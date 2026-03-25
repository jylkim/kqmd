import type { ExpandedQuery } from '@tobilu/qmd';
import type {
  PlainQuerySearchRequest,
  QueryCommandInput,
  QueryExecutionSummary,
  QueryNormalizationPlan,
} from './io/types.js';
import type { QueryTraits } from './query_classifier.js';
import { shouldDisableRerankForQuery } from './query_classifier.js';
import type { QueryLexicalProbe } from './query_lexical_candidates.js';
import { buildPlainQuerySearchRequest } from './query_normalization.js';

const DEFAULT_COMPATIBILITY_CANDIDATE_WINDOW = 40;

export interface QueryExecutionPlan {
  readonly request: QueryCommandInput | PlainQuerySearchRequest;
  readonly fallbackReason: QueryExecutionSummary['execution']['fallbackReason'];
  readonly retrievalKind: QueryExecutionSummary['execution']['retrievalKind'];
  readonly lexicalSignal: QueryExecutionSummary['execution']['lexicalSignal'];
  readonly candidateWindow: number;
  readonly normalizationPlan: QueryNormalizationPlan;
}

function explicitCollectionFilterCount(input: QueryCommandInput): number {
  return Array.isArray(input.collections) ? input.collections.length : 0;
}

function buildFastDefaultQueries(query: string): ExpandedQuery[] {
  return [
    { type: 'lex', query, line: 1 },
    { type: 'vec', query, line: 2 },
  ];
}

function resolveFastDefaultCandidateWindow(
  limit: number,
  traits: QueryTraits,
  lexicalSignal: QueryLexicalProbe['signal'],
): number {
  const baseLimit = Math.max(limit, 1);

  if (lexicalSignal === 'strong') {
    return Math.max(baseLimit, Math.min(baseLimit + 2, 10));
  }

  if (lexicalSignal === 'moderate') {
    return Math.max(baseLimit, Math.min(baseLimit * 2, 14));
  }

  if (traits.queryClass === 'general') {
    return Math.max(baseLimit, Math.min(baseLimit * 3, 18));
  }

  return Math.max(baseLimit, Math.min(baseLimit * 3, 20));
}

export function buildQueryExecutionPlan(args: {
  readonly input: QueryCommandInput;
  readonly traits: QueryTraits;
  readonly lexicalProbe: QueryLexicalProbe;
  readonly normalizationPlan: QueryNormalizationPlan;
  readonly selectedCollectionsCount: number;
}): QueryExecutionPlan {
  const { input, traits, lexicalProbe, normalizationPlan, selectedCollectionsCount } = args;

  if (input.queryMode === 'structured') {
    return {
      request: {
        ...input,
        disableRerank: false,
      },
      fallbackReason: 'compatibility-structured',
      retrievalKind: 'structured-compatibility',
      lexicalSignal: 'none',
      candidateWindow: input.candidateLimit ?? DEFAULT_COMPATIBILITY_CANDIDATE_WINDOW,
      normalizationPlan,
    };
  }

  const baseRequest = buildPlainQuerySearchRequest(input, traits);

  if (input.intent) {
    return {
      request: {
        ...baseRequest,
        runtimeKind: 'compatibility-hybrid',
      },
      fallbackReason: 'compatibility-explicit-intent',
      retrievalKind: 'compatibility-hybrid',
      lexicalSignal: lexicalProbe.signal,
      candidateWindow: input.candidateLimit ?? DEFAULT_COMPATIBILITY_CANDIDATE_WINDOW,
      normalizationPlan,
    };
  }

  if (input.candidateLimit !== undefined) {
    return {
      request: {
        ...baseRequest,
        runtimeKind: 'compatibility-hybrid',
      },
      fallbackReason: 'compatibility-explicit-candidate-limit',
      retrievalKind: 'compatibility-hybrid',
      lexicalSignal: lexicalProbe.signal,
      candidateWindow: input.candidateLimit,
      normalizationPlan,
    };
  }

  if (explicitCollectionFilterCount(input) > 1) {
    return {
      request: {
        ...baseRequest,
        runtimeKind: 'compatibility-public',
      },
      fallbackReason: 'compatibility-explicit-collection-filter',
      retrievalKind: 'compatibility-public',
      lexicalSignal: lexicalProbe.signal,
      candidateWindow: DEFAULT_COMPATIBILITY_CANDIDATE_WINDOW,
      normalizationPlan,
    };
  }

  if (selectedCollectionsCount > 1) {
    return {
      request: {
        ...baseRequest,
        runtimeKind: 'compatibility-public',
      },
      fallbackReason: 'compatibility-multi-collection-default',
      retrievalKind: 'compatibility-public',
      lexicalSignal: lexicalProbe.signal,
      candidateWindow: DEFAULT_COMPATIBILITY_CANDIDATE_WINDOW,
      normalizationPlan,
    };
  }

  if (lexicalProbe.conservativeSyntax) {
    return {
      request: {
        ...baseRequest,
        runtimeKind: 'compatibility-hybrid',
      },
      fallbackReason: 'conservative-syntax',
      retrievalKind: 'compatibility-hybrid',
      lexicalSignal: lexicalProbe.signal,
      candidateWindow: DEFAULT_COMPATIBILITY_CANDIDATE_WINDOW,
      normalizationPlan,
    };
  }

  const candidateWindow = resolveFastDefaultCandidateWindow(
    input.limit,
    traits,
    lexicalProbe.signal,
  );
  const disableRerank = shouldDisableRerankForQuery(traits) || lexicalProbe.signal === 'strong';

  return {
    request: {
      ...baseRequest,
      candidateLimit: candidateWindow,
      disableRerank,
      fetchLimit: candidateWindow,
      preExpandedQueries: buildFastDefaultQueries(input.query),
      runtimeKind: 'cost-capped-structured',
    },
    fallbackReason: 'fast-default',
    retrievalKind: 'cost-capped-structured',
    lexicalSignal: lexicalProbe.signal,
    candidateWindow,
    normalizationPlan,
  };
}
