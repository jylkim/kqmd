import type { QMDStore } from '@tobilu/qmd';
import { describeEffectiveEmbedModel } from '#src/config/embedding_policy.js';
import { describeEffectiveSearchPolicy } from '#src/config/search_policy.js';
import {
  hasEmbeddingMismatch,
  readEmbeddingHealth,
  summarizeStoredEmbeddingModels,
} from './embedding_health.js';
import { normalizeHybridQueryResults } from './io/format.js';
import type {
  OwnedCommandError,
  QueryCommandInput,
  QueryExecutionSummary,
  QueryNormalizationReason,
  SearchAssistSummary,
  SearchOutputRow,
} from './io/types.js';
import { resolveSelectedCollections } from './io/validate.js';
import { mergeNormalizedCandidates } from './query_candidate_merge.js';
import { classifyQuery, shouldDisableRerankForQuery } from './query_classifier.js';
import {
  buildNormalizedSearchRequest,
  buildPlainQuerySearchRequest,
  buildQueryNormalizationPlan,
  buildQueryNormalizationSummary,
  hasStrongBaseNormalizationHit,
  QUERY_NORMALIZATION_LATENCY_BUDGET_MS,
  QUERY_NORMALIZATION_RESCUE_CAP,
} from './query_normalization.js';
import { rankQueryRows } from './query_ranking.js';
import { executeOwnedQuerySearch, type QueryRuntimeDependencies } from './query_runtime.js';
import {
  type QuerySearchAssistDependencies,
  resolveQuerySearchAssist,
} from './query_search_assist.js';
import {
  evaluateQuerySearchAssistPolicy,
  hasConservativeLexSyntax,
  mergeRescueCandidates,
  type QuerySearchAssistPolicy,
  shouldConsiderQuerySearchAssist,
} from './query_search_assist_policy.js';
import { readSearchIndexHealth } from './search_index_health.js';

export interface QueryCoreSuccess {
  readonly rows: SearchOutputRow[];
  readonly advisories: readonly string[];
  readonly query: QueryExecutionSummary;
  readonly searchAssist?: import('./io/types.js').SearchAssistSummary;
}

export interface QueryCoreOptions {
  readonly availableCollectionNames?: readonly string[];
  readonly defaultCollectionNames?: readonly string[];
}

export interface QueryCoreDependencies
  extends QueryRuntimeDependencies,
    QuerySearchAssistDependencies {
  readonly now?: () => number;
}

function buildEmbeddingMismatchAdvisory(expectedModel: string, storedModels: string): string {
  return [
    'Embedding model mismatch detected.',
    `Expected effective model: ${expectedModel}`,
    `Stored models: ${storedModels}`,
    "Run 'qmd embed --force' to rebuild embeddings for the current model.",
  ].join('\n');
}

function buildQueryExecutionSummary(args: {
  readonly input: QueryCommandInput;
  readonly queryClass: QueryExecutionSummary['queryClass'];
  readonly normalization: QueryExecutionSummary['normalization'];
  readonly searchAssist: SearchAssistSummary;
}): QueryExecutionSummary {
  return {
    mode: args.input.queryMode,
    primaryQuery: args.input.displayQuery,
    intent: args.input.intent,
    queryClass: args.queryClass,
    normalization: args.normalization,
    searchAssist: args.searchAssist,
  };
}

