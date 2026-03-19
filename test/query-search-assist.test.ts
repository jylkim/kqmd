import { describe, expect, test } from 'vitest';
import type { QueryCommandInput } from '../src/commands/owned/io/types.js';
import { classifyQuery } from '../src/commands/owned/query_classifier.js';
import { resolveQuerySearchAssist } from '../src/commands/owned/query_search_assist.js';

function createPolicy() {
  const input: QueryCommandInput = {
    query: '지속 학습',
    displayQuery: '지속 학습',
    format: 'json',
    limit: 5,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    explain: false,
    queryMode: 'plain',
    collections: ['docs'],
  };

  return {
    kind: 'eligible' as const,
    query: input.query,
    rescueCap: 2,
    timeoutMs: 10,
    selectedCollections: ['docs'],
    traits: classifyQuery(input),
  };
}

describe('query search assist', () => {
  test('reports timeout only for injected async resolver paths', async () => {
    const result = await resolveQuerySearchAssist(
      {
        internal: {},
      } as never,
      createPolicy(),
      {
        resolveSearchAssistRows: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [];
        },
      },
    );

    expect(result).toEqual({
      rows: [],
      reason: 'timeout',
    });
  });
});
