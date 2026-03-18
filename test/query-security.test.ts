import { describe, expect, test } from 'vitest';

import { parseOwnedQueryInput } from '../src/commands/owned/io/parse.js';
import { createContext } from './helpers.js';

describe('query security bounds', () => {
  test('rejects overlong plain queries', () => {
    const result = parseOwnedQueryInput(createContext(['query', 'x'.repeat(501)]));

    expect(result).toEqual({
      kind: 'validation',
      stderr: 'Query text must be 500 characters or less for plain queries.',
      exitCode: 1,
    });
  });

  test('rejects too many structured lines', () => {
    const queryDocument = Array.from({ length: 11 }, (_, index) => `lex: line ${index + 1}`).join(
      '\n',
    );
    const result = parseOwnedQueryInput(createContext(['query', queryDocument]));

    expect(result).toEqual({
      kind: 'validation',
      stderr: 'Query documents support at most 10 non-empty lines.',
      exitCode: 1,
    });
  });

  test('rejects unsupported control characters', () => {
    const result = parseOwnedQueryInput(createContext(['query', 'auth\u0007flow']));

    expect(result).toEqual({
      kind: 'validation',
      stderr: 'Query text contains unsupported control characters.',
      exitCode: 1,
    });
  });
});
