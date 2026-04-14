import { describe, expect, test } from 'vitest';

import {
  parseOwnedBenchInput,
  parseOwnedEmbedInput,
  parseOwnedQueryInput,
  parseOwnedSearchInput,
  parseOwnedStatusInput,
  parseOwnedUpdateInput,
} from '../../src/commands/owned/io/parse.js';
import { createContext } from '../helpers.js';

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
        chunkStrategy: undefined,
        disableRerank: false,
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

  test('query accepts candidate-limit when it is a positive integer', () => {
    const result = parseOwnedQueryInput(
      createContext(['query', '--candidate-limit', '10', 'auth']),
    );

    expect(result).toEqual({
      kind: 'ok',
      input: {
        query: 'auth',
        format: 'cli',
        limit: 5,
        minScore: 0,
        all: false,
        full: false,
        lineNumbers: false,
        collections: undefined,
        explain: false,
        candidateLimit: 10,
        chunkStrategy: undefined,
        disableRerank: false,
        intent: undefined,
        queryMode: 'plain',
        queries: undefined,
        displayQuery: 'auth',
      },
    });
  });

  test('query rejects invalid candidate-limit values', () => {
    expect(
      parseOwnedQueryInput(createContext(['query', '--candidate-limit', '0', 'auth'])),
    ).toEqual({
      kind: 'validation',
      stderr: 'The `--candidate-limit` option must be a positive integer.',
      exitCode: 1,
    });

    expect(
      parseOwnedQueryInput(createContext(['query', '--candidate-limit', '101', 'auth'])),
    ).toEqual({
      kind: 'validation',
      stderr: 'The `--candidate-limit` option must be 100 or less.',
      exitCode: 1,
    });
  });

  test('query rejects oversized plain text and structured line overflow', () => {
    expect(parseOwnedQueryInput(createContext(['query', 'x'.repeat(501)]))).toEqual({
      kind: 'validation',
      stderr: 'Query text must be 500 characters or less for plain queries.',
      exitCode: 1,
    });

    const queryDocument = Array.from({ length: 11 }, (_, index) => `lex: line ${index + 1}`).join(
      '\n',
    );
    expect(parseOwnedQueryInput(createContext(['query', queryDocument]))).toEqual({
      kind: 'validation',
      stderr: 'Query documents support at most 10 non-empty lines.',
      exitCode: 1,
    });
  });

  test('query parses no-rerank and chunk-strategy flags', () => {
    const result = parseOwnedQueryInput(
      createContext(['query', '--no-rerank', '--chunk-strategy', 'auto', 'auth']),
    );

    expect(result).toEqual({
      kind: 'ok',
      input: {
        query: 'auth',
        format: 'cli',
        limit: 5,
        minScore: 0,
        all: false,
        full: false,
        lineNumbers: false,
        collections: undefined,
        explain: false,
        candidateLimit: undefined,
        chunkStrategy: 'auto',
        disableRerank: true,
        intent: undefined,
        queryMode: 'plain',
        queries: undefined,
        displayQuery: 'auth',
      },
    });
  });

  test('query rejects invalid chunk-strategy values', () => {
    expect(
      parseOwnedQueryInput(createContext(['query', '--chunk-strategy', 'weird', 'auth'])),
    ).toEqual({
      kind: 'validation',
      stderr: '--chunk-strategy must be "auto" or "regex" (got "weird")',
      exitCode: 1,
    });
  });

  test('update rejects unexpected positional arguments', () => {
    const result = parseOwnedUpdateInput(createContext(['update', 'extra']));

    expect(result).toEqual({
      kind: 'usage',
      stderr: 'Usage: qmd update',
      exitCode: 1,
    });
  });

  test('update rejects de-surfaced pull flag', () => {
    const result = parseOwnedUpdateInput(createContext(['update', '--pull']));

    expect(result).toEqual({
      kind: 'validation',
      stderr: 'Unknown option for `qmd update`: --pull.',
      exitCode: 1,
    });
  });

  test('embed parses force flag', () => {
    const result = parseOwnedEmbedInput(createContext(['embed', '--force']));

    expect(result).toEqual({
      kind: 'ok',
      input: {
        force: true,
        chunkStrategy: undefined,
      },
    });
  });

  test('embed parses chunk-strategy flag', () => {
    const result = parseOwnedEmbedInput(createContext(['embed', '--chunk-strategy', 'regex']));

    expect(result).toEqual({
      kind: 'ok',
      input: {
        force: false,
        chunkStrategy: 'regex',
      },
    });
  });

  test('bench parses fixture path, json, and collection override', () => {
    const result = parseOwnedBenchInput(
      createContext(['bench', '--json', '-c', 'docs', 'fixtures/example.json']),
    );

    expect(result).toEqual({
      kind: 'ok',
      input: {
        fixturePath: 'fixtures/example.json',
        json: true,
        collection: 'docs',
      },
    });
  });

  test('bench rejects unsupported options', () => {
    expect(
      parseOwnedBenchInput(createContext(['bench', '--csv', 'fixtures/example.json'])),
    ).toEqual({
      kind: 'validation',
      stderr: 'Unknown option for `qmd bench`: --csv.',
      exitCode: 1,
    });
  });

  test('status rejects unsupported command-specific flags', () => {
    const result = parseOwnedStatusInput(createContext(['status', '--json']));

    expect(result).toEqual({
      kind: 'ok',
      input: {},
    });
  });
});
