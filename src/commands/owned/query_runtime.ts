/**
 * 쿼리 실행 브릿지 — upstream helper와 public API를 조합해
 * fast-default / compatibility path를 모두 한 곳에서 라우팅한다.
 */
import { pathToFileURL } from 'node:url';
import type { ExpandedQuery, QMDStore } from '@tobilu/qmd';
import { findUpstreamPackageRoot } from '#src/passthrough/upstream_locator.js';
import type { PlainQuerySearchRequest, QueryCommandInput } from './io/types.js';

type QueryResults = Awaited<ReturnType<QMDStore['search']>>;

type SearchHooks = {
  readonly onStrongSignal?: (topScore: number) => void;
  readonly onExpandStart?: () => void;
  readonly onExpand?: (original: string, expanded: ExpandedQuery[], elapsedMs: number) => void;
  readonly onEmbedStart?: (count: number) => void;
  readonly onEmbedDone?: (elapsedMs: number) => void;
  readonly onRerankStart?: (chunkCount: number) => void;
  readonly onRerankDone?: (elapsedMs: number) => void;
};

type HybridQueryFn = (
  store: QMDStore['internal'],
  query: string,
  options?: {
    readonly collection?: string;
    readonly limit?: number;
    readonly minScore?: number;
    readonly candidateLimit?: number;
    readonly explain?: boolean;
    readonly intent?: string;
    readonly skipRerank?: boolean;
    readonly hooks?: SearchHooks;
  },
) => Promise<QueryResults>;

type StructuredSearchFn = (
  store: QMDStore['internal'],
  searches: ExpandedQuery[],
  options?: {
    readonly collections?: string[];
    readonly limit?: number;
    readonly minScore?: number;
    readonly candidateLimit?: number;
    readonly explain?: boolean;
    readonly intent?: string;
    readonly skipRerank?: boolean;
    readonly hooks?: SearchHooks;
  },
) => Promise<QueryResults>;

export interface QueryRuntimeStageTelemetry {
  readonly retrievalKind:
    | 'cost-capped-structured'
    | 'compatibility-hybrid'
    | 'compatibility-public'
    | 'structured-compatibility';
  readonly embeddingApplied: boolean;
  readonly expansionApplied: boolean;
  readonly rerankApplied: boolean;
  readonly candidateWindow: number;
}

export interface QueryRuntimeDependencies {
  readonly hybridQuery?: HybridQueryFn;
  readonly onStageTelemetry?: (telemetry: QueryRuntimeStageTelemetry) => void;
  readonly structuredSearch?: StructuredSearchFn;
}

type QuerySearchRequest = QueryCommandInput | PlainQuerySearchRequest;

let queryRuntimePromise:
  | Promise<Required<Pick<QueryRuntimeDependencies, 'hybridQuery' | 'structuredSearch'>>>
  | undefined;

async function loadQueryRuntimeHelpers(): Promise<
  Required<Pick<QueryRuntimeDependencies, 'hybridQuery' | 'structuredSearch'>>
> {
  if (!queryRuntimePromise) {
    const storeUrl = pathToFileURL(`${findUpstreamPackageRoot()}/dist/store.js`).href;
    queryRuntimePromise = import(storeUrl).then((module) => ({
      hybridQuery: module.hybridQuery as HybridQueryFn,
      structuredSearch: module.structuredSearch as StructuredSearchFn,
    }));
  }

  return queryRuntimePromise;
}

function resolveQueryLimit(input: QuerySearchRequest): number {
  if (input.fetchLimit !== undefined) {
    return input.fetchLimit;
  }

  return input.all ? 500 : input.limit;
}

function hasVectorSearches(searches: readonly ExpandedQuery[]): boolean {
  return searches.some((search) => search.type === 'vec' || search.type === 'hyde');
}

function canUseStructuredBridge(store: QMDStore): boolean {
  return typeof store.internal.searchFTS === 'function';
}

function canUseHybridBridge(store: QMDStore): boolean {
  return typeof store.internal.searchFTS === 'function';
}

