import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';
import type { QueryCommandInput } from '../src/commands/owned/io/types.js';
import { executeQueryCore } from '../src/commands/owned/query_core.js';

function createInput(overrides: Partial<QueryCommandInput> = {}): QueryCommandInput {
  return {
    query: 'auth flow',
    format: 'json',
    limit: 10,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    explain: false,
    queryMode: 'plain',
    displayQuery: 'auth flow',
    ...overrides,
  };
}

function createStore(): QMDStore {
  return {
    close: vi.fn(async () => {}),
    listCollections: vi.fn(async () => [{ name: 'docs' }, { name: 'notes' }]),
    getDefaultCollectionNames: vi.fn(async () => ['docs']),
    search: vi.fn(async () => [
      {
        displayPath: 'docs/readme.md',
        title: 'README',
        body: 'Auth flow details',
        bestChunk: 'Auth flow details',
        context: 'documentation',
        score: 0.8,
        docid: 'doc-1',
        bestChunkPos: 0,
      },
    ]),
    getStatus: vi.fn(async () => ({
      totalDocuments: 2,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [],
    })),
    internal: {
      db: {
        prepare: vi.fn((sql: string) => ({
          all: vi.fn(() => {
            if (sql.includes('content_vectors')) {
              return [{ model: 'embeddinggemma', documents: 2 }];
            }

            return [];
          }),
          get: vi.fn(() => {
            if (sql.includes('COUNT(*) AS count')) {
              return { count: 2 };
            }

            return undefined;
          }),
        })),
      },
    },
  } as unknown as QMDStore;
}

describe('query core', () => {
  test('rejects candidate-limit with multiple collections on plain queries', async () => {
    const result = await executeQueryCore(
      createStore(),
      createInput({
        candidateLimit: 10,
        collections: ['docs', 'notes'],
      }),
      { HOME: '/home/tester' },
    );

    expect(result).toEqual({
      kind: 'validation',
      exitCode: 1,
      stderr: 'The `--candidate-limit` option currently supports at most one collection filter.',
    });
  });

  test('rejects oversized candidate-limit for mixed technical plain queries', async () => {
    const result = await executeQueryCore(
      createStore(),
      createInput({
        query: '지속 learning',
        displayQuery: '지속 learning',
        candidateLimit: 80,
      }),
      { HOME: '/home/tester' },
    );

    expect(result).toEqual({
      kind: 'validation',
      exitCode: 1,
      stderr:
        'Mixed technical plain queries support `--candidate-limit` up to 50 to keep rerank cost bounded.',
    });
  });

  test('allows oversized candidate-limit for general english plain queries', async () => {
    const hybridQuery = vi.fn(async () => []);

    const result = await executeQueryCore(
      createStore(),
      createInput({
        query: "what's new",
        displayQuery: "what's new",
        candidateLimit: 80,
        collections: ['docs'],
      }),
      { HOME: '/home/tester' },
      { hybridQuery },
    );

    expect('kind' in result).toBe(false);
    expect(hybridQuery).toHaveBeenCalledWith(expect.anything(), "what's new", {
      collection: 'docs',
      limit: 20,
      minScore: 0,
      candidateLimit: 80,
      explain: false,
      intent: undefined,
      skipRerank: false,
    });
  });

  test('allows structured compatibility queries to keep rerank enabled', async () => {
    const structuredSearch = vi.fn(async () => []);

    const result = await executeQueryCore(
      createStore(),
      createInput({
        query: 'lex: src/commands/owned/query_core.ts\nvec: auth flow',
        displayQuery: 'src/commands/owned/query_core.ts',
        queryMode: 'structured',
        queries: [
          { type: 'lex', query: 'src/commands/owned/query_core.ts', line: 1 },
          { type: 'vec', query: 'auth flow', line: 2 },
        ],
        candidateLimit: 80,
      }),
      { HOME: '/home/tester' },
      { structuredSearch },
    );

    expect('kind' in result).toBe(false);
    expect(structuredSearch).toHaveBeenCalledWith(expect.anything(), expect.any(Array), {
      collections: ['docs'],
      limit: 10,
      minScore: 0,
      candidateLimit: 80,
      explain: false,
      intent: undefined,
      skipRerank: false,
    });
  });

  test('returns structured advisories when embedding models mismatch', async () => {
    const result = await executeQueryCore(createStore(), createInput(), {
      HOME: '/home/tester',
    });

    expect('kind' in result).toBe(false);
    if ('kind' in result) {
      return;
    }

    expect(result.rows).toHaveLength(1);
    expect(result.advisories[0]).toContain('Embedding model mismatch detected.');
  });

  test('preserves source body and adds adaptive ranking metadata', async () => {
    const result = await executeQueryCore(
      createStore(),
      createInput({
        query: '지속 학습',
        displayQuery: '지속 학습',
      }),
      {
        HOME: '/home/tester',
      },
    );

    expect('kind' in result).toBe(false);
    if ('kind' in result) {
      return;
    }

    expect(result.rows[0]?.sourceBody).toBe('Auth flow details');
    expect(result.rows[0]?.body).toBe('Auth flow details');
    expect(result.rows[0]?.adaptive?.queryClass).toBe('short-korean-phrase');
  });

  test('passes adaptive fetch limit and rerank disable state to runtime dependencies', async () => {
    const hybridQuery = vi.fn(async () => [
      {
        file: 'docs/readme.md',
        displayPath: 'docs/readme.md',
        title: 'README',
        body: '지속 학습 메모',
        bestChunk: '지속 학습 메모',
        context: 'documentation',
        score: 0.7,
        docid: 'doc-1',
        bestChunkPos: 0,
      },
    ]);

    const result = await executeQueryCore(
      createStore(),
      createInput({
        query: '지속 학습',
        displayQuery: '지속 학습',
        candidateLimit: 30,
        collections: ['docs'],
      }),
      { HOME: '/home/tester' },
      { hybridQuery },
    );

    expect('kind' in result).toBe(false);
    expect(hybridQuery).toHaveBeenCalledWith(expect.anything(), '지속 학습', {
      collection: 'docs',
      limit: 30,
      minScore: 0,
      candidateLimit: 30,
      explain: false,
      intent: undefined,
      skipRerank: true,
    });
  });

  test('allows oversized candidate-limit for path-like plain queries when rerank is disabled', async () => {
    const hybridQuery = vi.fn(async () => []);

    const result = await executeQueryCore(
      createStore(),
      createInput({
        query: 'src/commands/owned/query_core.ts',
        displayQuery: 'src/commands/owned/query_core.ts',
        candidateLimit: 80,
        collections: ['docs'],
      }),
      { HOME: '/home/tester' },
      { hybridQuery },
    );

    expect('kind' in result).toBe(false);
    expect(hybridQuery).toHaveBeenCalledWith(
      expect.anything(),
      'src/commands/owned/query_core.ts',
      {
        collection: 'docs',
        limit: 40,
        minScore: 0,
        candidateLimit: 80,
        explain: false,
        intent: undefined,
        skipRerank: true,
      },
    );
  });
});
