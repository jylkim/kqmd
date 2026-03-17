import { describe, expect, test } from 'vitest';
import type { QueryCommandInput } from '../src/commands/owned/io/types.js';
import {
  classifyQuery,
  resolveFetchLimitForQuery,
  shouldDisableRerankForQuery,
} from '../src/commands/owned/query_classifier.js';

function createInput(overrides: Partial<QueryCommandInput> = {}): QueryCommandInput {
  return {
    query: '지속 학습',
    format: 'cli',
    limit: 5,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    explain: false,
    queryMode: 'plain',
    displayQuery: '지속 학습',
    ...overrides,
  };
}

describe('query classifier', () => {
  test('classifies short korean phrases', () => {
    expect(classifyQuery(createInput()).queryClass).toBe('short-korean-phrase');
  });

  test('classifies mixed technical queries', () => {
    expect(
      classifyQuery(
        createInput({
          query: '지속 learning',
          displayQuery: '지속 learning',
        }),
      ).queryClass,
    ).toBe('mixed-technical');
  });

  test('keeps general english queries out of mixed technical and phrase/path heuristics', () => {
    const apostrophe = classifyQuery(
      createInput({
        query: "what's new",
        displayQuery: "what's new",
      }),
    );
    const hyphenated = classifyQuery(
      createInput({
        query: 'self-hosted pre-commit',
        displayQuery: 'self-hosted pre-commit',
      }),
    );

    expect(apostrophe.queryClass).toBe('general');
    expect(apostrophe.hasExplicitPhrase).toBe(false);
    expect(apostrophe.hasPathLikeToken).toBe(false);
    expect(hyphenated.queryClass).toBe('general');
    expect(hyphenated.hasPathLikeToken).toBe(false);
  });

  test('marks explicit phrases and path-like queries for lexical-first handling', () => {
    const quoted = classifyQuery(
      createInput({
        query: '"agent orchestration"',
        displayQuery: '"agent orchestration"',
      }),
    );
    const pathLike = classifyQuery(
      createInput({
        query: 'src/commands/owned/query_core.ts',
        displayQuery: 'src/commands/owned/query_core.ts',
      }),
    );

    expect(quoted.hasExplicitPhrase).toBe(true);
    expect(pathLike.hasPathLikeToken).toBe(true);
  });

  test('preserves structured compatibility when display query looks path-like', () => {
    const traits = classifyQuery(
      createInput({
        query: 'lex: src/commands/owned/query_core.ts\nvec: auth flow',
        displayQuery: 'src/commands/owned/query_core.ts',
        queryMode: 'structured',
      }),
    );

    expect(traits.queryClass).toBe('structured');
    expect(traits.hasPathLikeToken).toBe(true);
    expect(shouldDisableRerankForQuery(traits)).toBe(false);
  });

  test('keeps structured queries in compatibility mode', () => {
    expect(
      classifyQuery(
        createInput({
          query: 'lex: 지속 학습\nvec: continual learning',
          displayQuery: '지속 학습',
          queryMode: 'structured',
        }),
      ).queryClass,
    ).toBe('structured');
  });

  test('derives bounded fetch windows by query class', () => {
    const shortKorean = classifyQuery(createInput());
    const mixedTechnical = classifyQuery(
      createInput({
        query: 'src/commands/owned/query_core.ts',
        displayQuery: 'src/commands/owned/query_core.ts',
      }),
    );

    expect(resolveFetchLimitForQuery(5, shortKorean)).toBe(20);
    expect(resolveFetchLimitForQuery(5, mixedTechnical)).toBe(20);
    expect(resolveFetchLimitForQuery(20, mixedTechnical, 10)).toBe(20);
    expect(resolveFetchLimitForQuery(20, mixedTechnical, 30)).toBe(30);
  });
});
