import type { QMDStore } from '@tobilu/qmd';
import { describeEffectiveEmbedModel } from '#src/config/embedding_policy.js';
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
import { classifyQuery } from './query_classifier.js';
import { buildQueryExecutionPlan } from './query_execution_policy.js';
import { probeQueryLexicalCandidates } from './query_lexical_candidates.js';
import {
  buildPlainQuerySearchRequest,
  buildQueryNormalizationPlan,
  buildQueryNormalizationSummary,
  hasStrongBaseNormalizationHit,
  QUERY_NORMALIZATION_LATENCY_BUDGET_MS,
  QUERY_NORMALIZATION_RESCUE_CAP,
} from './query_normalization.js';
import { rankQueryRows } from './query_ranking.js';
import {
  executeOwnedQuerySearch,
  type QueryRuntimeDependencies,
  type QueryRuntimeStageTelemetry,
} from './query_runtime.js';
import {
  type QuerySearchAssistDependencies,
  resolveQuerySearchAssist,
} from './query_search_assist.js';
import {
  evaluateQuerySearchAssistPolicy,
  mergeRescueCandidates,
  type QuerySearchAssistPolicy,
  shouldConsiderQuerySearchAssist,
} from './query_search_assist_policy.js';

function mergeRuntimeTelemetry(
  ...telemetries: Array<QueryRuntimeStageTelemetry | undefined>
): QueryRuntimeStageTelemetry | undefined {
  const observed = telemetries.filter(
    (telemetry): telemetry is QueryRuntimeStageTelemetry => telemetry !== undefined,
  );

  if (observed.length === 0) {
    return undefined;
  }

  return {
    retrievalKind: observed[0]?.retrievalKind ?? 'compatibility-public',
    embeddingApplied: observed.some((telemetry) => telemetry.embeddingApplied),
    expansionApplied: observed.some((telemetry) => telemetry.expansionApplied),
    rerankApplied: observed.some((telemetry) => telemetry.rerankApplied),
    candidateWindow: Math.max(...observed.map((telemetry) => telemetry.candidateWindow)),
  };
}

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
  readonly execution: QueryExecutionSummary['execution'];
  readonly normalization: QueryExecutionSummary['normalization'];
  readonly searchAssist: SearchAssistSummary;
}): QueryExecutionSummary {
  return {
    mode: args.input.queryMode,
    primaryQuery: args.input.displayQuery,
    intent: args.input.intent,
    queryClass: args.queryClass,
    execution: args.execution,
    normalization: args.normalization,
    searchAssist: args.searchAssist,
  };
}

