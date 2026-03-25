import type { ExpandedQuery } from '@tobilu/qmd';
import type { z } from 'zod';
import { isOwnedCommandError, validationError } from '#src/commands/owned/io/errors.js';
import { buildMcpQueryRows } from '#src/commands/owned/io/query_rows.js';
import type { QueryCommandInput } from '#src/commands/owned/io/types.js';
import {
  parseStructuredQueryDocument,
  resolvePrimaryQuery,
  validatePlainQueryText,
  validateSingleLineQueryText,
} from '#src/commands/owned/io/validate.js';
import { classifyQuery } from '#src/commands/owned/query_classifier.js';
import type { QueryCoreSuccess } from '#src/commands/owned/query_core.js';
import { filterRows } from '../commands/owned/io/format.js';
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

function buildFallbackQuerySummary(
  input: QueryCommandInput,
  searchAssist?: QueryCoreSuccess['searchAssist'],
): QueryCoreSuccess['query'] {
  const retrievalKind =
    input.queryMode === 'structured' ? 'structured-compatibility' : 'compatibility-public';
  const fallbackReason =
    input.queryMode === 'structured'
      ? 'compatibility-structured'
      : input.intent
        ? 'compatibility-explicit-intent'
        : input.candidateLimit !== undefined
          ? 'compatibility-explicit-candidate-limit'
          : input.collections && input.collections.length > 0
            ? 'compatibility-explicit-collection-filter'
            : 'compatibility-public-fallback';
  return {
    mode: input.queryMode,
    primaryQuery: input.displayQuery,
    intent: input.intent,
    queryClass: classifyQuery(input).queryClass,
    execution: {
      retrievalKind,
      fallbackReason,
      lexicalSignal: 'none',
      embeddingApplied: false,
      expansionApplied: false,
      rerankApplied: false,
      heavyPathUsed: false,
      candidateWindow: input.candidateLimit ?? 40,
    },
    normalization: {
      applied: false,
      reason: 'not-eligible',
      addedCandidates: 0,
    },
    searchAssist: searchAssist ?? {
      applied: false,
      reason: 'ineligible',
      addedCandidates: 0,
    },
  };
}

export function buildQueryResponse(result: QueryCoreSuccess, input: QueryCommandInput) {
  const filteredRows = filterRows(result.rows, input.limit, input.minScore);
  const rows = buildMcpQueryRows(filteredRows, input.displayQuery, input.intent);
  const query = result.query ?? buildFallbackQuerySummary(input, result.searchAssist);

  return {
    primaryQuery: input.displayQuery,
    rows,
    advisories: result.advisories,
    query,
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

function buildMcpQueryInput(
  body: z.infer<typeof queryRequestSchema>,
  collections: string[] | undefined,
  overrides: Pick<QueryCommandInput, 'query' | 'queryMode' | 'displayQuery' | 'intent'> &
    Partial<Pick<QueryCommandInput, 'queries'>>,
): { readonly input: QueryCommandInput } {
  return {
    input: {
      format: 'json',
      limit: body.limit ?? 10,
      minScore: body.minScore ?? 0,
      all: false,
      full: false,
      lineNumbers: false,
      collections,
      candidateLimit: body.candidateLimit,
      explain: false,
      ...overrides,
    },
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

    return buildMcpQueryInput(body, collections, {
      query: buildStructuredQueryText(normalized.searches, normalized.intent),
      intent: normalized.intent,
      queryMode: 'structured',
      queries: normalized.searches,
      displayQuery: resolvePrimaryQuery(normalized.searches),
    });
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

    return buildMcpQueryInput(body, collections, {
      query,
      intent: body.intent,
      queryMode: 'plain',
      displayQuery: query,
    });
  }

  return buildMcpQueryInput(body, collections, {
    query,
    intent: structuredQuery.intent,
    queryMode: 'structured',
    queries: structuredQuery.searches,
    displayQuery: resolvePrimaryQuery(structuredQuery.searches),
  });
}
