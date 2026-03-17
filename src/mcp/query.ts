import type { ExpandedQuery } from '@tobilu/qmd';
import type { z } from 'zod';
import { isOwnedCommandError, validationError } from '../commands/owned/io/errors.js';
import { buildMcpQueryRows } from '../commands/owned/io/query_rows.js';
import type { QueryCommandInput } from '../commands/owned/io/types.js';
import {
  parseStructuredQueryDocument,
  validatePlainQueryText,
  validateSingleLineQueryText,
} from '../commands/owned/io/validate.js';
import { classifyQuery } from '../commands/owned/query_classifier.js';
import type { executeQueryCore } from '../commands/owned/query_core.js';
import type { queryRequestSchema } from './types.js';

export function encodeQmdPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function formatSearchSummary(
  results: Array<{
    readonly docid: string;
    readonly file: string;
    readonly title: string;
    readonly score: number;
  }>,
  query: string,
  advisories: readonly string[],
): string {
  const lines =
    results.length === 0
      ? [`No results found for "${query}"`]
      : [
          `Found ${results.length} result${results.length === 1 ? '' : 's'} for "${query}":`,
          '',
          ...results.map(
            (result) =>
              `${result.docid} ${Math.round(result.score * 100)}% ${result.file} - ${result.title}`,
          ),
        ];

  if (advisories.length > 0) {
    lines.push(
      '',
      'Advisories:',
      ...advisories.map((advisory) => `- ${advisory.replaceAll('\n', ' ')}`),
    );
  }

  return lines.join('\n');
}

export function resolvePrimaryQuery(
  searches: Array<{ readonly type: 'lex' | 'vec' | 'hyde'; readonly query: string }>,
): string {
  return (
    searches.find((search) => search.type === 'lex')?.query ??
    searches.find((search) => search.type === 'vec')?.query ??
    searches[0]?.query ??
    ''
  );
}

function shapeQueryRows(
  rows: Awaited<ReturnType<typeof executeQueryCore>> extends infer Result
    ? Result extends { rows: infer QueryRows }
      ? QueryRows
      : never
    : never,
  primaryQuery: string,
  intent?: string,
) {
  return buildMcpQueryRows(rows, primaryQuery, intent);
}

export function buildQueryResponse(
  result: Awaited<ReturnType<typeof executeQueryCore>> extends infer QueryResult
    ? QueryResult extends { rows: infer QueryRows; advisories: infer QueryAdvisories }
      ? { readonly rows: QueryRows; readonly advisories: QueryAdvisories }
      : never
    : never,
  input: QueryCommandInput,
) {
  const rows = shapeQueryRows(result.rows, input.displayQuery, input.intent);

  return {
    primaryQuery: input.displayQuery,
    rows,
    advisories: result.advisories,
    query: {
      mode: input.queryMode,
      primaryQuery: input.displayQuery,
      intent: input.intent,
      queryClass: classifyQuery(input).queryClass,
    },
    text: formatSearchSummary(
      rows.map((row) => ({
        docid: row.docid,
        file: row.file,
        title: row.title,
        score: row.score,
      })),
      input.displayQuery,
      result.advisories,
    ),
  };
}

function normalizeCollections(
  collections?: string[],
): string[] | undefined | ReturnType<typeof validationError> {
  if (!collections) {
    return collections;
  }

  for (const [index, collection] of collections.entries()) {
    const validation = validateSingleLineQueryText(collection, `Collection ${index + 1}`);
    if (validation) {
      return validation;
    }
  }

  return collections;
}

function buildStructuredQueryText(
  searches: Array<{ readonly type: 'lex' | 'vec' | 'hyde'; readonly query: string }>,
  intent?: string,
) {
  return [
    ...searches.map((search) => `${search.type}: ${search.query}`),
    ...(intent ? [`intent: ${intent}`] : []),
  ].join('\n');
}

function normalizeStructuredSearches(
  searches: Array<{ readonly type: 'lex' | 'vec' | 'hyde'; readonly query: string }>,
  intent?: string,
) {
  const parsed = parseStructuredQueryDocument(buildStructuredQueryText(searches, intent));
  if (isOwnedCommandError(parsed)) {
    return parsed;
  }

  if (parsed === null) {
    return validationError('Structured query payload must include at least one search.');
  }

  return {
    searches: parsed.searches as ExpandedQuery[],
    intent: parsed.intent,
  };
}

export function buildQueryInputFromRequest(
  body: z.infer<typeof queryRequestSchema>,
): { readonly input: QueryCommandInput } | ReturnType<typeof validationError> {
  const collections = normalizeCollections(body.collections);
  if (isOwnedCommandError(collections)) {
    return collections;
  }

  if (body.searches) {
    const normalized = normalizeStructuredSearches(body.searches, body.intent);
    if (isOwnedCommandError(normalized)) {
      return normalized;
    }

    const primaryQuery = resolvePrimaryQuery(normalized.searches);
    return {
      input: {
        query: buildStructuredQueryText(normalized.searches, normalized.intent),
        format: 'json',
        limit: body.limit ?? 10,
        minScore: body.minScore ?? 0,
        all: false,
        full: false,
        lineNumbers: false,
        collections,
        candidateLimit: body.candidateLimit,
        explain: false,
        intent: normalized.intent,
        queryMode: 'structured',
        queries: normalized.searches,
        displayQuery: primaryQuery,
      },
    };
  }

  const query = body.query ?? '';
  const structuredQuery = parseStructuredQueryDocument(query);
  if (isOwnedCommandError(structuredQuery)) {
    return structuredQuery;
  }

  if (structuredQuery?.intent && body.intent) {
    return validationError(
      'Structured query documents with `intent:` cannot also provide a top-level `intent`.',
    );
  }

  if (structuredQuery === null) {
    const validation = validatePlainQueryText(query);
    if (validation) {
      return validation;
    }

    if (body.intent) {
      const intentValidation = validateSingleLineQueryText(body.intent, 'Intent');
      if (intentValidation) {
        return intentValidation;
      }
    }

    return {
      input: {
        query,
        format: 'json',
        limit: body.limit ?? 10,
        minScore: body.minScore ?? 0,
        all: false,
        full: false,
        lineNumbers: false,
        collections,
        candidateLimit: body.candidateLimit,
        explain: false,
        intent: body.intent,
        queryMode: 'plain',
        displayQuery: query,
      },
    };
  }

  return {
    input: {
      query,
      format: 'json',
      limit: body.limit ?? 10,
      minScore: body.minScore ?? 0,
      all: false,
      full: false,
      lineNumbers: false,
      collections,
      candidateLimit: body.candidateLimit,
      explain: false,
      intent: structuredQuery.intent,
      queryMode: 'structured',
      queries: structuredQuery.searches,
      displayQuery: resolvePrimaryQuery(structuredQuery.searches),
    },
  };
}
