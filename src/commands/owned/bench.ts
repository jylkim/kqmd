import { createHash } from 'node:crypto';
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
import {
  resolveSelectedCollections,
  validatePlainQueryText,
  validateSingleLineQueryText,
} from './io/validate.js';
import { executeQueryCore } from './query_core.js';
import { probeQueryLexicalCandidates } from './query_lexical_candidates.js';
import type { OwnedRuntimeDependencies, OwnedRuntimeFailure } from './runtime.js';
import { withOwnedStore } from './runtime.js';

type BenchmarkQueryType = 'exact' | 'semantic' | 'topical' | 'cross-domain' | 'alias';
type BenchBackendName = 'bm25' | 'vector' | 'hybrid' | 'full';
type BenchSide = 'upstream' | 'current';
type BackendStatus = 'ok' | 'unavailable';
type SummaryStatus = 'ok' | 'partial' | 'unavailable';

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

type BenchCollectionScope = {
  readonly mode: 'single-collection';
  readonly label: string;
  readonly collection: string;
};

type BackendResult = {
  readonly status: BackendStatus;
  readonly precision_at_k: number | null;
  readonly recall: number | null;
  readonly mrr: number | null;
  readonly f1: number | null;
  readonly hits_at_k: number | null;
  readonly total_expected: number;
  readonly latency_ms: number | null;
  readonly top_files: string[];
};

type QueryResult = {
  readonly id: string;
  readonly type: string;
  readonly backends: Record<BenchBackendName, BackendResult>;
};

type SummaryResult = {
  readonly status: SummaryStatus;
  readonly available_runs: number;
  readonly total_runs: number;
  readonly unavailable_runs: number;
  readonly avg_precision: number | null;
  readonly avg_recall: number | null;
  readonly avg_mrr: number | null;
  readonly avg_f1: number | null;
  readonly avg_latency_ms: number | null;
};

type BenchmarkResult = {
  readonly timestamp: string;
  readonly fixture_label: string;
  readonly results: QueryResult[];
  readonly summary: Record<BenchBackendName, SummaryResult>;
};

type BenchComparisonResult = {
  readonly schema_version: '1';
  readonly baseline: 'upstream';
  readonly fixture_label: string;
  readonly collection: string;
  readonly measurement_policy: {
    readonly collection_scope: {
      readonly mode: BenchCollectionScope['mode'];
      readonly label: string;
    };
    readonly latency_scope: 'single-run-per-backend';
    readonly latency_comparable: false;
    readonly latency_note: string;
    readonly raw_queries_exposed: false;
  };
  readonly upstream: BenchmarkResult;
  readonly current: BenchmarkResult;
  readonly representatives: Array<{
    readonly backend: BenchBackendName;
    readonly query_id: string;
    readonly upstream_f1: number | null;
    readonly current_f1: number | null;
    readonly delta_f1: number | null;
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

const ALLOWED_QUERY_TYPES = new Set<BenchmarkQueryType>([
  'exact',
  'semantic',
  'topical',
  'cross-domain',
  'alias',
]);

const BENCH_LATENCY_NOTE =
  'Latency is informational only. Upstream measures direct store API calls; current measures the owned K-QMD command path.';

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }

  return false;
}

function stripQmdScheme(path: string): string {
  if (!path.startsWith('qmd://')) {
    return path;
  }

  const withoutScheme = path.slice('qmd://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  return slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : withoutScheme;
}

function normalizeRelativePath(path: string): string {
  return stripQmdScheme(path)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function isSafeRelativePath(path: string): boolean {
  const normalized = normalizeRelativePath(path);
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    return false;
  }

  if (
    path.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) && !path.startsWith('qmd://'))
  ) {
    return false;
  }

  return normalized
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function sanitizeOutputPath(path: string): string {
  return isSafeRelativePath(path) ? normalizeRelativePath(path) : '[redacted-path]';
}

function buildFixtureLabel(rawFixture: string): string {
  return `fixture-${createHash('sha256').update(rawFixture).digest('hex').slice(0, 8)}`;
}

