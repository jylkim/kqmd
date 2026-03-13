import { pathToFileURL } from 'node:url';
import type { ExpandedQuery, QMDStore } from '@tobilu/qmd';
import { findUpstreamPackageRoot } from '../../passthrough/upstream_locator.js';
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
  });
}
