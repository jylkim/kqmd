import { readFile } from 'node:fs/promises';

import type { QMDStore } from '@tobilu/qmd';

import type { CommandExecutionContext, CommandExecutionResult } from '#src/types/command.js';
import {
  fromExecutionFailure,
  fromRuntimeFailure,
  isOwnedCommandError,
  isOwnedRuntimeFailure,
  toExecutionResult,
  validationError,
} from './io/errors.js';
import { parseOwnedBenchInput } from './io/parse.js';
import type { BenchCommandInput, OwnedCommandError, QueryCommandInput } from './io/types.js';
import { resolveSelectedCollections } from './io/validate.js';
import { executeQueryCore } from './query_core.js';
import { probeQueryLexicalCandidates } from './query_lexical_candidates.js';
import type { OwnedRuntimeDependencies, OwnedRuntimeFailure } from './runtime.js';
import { withOwnedStore } from './runtime.js';

type BenchmarkQueryType = 'exact' | 'semantic' | 'topical' | 'cross-domain' | 'alias';

type BenchmarkQuery = {
  readonly id: string;
  readonly query: string;
  readonly type: BenchmarkQueryType;
  readonly description: string;
  readonly expected_files: string[];
  readonly expected_in_top_k: number;
};

type BenchmarkFixture = {
  readonly description: string;
  readonly version: number;
  readonly collection?: string;
  readonly queries: BenchmarkQuery[];
};

type BenchBackendName = 'bm25' | 'vector' | 'hybrid' | 'full';
type BenchSide = 'upstream' | 'current';

type BackendResult = {
  readonly precision_at_k: number;
  readonly recall: number;
  readonly mrr: number;
  readonly f1: number;
  readonly hits_at_k: number;
  readonly total_expected: number;
  readonly latency_ms: number;
  readonly top_files: string[];
};

type QueryResult = {
  readonly id: string;
  readonly query: string;
  readonly type: string;
  readonly backends: Record<BenchBackendName, BackendResult>;
};

type BenchmarkResult = {
  readonly timestamp: string;
  readonly fixture: string;
  readonly results: QueryResult[];
  readonly summary: Record<
    BenchBackendName,
    {
      readonly avg_precision: number;
      readonly avg_recall: number;
      readonly avg_mrr: number;
      readonly avg_f1: number;
      readonly avg_latency_ms: number;
    }
  >;
};

type BenchComparisonResult = {
  readonly schema_version: '1';
  readonly baseline: 'upstream';
  readonly fixture: string;
  readonly collection?: string;
  readonly upstream: BenchmarkResult;
  readonly current: BenchmarkResult;
  readonly representatives: Array<{
    readonly backend: BenchBackendName;
    readonly query_id: string;
    readonly upstream_f1: number;
    readonly current_f1: number;
    readonly delta_f1: number;
  }>;
};

type BenchCommandSuccess = {
  readonly comparison: BenchComparisonResult;
};

export interface BenchCommandDependencies {
  readonly run?: (
    context: CommandExecutionContext,
    input: BenchCommandInput,
    runtimeDependencies?: OwnedRuntimeDependencies,
  ) => Promise<BenchCommandSuccess | OwnedCommandError | OwnedRuntimeFailure>;
  readonly runtimeDependencies?: OwnedRuntimeDependencies;
  readonly now?: () => Date;
  readonly readFileImpl?: typeof readFile;
}

function normalizePath(path: string): string {
  const stripped = path.startsWith('qmd://')
    ? (() => {
        const withoutScheme = path.slice('qmd://'.length);
        const slashIndex = withoutScheme.indexOf('/');
        return slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : withoutScheme;
      })()
    : path;

  return stripped.toLowerCase().replace(/^\/+|\/+$/g, '');
}

function pathsMatch(result: string, expected: string): boolean {
  const normalizedResult = normalizePath(result);
  const normalizedExpected = normalizePath(expected);
  return (
    normalizedResult === normalizedExpected ||
    normalizedResult.endsWith(normalizedExpected) ||
    normalizedExpected.endsWith(normalizedResult)
  );
}