function createTelemetryCollector(
  dependencies: QueryRuntimeDependencies,
  seed: Pick<QueryRuntimeStageTelemetry, 'retrievalKind' | 'candidateWindow'>,
): {
  readonly hooks: SearchHooks;
  finalize: (
    defaults?: Partial<
      Pick<QueryRuntimeStageTelemetry, 'embeddingApplied' | 'expansionApplied' | 'rerankApplied'>
    >,
  ) => void;
} {
  let embeddingApplied = false;
  let expansionApplied = false;
  let rerankApplied = false;
  let emitted = false;

  const flush = (
    overrides: Partial<
      Pick<QueryRuntimeStageTelemetry, 'embeddingApplied' | 'expansionApplied' | 'rerankApplied'>
    > = {},
  ) => {
    emitted = true;
    dependencies.onStageTelemetry?.({
      retrievalKind: seed.retrievalKind,
      embeddingApplied: overrides.embeddingApplied ?? embeddingApplied,
      expansionApplied: overrides.expansionApplied ?? expansionApplied,
      rerankApplied: overrides.rerankApplied ?? rerankApplied,
      candidateWindow: seed.candidateWindow,
    });
  };

  return {
    hooks: {
      onExpand: (_original, expanded) => {
        expansionApplied = expanded.length > 0;
      },
      onEmbedStart: (count) => {
        embeddingApplied = count > 0;
      },
      onRerankStart: (chunkCount) => {
        rerankApplied = chunkCount > 0;
      },
      onRerankDone: () => {
        flush();
      },
      onEmbedDone: () => {
        if (!rerankApplied) {
          flush();
        }
      },
      onStrongSignal: () => {
        if (!embeddingApplied && !rerankApplied) {
          flush();
        }
      },
    },
    finalize: (defaults = {}) => {
      if (!emitted) {
        flush(defaults);
      }
    },
  };
}

