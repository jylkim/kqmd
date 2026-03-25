import type {
  QueryCommandInput,
  QueryRetrievalEligibilityReason,
  QueryRetrievalPath,
} from './io/types.js';

export interface QueryExecutionPlan {
  readonly strategy: QueryRetrievalPath;
  readonly selectedCollections: readonly string[];
  readonly eligibilityReason: QueryRetrievalEligibilityReason;
  readonly canUseModelStages: boolean;
  readonly normalizationEnabled: boolean;
  readonly searchAssistEnabled: boolean;
}

export function buildQueryExecutionPlan(args: {
  readonly input: QueryCommandInput;
  readonly selectedCollections: readonly string[];
}): QueryExecutionPlan {
  const { input, selectedCollections } = args;

  if (input.queryMode === 'structured') {
    return {
      strategy: 'compatibility',
      selectedCollections,
      eligibilityReason: 'structured-query',
      canUseModelStages: true,
      normalizationEnabled: false,
      searchAssistEnabled: false,
    };
  }

  if (input.intent) {
    return {
      strategy: 'compatibility',
      selectedCollections,
      eligibilityReason: 'explicit-intent',
      canUseModelStages: true,
      normalizationEnabled: true,
      searchAssistEnabled: true,
    };
  }

  if (input.candidateLimit !== undefined) {
    return {
      strategy: 'compatibility',
      selectedCollections,
      eligibilityReason: 'explicit-candidate-limit',
      canUseModelStages: true,
      normalizationEnabled: true,
      searchAssistEnabled: true,
    };
  }

  if ((input.collections?.length ?? 0) > 0) {
    return {
      strategy: 'compatibility',
      selectedCollections,
      eligibilityReason: 'explicit-collection-filter',
      canUseModelStages: true,
      normalizationEnabled: true,
      searchAssistEnabled: true,
    };
  }

  return {
    strategy: 'fast-default',
    selectedCollections,
    eligibilityReason: 'plain-default',
    canUseModelStages: false,
    normalizationEnabled: true,
    searchAssistEnabled: true,
  };
}
