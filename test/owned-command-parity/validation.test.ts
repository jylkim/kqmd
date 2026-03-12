import { describe, expect, test } from 'vitest';

import {
  parseStructuredQueryDocument,
  resolveSelectedCollections,
} from '../../src/commands/owned/io/validate.js';

describe('owned command parity validation', () => {
  test('rejects mixed expand and typed query documents', () => {
    expect(parseStructuredQueryDocument('expand: auth\nlex: login')).toEqual({
      kind: 'validation',
      stderr:
        'Line 1 starts with expand:, but query documents cannot mix expand with typed lines. Submit a single expand query instead.',
      exitCode: 1,
    });
  });

  test('rejects intent-only query documents', () => {
    expect(parseStructuredQueryDocument('intent: docs')).toEqual({
      kind: 'validation',
      stderr: 'intent: cannot appear alone. Add at least one lex:, vec:, or hyde: line.',
      exitCode: 1,
    });
  });

  test('rejects unknown collections', () => {
    expect(resolveSelectedCollections(['missing'], ['docs', 'notes'], ['docs'])).toEqual({
      kind: 'validation',
      stderr: 'Collection not found: missing',
      exitCode: 1,
    });
  });

  test('uses default collections when no explicit collection filter exists', () => {
    expect(resolveSelectedCollections(undefined, ['docs', 'notes'], ['docs'])).toEqual(['docs']);
  });
});
