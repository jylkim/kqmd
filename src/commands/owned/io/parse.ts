import { parseArgs } from 'node:util';

import { CLI_OPTIONS } from '../../../cli_options.js';
import type { CommandExecutionContext } from '../../../types/command.js';
import { isOwnedCommandError, usageError, validationError } from './errors.js';
import type {
  EmbedCommandInput,
  ParseResult,
  QueryCommandInput,
  SearchCommandInput,
  SearchOutputFormat,
  StatusCommandInput,
  UpdateCommandInput,
} from './types.js';
import { parseStructuredQueryDocument } from './validate.js';

type ParsedValues = Record<string, string | boolean | string[] | undefined>;

function parseOwnedArgs(argv: string[]): { values: ParsedValues; positionals: string[] } {
  const { values, positionals } = parseArgs({
    args: argv,
    options: CLI_OPTIONS,
    allowPositionals: true,
    strict: false,
  });

  return {
    values: values as ParsedValues,
    positionals,
  };
}

function resolveFormat(values: ParsedValues): SearchOutputFormat {
  if (values.csv) return 'csv';
  if (values.md) return 'md';
  if (values.xml) return 'xml';
  if (values.files) return 'files';
  if (values.json) return 'json';
  return 'cli';
}

function resolveDefaultLimit(format: SearchOutputFormat): number {
  return format === 'files' || format === 'json' ? 20 : 5;
}

function resolveLimit(values: ParsedValues, format: SearchOutputFormat): number {
  const isAll = Boolean(values.all);
  if (isAll) {
    return 100000;
  }

  const defaultLimit = resolveDefaultLimit(format);
  const rawLimit = values.n;
  if (typeof rawLimit !== 'string') {
    return defaultLimit;
  }

  return Number.parseInt(rawLimit, 10) || defaultLimit;
}

function resolveMinScore(values: ParsedValues): number {
  const rawMinScore = values['min-score'];
  if (typeof rawMinScore !== 'string') {
    return 0;
  }

  return Number.parseFloat(rawMinScore) || 0;
}

function resolveCandidateLimit(values: ParsedValues): number | undefined {
  const rawCandidateLimit = values['candidate-limit'];
  if (typeof rawCandidateLimit !== 'string') {
    return undefined;
  }

  return Number.parseInt(rawCandidateLimit, 10) || undefined;
}

function resolveCollections(values: ParsedValues): string[] | undefined {
  const rawCollections = values.collection;
  if (Array.isArray(rawCollections)) {
    return rawCollections;
  }

  if (typeof rawCollections === 'string') {
    return [rawCollections];
  }

  return undefined;
}

function resolveQuery(positionals: string[]): string {
  return positionals.slice(1).join(' ');
}

function hasTruthyValue(value: string | boolean | string[] | undefined): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== undefined && value !== false;
}

export function parseOwnedSearchInput(
  context: CommandExecutionContext,
): ParseResult<SearchCommandInput> {
  const { values, positionals } = parseOwnedArgs(context.argv);
  const query = resolveQuery(positionals);

  if (!query) {
    return usageError('Usage: qmd search [options] <query>');
  }

  const format = resolveFormat(values);

  return {
    kind: 'ok',
    input: {
      query,
      format,
      limit: resolveLimit(values, format),
      minScore: resolveMinScore(values),
      all: Boolean(values.all),
      full: Boolean(values.full),
      lineNumbers: Boolean(values['line-numbers']),
      collections: resolveCollections(values),
    },
  };
}

export function parseOwnedQueryInput(
  context: CommandExecutionContext,
): ParseResult<QueryCommandInput> {
  const { values, positionals } = parseOwnedArgs(context.argv);
  const query = resolveQuery(positionals);

  if (!query) {
    return usageError('Usage: qmd query [options] <query>');
  }

  const format = resolveFormat(values);
  const structuredQuery = parseStructuredQueryDocument(query);
  if (isOwnedCommandError(structuredQuery)) {
    return structuredQuery;
  }

  const parsedIntent = typeof values.intent === 'string' ? values.intent : undefined;
  const queryDocument = structuredQuery && 'searches' in structuredQuery ? structuredQuery : null;
  const candidateLimit = resolveCandidateLimit(values);

  if (candidateLimit !== undefined) {
    return validationError('The `query` command does not yet support --candidate-limit.');
  }

  const displayQuery = queryDocument
    ? (queryDocument.searches.find((search) => search.type === 'lex')?.query ??
      queryDocument.searches.find((search) => search.type === 'vec')?.query ??
      query)
    : query;

  return {
    kind: 'ok',
    input: {
      query,
      format,
      limit: resolveLimit(values, format),
      minScore: resolveMinScore(values),
      all: Boolean(values.all),
      full: Boolean(values.full),
      lineNumbers: Boolean(values['line-numbers']),
      collections: resolveCollections(values),
      explain: Boolean(values.explain),
      candidateLimit,
      intent: parsedIntent ?? queryDocument?.intent,
      queryMode: queryDocument ? 'structured' : 'plain',
      queries: queryDocument?.searches,
      displayQuery,
    },
  };
}

export function parseOwnedUpdateInput(
  context: CommandExecutionContext,
): ParseResult<UpdateCommandInput> {
  const { values, positionals } = parseOwnedArgs(context.argv);

  if (positionals.length > 1) {
    return usageError('Usage: qmd update [--pull]');
  }

  if (values.pull) {
    return validationError('The `update` command does not yet support --pull.');
  }

  return {
    kind: 'ok',
    input: {
      pull: Boolean(values.pull),
    },
  };
}

export function parseOwnedEmbedInput(
  context: CommandExecutionContext,
): ParseResult<EmbedCommandInput> {
  const { values, positionals } = parseOwnedArgs(context.argv);

  if (positionals.length > 1) {
    return usageError('Usage: qmd embed [-f|--force]');
  }

  return {
    kind: 'ok',
    input: {
      force: Boolean(values.force),
    },
  };
}

export function parseOwnedStatusInput(
  context: CommandExecutionContext,
): ParseResult<StatusCommandInput> {
  const { values, positionals } = parseOwnedArgs(context.argv);

  if (positionals.length > 1) {
    return usageError('Usage: qmd status');
  }

  for (const [key, value] of Object.entries(values)) {
    if (key === 'index') {
      continue;
    }

    if (hasTruthyValue(value)) {
      return validationError('The `status` command does not accept command-specific flags.');
    }
  }

  return {
    kind: 'ok',
    input: {},
  };
}
