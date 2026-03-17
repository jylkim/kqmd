import { parseArgs } from 'node:util';

import { CLI_OPTIONS } from '#src/cli_options.js';
import type { CommandExecutionContext } from '#src/types/command.js';
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
import {
  parseStructuredQueryDocument,
  resolvePrimaryQuery,
  validatePlainQueryText,
} from './validate.js';

export type ParsedValues = Record<string, string | boolean | string[] | undefined>;

export function parseOwnedArgs(argv: string[]): { values: ParsedValues; positionals: string[] } {
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

function parsePositiveIntegerOption(
  rawValue: string | undefined,
  optionName: string,
  maximum?: number,
): number | ReturnType<typeof validationError> | undefined {
  if (rawValue === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(rawValue.trim())) {
    return validationError(`The \`${optionName}\` option must be a positive integer.`);
  }

  const value = Number.parseInt(rawValue, 10);
  if (value < 1) {
    return validationError(`The \`${optionName}\` option must be a positive integer.`);
  }

  if (maximum !== undefined && value > maximum) {
    return validationError(`The \`${optionName}\` option must be ${maximum} or less.`);
  }

  return value;
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

  if (structuredQuery === null) {
    const plainQueryValidation = validatePlainQueryText(query);
    if (plainQueryValidation) {
      return plainQueryValidation;
    }
  }

  const parsedIntent = typeof values.intent === 'string' ? values.intent : undefined;
  const queryDocument = structuredQuery && 'searches' in structuredQuery ? structuredQuery : null;
  const parsedCandidateLimit = parsePositiveIntegerOption(
    typeof values['candidate-limit'] === 'string' ? values['candidate-limit'] : undefined,
    '--candidate-limit',
    100,
  );

  if (isOwnedCommandError(parsedCandidateLimit)) {
    return parsedCandidateLimit;
  }

  const candidateLimit = parsedCandidateLimit;

  const displayQuery = queryDocument ? resolvePrimaryQuery(queryDocument.searches) || query : query;

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
    return usageError('Usage: qmd update');
  }

  if (values.pull) {
    return validationError('Unknown option for `qmd update`: --pull.');
  }

  return {
    kind: 'ok',
    input: {},
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
  const { positionals } = parseOwnedArgs(context.argv);

  if (positionals.length > 1) {
    return usageError('Usage: qmd status');
  }

  return {
    kind: 'ok',
    input: {},
  };
}
