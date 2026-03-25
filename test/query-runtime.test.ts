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

    await executeOwnedQuerySearch(
      store,
      createInput({
        fetchLimit: 20,
      }),
      ['docs'],
    );

    expect(store.search).toHaveBeenCalledWith({
      query: 'auth flow',
      collections: ['docs'],
      limit: 20,
      minScore: 0,
      explain: false,
      intent: undefined,
    });
  });

  test('disables rerank on public store.search when requested', async () => {
    const store = createStore();

    await executeOwnedQuerySearch(
      store,
      createInput({
        disableRerank: true,
        fetchLimit: 20,
      }),
      ['docs'],
    );

    expect(store.search).toHaveBeenCalledWith({
      query: 'auth flow',
      collections: ['docs'],
      limit: 20,
      minScore: 0,
      explain: false,
      intent: undefined,
      rerank: false,
    });
  });

  test('passes rerank false for quoted phrase queries when classifier disables rerank', async () => {
    const store = createStore();

    await executeOwnedQuerySearch(
      store,
      createInput({
        query: '"agent orchestration"',
        displayQuery: '"agent orchestration"',
        disableRerank: true,
        fetchLimit: 20,
      }),
      ['docs'],
    );

    expect(store.search).toHaveBeenCalledWith({
      query: '"agent orchestration"',
      collections: ['docs'],
      limit: 20,
      minScore: 0,
      explain: false,
      intent: undefined,
      rerank: false,
    });
  });

  test('routes plain query candidate-limit through hybridQuery', async () => {
    const store = createStore();
    const hybridQuery = vi.fn(async () => []);

    await executeOwnedQuerySearch(
      store,
      createInput({
        candidateLimit: 10,
        fetchLimit: 20,
      }),
      ['docs'],
      { hybridQuery },
    );

    expect(store.search).not.toHaveBeenCalled();
    expect(hybridQuery).toHaveBeenCalledWith(
      store.internal,
      'auth flow',
      expect.objectContaining({
        collection: 'docs',
        limit: 20,
        minScore: 0,
        candidateLimit: 10,
        explain: false,
        intent: undefined,
      }),
    );
  });

  test('passes skipRerank to hybridQuery when candidate-limit path disables rerank', async () => {
    const store = createStore();
    const hybridQuery = vi.fn(async () => []);

    await executeOwnedQuerySearch(
      store,
      createInput({
        candidateLimit: 10,
        disableRerank: true,
        fetchLimit: 20,
      }),
      ['docs'],
      { hybridQuery },
    );

    expect(hybridQuery).toHaveBeenCalledWith(
      store.internal,
      'auth flow',
      expect.objectContaining({
        collection: 'docs',
        limit: 20,
        minScore: 0,
        candidateLimit: 10,
        explain: false,
        intent: undefined,
        skipRerank: true,
      }),
    );
  });

  test('rejects plain query candidate-limit with multiple collection filters', async () => {
    const store = createStore();
    const hybridQuery = vi.fn(async () => []);

    await expect(
      executeOwnedQuerySearch(
        store,
        createInput({
          candidateLimit: 10,
        }),
        ['docs', 'notes'],
        { hybridQuery },
      ),
    ).rejects.toThrow(
      'The `--candidate-limit` option currently supports at most one collection filter.',
    );

    expect(hybridQuery).not.toHaveBeenCalled();
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
        fetchLimit: 20,
      }),
      ['docs', 'notes'],
      { structuredSearch },
    );

    expect(store.search).not.toHaveBeenCalled();
    expect(structuredSearch).toHaveBeenCalledWith(
      store.internal,
      queries,
      expect.objectContaining({
        collections: ['docs', 'notes'],
        limit: 20,
        minScore: 0,
        candidateLimit: 10,
        explain: false,
        intent: undefined,
      }),
    );
  });

  test('falls back to public search when fast-default spans multiple collections', async () => {
    const store = createStore();
    const structuredSearch = vi.fn(async () => []);

    await executeOwnedQuerySearch(
      store,
      {
        ...createInput({
          fetchLimit: 20,
          candidateLimit: 12,
        }),
        preExpandedQueries: [
          { type: 'lex', query: 'auth flow', line: 1 },
          { type: 'vec', query: 'auth flow', line: 2 },
        ],
        runtimeKind: 'cost-capped-structured',
      } as never,
      ['docs', 'notes'],
      { structuredSearch },
    );

    expect(store.search).toHaveBeenCalledWith({
      query: 'auth flow',
      collections: ['docs', 'notes'],
      limit: 20,
      minScore: 0,
      explain: false,
      intent: undefined,
    });
    expect(structuredSearch).not.toHaveBeenCalled();
  });
});