function scoreResults(
  resultFiles: readonly string[],
  expectedFiles: readonly string[],
  topK: number,
) {
  const topFiles = resultFiles.slice(0, topK);
  let hitsAtK = 0;
  for (const expected of expectedFiles) {
    if (topFiles.some((result) => pathsMatch(result, expected))) {
      hitsAtK += 1;
    }
  }

  let totalHits = 0;
  for (const expected of expectedFiles) {
    if (resultFiles.some((result) => pathsMatch(result, expected))) {
      totalHits += 1;
    }
  }

  let mrr = 0;
  for (const [index, result] of resultFiles.entries()) {
    if (expectedFiles.some((expected) => pathsMatch(result, expected))) {
      mrr = 1 / (index + 1);
      break;
    }
  }

  const denominator = Math.min(topK, expectedFiles.length);
  const precision_at_k = denominator > 0 ? hitsAtK / denominator : 0;
  const recall = expectedFiles.length > 0 ? totalHits / expectedFiles.length : 0;
  const f1 =
    precision_at_k + recall > 0 ? (2 * precision_at_k * recall) / (precision_at_k + recall) : 0;

  return {
    precision_at_k,
    recall,
    mrr,
    f1,
    hits_at_k: hitsAtK,
  };
}

function computeSummary(results: readonly QueryResult[]): BenchmarkResult['summary'] {
  const backends: BenchBackendName[] = ['bm25', 'vector', 'hybrid', 'full'];
  const summary = {} as BenchmarkResult['summary'];

  for (const backend of backends) {
    let totalPrecision = 0;
    let totalRecall = 0;
    let totalMrr = 0;
    let totalF1 = 0;
    let totalLatency = 0;
    let count = 0;

    for (const result of results) {
      const item = result.backends[backend];
      totalPrecision += item.precision_at_k;
      totalRecall += item.recall;
      totalMrr += item.mrr;
      totalF1 += item.f1;
      totalLatency += item.latency_ms;
      count += 1;
    }

    summary[backend] = {
      avg_precision: count > 0 ? totalPrecision / count : 0,
      avg_recall: count > 0 ? totalRecall / count : 0,
      avg_mrr: count > 0 ? totalMrr / count : 0,
      avg_f1: count > 0 ? totalF1 / count : 0,
      avg_latency_ms: count > 0 ? totalLatency / count : 0,
    };
  }

  return summary;
}

function formatMetric(value: number): string {
  return value.toFixed(3).padStart(6);
}

function formatLatency(value: number): string {
  return `${Math.round(value).toString().padStart(5)}ms`;
}

function buildCliOutput(result: BenchComparisonResult): string {
  const lines = [
    `Benchmark: ${result.fixture}`,
    result.collection ? `Collection: ${result.collection}` : undefined,
    '',
    'Summary',
    '-------',
    'Backend  Side      P@k    Recall   MRR     F1     Avg',
  ].filter((line): line is string => Boolean(line));

  const backends: BenchBackendName[] = ['bm25', 'vector', 'hybrid', 'full'];
  for (const backend of backends) {
    const upstream = result.upstream.summary[backend];
    const current = result.current.summary[backend];

    lines.push(
      `${backend.padEnd(8)}upstream ${formatMetric(upstream.avg_precision)} ${formatMetric(upstream.avg_recall)} ${formatMetric(upstream.avg_mrr)} ${formatMetric(upstream.avg_f1)} ${formatLatency(upstream.avg_latency_ms)}`,
    );
    lines.push(
      `${''.padEnd(8)}current  ${formatMetric(current.avg_precision)} ${formatMetric(current.avg_recall)} ${formatMetric(current.avg_mrr)} ${formatMetric(current.avg_f1)} ${formatLatency(current.avg_latency_ms)}`,
    );
  }

  if (result.representatives.length > 0) {
    lines.push('', 'Representative Cases', '--------------------');
    for (const representative of result.representatives) {
      const direction =
        representative.delta_f1 > 0
          ? 'current-better'
          : representative.delta_f1 < 0
            ? 'upstream-better'
            : 'same';
      lines.push(
        `${representative.query_id} / ${representative.backend}: ${direction} (delta F1 ${representative.delta_f1.toFixed(3)})`,
      );
    }
  }

  return lines.join('\n');
}

