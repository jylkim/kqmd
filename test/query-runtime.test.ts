import type { ExpandedQuery, QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';
import type { QueryCommandInput } from '../src/commands/owned/io/types.js';
import { executeOwnedQuerySearch } from '../src/commands/owned/query_runtime.js';

function createStore() {
  return {
    search: vi.fn(async () => []),
    internal: {
      db: {},
    },
  } as unknown as QMDStore;
}

function createInput(overrides: Partial<QueryCommandInput> = {}): QueryCommandInput {
  return {
    query: 'auth flow',
    format: 'cli',
    limit: 5,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    collections: undefined,
    explain: false,
    candidateLimit: undefined,
    intent: undefined,
    queryMode: 'plain',
    queries: undefined,
    displayQuery: 'auth flow',
    ...overrides,
  };
}

describe('owned query runtime', () => {
  test('uses public store.search when candidate-limit is not set', async () => {
    const store = createStore();

    await executeOwnedQuerySearch(store, createInput(), ['docs']);

    expect(store.search).toHaveBeenCalledWith({
      query: 'auth flow',
      collections: ['docs'],
      limit: 5,
      minScore: 0,
      explain: false,
      intent: undefined,
    });
  });

  test('routes plain query candidate-limit through hybridQuery', async () => {
    const store = createStore();
    const hybridQuery = vi.fn(async () => []);

    await executeOwnedQuerySearch(
      store,
      createInput({
        candidateLimit: 10,
      }),
      ['docs'],
      { hybridQuery },
    );

    expect(store.search).not.toHaveBeenCalled();
    expect(hybridQuery).toHaveBeenCalledWith(store.internal, 'auth flow', {
      collection: 'docs',
      limit: 5,
      minScore: 0,
      candidateLimit: 10,
      explain: false,
      intent: undefined,
    });
  });

  test('routes structured query candidate-limit through structuredSearch', async () => {
    const store = createStore();
    const structuredSearch = vi.fn(async () => []);
    const queries: ExpandedQuery[] = [
      { type: 'lex', query: 'auth flow', line: 1 },
      { type: 'vec', query: 'login journey', line: 2 },
    ];

    await executeOwnedQuerySearch(
      store,
      createInput({
        candidateLimit: 10,
        queryMode: 'structured',
        queries,
      }),
      ['docs', 'notes'],
      { structuredSearch },
    );

    expect(store.search).not.toHaveBeenCalled();
    expect(structuredSearch).toHaveBeenCalledWith(store.internal, queries, {
      collections: ['docs', 'notes'],
      limit: 5,
      minScore: 0,
      candidateLimit: 10,
      explain: false,
      intent: undefined,
    });
  });
});
