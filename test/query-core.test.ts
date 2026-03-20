import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';
import type { QueryCommandInput } from '../src/commands/owned/io/types.js';
import { executeQueryCore } from '../src/commands/owned/query_core.js';
import { QUERY_NORMALIZATION_LATENCY_BUDGET_MS } from '../src/commands/owned/query_normalization.js';

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

function getPreparedSqls(store: QMDStore): string[] {
  const prepare = store.internal.db.prepare as unknown as {
    mock: { calls: Array<[string]> };
  };

  return prepare.mock.calls.map(([sql]) => sql);
}

function createCleanAssistStore(
  baseSearchResults: Awaited<ReturnType<QMDStore['search']>>,
): QMDStore {
  return {
    close: vi.fn(async () => {}),
    listCollections: vi.fn(async () => [{ name: 'docs' }]),
    getDefaultCollectionNames: vi.fn(async () => ['docs']),
    search: vi.fn(async () => baseSearchResults),
    getStatus: vi.fn(async () => ({
      totalDocuments: 1,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [],
    })),
    internal: {
      db: {
        prepare: vi.fn((sql: string) => ({
          all: vi.fn(() => {
            if (sql.includes('content_vectors')) {
              return [{ model: 'embeddinggemma', documents: 1 }];
            }

            return [];
          }),
          get: vi.fn((...params: (string | number)[]) => {
            if (sql.includes('store_config')) {
              if (params[0] === 'kqmd_search_source_snapshot') {
                return {
                  value: JSON.stringify({
                    totalDocuments: 1,
                    latestModifiedAt: '2026-03-19T00:00:00.000Z',
                    maxDocumentId: 1,
                  }),
                };
              }

              if (params[0] === 'kqmd_search_collection_snapshots') {
                return {
                  value: JSON.stringify({
                    docs: {
                      totalDocuments: 1,
                      latestModifiedAt: '2026-03-19T00:00:00.000Z',
                      maxDocumentId: 1,
                    },
                  }),
                };
              }

              return { value: 'kiwi-cong-shadow-v1' };
            }

            if (sql.includes('sqlite_master')) {
              return { name: 'kqmd_documents_fts' };
            }

            if (sql.includes('MAX(d.modified_at)')) {
              return {
                count: 1,
                latest_modified_at: '2026-03-19T00:00:00.000Z',
                max_document_id: 1,
              };
            }

            if (sql.includes('COUNT(*) AS count')) {
              return { count: 1 };
            }

            return undefined;
          }),
        })),
      },
    },
  } as unknown as QMDStore;
}

