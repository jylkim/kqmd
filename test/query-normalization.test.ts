import { describe, expect, test } from 'vitest';

import type { QueryCommandInput } from '../src/commands/owned/io/types.js';
import { classifyQuery } from '../src/commands/owned/query_classifier.js';
import {
  buildNormalizedSearchRequest,
  buildPlainQuerySearchRequest,
  buildQueryNormalizationPlan,
} from '../src/commands/owned/query_normalization.js';

function createInput(overrides: Partial<QueryCommandInput> = {}): QueryCommandInput {
  return {
    query: '문서 업로드 파싱은 어떻게 동작해?',
    displayQuery: '문서 업로드 파싱은 어떻게 동작해?',
    format: 'json',
    limit: 5,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    explain: false,
    queryMode: 'plain',
    ...overrides,
  };
}

describe('query normalization', () => {
  test('builds a normalized supplement query for long Korean questions', () => {
    const input = createInput();
    const traits = classifyQuery(input);
    const plan = buildQueryNormalizationPlan(input, traits);

    expect(plan).toEqual({
      kind: 'apply',
      normalizedQuery: '문서 업로드 파싱',
      keptTerms: ['문서', '업로드', '파싱'],
    });

    if (plan.kind !== 'apply') {
      throw new Error('expected apply plan');
    }

    const baseRequest = buildPlainQuerySearchRequest(input, traits);
    expect(buildNormalizedSearchRequest(baseRequest, plan)).toMatchObject({
      query: '문서 업로드 파싱',
      displayQuery: '문서 업로드 파싱은 어떻게 동작해?',
      queryMode: 'plain',
      disableRerank: true,
      fetchLimit: 13,
    });
  });

  test('skips conservative quoted queries', () => {
    const input = createInput({
      query: '"문서 업로드 파싱은 어떻게 동작해?"',
      displayQuery: '"문서 업로드 파싱은 어떻게 동작해?"',
    });

    expect(buildQueryNormalizationPlan(input, classifyQuery(input))).toEqual({
      kind: 'skip',
      reason: 'skipped-guard',
    });
  });

  test('preserves path-like tokens inside long Korean questions', () => {
    const input = createInput({
      query: 'src/app/page.tsx에서 oauth callback은 어떻게 동작해?',
      displayQuery: 'src/app/page.tsx에서 oauth callback은 어떻게 동작해?',
    });
    const traits = classifyQuery(input);
    const plan = buildQueryNormalizationPlan(input, traits);

    expect(plan).toEqual({
      kind: 'apply',
      normalizedQuery: 'src/app/page.tsx oauth callback',
      keptTerms: ['src/app/page.tsx', 'oauth', 'callback'],
    });

    const baseRequest = buildPlainQuerySearchRequest(input, traits);
    if (plan.kind !== 'apply') {
      throw new Error('expected apply plan');
    }

    expect(buildNormalizedSearchRequest(baseRequest, plan)).toMatchObject({
      query: 'src/app/page.tsx oauth callback',
      displayQuery: 'src/app/page.tsx에서 oauth callback은 어떻게 동작해?',
      queryMode: 'plain',
    });
  });

  test('does not over-strip Korean nouns with ambiguous trailing syllables', () => {
    const input = createInput({
      query: '회로 설계는 어떻게 동작해?',
      displayQuery: '회로 설계는 어떻게 동작해?',
    });

    expect(buildQueryNormalizationPlan(input, classifyQuery(input))).toEqual({
      kind: 'apply',
      normalizedQuery: '회로 설계',
      keptTerms: ['회로', '설계'],
    });
  });

  test('skips path-like lookups without Korean intent', () => {
    const input = createInput({
      query: 'src/app/page.tsx',
      displayQuery: 'src/app/page.tsx',
    });

    expect(buildQueryNormalizationPlan(input, classifyQuery(input))).toEqual({
      kind: 'skip',
      reason: 'not-eligible',
    });
  });
});