async function readFixture(
  fixturePath: string,
  readFileImpl: typeof readFile,
): Promise<BenchmarkFixture | OwnedCommandError> {
  try {
    const raw = await readFileImpl(fixturePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BenchmarkFixture>;

    if (
      typeof parsed.description !== 'string' ||
      typeof parsed.version !== 'number' ||
      !Array.isArray(parsed.queries)
    ) {
      return validationError('Invalid fixture: missing required benchmark fields.');
    }

    for (const query of parsed.queries) {
      if (
        !query ||
        typeof query.id !== 'string' ||
        typeof query.query !== 'string' ||
        typeof query.type !== 'string' ||
        typeof query.description !== 'string' ||
        !Array.isArray(query.expected_files) ||
        typeof query.expected_in_top_k !== 'number'
      ) {
        return validationError(
          'Invalid fixture: each query must define id, query, type, description, expected_files, and expected_in_top_k.',
        );
      }
    }

    return parsed as BenchmarkFixture;
  } catch (error) {
    return validationError(
      `Failed to read benchmark fixture \`${fixturePath}\`: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function resolveBenchCollection(
  store: QMDStore,
  requestedCollection: string | undefined,
): Promise<string | undefined | OwnedCommandError> {
  if (requestedCollection === undefined) {
    return undefined;
  }

  const [collections, defaults] = await Promise.all([
    store.listCollections(),
    store.getDefaultCollectionNames(),
  ]);

  const resolved = resolveSelectedCollections(
    [requestedCollection],
    collections.map((collection) => collection.name),
    defaults,
  );

  if (isOwnedCommandError(resolved)) {
    return resolved;
  }

  return resolved[0];
}

async function runUpstreamBackend(
  store: QMDStore,
  backend: BenchBackendName,
  query: string,
  limit: number,
  collection: string | undefined,
): Promise<string[]> {
  switch (backend) {
    case 'bm25':
      return (await store.searchLex(query, { limit, collection })).map((row) => row.filepath);
    case 'vector':
      return (await store.searchVector(query, { limit, collection })).map((row) => row.filepath);
    case 'hybrid':
      return (
        await store.search({
          query,
          limit,
          collection,
          rerank: false,
        })
      ).map((row) => row.file);
    case 'full':
      return (
        await store.search({
          query,
          limit,
          collection,
          rerank: true,
        })
      ).map((row) => row.file);
  }
}

async function runCurrentBm25(
  store: QMDStore,
  query: string,
  limit: number,
  collection: string | undefined,
): Promise<string[]> {
  const selectedCollections = collection ? [collection] : await store.getDefaultCollectionNames();
  const fetchLimit = Math.max(50, limit * 2);
  const probe = await probeQueryLexicalCandidates(store, query, selectedCollections, fetchLimit);
  return probe.rows.slice(0, limit).map((row) => row.displayPath);
}

function createQueryInput(
  query: string,
  limit: number,
  collection: string | undefined,
  disableRerank: boolean,
): QueryCommandInput {
  return {
    query,
    displayQuery: query,
    format: 'json',
    limit,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    collections: collection ? [collection] : undefined,
    explain: false,
    queryMode: 'plain',
    disableRerank,
  };
}

async function runCurrentQueryBackend(
  store: QMDStore,
  query: string,
  limit: number,
  collection: string | undefined,
  disableRerank: boolean,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const result = await executeQueryCore(
    store,
    createQueryInput(query, limit, collection, disableRerank),
    env,
  );
  if (isOwnedCommandError(result)) {
    throw new Error(result.stderr);
  }

  return result.rows.slice(0, limit).map((row) => row.displayPath);
}

async function runCurrentBackend(
  store: QMDStore,
  backend: BenchBackendName,
  query: string,
  limit: number,
  collection: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  switch (backend) {
    case 'bm25':
      return runCurrentBm25(store, query, limit, collection);
    case 'vector':
      return (await store.searchVector(query, { limit, collection })).map((row) => row.filepath);
    case 'hybrid':
      return runCurrentQueryBackend(store, query, limit, collection, true, env);
    case 'full':
      return runCurrentQueryBackend(store, query, limit, collection, false, env);
  }
}

async function runBenchSide(args: {
  readonly store: QMDStore;
  readonly fixturePath: string;
  readonly fixture: BenchmarkFixture;
  readonly collection?: string;
  readonly side: BenchSide;
  readonly env: NodeJS.ProcessEnv;
  readonly now: () => Date;
}): Promise<BenchmarkResult> {
  const backends: BenchBackendName[] = ['bm25', 'vector', 'hybrid', 'full'];
  const results: QueryResult[] = [];

  for (const query of args.fixture.queries) {
    const backendResults = {} as QueryResult['backends'];
    const limit = Math.max(query.expected_in_top_k, 10);

    for (const backend of backends) {
      const startedAt = Date.now();
      try {
        const resultFiles =
          args.side === 'upstream'
            ? await runUpstreamBackend(args.store, backend, query.query, limit, args.collection)
            : await runCurrentBackend(
                args.store,
                backend,
                query.query,
                limit,
                args.collection,
                args.env,
              );

        backendResults[backend] = {
          ...scoreResults(resultFiles, query.expected_files, query.expected_in_top_k),
          total_expected: query.expected_files.length,
          latency_ms: Date.now() - startedAt,
          top_files: resultFiles.slice(0, 10),
        };
      } catch {
        backendResults[backend] = {
          precision_at_k: 0,
          recall: 0,
          mrr: 0,
          f1: 0,
          hits_at_k: 0,
          total_expected: query.expected_files.length,
          latency_ms: Date.now() - startedAt,
          top_files: [],
        };
      }
    }

    results.push({
      id: query.id,
      query: query.query,
      type: query.type,
      backends: backendResults,
    });
  }

  return {
    timestamp: args.now().toISOString().replace(/[:.]/g, '').slice(0, 15),
    fixture: args.fixturePath,
    results,
    summary: computeSummary(results),
  };
}

function buildRepresentatives(
  upstream: BenchmarkResult,
  current: BenchmarkResult,
): BenchComparisonResult['representatives'] {
  const items: BenchComparisonResult['representatives'] = [];
  const backends: BenchBackendName[] = ['bm25', 'vector', 'hybrid', 'full'];

  for (const currentQuery of current.results) {
    const upstreamQuery = upstream.results.find((query) => query.id === currentQuery.id);
    if (!upstreamQuery) {
      continue;
    }

    for (const backend of backends) {
      const upstreamResult = upstreamQuery.backends[backend];
      const currentResult = currentQuery.backends[backend];
      items.push({
        backend,
        query_id: currentQuery.id,
        upstream_f1: upstreamResult.f1,
        current_f1: currentResult.f1,
        delta_f1: Number((currentResult.f1 - upstreamResult.f1).toFixed(3)),
      });
    }
  }

  return items
    .sort((left, right) => Math.abs(right.delta_f1) - Math.abs(left.delta_f1))
    .slice(0, 3);
}

async function runBenchCommand(
  context: CommandExecutionContext,
  input: BenchCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
  options: { readonly now?: () => Date; readonly readFileImpl?: typeof readFile } = {},
): Promise<BenchCommandSuccess | OwnedCommandError | OwnedRuntimeFailure> {
  const readFileImpl = options.readFileImpl ?? readFile;
  const fixture = await readFixture(input.fixturePath, readFileImpl);
  if (isOwnedCommandError(fixture)) {
    return fixture;
  }

  return withOwnedStore(
    'bench',
    context,
    async (session) => {
      const collection = input.collection ?? fixture.collection;
      const resolvedCollection = await resolveBenchCollection(session.store, collection);
      if (isOwnedCommandError(resolvedCollection)) {
        return resolvedCollection;
      }

      const now = options.now ?? (() => new Date());
      const upstream = await runBenchSide({
        store: session.store,
        fixturePath: input.fixturePath,
        fixture,
        collection: resolvedCollection,
        side: 'upstream',
        env: runtimeDependencies?.env ?? process.env,
        now,
      });
      const current = await runBenchSide({
        store: session.store,
        fixturePath: input.fixturePath,
        fixture,
        collection: resolvedCollection,
        side: 'current',
        env: runtimeDependencies?.env ?? process.env,
        now,
      });

      return {
        comparison: {
          schema_version: '1',
          baseline: 'upstream',
          fixture: input.fixturePath,
          collection: resolvedCollection,
          upstream,
          current,
          representatives: buildRepresentatives(upstream, current),
        },
      };
    },
    runtimeDependencies,
  );
}

export async function handleBenchCommand(
  context: CommandExecutionContext,
  dependencies: BenchCommandDependencies = {},
): Promise<CommandExecutionResult> {
  const parsed = parseOwnedBenchInput(context);
  if (parsed.kind !== 'ok') {
    return toExecutionResult(parsed);
  }

  try {
    const result = await (
      dependencies.run ??
      ((innerContext, input, runtimeDeps) =>
        runBenchCommand(innerContext, input, runtimeDeps, {
          now: dependencies.now,
          readFileImpl: dependencies.readFileImpl,
        }))
    )(context, parsed.input, dependencies.runtimeDependencies);

    if (isOwnedRuntimeFailure(result)) {
      return toExecutionResult(fromRuntimeFailure(result));
    }

    if (isOwnedCommandError(result)) {
      return toExecutionResult(result);
    }

    return {
      exitCode: 0,
      stdout: parsed.input.json
        ? JSON.stringify(result.comparison, null, 2)
        : buildCliOutput(result.comparison),
    };
  } catch (error) {
    return toExecutionResult(fromExecutionFailure('bench', error));
  }
}