function shouldProbeLexicalCandidates(
  input: QueryCommandInput,
  traits: ReturnType<typeof classifyQuery>,
  selectedCollectionsCount: number,
): boolean {
  if (input.queryMode !== 'plain') {
    return false;
  }

  const fastDefaultCandidate =
    selectedCollectionsCount <= 1 &&
    input.intent === undefined &&
    input.candidateLimit === undefined &&
    (!input.collections || input.collections.length <= 1);
  const searchAssistCandidate = shouldConsiderQuerySearchAssist(input, traits) && traits.hasHangul;

  return fastDefaultCandidate || searchAssistCandidate;
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

  const lexicalProbe = shouldProbeLexicalCandidates(input, traits, selectedCollections.length)
    ? await probeQueryLexicalCandidates(store, input.query, selectedCollections)
    : {
        rows: [],
        signal: 'none' as const,
        usesShadowIndex: false,
        conservativeSyntax: false,
      };
  const executionPlan = buildQueryExecutionPlan({
    input,
    traits,
    lexicalProbe,
    normalizationPlan,
    selectedCollectionsCount: selectedCollections.length,
  });

  let searchAssistPolicy: QuerySearchAssistPolicy;
  if (!shouldConsiderQuerySearchAssist(input, traits) || !traits.hasHangul) {
    searchAssistPolicy = { kind: 'skip', reason: 'ineligible' };
  } else if (lexicalProbe.conservativeSyntax) {
    searchAssistPolicy = { kind: 'skip', reason: 'conservative-syntax' };
  } else if (!lexicalProbe.searchHealth) {
    searchAssistPolicy = { kind: 'skip', reason: 'ineligible' };
  } else {
    searchAssistPolicy = evaluateQuerySearchAssistPolicy({
      input,
      traits,
      searchHealth: lexicalProbe.searchHealth,
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
  let runtimeTelemetry: QueryRuntimeStageTelemetry | undefined;
  const results = await executeOwnedQuerySearch(store, executionPlan.request, selectedCollections, {
    ...runtimeDependencies,
    onStageTelemetry: (telemetry) => {
      runtimeTelemetry = telemetry;
      runtimeDependencies.onStageTelemetry?.(telemetry);
    },
  });
  const baseSearchDurationMs = now() - baseSearchStartedAt;
  const baseRows = normalizeHybridQueryResults(results);
  let mergedRows = baseRows;
  let normalizationReason: QueryNormalizationReason =
    normalizationPlan.kind === 'skip' ? normalizationPlan.reason : 'applied';
  let normalizationAddedCandidates = 0;
  let normalizationTelemetry: QueryRuntimeStageTelemetry | undefined;
  let searchAssist: QueryCoreSuccess['searchAssist'] | undefined;

  if (
    normalizationPlan.kind === 'apply' &&
    !hasStrongBaseNormalizationHit(baseRows, normalizationPlan) &&
    baseSearchDurationMs <= QUERY_NORMALIZATION_LATENCY_BUDGET_MS
  ) {
    try {
      const normalizedInput: QueryCommandInput = {
        ...input,
        query: normalizationPlan.normalizedQuery,
        displayQuery: normalizationPlan.normalizedQuery,
      };
      const normalizedTraits = classifyQuery(normalizedInput);
      const normalizedExecutionPlan = buildQueryExecutionPlan({
        input: normalizedInput,
        traits: normalizedTraits,
        lexicalProbe: shouldProbeLexicalCandidates(
          normalizedInput,
          normalizedTraits,
          selectedCollections.length,
        )
          ? await probeQueryLexicalCandidates(store, normalizedInput.query, selectedCollections)
          : {
              rows: [],
              signal: 'none' as const,
              usesShadowIndex: false,
              conservativeSyntax: false,
            },
        normalizationPlan: {
          kind: 'skip',
          reason: 'not-eligible',
        },
        selectedCollectionsCount: selectedCollections.length,
      });
      const normalizedResults = await executeOwnedQuerySearch(
        store,
        normalizedExecutionPlan.request,
        selectedCollections,
        {
          ...runtimeDependencies,
          onStageTelemetry: (telemetry) => {
            normalizationTelemetry = telemetry;
            runtimeDependencies.onStageTelemetry?.(telemetry);
          },
        },
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
  const preExpandedQueries =
    'preExpandedQueries' in executionPlan.request
      ? executionPlan.request.preExpandedQueries
      : undefined;
  const structuredQueries =
    executionPlan.request.queryMode === 'structured' && 'queries' in executionPlan.request
      ? executionPlan.request.queries
      : undefined;
  const combinedTelemetry = mergeRuntimeTelemetry(runtimeTelemetry, normalizationTelemetry);
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
      execution: {
        retrievalKind: combinedTelemetry?.retrievalKind ?? executionPlan.retrievalKind,
        fallbackReason: executionPlan.fallbackReason,
        lexicalSignal: executionPlan.lexicalSignal,
        embeddingApplied:
          combinedTelemetry?.embeddingApplied ??
          (executionPlan.request.queryMode === 'structured'
            ? Boolean(structuredQueries?.some((query) => query.type !== 'lex'))
            : preExpandedQueries
              ? preExpandedQueries.some((query) => query.type !== 'lex')
              : false),
        expansionApplied:
          combinedTelemetry?.expansionApplied ??
          (executionPlan.request.queryMode === 'plain' &&
            !preExpandedQueries &&
            executionPlan.retrievalKind !== 'compatibility-public'),
        rerankApplied:
          combinedTelemetry?.rerankApplied ?? !(executionPlan.request.disableRerank ?? false),
        heavyPathUsed:
          (combinedTelemetry?.expansionApplied ??
            (executionPlan.request.queryMode === 'plain' &&
              !preExpandedQueries &&
              executionPlan.retrievalKind !== 'compatibility-public')) ||
          (combinedTelemetry?.rerankApplied ?? !(executionPlan.request.disableRerank ?? false)),
        candidateWindow: combinedTelemetry?.candidateWindow ?? executionPlan.candidateWindow,
      },
      normalization: buildQueryNormalizationSummary({
        reason: normalizationReason,
        addedCandidates: normalizationAddedCandidates,
      }),
      searchAssist: effectiveSearchAssist,
    }),
    searchAssist: effectiveSearchAssist,
  };
}
