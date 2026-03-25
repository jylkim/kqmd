import { describe, expect, test } from 'vitest';
import type { QueryCommandInput } from '../src/commands/owned/io/types.js';
import { classifyQuery } from '../src/commands/owned/query_classifier.js';
import { buildQueryExecutionPlan } from '../src/commands/owned/query_execution_policy.js';

function createInput(overrides: Partial<QueryCommandInput> = {}): QueryCommandInput {
  return {
    query: 'auth flow',
    displayQuery: 'auth flow',
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
  test('uses fast-default for plain queries without explicit controls', () => {
    const input = createInput({
      query: "what's new",
      displayQuery: "what's new",
    });

    expect(
      buildQueryExecutionPlan({
        input,
        selectedCollections: ['docs'],
      }),
    ).toMatchObject({
      strategy: 'fast-default',
      eligibilityReason: 'plain-default',
      canUseModelStages: false,
      normalizationEnabled: true,
      searchAssistEnabled: true,
    });
  });

  test('uses compatibility path for structured queries', () => {
    const input = createInput({
      query: 'lex: auth flow\nvec: login journey',
      displayQuery: 'auth flow',
      queryMode: 'structured',
      queries: [
        { type: 'lex', query: 'auth flow', line: 1 },
        { type: 'vec', query: 'login journey', line: 2 },
      ],
    });

    expect(
      buildQueryExecutionPlan({
        input,
        selectedCollections: ['docs'],
      }),
    ).toMatchObject({
      strategy: 'compatibility',
      eligibilityReason: 'structured-query',
      canUseModelStages: true,
    });
  });

  test('uses compatibility path when intent is explicit', () => {
    const input = createInput({
      query: 'auth flow',
      displayQuery: 'auth flow',
      intent: 'login journey',
    });

    expect(
      buildQueryExecutionPlan({
        input,
        selectedCollections: ['docs'],
      }),
    ).toMatchObject({
      strategy: 'compatibility',
      eligibilityReason: 'explicit-intent',
      canUseModelStages: true,
    });
  });

  test('uses compatibility path when candidate-limit is explicit', () => {
    const input = createInput({
      candidateLimit: 20,
    });

    expect(
      buildQueryExecutionPlan({
        input,
        selectedCollections: ['docs'],
      }),
    ).toMatchObject({
      strategy: 'compatibility',
      eligibilityReason: 'explicit-candidate-limit',
      canUseModelStages: true,
    });
  });

  test('uses compatibility path when collection filter is explicit', () => {
    const input = createInput({
      collections: ['docs'],
    });

    expect(
      buildQueryExecutionPlan({
        input,
        selectedCollections: ['docs'],
      }),
    ).toMatchObject({
      strategy: 'compatibility',
      eligibilityReason: 'explicit-collection-filter',
      canUseModelStages: true,
    });
  });

  test('keeps query class separate from retrieval policy', () => {
    const input = createInput({
      query: '지속 학습',
      displayQuery: '지속 학습',
    });
    const traits = classifyQuery(input);

    expect(traits.queryClass).toBe('short-korean-phrase');
    expect(
      buildQueryExecutionPlan({
        input,
        selectedCollections: ['docs'],
      }).strategy,
    ).toBe('fast-default');
  });
});
