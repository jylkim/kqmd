import { describe, expect, test } from 'vitest';

import {
  parseOwnedEmbedInput,
  parseOwnedQueryInput,
  parseOwnedSearchInput,
  parseOwnedUpdateInput,
} from '../../src/commands/owned/io/parse.js';
import type { CommandExecutionContext } from '../../src/types/command.js';

function createContext(argv: string[]): CommandExecutionContext {
  return {
    argv,
    commandArgs: argv.slice(1),
  };
}

describe('owned command parity parse', () => {
  test('search uses fixed format precedence and default limit', () => {
    const result = parseOwnedSearchInput(createContext(['search', '--json', '--files', 'hangul']));

    expect(result).toEqual({
      kind: 'ok',
      input: {
        query: 'hangul',
        format: 'files',
        limit: 20,
        minScore: 0,
        all: false,
        full: false,
        lineNumbers: false,
        collections: undefined,
      },
    });
  });

  test('query parses structured query documents and prefers lex display query', () => {
    const result = parseOwnedQueryInput(
      createContext(['query', 'intent: docs\nlex: auth flow\nvec: login flow']),
    );

    expect(result).toEqual({
      kind: 'ok',
      input: {
        query: 'intent: docs\nlex: auth flow\nvec: login flow',
        format: 'cli',
        limit: 5,
        minScore: 0,
        all: false,
        full: false,
        lineNumbers: false,
        collections: undefined,
        explain: false,
        candidateLimit: undefined,
        intent: 'docs',
        queryMode: 'structured',
        queries: [
          { type: 'lex', query: 'auth flow', line: 2 },
          { type: 'vec', query: 'login flow', line: 3 },
        ],
        displayQuery: 'auth flow',
      },
    });
  });

  test('query rejects unsupported candidate-limit instead of silently ignoring it', () => {
    const result = parseOwnedQueryInput(
      createContext(['query', '--candidate-limit', '10', 'auth']),
    );

    expect(result).toEqual({
      kind: 'validation',
      stderr: 'The `query` command does not yet support --candidate-limit.',
      exitCode: 1,
    });
  });

  test('update rejects unexpected positional arguments', () => {
    const result = parseOwnedUpdateInput(createContext(['update', 'extra']));

    expect(result).toEqual({
      kind: 'usage',
      stderr: 'Usage: qmd update [--pull]',
      exitCode: 1,
    });
  });

  test('update rejects unsupported pull flag instead of pretending it ran', () => {
    const result = parseOwnedUpdateInput(createContext(['update', '--pull']));

    expect(result).toEqual({
      kind: 'validation',
      stderr: 'The `update` command does not yet support --pull.',
      exitCode: 1,
    });
  });

  test('embed parses force flag', () => {
    const result = parseOwnedEmbedInput(createContext(['embed', '--force']));

    expect(result).toEqual({
      kind: 'ok',
      input: {
        force: true,
      },
    });
  });
});