export async function executeQueryCore(
  store: QMDStore,
  input: QueryCommandInput,
  env: NodeJS.ProcessEnv = process.env,
  runtimeDependencies: QueryCoreDependencies = {},
  options: QueryCoreOptions = {},
): Promise<QueryCoreSuccess | OwnedCommandError> {
  const effectiveModel = describeEffectiveEmbedModel(env);
  const [availableCollectionNames, defaultCollectionNames] =
    options.availableCollectionNames && options.defaultCollectionNames
      ? [options.availableCollectionNames, options.defaultCollectionNames]
      : await Promise.all([
          store
            .listCollections()
            .then((collections) => collections.map((collection) => collection.name)),
          store.getDefaultCollectionNames(),
        ]);

  const selectedCollections = resolveSelectedCollections(
    input.collections,
    [...availableCollectionNames],
    [...defaultCollectionNames],
  );

  if ('kind' in selectedCollections) {
    return selectedCollections;
  }

  if (
    input.candidateLimit !== undefined &&
    input.queryMode === 'plain' &&
    selectedCollections.length > 1
  ) {
    return {
      kind: 'validation',
      exitCode: 1,
      stderr: 'The `--candidate-limit` option currently supports at most one collection filter.',
    };
  }

  const traits = classifyQuery(input);
  const baseRequest =
    input.queryMode === 'plain' ? buildPlainQuerySearchRequest(input, traits) : undefined;
  const normalizationPlan: import('./io/types.js').QueryNormalizationPlan =
    input.queryMode === 'plain'
      ? buildQueryNormalizationPlan(input, traits)
      : { kind: 'skip', reason: 'not-eligible' as const };
  const searchRequest =
    input.queryMode === 'plain'
      ? baseRequest
      : {
          ...input,
          disableRerank: shouldDisableRerankForQuery(traits),
        };

  if (!searchRequest) {
    throw new Error('Plain query search request was not initialized.');
  }
  if (
    input.candidateLimit !== undefined &&
    input.queryMode === 'plain' &&
    traits.queryClass === 'mixed-technical' &&
    !(baseRequest?.disableRerank ?? false) &&
    input.candidateLimit > 50
  ) {
    return {
      kind: 'validation',
      exitCode: 1,
      stderr:
        'Mixed technical plain queries support `--candidate-limit` up to 50 to keep rerank cost bounded.',
    };
  }

  let searchAssistPolicy: QuerySearchAssistPolicy;
  if (!shouldConsiderQuerySearchAssist(input, traits) || !traits.hasHangul) {
    searchAssistPolicy = { kind: 'skip', reason: 'ineligible' };
  } else if (hasConservativeLexSyntax(input.query)) {
    searchAssistPolicy = { kind: 'skip', reason: 'conservative-syntax' };
  } else {
    searchAssistPolicy = evaluateQuerySearchAssistPolicy({
      input,
      traits,
      searchHealth: readSearchIndexHealth(store.internal.db, describeEffectiveSearchPolicy(), {
        collections: selectedCollections,
      }),
      selectedCollections,
    });
  }

  const now = runtimeDependencies.now ?? Date.now;
  const healthPromise = readEmbeddingHealth(store, effectiveModel.uri, {
    collections: selectedCollections,
  }).then(
    (health) => ({ ok: true as const, health }),
    (error) => ({ ok: false as const, error }),
  );
  const baseSearchStartedAt = now();
  const results = await executeOwnedQuerySearch(
    store,
    searchRequest,
    selectedCollections,
    runtimeDependencies,
  );
  const baseSearchDurationMs = now() - baseSearchStartedAt;
  const baseRows = normalizeHybridQueryResults(results);
  let mergedRows = baseRows;
  let normalizationReason: QueryNormalizationReason =
    normalizationPlan.kind === 'skip' ? normalizationPlan.reason : 'applied';
  let normalizationAddedCandidates = 0;
  let searchAssist: QueryCoreSuccess['searchAssist'] | undefined;

  if (
    normalizationPlan.kind === 'apply' &&
    !hasStrongBaseNormalizationHit(baseRows, normalizationPlan) &&
    baseSearchDurationMs <= QUERY_NORMALIZATION_LATENCY_BUDGET_MS
  ) {
    try {
      if (!baseRequest) {
        throw new Error('Normalized supplement requires a plain base request.');
      }

      const normalizedRequest = buildNormalizedSearchRequest(baseRequest, normalizationPlan);
      const normalizedResults = await executeOwnedQuerySearch(
        store,
        normalizedRequest,
        selectedCollections,
        runtimeDependencies,
      );
      const normalizationMerge = mergeNormalizedCandidates(
        baseRows,
        normalizeHybridQueryResults(normalizedResults),
        QUERY_NORMALIZATION_RESCUE_CAP,
      );
      mergedRows = normalizationMerge.rows;
      normalizationAddedCandidates = normalizationMerge.addedCandidates;
    } catch {
      normalizationReason = 'failed-open';
    }
  } else if (normalizationPlan.kind === 'apply') {
    normalizationReason =
      baseSearchDurationMs > QUERY_NORMALIZATION_LATENCY_BUDGET_MS
        ? 'latency-budget'
        : 'skipped-guard';
  }

  if (searchAssistPolicy.kind === 'eligible') {
    const assist = await resolveQuerySearchAssist(store, searchAssistPolicy, runtimeDependencies);
    const mergeResult = mergeRescueCandidates(
      mergedRows,
      assist.rows,
      searchAssistPolicy.rescueCap,
    );
    mergedRows = mergeResult.rows;
    searchAssist = {
      applied: mergeResult.addedCandidates > 0,
      reason: assist.reason,
      addedCandidates: mergeResult.addedCandidates,
    };
  } else {
    searchAssist = {
      applied: false,
      reason: searchAssistPolicy.reason,
      addedCandidates: 0,
    };
  }

  const effectiveSearchAssist = searchAssist ?? {
    applied: false,
    reason: 'ineligible',
    addedCandidates: 0,
  };
  const healthResult = await healthPromise;
  if (!healthResult.ok) {
    throw healthResult.error;
  }

  return {
    rows: rankQueryRows(mergedRows, traits),
    advisories: hasEmbeddingMismatch(healthResult.health)
      ? [
          buildEmbeddingMismatchAdvisory(
            effectiveModel.uri,
            summarizeStoredEmbeddingModels(healthResult.health),
          ),
        ]
      : [],
    query: buildQueryExecutionSummary({
      input,
      queryClass: traits.queryClass,
      normalization: buildQueryNormalizationSummary({
        reason: normalizationReason,
        addedCandidates: normalizationAddedCandidates,
      }),
      searchAssist: effectiveSearchAssist,
    }),
    searchAssist: effectiveSearchAssist,
  };
}