export async function executeOwnedQuerySearch(
  store: QMDStore,
  input: QuerySearchRequest,
  selectedCollections: string[],
  dependencies: QueryRuntimeDependencies = {},
): Promise<QueryResults> {
  const limit = resolveQueryLimit(input);
  const singleCollection = selectedCollections.length === 1 ? selectedCollections[0] : undefined;

  if (input.queryMode === 'structured' && 'queries' in input && input.queries) {
    if (input.candidateLimit === undefined) {
      const result = await store.search({
        queries: input.queries,
        collections: selectedCollections.length > 0 ? selectedCollections : undefined,
        limit,
        minScore: input.minScore,
        explain: input.explain,
        intent: input.intent,
        ...(input.disableRerank ? { rerank: false } : {}),
      });
      dependencies.onStageTelemetry?.({
        retrievalKind: 'structured-compatibility',
        candidateWindow: 40,
        embeddingApplied: false,
        expansionApplied: false,
        rerankApplied: false,
      });
      return result;
    }

    const structuredSearch =
      dependencies.structuredSearch ?? (await loadQueryRuntimeHelpers()).structuredSearch;
    const candidateWindow = input.candidateLimit ?? 40;
    const telemetry = createTelemetryCollector(dependencies, {
      retrievalKind: 'structured-compatibility',
      candidateWindow,
    });
    const result = await structuredSearch(store.internal, input.queries, {
      collections: selectedCollections.length > 0 ? selectedCollections : undefined,
      limit,
      minScore: input.minScore,
      candidateLimit: candidateWindow,
      explain: input.explain,
      intent: input.intent,
      skipRerank: input.disableRerank,
      hooks: telemetry.hooks,
    });

    telemetry.finalize({
      embeddingApplied: hasVectorSearches(input.queries),
      expansionApplied: false,
      rerankApplied: !input.disableRerank && result.length > 0,
    });

    return result;
  }

  if (
    input.queryMode === 'plain' &&
    'preExpandedQueries' in input &&
    input.preExpandedQueries &&
    input.preExpandedQueries.length > 0
  ) {
    if (selectedCollections.length > 1) {
      const result = await store.search({
        query: input.query,
        collections: selectedCollections,
        limit,
        minScore: input.minScore,
        explain: input.explain,
        intent: input.intent,
        ...(input.disableRerank ? { rerank: false } : {}),
      });
      dependencies.onStageTelemetry?.({
        retrievalKind: 'compatibility-public',
        candidateWindow: 40,
        embeddingApplied: true,
        expansionApplied: true,
        rerankApplied: !input.disableRerank && result.length > 0,
      });
      return result;
    }

    if (!canUseStructuredBridge(store) && !dependencies.structuredSearch) {
      const result = await store.search({
        query: input.query,
        collections: selectedCollections.length > 0 ? selectedCollections : undefined,
        limit,
        minScore: input.minScore,
        explain: input.explain,
        intent: input.intent,
        ...(input.disableRerank ? { rerank: false } : {}),
      });
      dependencies.onStageTelemetry?.({
        retrievalKind: 'cost-capped-structured',
        candidateWindow: input.candidateLimit ?? Math.max(input.limit, 1),
        embeddingApplied: false,
        expansionApplied: false,
        rerankApplied: false,
      });
      return result;
    }

    const structuredSearch =
      dependencies.structuredSearch ?? (await loadQueryRuntimeHelpers()).structuredSearch;
    const candidateWindow = input.candidateLimit ?? Math.max(input.limit, 1);
    const telemetry = createTelemetryCollector(dependencies, {
      retrievalKind: 'cost-capped-structured',
      candidateWindow,
    });

    const result = await structuredSearch(store.internal, input.preExpandedQueries, {
      collections: selectedCollections.length > 0 ? selectedCollections : undefined,
      limit,
      minScore: input.minScore,
      candidateLimit: candidateWindow,
      explain: input.explain,
      intent: input.intent,
      skipRerank: input.disableRerank,
      hooks: telemetry.hooks,
    });

    telemetry.finalize({
      embeddingApplied: hasVectorSearches(input.preExpandedQueries),
      expansionApplied: false,
      rerankApplied: !input.disableRerank && result.length > 0,
    });

    return result;
  }

  if (
    input.queryMode === 'plain' &&
    (('runtimeKind' in input && input.runtimeKind === 'compatibility-hybrid') ||
      input.candidateLimit !== undefined) &&
    selectedCollections.length <= 1
  ) {
    const candidateWindow = input.candidateLimit ?? 40;

    if (!canUseHybridBridge(store) && !dependencies.hybridQuery) {
      const result = await store.search({
        query: input.query,
        collections: selectedCollections.length > 0 ? selectedCollections : undefined,
        limit,
        minScore: input.minScore,
        explain: input.explain,
        intent: input.intent,
        ...(input.disableRerank ? { rerank: false } : {}),
      });
      dependencies.onStageTelemetry?.({
        retrievalKind: 'compatibility-hybrid',
        candidateWindow,
        embeddingApplied: false,
        expansionApplied: false,
        rerankApplied: false,
      });
      return result;
    }

    const hybridQuery = dependencies.hybridQuery ?? (await loadQueryRuntimeHelpers()).hybridQuery;
    const telemetry = createTelemetryCollector(dependencies, {
      retrievalKind: 'compatibility-hybrid',
      candidateWindow,
    });

    const result = await hybridQuery(store.internal, input.query, {
      collection: singleCollection,
      limit,
      minScore: input.minScore,
      candidateLimit: input.candidateLimit,
      explain: input.explain,
      intent: input.intent,
      skipRerank: input.disableRerank,
      hooks: telemetry.hooks,
    });

    telemetry.finalize({
      embeddingApplied: true,
      rerankApplied: !input.disableRerank && result.length > 0,
    });

    return result;
  }

  if (input.candidateLimit === undefined) {
    const result = await store.search({
      query: input.query,
      collections: selectedCollections.length > 0 ? selectedCollections : undefined,
      limit,
      minScore: input.minScore,
      explain: input.explain,
      intent: input.intent,
      ...(input.disableRerank ? { rerank: false } : {}),
    });
    dependencies.onStageTelemetry?.({
      retrievalKind: 'compatibility-public',
      candidateWindow: 40,
      embeddingApplied: false,
      expansionApplied: false,
      rerankApplied: false,
    });
    return result;
  }

  if (selectedCollections.length > 1) {
    throw new Error(
      'The `--candidate-limit` option currently supports at most one collection filter.',
    );
  }

  if (!canUseHybridBridge(store) && !dependencies.hybridQuery) {
    const result = await store.search({
      query: input.query,
      collections: selectedCollections.length > 0 ? selectedCollections : undefined,
      limit,
      minScore: input.minScore,
      explain: input.explain,
      intent: input.intent,
      ...(input.disableRerank ? { rerank: false } : {}),
    });
    dependencies.onStageTelemetry?.({
      retrievalKind: 'compatibility-hybrid',
      candidateWindow: input.candidateLimit,
      embeddingApplied: false,
      expansionApplied: false,
      rerankApplied: false,
    });
    return result;
  }

  const hybridQuery = dependencies.hybridQuery ?? (await loadQueryRuntimeHelpers()).hybridQuery;
  const telemetry = createTelemetryCollector(dependencies, {
    retrievalKind: 'compatibility-hybrid',
    candidateWindow: input.candidateLimit,
  });
  const result = await hybridQuery(store.internal, input.query, {
    collection: singleCollection,
    limit,
    minScore: input.minScore,
    candidateLimit: input.candidateLimit,
    explain: input.explain,
    intent: input.intent,
    skipRerank: input.disableRerank,
    hooks: telemetry.hooks,
  });
  telemetry.finalize({
    embeddingApplied: true,
    rerankApplied: !input.disableRerank && result.length > 0,
  });
  return result;
}
