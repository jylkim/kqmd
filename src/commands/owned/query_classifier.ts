import type { QueryClass, QueryCommandInput } from './io/types.js';

export interface QueryTraits {
  readonly original: string;
  readonly normalized: string;
  readonly wholeForm: string;
  readonly terms: readonly string[];
  readonly hasHangul: boolean;
  readonly hasLatin: boolean;
  readonly hasExplicitPhrase: boolean;
  readonly hasPathLikeToken: boolean;
  readonly queryClass: QueryClass;
}

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function stripOuterQuotes(text: string): string {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function hasOuterQuotes(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  );
}

function extractTerms(text: string): string[] {
  return (text.match(/[A-Za-z0-9_./:-]+|[가-힣]+/g) ?? [])
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0);
}

function containsPathLikeToken(text: string): boolean {
  return (
    /(?:^|[\s(])(?:\.{1,2}\/|~\/)/.test(text) ||
    /[\\/]/.test(text) ||
    /\b[a-z]+[A-Z][A-Za-z]*\b/.test(text) ||
    /::/.test(text) ||
    /\b[A-Za-z0-9_.-]+\.[A-Za-z0-9]{2,10}\b/.test(text)
  );
}

export function classifyQuery(input: QueryCommandInput): QueryTraits {
  const original = input.displayQuery || input.query;
  const normalized = normalizeWhitespace(original);
  const wholeForm = stripOuterQuotes(normalized).toLowerCase();
  const terms = extractTerms(wholeForm);
  const hasHangul = /[가-힣]/.test(wholeForm);
  const hasLatin = /[A-Za-z]/.test(wholeForm);
  const hasExplicitPhrase = hasOuterQuotes(normalized);
  const hasPathLikeToken = containsPathLikeToken(wholeForm);

  let queryClass: QueryClass;
  if (input.queryMode === 'structured') {
    queryClass = 'structured';
  } else if (hasHangul && !hasLatin && terms.length <= 3) {
    queryClass = 'short-korean-phrase';
  } else if (hasLatin && (hasHangul || hasPathLikeToken)) {
    queryClass = 'mixed-technical';
  } else {
    queryClass = 'general';
  }

  return {
    original,
    normalized,
    wholeForm,
    terms,
    hasHangul,
    hasLatin,
    hasExplicitPhrase,
    hasPathLikeToken,
    queryClass,
  };
}

export function shouldDisableRerankForQuery(traits: QueryTraits): boolean {
  if (traits.queryClass === 'structured') {
    return false;
  }

  return (
    traits.queryClass === 'short-korean-phrase' ||
    traits.hasExplicitPhrase ||
    traits.hasPathLikeToken
  );
}

export function resolveFetchLimitForQuery(
  currentLimit: number,
  traits: QueryTraits,
  candidateLimit?: number,
): number {
  const limit = Math.max(currentLimit, 1);

  if (traits.queryClass === 'structured') {
    return limit;
  }

  const baseWindow =
    traits.queryClass === 'short-korean-phrase'
      ? Math.min(Math.max(limit * 4, 20), 40)
      : traits.queryClass === 'mixed-technical'
        ? Math.min(Math.max(limit * 4, 20), 50)
        : Math.min(Math.max(limit * 3, 15), 20);

  if (candidateLimit !== undefined) {
    return Math.max(limit, Math.min(baseWindow, candidateLimit));
  }

  return Math.max(limit, baseWindow);
}