function normalizePath(path: string): string {
  return normalizeRelativePath(path).toLowerCase();
}

function pathsMatch(result: string, expected: string): boolean {
  const normalizedResult = normalizePath(result);
  const normalizedExpected = normalizePath(expected);

  return (
    normalizedResult === normalizedExpected || normalizedResult.endsWith(`/${normalizedExpected}`)
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
    let availableRuns = 0;

    for (const result of results) {
      const item = result.backends[backend];
      if (item.status !== 'ok') {
        continue;
      }

      totalPrecision += item.precision_at_k ?? 0;
      totalRecall += item.recall ?? 0;
      totalMrr += item.mrr ?? 0;
      totalF1 += item.f1 ?? 0;
      totalLatency += item.latency_ms ?? 0;
      availableRuns += 1;
    }

    const totalRuns = results.length;
    summary[backend] = {
      status: availableRuns === 0 ? 'unavailable' : availableRuns < totalRuns ? 'partial' : 'ok',
      available_runs: availableRuns,
      total_runs: totalRuns,
      unavailable_runs: totalRuns - availableRuns,
      avg_precision: availableRuns > 0 ? totalPrecision / availableRuns : null,
      avg_recall: availableRuns > 0 ? totalRecall / availableRuns : null,
      avg_mrr: availableRuns > 0 ? totalMrr / availableRuns : null,
      avg_f1: availableRuns > 0 ? totalF1 / availableRuns : null,
      avg_latency_ms: availableRuns > 0 ? totalLatency / availableRuns : null,
    };
  }

  return summary;
}

function formatMetric(value: number | null): string {
  if (value === null) {
    return '   n/a';
  }

  return value.toFixed(3).padStart(6);
}

function formatLatency(value: number | null): string {
  if (value === null) {
    return '  n/a';
  }

  return `${Math.round(value).toString().padStart(5)}ms`;
}

function buildCliOutput(result: BenchComparisonResult): string {
  const lines = [
    `Benchmark: ${result.fixture_label}`,
    `Collection scope: ${result.measurement_policy.collection_scope.label}`,
    'Latency: single-run-per-backend (not apples-to-apples comparable)',
    '',
    'Summary',
    '-------',
    'Backend  Side      Status       P@k    Recall   MRR     F1     Avg',
  ];

  const backends: BenchBackendName[] = ['bm25', 'vector', 'hybrid', 'full'];
  for (const backend of backends) {
    const upstream = result.upstream.summary[backend];
    const current = result.current.summary[backend];

    lines.push(
      `${backend.padEnd(8)}upstream ${upstream.status.padEnd(12)} ${formatMetric(upstream.avg_precision)} ${formatMetric(upstream.avg_recall)} ${formatMetric(upstream.avg_mrr)} ${formatMetric(upstream.avg_f1)} ${formatLatency(upstream.avg_latency_ms)}`,
    );
    lines.push(
      `${''.padEnd(8)}current  ${current.status.padEnd(12)} ${formatMetric(current.avg_precision)} ${formatMetric(current.avg_recall)} ${formatMetric(current.avg_mrr)} ${formatMetric(current.avg_f1)} ${formatLatency(current.avg_latency_ms)}`,
    );
  }

  lines.push(
    '',
    '* Unavailable backend rows are excluded from averages.',
    `* ${result.measurement_policy.latency_note}`,
  );

  if (result.representatives.length > 0) {
    lines.push('', 'Representative Cases', '--------------------');
    for (const representative of result.representatives) {
      const direction =
        representative.delta_f1 === null
          ? 'unavailable'
          : representative.delta_f1 > 0
            ? 'current-better'
            : representative.delta_f1 < 0
              ? 'upstream-better'
              : 'same';

      lines.push(
        `${representative.query_id} / ${representative.backend}: ${direction}${representative.delta_f1 === null ? '' : ` (delta F1 ${representative.delta_f1.toFixed(3)})`}`,
      );
    }
  }

  return lines.join('\n');
}