function createDynamicSearchStore(searchImpl: NonNullable<QMDStore['search']>): QMDStore {
  return {
    close: vi.fn(async () => {}),
    listCollections: vi.fn(async () => [{ name: 'docs' }]),
    getDefaultCollectionNames: vi.fn(async () => ['docs']),
    search: vi.fn(searchImpl),
    getStatus: vi.fn(async () => ({
      totalDocuments: 1,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [],
    })),
    internal: {
      db: {
        prepare: vi.fn((sql: string) => ({
          all: vi.fn(() => {
            if (sql.includes('content_vectors')) {
              return [{ model: 'embeddinggemma', documents: 1 }];
            }

            return [];
          }),
          get: vi.fn(() => {
            if (sql.includes('COUNT(*) AS count')) {
              return { count: 1 };
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

  test('skips search health reads for ineligible general english queries', async () => {
    const store = createStore();

    const result = await executeQueryCore(
      store,
      createInput({
        query: "what's new",
        displayQuery: "what's new",
      }),
      { HOME: '/home/tester' },
    );

    expect('kind' in result).toBe(false);
    if ('kind' in result) {
      return;
    }

    expect(result.searchAssist).toEqual({
      applied: false,
      reason: 'ineligible',
      addedCandidates: 0,
    });

    const preparedSqls = getPreparedSqls(store);
    expect(
      preparedSqls.some(
        (sql) =>
          sql.includes('sqlite_master') ||
          sql.includes('kqmd_search_') ||
          sql.includes('MAX(d.modified_at)'),
      ),
    ).toBe(false);
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

  test('rescues eligible korean query misses with search assist candidates', async () => {
    const store = createCleanAssistStore([
      {
        file: 'docs/overview.md',
        displayPath: 'docs/overview.md',
        title: 'Overview',
        body: 'generic note',
        bestChunk: 'generic note',
        context: 'documentation',
        score: 0.52,
        docid: 'doc-1',
        bestChunkPos: 0,
      },
    ]);
    const resolveSearchAssistRows = vi.fn(async () => [
      {
        displayPath: 'docs/korean-search.md',
        title: '지속 학습 메모',
        body: '지속 학습은 문서 업로드 파싱과 연결됩니다.',
        sourceBody: '지속 학습은 문서 업로드 파싱과 연결됩니다.',
        context: 'documentation',
        score: 0.91,
        docid: 'doc-2',
      },
    ]);

    const result = await executeQueryCore(
      store,
      createInput({
        query: '지속 학습',
        displayQuery: '지속 학습',
      }),
      { HOME: '/home/tester' },
      { resolveSearchAssistRows },
    );

    expect('kind' in result).toBe(false);
    if ('kind' in result) {
      return;
    }

    expect(resolveSearchAssistRows).toHaveBeenCalledTimes(1);
    expect(result.searchAssist).toEqual({
      applied: true,
      reason: 'strong-hit',
      addedCandidates: 1,
    });
    expect(result.rows.some((row) => row.searchAssist?.rescued)).toBe(true);
  });

  test('returns rescue-only results when base query is empty but assist finds a strong hit', async () => {
    const store = createCleanAssistStore([]);

    const result = await executeQueryCore(
      store,
      createInput({
        query: '지속 학습',
        displayQuery: '지속 학습',
      }),
      { HOME: '/home/tester' },
      {
        resolveSearchAssistRows: async () => [
          {
            displayPath: 'docs/korean-search.md',
            title: '지속 학습 메모',
            body: '지속 학습은 문서 업로드 파싱과 연결됩니다.',
            sourceBody: '지속 학습은 문서 업로드 파싱과 연결됩니다.',
            context: 'documentation',
            score: 0.95,
            docid: 'doc-2',
          },
        ],
      },
    );

    expect('kind' in result).toBe(false);
    if ('kind' in result) {
      return;
    }

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.searchAssist?.rescued).toBe(true);
    expect(result.searchAssist).toEqual({
      applied: true,
      reason: 'strong-hit',
      addedCandidates: 1,
    });
  });

  test('skips search assist for quoted hangul queries', async () => {
    const resolveSearchAssistRows = vi.fn(async () => []);

    const result = await executeQueryCore(
      createCleanAssistStore([]),
      createInput({
        query: '"지속 학습"',
        displayQuery: '"지속 학습"',
      }),
      { HOME: '/home/tester' },
      { resolveSearchAssistRows },
    );

    expect('kind' in result).toBe(false);
    if ('kind' in result) {
      return;
    }

    expect(resolveSearchAssistRows).not.toHaveBeenCalled();
    expect(result.searchAssist).toEqual({
      applied: false,
      reason: 'conservative-syntax',
      addedCandidates: 0,
    });
  });

  test('adds normalized supplement candidates for long Korean questions', async () => {
    const originalQuery = '문서 업로드 파싱은 어떻게 동작해?';
    const normalizedQuery = '문서 업로드 파싱';
    const store = createDynamicSearchStore(async (args) => {
      const query = 'query' in args ? args.query : '';
      if (query === originalQuery) {
        return [
          {
            file: 'docs/noise.md',
            displayPath: 'docs/noise.md',
            title: 'Generic docs',
            body: 'generic note',
            bestChunk: 'generic note',
            context: 'documentation',
            score: 0.55,
            docid: 'noise-1',
            bestChunkPos: 0,
          },
        ];
      }

      if (query === normalizedQuery) {
        return [
          {
            file: 'docs/upload-parser.md',
            displayPath: 'docs/upload-parser.md',
            title: '문서 업로드 파서',
            body: '문서 업로드 파싱 동작을 설명합니다.',
            bestChunk: '문서 업로드 파싱 동작을 설명합니다.',
            context: 'documentation',
            score: 0.91,
            docid: 'target-1',
            bestChunkPos: 0,
          },
        ];
      }

      return [];
    });

    const result = await executeQueryCore(
      store,
      createInput({
        query: originalQuery,
        displayQuery: originalQuery,
      }),
      { HOME: '/home/tester' },
    );

    expect('kind' in result).toBe(false);
    if ('kind' in result) {
      return;
    }

    expect(result.query.normalization).toEqual({
      applied: true,
      reason: 'applied',
      addedCandidates: 1,
    });
    const searchCalls = (
      store.search as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }
    ).mock.calls;
    expect(searchCalls[0]?.[0]).toMatchObject({
      query: originalQuery,
      collections: ['docs'],
      limit: 20,
    });
    expect(searchCalls[1]?.[0]).toMatchObject({
      query: normalizedQuery,
      collections: ['docs'],
      limit: 18,
      rerank: false,
    });
    expect(result.rows.map((row) => row.displayPath)).toContain('docs/upload-parser.md');
    expect(result.rows.some((row) => row.normalization?.supplemented)).toBe(true);
  });

  test('keeps normalization eligible when embedding health is slower than base retrieval', async () => {
    const originalQuery = '문서 업로드 파싱은 어떻게 동작해?';
    const normalizedQuery = '문서 업로드 파싱';
    const store = createDynamicSearchStore(async (args) => {
      const query = 'query' in args ? args.query : '';
      if (query === originalQuery) {
        return [
          {
            file: 'docs/noise.md',
            displayPath: 'docs/noise.md',
            title: 'Generic docs',
            body: 'generic note',
            bestChunk: 'generic note',
            context: 'documentation',
            score: 0.55,
            docid: 'noise-1',
            bestChunkPos: 0,
          },
        ];
      }

      if (query === normalizedQuery) {
        return [
          {
            file: 'docs/upload-parser.md',
            displayPath: 'docs/upload-parser.md',
            title: '문서 업로드 파서',
            body: '문서 업로드 파싱 동작을 설명합니다.',
            bestChunk: '문서 업로드 파싱 동작을 설명합니다.',
            context: 'documentation',
            score: 0.91,
            docid: 'target-1',
            bestChunkPos: 0,
          },
        ];
      }

      return [];
    });
    store.getStatus = vi.fn(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, QUERY_NORMALIZATION_LATENCY_BUDGET_MS + 20),
      );

      return {
        totalDocuments: 1,
        needsEmbedding: 0,
        hasVectorIndex: true,
        collections: [],
      };
    });

    const result = await executeQueryCore(
      store,
      createInput({
        query: originalQuery,
        displayQuery: originalQuery,
      }),
      { HOME: '/home/tester' },
    );

    expect('kind' in result).toBe(false);
    if ('kind' in result) {
      return;
    }

    expect(result.query.normalization).toEqual({
      applied: true,
      reason: 'applied',
      addedCandidates: 1,
    });
    expect((store.search as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(
      2,
    );
    expect(result.rows.map((row) => row.displayPath)).toContain('docs/upload-parser.md');
  });

  test('skips normalized supplement when base search already has a strong long-query hit', async () => {
    const originalQuery = '문서 업로드 파싱은 어떻게 동작해?';
    const store = createDynamicSearchStore(async (args) => {
      const query = 'query' in args ? args.query : '';
      if (query === originalQuery) {
        return [
          {
            file: 'docs/upload-parser.md',
            displayPath: 'docs/upload-parser.md',
            title: '문서 업로드 파서',
            body: '문서 업로드 파싱 동작을 자세히 설명합니다.',
            bestChunk: '문서 업로드 파싱 동작을 자세히 설명합니다.',
            context: 'documentation',
            score: 0.91,
            docid: 'target-strong',
            bestChunkPos: 0,
          },
        ];
      }

      return [];
    });

    const result = await executeQueryCore(
      store,
      createInput({
        query: originalQuery,
        displayQuery: originalQuery,
      }),
      { HOME: '/home/tester' },
    );

    expect('kind' in result).toBe(false);
    if ('kind' in result) {
      return;
    }

    expect(result.query.normalization).toEqual({
      applied: false,
      reason: 'skipped-guard',
      addedCandidates: 0,
    });
    expect((store.search as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(
      1,
    );
  });

  test('skips normalized supplement when deterministic timing seam exceeds the latency budget', async () => {
    const originalQuery = '문서 업로드 파싱은 어떻게 동작해?';
    const normalizedQuery = '문서 업로드 파싱';
    const store = createDynamicSearchStore(async (args) => {
      const query = 'query' in args ? args.query : '';
      if (query === originalQuery) {
        return [
          {
            file: 'docs/noise.md',
            displayPath: 'docs/noise.md',
            title: 'Generic docs',
            body: 'generic note',
            bestChunk: 'generic note',
            context: 'documentation',
            score: 0.55,
            docid: 'noise-1',
            bestChunkPos: 0,
          },
        ];
      }

      if (query === normalizedQuery) {
        return [
          {
            file: 'docs/upload-parser.md',
            displayPath: 'docs/upload-parser.md',
            title: '문서 업로드 파서',
            body: '문서 업로드 파싱 동작을 설명합니다.',
            bestChunk: '문서 업로드 파싱 동작을 설명합니다.',
            context: 'documentation',
            score: 0.91,
            docid: 'target-1',
            bestChunkPos: 0,
          },
        ];
      }

      return [];
    });
    const nowValues = [0, QUERY_NORMALIZATION_LATENCY_BUDGET_MS + 10];

    const result = await executeQueryCore(
      store,
      createInput({
        query: originalQuery,
        displayQuery: originalQuery,
      }),
      { HOME: '/home/tester' },
      {
        now: () => nowValues.shift() ?? QUERY_NORMALIZATION_LATENCY_BUDGET_MS + 10,
      },
    );

    expect('kind' in result).toBe(false);
    if ('kind' in result) {
      return;
    }

    expect(result.query.normalization).toEqual({
      applied: false,
      reason: 'latency-budget',
      addedCandidates: 0,
    });
    expect((store.search as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(
      1,
    );
  });

  test('fails open when normalized supplement retrieval throws', async () => {
    const originalQuery = '문서 업로드 파싱은 어떻게 동작해?';
    const normalizedQuery = '문서 업로드 파싱';
    const store = createDynamicSearchStore(async (args) => {
      const query = 'query' in args ? args.query : '';
      if (query === originalQuery) {
        return [
          {
            file: 'docs/original.md',
            displayPath: 'docs/original.md',
            title: 'Original hit',
            body: 'base result',
            bestChunk: 'base result',
            context: 'documentation',
            score: 0.82,
            docid: 'base-1',
            bestChunkPos: 0,
          },
        ];
      }

      if (query === normalizedQuery) {
        throw new Error('normalized retrieval failed');
      }

      return [];
    });

    const result = await executeQueryCore(
      store,
      createInput({
        query: originalQuery,
        displayQuery: originalQuery,
      }),
      { HOME: '/home/tester' },
    );

    expect('kind' in result).toBe(false);
    if ('kind' in result) {
      return;
    }

    expect(result.query.normalization).toEqual({
      applied: false,
      reason: 'failed-open',
      addedCandidates: 0,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.displayPath).toBe('docs/original.md');
  });
});
