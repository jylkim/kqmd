import { describe, expect, test } from 'vitest';

import type { QueryCommandInput } from '../src/commands/owned/io/types.js';
import { classifyQuery } from '../src/commands/owned/query_classifier.js';
import { buildQueryExecutionPlan } from '../src/commands/owned/query_execution_policy.js';

function createInput(overrides: Partial<QueryCommandInput> = {}): QueryCommandInput {
  return {
    query: 'agent orchestration',
    displayQuery: 'agent orchestration',
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

describe('query execution policy', () => {
  test('uses cost-capped structured fast default for plain queries without explicit overrides', () => {
    const input = createInput();
    const plan = buildQueryExecutionPlan({
      input,
      traits: classifyQuery(input),
      lexicalProbe: {
        rows: [],
        signal: 'strong',
        usesShadowIndex: false,
        conservativeSyntax: false,
      },
      normalizationPlan: { kind: 'skip', reason: 'not-eligible' },
      selectedCollectionsCount: 1,
    });

    expect(plan.retrievalKind).toBe('cost-capped-structured');
    expect(plan.fallbackReason).toBe('fast-default');
    expect(plan.candidateWindow).toBe(7);
    expect(plan.request.queryMode).toBe('plain');
    expect('preExpandedQueries' in plan.request && plan.request.preExpandedQueries).toEqual([
      { type: 'lex', query: 'agent orchestration', line: 1 },
      { type: 'vec', query: 'agent orchestration', line: 2 },
    ]);
  });

  test('keeps explicit intent on compatibility hybrid path', () => {
    const input = createInput({ intent: 'release notes' });
    const plan = buildQueryExecutionPlan({
      input,
      traits: classifyQuery(input),
      lexicalProbe: {
        rows: [],
        signal: 'moderate',
        usesShadowIndex: false,
        conservativeSyntax: false,
      },
      normalizationPlan: { kind: 'skip', reason: 'not-eligible' },
      selectedCollectionsCount: 1,
    });

    expect(plan.retrievalKind).toBe('compatibility-hybrid');
    expect(plan.fallbackReason).toBe('compatibility-explicit-intent');
    expect(
      'preExpandedQueries' in plan.request ? plan.request.preExpandedQueries : undefined,
    ).toBeUndefined();
  });

  test('keeps conservative syntax on compatibility path', () => {
    const input = createInput({ query: '"지속 학습"', displayQuery: '"지속 학습"' });
    const plan = buildQueryExecutionPlan({
      input,
      traits: classifyQuery(input),
      lexicalProbe: {
        rows: [],
        signal: 'moderate',
        usesShadowIndex: false,
        conservativeSyntax: true,
      },
      normalizationPlan: { kind: 'skip', reason: 'skipped-guard' },
      selectedCollectionsCount: 1,
    });

    expect(plan.retrievalKind).toBe('compatibility-hybrid');
    expect(plan.fallbackReason).toBe('conservative-syntax');
  });

  test('keeps single explicit collection on fast-default path', () => {
    const input = createInput({ collections: ['docs'] });
    const plan = buildQueryExecutionPlan({
      input,
      traits: classifyQuery(input),
      lexicalProbe: {
        rows: [],
        signal: 'weak',
        usesShadowIndex: false,
        conservativeSyntax: false,
      },
      normalizationPlan: { kind: 'skip', reason: 'not-eligible' },
      selectedCollectionsCount: 1,
    });

    expect(plan.retrievalKind).toBe('cost-capped-structured');
    expect(plan.fallbackReason).toBe('fast-default');
  });

  test('keeps explicit multi-collection filters on compatibility public path', () => {
    const input = createInput({ collections: ['docs', 'notes'] });
    const plan = buildQueryExecutionPlan({
      input,
      traits: classifyQuery(input),
      lexicalProbe: {
        rows: [],
        signal: 'weak',
        usesShadowIndex: false,
        conservativeSyntax: false,
      },
      normalizationPlan: { kind: 'skip', reason: 'not-eligible' },
      selectedCollectionsCount: 2,
    });

    expect(plan.retrievalKind).toBe('compatibility-public');
    expect(plan.fallbackReason).toBe('compatibility-explicit-collection-filter');
  });

  test('keeps multi-collection defaults on compatibility public path', () => {
    const input = createInput();
    const plan = buildQueryExecutionPlan({
      input,
      traits: classifyQuery(input),
      lexicalProbe: {
        rows: [],
        signal: 'moderate',
        usesShadowIndex: false,
        conservativeSyntax: false,
      },
      normalizationPlan: { kind: 'skip', reason: 'not-eligible' },
      selectedCollectionsCount: 2,
    });

    expect(plan.retrievalKind).toBe('compatibility-public');
    expect(plan.fallbackReason).toBe('compatibility-multi-collection-default');
    expect(
      'preExpandedQueries' in plan.request ? plan.request.preExpandedQueries : undefined,
    ).toBeUndefined();
  });

  test('disables rerank for mixed-technical Hangul fast-default queries', () => {
    const input = createInput({
      query: '도커 compose 설정',
      displayQuery: '도커 compose 설정',
      collections: ['docs'],
    });
    const plan = buildQueryExecutionPlan({
      input,
      traits: classifyQuery(input),
      lexicalProbe: {
        rows: [],
        signal: 'none',
        usesShadowIndex: false,
        conservativeSyntax: false,
      },
      normalizationPlan: { kind: 'skip', reason: 'not-eligible' },
      selectedCollectionsCount: 1,
    });

    expect(plan.retrievalKind).toBe('cost-capped-structured');
    expect(plan.request.queryMode).toBe('plain');
    expect(plan.request.disableRerank).toBe(true);
  });

  test('preserves explicit rerank disable and chunk strategy on fast-default plain queries', () => {
    const input = createInput({
      query: '문서 업로드 파싱 순서는 어떻게 동작해?',
      displayQuery: '문서 업로드 파싱 순서는 어떻게 동작해?',
      disableRerank: true,
      chunkStrategy: 'regex',
    });
    const plan = buildQueryExecutionPlan({
      input,
      traits: classifyQuery(input),
      lexicalProbe: {
        rows: [],
        signal: 'none',
        usesShadowIndex: false,
        conservativeSyntax: false,
      },
      normalizationPlan: { kind: 'apply', normalizedQuery: '문서 업로드 파싱 순서', keptTerms: [] },
      selectedCollectionsCount: 1,
    });

    expect(plan.retrievalKind).toBe('cost-capped-structured');
    expect(plan.request.queryMode).toBe('plain');
    expect(plan.request.disableRerank).toBe(true);
    expect(plan.request.chunkStrategy).toBe('regex');
  });

  test('preserves explicit rerank disable on structured compatibility queries', () => {
    const input = createInput({
      query: 'type: lex\nquery: auth flow',
      displayQuery: 'auth flow',
      queryMode: 'structured',
      queries: [{ type: 'lex', query: 'auth flow', line: 1 }],
      disableRerank: true,
    });
    const plan = buildQueryExecutionPlan({
      input,
      traits: classifyQuery(input),
      lexicalProbe: {
        rows: [],
        signal: 'none',
        usesShadowIndex: false,
        conservativeSyntax: false,
      },
      normalizationPlan: { kind: 'skip', reason: 'not-eligible' },
      selectedCollectionsCount: 1,
    });

    expect(plan.retrievalKind).toBe('structured-compatibility');
    expect(plan.request.queryMode).toBe('structured');
    expect(plan.request.disableRerank).toBe(true);
  });
});
