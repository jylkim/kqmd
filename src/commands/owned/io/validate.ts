/**
 * 쿼리 입력 검증 및 구조화 쿼리 파싱.
 *
 * 쿼리 모드:
 *   - plain:      단일 텍스트 쿼리 (기본)
 *   - structured: 여러 줄의 typed 쿼리 문서 (lex:/vec:/hyde: prefix)
 *   - expand:     단일 쿼리를 자동 확장 (expand: prefix)
 *
 * 구조화 쿼리 문서 형식:
 *   lex: 한국어 형태소 검색   ← BM25 lexical 검색
 *   vec: semantic search     ← vector 유사도 검색
 *   hyde: hypothetical doc    ← HyDE(Hypothetical Document Embeddings) 검색
 *   intent: 검색 의도 설명    ← 선택적, 결과 스니펫 추출에 활용
 *
 * 보안:
 *   - 제어 문자(NUL, ESC 등)를 거부하여 터미널 이스케이프 공격을 방지한다.
 *   - 쿼리 길이를 500자, 줄 수를 10줄로 제한한다.
 */
import type { ExpandedQuery } from '@tobilu/qmd';

import { validationError } from './errors.js';
import type { OwnedCommandError } from './types.js';

export const MAX_QUERY_TEXT_LENGTH = 500;
export const MAX_STRUCTURED_QUERY_LINES = 10;

/**
 * 탭(9), LF(10), CR(13)을 제외한 제어 문자를 감지한다.
 * NUL(0), ESC(27), DEL(127) 등은 터미널 이스케이프 시퀀스에 악용될 수 있다.
 */
function hasDisallowedControlCharacters(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return true;
    }
  }

  return false;
}

export interface StructuredQueryDocument {
  readonly searches: ExpandedQuery[];
  readonly intent?: string;
}

function validateTextValue(
  text: string,
  label: string,
  options: { readonly allowNewlines: boolean },
): OwnedCommandError | null {
  if (text.length > MAX_QUERY_TEXT_LENGTH) {
    return validationError(`${label} must be ${MAX_QUERY_TEXT_LENGTH} characters or less.`);
  }

  if (!options.allowNewlines && /[\r\n]/.test(text)) {
    return validationError(`${label} must be a single line.`);
  }

  if (hasDisallowedControlCharacters(text)) {
    return validationError(`${label} contains unsupported control characters.`);
  }

  return null;
}

export function validatePlainQueryText(query: string): OwnedCommandError | null {
  const validation = validateTextValue(query, 'Query text', { allowNewlines: true });
  if (validation) {
    if (validation.stderr === `Query text must be ${MAX_QUERY_TEXT_LENGTH} characters or less.`) {
      return validationError(
        `Query text must be ${MAX_QUERY_TEXT_LENGTH} characters or less for plain queries.`,
      );
    }

    return validation;
  }

  return null;
}

export function validateSingleLineQueryText(text: string, label: string): OwnedCommandError | null {
  return validateTextValue(text, label, { allowNewlines: false });
}

export function parseStructuredQueryDocument(
  query: string,
): StructuredQueryDocument | null | OwnedCommandError {
  const rawLines = query
    .split('\n')
    .map((line, index) => ({
      raw: line,
      trimmed: line.trim(),
      number: index + 1,
    }))
    .filter((line) => line.trimmed.length > 0);

  if (rawLines.length === 0) {
    return null;
  }

  if (rawLines.length > MAX_STRUCTURED_QUERY_LINES) {
    return validationError(
      `Query documents support at most ${MAX_STRUCTURED_QUERY_LINES} non-empty lines.`,
    );
  }

  const prefixRe = /^(lex|vec|hyde):\s*/i;
  const expandRe = /^expand:\s*/i;
  const intentRe = /^intent:\s*/i;
  const typed: ExpandedQuery[] = [];
  let intent: string | undefined;

  for (const line of rawLines) {
    if (expandRe.test(line.trimmed)) {
      if (rawLines.length > 1) {
        return validationError(
          `Line ${line.number} starts with expand:, but query documents cannot mix expand with typed lines. Submit a single expand query instead.`,
        );
      }

      const text = line.trimmed.replace(expandRe, '').trim();
      if (!text) {
        return validationError('expand: query must include text.');
      }

      if (text.length > MAX_QUERY_TEXT_LENGTH) {
        return validationError(
          `expand: query must be ${MAX_QUERY_TEXT_LENGTH} characters or less.`,
        );
      }

      if (hasDisallowedControlCharacters(text)) {
        return validationError('expand: query contains unsupported control characters.');
      }

      return null;
    }

    if (intentRe.test(line.trimmed)) {
      if (intent !== undefined) {
        return validationError(
          `Line ${line.number}: only one intent: line is allowed per query document.`,
        );
      }

      const text = line.trimmed.replace(intentRe, '').trim();
      if (!text) {
        return validationError(`Line ${line.number}: intent: must include text.`);
      }

      if (text.length > MAX_QUERY_TEXT_LENGTH) {
        return validationError(
          `Line ${line.number}: intent: must be ${MAX_QUERY_TEXT_LENGTH} characters or less.`,
        );
      }

      if (hasDisallowedControlCharacters(text)) {
        return validationError(
          `Line ${line.number}: intent: contains unsupported control characters.`,
        );
      }

      intent = text;
      continue;
    }

    const match = line.trimmed.match(prefixRe);
    if (match) {
      const type = match[1]?.toLowerCase() as ExpandedQuery['type'];
      const text = line.trimmed.slice(match[0].length).trim();

      if (!text) {
        return validationError(`Line ${line.number} (${type}:) must include text.`);
      }

      if (/\r|\n/.test(text)) {
        return validationError(
          `Line ${line.number} (${type}:) contains a newline. Keep each query on a single line.`,
        );
      }

      if (text.length > MAX_QUERY_TEXT_LENGTH) {
        return validationError(
          `Line ${line.number} (${type}:) must be ${MAX_QUERY_TEXT_LENGTH} characters or less.`,
        );
      }

      if (hasDisallowedControlCharacters(text)) {
        return validationError(
          `Line ${line.number} (${type}:) contains unsupported control characters.`,
        );
      }

      typed.push({ type, query: text, line: line.number });
      continue;
    }

    if (rawLines.length === 1) {
      return null;
    }

    return validationError(
      `Line ${line.number} is missing a lex:/vec:/hyde:/intent: prefix. Each line in a query document must start with one.`,
    );
  }

  if (intent && typed.length === 0) {
    return validationError(
      'intent: cannot appear alone. Add at least one lex:, vec:, or hyde: line.',
    );
  }

  return typed.length > 0 ? { searches: typed, intent } : null;
}

export function resolveSelectedCollections(
  requestedCollections: string[] | undefined,
  availableCollections: string[],
  defaultCollections: string[],
): string[] | OwnedCommandError {
  if (!requestedCollections || requestedCollections.length === 0) {
    return defaultCollections;
  }

  const available = new Set(availableCollections);

  for (const collection of requestedCollections) {
    if (!available.has(collection)) {
      return validationError(`Collection not found: ${collection}`);
    }
  }

  return requestedCollections;
}

export function resolvePrimaryQuery(
  searches: ReadonlyArray<{ readonly type: string; readonly query: string }>,
): string {
  return (
    searches.find((search) => search.type === 'lex')?.query ??
    searches.find((search) => search.type === 'vec')?.query ??
    searches[0]?.query ??
    ''
  );
}
