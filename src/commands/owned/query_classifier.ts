/**
 * 쿼리 분류기 — 사용자 쿼리의 특성을 분석하여 검색 전략을 결정한다.
 *
 * 분류 결과(QueryClass)에 따라 다운스트림에서 fetch window 크기, 리랭킹 여부,
 * adaptive ranking 가중치가 달라진다.
 *
 * 클래스:
 *   - 'short-korean-phrase': 한글만 포함된 짧은 쿼리 (≤3 토큰). BM25에 의존도가 높다.
 *   - 'mixed-technical':     한영 혼합 또는 경로/코드 패턴 포함. literal 매칭이 중요하다.
 *   - 'structured':          JSON 구조화 쿼리 (queryMode === 'structured').
 *   - 'general':             그 외 일반 쿼리. vector search 결과를 주로 활용한다.
 */
import type { QueryClass, QueryCommandInput } from './io/types.js';

export interface QueryTraits {
  readonly original: string;
  readonly normalizedWhitespace: string;
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

/**
 * 텍스트에서 검색에 의미 있는 토큰을 추출한다.
 * 영숫자+특수문자(경로/URL 패턴) 또는 연속된 한글 음절을 하나의 토큰으로 인식한다.
 */
function extractTerms(text: string): string[] {
  return (text.match(/[A-Za-z0-9_./:-]+|[가-힣]+/g) ?? [])
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0);
}

/**
 * 쿼리에 파일 경로나 코드 식별자가 포함되어 있는지 판별한다.
 * 패턴:
 *   - 상대/홈 경로:  ./foo, ../bar, ~/baz
 *   - 디렉토리 구분자: / 또는 \
 *   - camelCase:      myFunction (소문자 시작 후 대문자)
 *   - 네임스페이스:   Foo::Bar
 *   - 파일 확장자:    foo.ts, README.md (확장자 2~10자)
 */
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
  const normalizedWhitespace = normalizeWhitespace(original);
  const wholeForm = stripOuterQuotes(normalizedWhitespace).toLowerCase();
  const terms = extractTerms(wholeForm);
  const hasHangul = /[가-힣]/.test(wholeForm);
  const hasLatin = /[A-Za-z]/.test(wholeForm);
  const hasExplicitPhrase = hasOuterQuotes(normalizedWhitespace);
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
    normalizedWhitespace,
    wholeForm,
    terms,
    hasHangul,
    hasLatin,
    hasExplicitPhrase,
    hasPathLikeToken,
    queryClass,
  };
}

/**
 * 리랭킹을 비활성화해야 하는지 판단한다.
 *
 * 짧은 한글 구문, 명시적 phrase 검색, 경로/코드 패턴에서는 vector reranker가
 * 오히려 lexical 정확도를 떨어뜨리므로 비활성화한다.
 * structured 쿼리는 자체 랭킹 로직이 있으므로 항상 rerank를 허용한다.
 */
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

/**
 * 쿼리 클래스에 따라 후보 문서 fetch 수를 결정한다.
 *
 * adaptive ranking이 최종 결과를 재정렬하므로, 사용자 요청 limit보다
 * 넓은 범위(fetch window)에서 후보를 가져와야 좋은 결과를 상위에 올릴 수 있다.
 *
 * - short-korean-phrase: limit×4, 최소 20 ~ 최대 40 (BM25 노이즈가 많아 넓게 탐색)
 * - mixed-technical:     limit×4, 최소 20 ~ 최대 50 (코드/경로 매칭의 변동폭이 큼)
 * - general:             limit×3, 최소 15 ~ 최대 20 (vector search 정확도가 높아 좁은 범위)
 */
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
