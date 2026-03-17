import type { ExpandedQuery } from '@tobilu/qmd';

import { validationError } from './errors.js';
import type { OwnedCommandError } from './types.js';

export const MAX_QUERY_TEXT_LENGTH = 500;
export const MAX_STRUCTURED_QUERY_LINES = 10;

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
