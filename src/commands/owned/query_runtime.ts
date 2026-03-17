/**
 * 쿼리 실행 브릿지 — upstream qmd의 내부 함수를 lazy-load하여 호출한다.
 *
 * --candidate-limit 옵션을 사용할 때, store.search()의 공개 API로는
 * 후보 수를 제어할 수 없으므로, upstream의 hybridQuery/structuredSearch를
 * 동적으로 import하여 직접 호출한다.
 *
 * candidate-limit이 없는 일반 쿼리는 store.search() 공개 API를 그대로 사용한다.
 */
import { pathToFileURL } from 'node:url';
import type { ExpandedQuery, QMDStore } from '@tobilu/qmd';
import { findUpstreamPackageRoot } from '#src/passthrough/upstream_locator.js';
import type { QueryCommandInput } from './io/types.js';

type QueryResults = Awaited<ReturnType<QMDStore['search']>>;

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
  },
) => Promise<QueryResults>;

export interface QueryRuntimeDependencies {
  readonly hybridQuery?: HybridQueryFn;
  readonly structuredSearch?: StructuredSearchFn;
}

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

function resolveQueryLimit(input: QueryCommandInput): number {
  if (input.fetchLimit !== undefined) {
    return input.fetchLimit;
  }

  return input.all ? 500 : input.limit;
}

export async function executeOwnedQuerySearch(
  store: QMDStore,
  input: QueryCommandInput,
  selectedCollections: string[],
  dependencies: QueryRuntimeDependencies = {},
): Promise<QueryResults> {
  const limit = resolveQueryLimit(input);

  if (input.queryMode === 'structured' && input.queries) {
    if (input.candidateLimit === undefined) {
      return store.search({
        queries: input.queries,
        collections: selectedCollections.length > 0 ? selectedCollections : undefined,
        limit,
        minScore: input.minScore,
        explain: input.explain,
        intent: input.intent,
        ...(input.disableRerank ? { rerank: false } : {}),
      });
    }

    const structuredSearch =
      dependencies.structuredSearch ?? (await loadQueryRuntimeHelpers()).structuredSearch;

    return structuredSearch(store.internal, input.queries, {
      collections: selectedCollections.length > 0 ? selectedCollections : undefined,
      limit,
      minScore: input.minScore,
      candidateLimit: input.candidateLimit,
      explain: input.explain,
      intent: input.intent,
      skipRerank: input.disableRerank,
    });
  }

  if (input.candidateLimit === undefined) {
    return store.search({
      query: input.query,
      collections: selectedCollections.length > 0 ? selectedCollections : undefined,
      limit,
      minScore: input.minScore,
      explain: input.explain,
      intent: input.intent,
      ...(input.disableRerank ? { rerank: false } : {}),
    });
  }

  if (selectedCollections.length > 1) {
    throw new Error(
      'The `--candidate-limit` option currently supports at most one collection filter.',
    );
  }

  const hybridQuery = dependencies.hybridQuery ?? (await loadQueryRuntimeHelpers()).hybridQuery;
  return hybridQuery(store.internal, input.query, {
    collection: selectedCollections[0],
    limit,
    minScore: input.minScore,
    candidateLimit: input.candidateLimit,
    explain: input.explain,
    intent: input.intent,
    skipRerank: input.disableRerank,
  });
}
