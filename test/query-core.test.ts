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
});
