import type {
  PlainQuerySearchRequest,
  QueryCommandInput,
  QueryNormalizationPlan,
  QueryNormalizationReason,
  QueryNormalizationSummary,
  SearchOutputRow,
} from './io/types.js';
import type { QueryTraits } from './query_classifier.js';
import {
  classifyQuery,
  resolveFetchLimitForQuery,
  shouldDisableRerankForQuery,
} from './query_classifier.js';
import { hasConservativeLexSyntax } from './query_search_assist_policy.js';

export const QUERY_NORMALIZATION_RESCUE_CAP = 4;
export const QUERY_NORMALIZATION_LATENCY_BUDGET_MS = 75;
const MIN_LONG_QUERY_TERMS = 4;
const MIN_RETAINED_TERMS = 2;
const STRONG_BASE_SCORE = 0.75;

const QUESTION_WORDS = new Set(['어떻게', '왜', '무엇', '뭐', '언제', '어디', '누가', '방법']);

const QUESTION_TAILS = new Set([
  '동작해',
  '동작하나',
  '동작해요',
  '되나',
  '되나요',
  '되요',
  '인가',
  '인가요',
  '일까',
  '설명해',
  '설명해줘',
  '알려줘',
  '질문',
]);

const STRIPPABLE_PARTICLE_SUFFIXES = [
  '에서',
  '에게',
  '으로',
  '부터',
  '까지',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '에',
];

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function looksLikeQuestion(text: string): boolean {
  return (
    /[?？]/.test(text) ||
    [...QUESTION_WORDS].some((word) => text.includes(word)) ||
    [...QUESTION_TAILS].some((word) => text.includes(word))
  );
}

function looksSensitiveToken(token: string): boolean {
  return (
    /https?:\/\//i.test(token) ||
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(token) ||
    /\b[0-9a-f]{32,}\b/i.test(token) ||
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(token) ||
    /\b(?:sk|pk|api|token|key)_[A-Za-z0-9_-]{12,}\b/i.test(token) ||
    /\b[A-Za-z0-9+/]{32,}={0,2}\b/.test(token)
  );
}

function isImmutableToken(token: string): boolean {
  return (
    looksSensitiveToken(token) ||
    /[\\/]/.test(token) ||
    /::/.test(token) ||
    /\b[A-Za-z0-9_.-]+\.[A-Za-z0-9]{2,10}\b/.test(token) ||
    /\b[a-z]+[A-Z][A-Za-z0-9]*\b/.test(token)
  );
}

function stripQuestionPunctuation(token: string): string {
  return token.replace(/^[^\p{L}\p{N}/_.:-]+|[^\p{L}\p{N}/_.:-]+$/gu, '');
}

function isWordLikeStem(token: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(token) || /^[가-힣]{2,}$/u.test(token);
}

function stripParticle(token: string): string {
  for (const suffix of STRIPPABLE_PARTICLE_SUFFIXES) {
    if (!token.endsWith(suffix)) {
      continue;
    }

    const stem = token.slice(0, -suffix.length);
    if (stem.length <= 1) {
      return token;
    }

    if (isWordLikeStem(stem) || isImmutableToken(stem)) {
      return stem;
    }

    return token;
  }

  return token;
}

function shouldDropToken(token: string): boolean {
  return QUESTION_WORDS.has(token) || QUESTION_TAILS.has(token);
}

function resolveDisableRerank(
  input: Pick<QueryCommandInput, 'disableRerank'>,
  traits: QueryTraits,
): boolean {
  return input.disableRerank === true || shouldDisableRerankForQuery(traits);
}