async function readFixture(
  fixturePath: string,
  readFileImpl: typeof readFile,
): Promise<
  { readonly fixture: BenchmarkFixture; readonly fixtureLabel: string } | OwnedCommandError
> {
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

    if (parsed.queries.length === 0) {
      return validationError('Invalid fixture: queries must contain at least one benchmark query.');
    }

    const seenIds = new Set<string>();
    const queries: BenchmarkQuery[] = [];

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

      if (seenIds.has(query.id)) {
        return validationError(`Invalid fixture: duplicate benchmark query id "${query.id}".`);
      }
      seenIds.add(query.id);

      const idValidation = validateSingleLineQueryText(query.id, 'Benchmark query id');
      if (idValidation) {
        return idValidation;
      }

      const queryValidation = validatePlainQueryText(query.query);
      if (queryValidation) {
        return queryValidation;
      }

      const descriptionValidation = validateSingleLineQueryText(
        query.description,
        `Benchmark query ${query.id} description`,
      );
      if (descriptionValidation) {
        return descriptionValidation;
      }

      if (!ALLOWED_QUERY_TYPES.has(query.type)) {
        return validationError(
          `Invalid fixture: benchmark query type must be one of ${[...ALLOWED_QUERY_TYPES].join(', ')}.`,
        );
      }

      if (
        !Number.isInteger(query.expected_in_top_k) ||
        query.expected_in_top_k < 1 ||
        query.expected_in_top_k > query.expected_files.length
      ) {
        return validationError(
          `Invalid fixture: benchmark query ${query.id} must set expected_in_top_k to a positive integer within expected_files length.`,
        );
      }

      if (
        query.expected_files.length === 0 ||
        query.expected_files.some(
          (expectedPath) =>
            typeof expectedPath !== 'string' ||
            expectedPath.length === 0 ||
            !isSafeRelativePath(expectedPath),
        )
      ) {
        return validationError(
          `Invalid fixture: benchmark query ${query.id} must define safe relative expected_files paths.`,
        );
      }

      queries.push({
        id: query.id,
        query: query.query,
        type: query.type,
        description: query.description,
        expected_files: [...query.expected_files],
        expected_in_top_k: query.expected_in_top_k,
      });
    }

    return {
      fixture: {
        description: parsed.description,
        version: parsed.version,
        collection: parsed.collection,
        queries,
      },
      fixtureLabel: buildFixtureLabel(raw),
    };
  } catch (error) {
    if (isOwnedCommandError(error)) {
      return error;
    }

    return validationError(
      `Failed to read benchmark fixture \`${fixturePath}\`: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function resolveBenchScope(
  store: QMDStore,
  requestedCollection: string | undefined,
): Promise<BenchCollectionScope | OwnedCommandError> {
  const collections = await store.listCollections();
  const availableCollectionNames = collections.map((collection) => collection.name);
  if (availableCollectionNames.length === 0) {
    return validationError('Benchmark requires at least one indexed collection.');
  }

  const defaults = await store.getDefaultCollectionNames();

  if (requestedCollection === undefined) {
    if (defaults.length === 1) {
      return {
        mode: 'single-collection',
        label: defaults[0],
        collection: defaults[0],
      };
    }

    if (defaults.length === 0 && availableCollectionNames.length === 1) {
      return {
        mode: 'single-collection',
        label: availableCollectionNames[0],
        collection: availableCollectionNames[0],
      };
    }

    return validationError(
      'The `qmd bench` command requires an explicit collection or exactly one default collection.',
    );
  }

  const resolved = resolveSelectedCollections(
    [requestedCollection],
    availableCollectionNames,
    defaults,
  );

  if (isOwnedCommandError(resolved)) {
    return resolved;
  }

  const collection = resolved[0];
  if (!collection) {
    return validationError(
      'The `qmd bench` command requires an explicit collection or exactly one default collection.',
    );
  }

  return {
    mode: 'single-collection',
    label: collection,
    collection,
  };
}

async function runUpstreamBackend(
  store: QMDStore,
  backend: BenchBackendName,
  query: string,
  limit: number,
  collection: string,
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
  collection: string,
): Promise<string[]> {
  const fetchLimit = Math.max(50, limit * 2);
  const probe = await probeQueryLexicalCandidates(store, query, [collection], fetchLimit);
  return probe.rows.slice(0, limit).map((row) => row.displayPath);
}

function createQueryInput(
  query: string,
  limit: number,
  collection: string,
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
    collections: [collection],
    explain: false,
    queryMode: 'plain',
    disableRerank,
  };
}

async function runCurrentQueryBackend(
  store: QMDStore,
  query: string,
  limit: number,
  collection: string,
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
  collection: string,
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
  readonly fixtureLabel: string;
  readonly fixture: BenchmarkFixture;
  readonly scope: BenchCollectionScope;
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
            ? await runUpstreamBackend(
                args.store,
                backend,
                query.query,
                limit,
                args.scope.collection,
              )
            : await runCurrentBackend(
                args.store,
                backend,
                query.query,
                limit,
                args.scope.collection,
                args.env,
              );

        backendResults[backend] = {
          status: 'ok',
          ...scoreResults(resultFiles, query.expected_files, query.expected_in_top_k),
          total_expected: query.expected_files.length,
          latency_ms: Date.now() - startedAt,
          top_files: resultFiles.slice(0, 10).map(sanitizeOutputPath),
        };
      } catch {
        backendResults[backend] = {
          status: 'unavailable',
          precision_at_k: null,
          recall: null,
          mrr: null,
          f1: null,
          hits_at_k: null,
          total_expected: query.expected_files.length,
          latency_ms: null,
          top_files: [],
        };
      }
    }

    results.push({
      id: query.id,
      type: query.type,
      backends: backendResults,
    });
  }

  return {
    timestamp: args.now().toISOString().replace(/[:.]/g, '').slice(0, 15),
    fixture_label: args.fixtureLabel,
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
        delta_f1:
          upstreamResult.f1 === null || currentResult.f1 === null
            ? null
            : Number((currentResult.f1 - upstreamResult.f1).toFixed(3)),
      });
    }
  }

  return items
    .sort(
      (left, right) =>
        Math.abs(right.delta_f1 ?? Number.NEGATIVE_INFINITY) -
        Math.abs(left.delta_f1 ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, 3);
}

async function runBenchCommand(
  context: CommandExecutionContext,
  input: BenchCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
  options: { readonly now?: () => Date; readonly readFileImpl?: typeof readFile } = {},
): Promise<BenchCommandSuccess | OwnedCommandError | OwnedRuntimeFailure> {
  const readFileImpl = options.readFileImpl ?? readFile;
  const fixtureResult = await readFixture(input.fixturePath, readFileImpl);
  if (isOwnedCommandError(fixtureResult)) {
    return fixtureResult;
  }

  return withOwnedStore(
    'bench',
    context,
    async (session) => {
      const requestedCollection = input.collection ?? fixtureResult.fixture.collection;
      const scope = await resolveBenchScope(session.store, requestedCollection);
      if (isOwnedCommandError(scope)) {
        return scope;
      }

      const now = options.now ?? (() => new Date());

      const upstream = await runBenchSide({
        store: session.store,
        fixtureLabel: fixtureResult.fixtureLabel,
        fixture: fixtureResult.fixture,
        scope,
        side: 'upstream',
        env: runtimeDependencies?.env ?? process.env,
        now,
      });
      const current = await runBenchSide({
        store: session.store,
        fixtureLabel: fixtureResult.fixtureLabel,
        fixture: fixtureResult.fixture,
        scope,
        side: 'current',
        env: runtimeDependencies?.env ?? process.env,
        now,
      });

      return {
        comparison: {
          schema_version: '1',
          baseline: 'upstream',
          fixture_label: fixtureResult.fixtureLabel,
          collection: scope.collection,
          measurement_policy: {
            collection_scope: {
              mode: scope.mode,
              label: scope.label,
            },
            latency_scope: 'single-run-per-backend',
            latency_comparable: false,
            latency_note: BENCH_LATENCY_NOTE,
            raw_queries_exposed: false,
          },
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