export function buildQueryNormalizationPlan(
  input: QueryCommandInput,
  traits: QueryTraits,
): QueryNormalizationPlan {
  if (input.queryMode !== 'plain' || !traits.hasHangul) {
    return { kind: 'skip', reason: 'not-eligible' };
  }

  if (hasConservativeLexSyntax(input.query) || traits.hasExplicitPhrase) {
    return { kind: 'skip', reason: 'skipped-guard' };
  }

  const questionLike = looksLikeQuestion(input.query);
  const longEnough = traits.terms.length >= MIN_LONG_QUERY_TERMS;

  if (!questionLike && !longEnough) {
    return { kind: 'skip', reason: 'not-eligible' };
  }

  const rawTokens = traits.normalizedWhitespace
    .replace(/[?？！]/g, ' ')
    .split(/\s+/)
    .map(stripQuestionPunctuation)
    .filter((token) => token.length > 0);

  if (rawTokens.some(looksSensitiveToken)) {
    return { kind: 'skip', reason: 'skipped-guard' };
  }

  const keptTerms: string[] = [];
  for (const rawToken of rawTokens) {
    const particleStripped = stripParticle(rawToken);
    const candidateToken = particleStripped || rawToken;

    if (isImmutableToken(candidateToken)) {
      keptTerms.push(candidateToken);
      continue;
    }

    const strippedToken = candidateToken;
    if (!strippedToken || shouldDropToken(strippedToken)) {
      continue;
    }

    if (strippedToken.length <= 1) {
      continue;
    }

    keptTerms.push(strippedToken);
  }

  const normalizedQuery = normalizeWhitespace(keptTerms.join(' '));
  if (
    normalizedQuery.length === 0 ||
    normalizedQuery === traits.normalizedWhitespace ||
    keptTerms.length < MIN_RETAINED_TERMS
  ) {
    return { kind: 'skip', reason: 'skipped-same-or-empty' };
  }

  return {
    kind: 'apply',
    normalizedQuery,
    keptTerms,
  };
}

export function buildPlainQuerySearchRequest(
  input: QueryCommandInput,
  traits: QueryTraits,
): PlainQuerySearchRequest {
  return {
    query: input.query,
    displayQuery: input.displayQuery,
    format: input.format,
    limit: input.limit,
    minScore: input.minScore,
    all: input.all,
    full: input.full,
    lineNumbers: input.lineNumbers,
    collections: input.collections,
    candidateLimit: input.candidateLimit,
    chunkStrategy: input.chunkStrategy,
    disableRerank: resolveDisableRerank(input, traits),
    fetchLimit: resolveFetchLimitForQuery(input.limit, traits, input.candidateLimit),
    explain: input.explain,
    intent: input.intent,
    queryMode: 'plain',
  };
}

export function buildNormalizedSearchRequest(
  baseRequest: PlainQuerySearchRequest,
  plan: Extract<QueryNormalizationPlan, { kind: 'apply' }>,
): PlainQuerySearchRequest {
  const normalizedTraits = classifyQuery({
    ...baseRequest,
    query: plan.normalizedQuery,
    displayQuery: plan.normalizedQuery,
  });
  const normalizedFetchLimit = resolveFetchLimitForQuery(
    baseRequest.limit,
    normalizedTraits,
    baseRequest.candidateLimit,
  );
  return {
    ...baseRequest,
    query: plan.normalizedQuery,
    disableRerank: resolveDisableRerank(baseRequest, normalizedTraits),
    fetchLimit: Math.max(baseRequest.limit, Math.min(normalizedFetchLimit, baseRequest.limit + 8)),
  };
}

function buildRowSearchText(row: SearchOutputRow): string {
  return [row.title, row.sourceBody ?? row.body].join('\n').toLowerCase();
}

export function hasStrongBaseNormalizationHit(
  rows: readonly SearchOutputRow[],
  plan: Extract<QueryNormalizationPlan, { kind: 'apply' }>,
): boolean {
  const normalizedQuery = plan.normalizedQuery.toLowerCase();

  return rows.slice(0, 3).some((row) => {
    const text = buildRowSearchText(row);
    if (text.includes(normalizedQuery) && row.score >= STRONG_BASE_SCORE) {
      return true;
    }

    return plan.keptTerms.every((term) => text.includes(term.toLowerCase())) && row.score >= 0.9;
  });
}

export function buildQueryNormalizationSummary(args: {
  readonly reason: QueryNormalizationReason;
  readonly addedCandidates?: number;
}): QueryNormalizationSummary {
  return {
    applied: args.reason === 'applied',
    reason: args.reason,
    addedCandidates: args.addedCandidates ?? 0,
  };
}
