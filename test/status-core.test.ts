import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';

import { readStatusCore } from '../src/commands/owned/status_core.js';

function createFakeStatusStore(): QMDStore {
  const prepare = vi.fn((sql: string) => ({
    get: vi.fn((...params: (string | number)[]) => {
      if (sql.includes('store_config')) {
        return params[0] === 'kqmd_search_source_snapshot'
          ? {
              value: JSON.stringify({
                totalDocuments: 2,
                latestModifiedAt: '2026-03-16T00:00:00.000Z',
                maxDocumentId: 2,
              }),
            }
          : { value: 'kiwi-cong-shadow-v1' };
      }

      if (sql.includes('sqlite_master')) {
        return { name: 'kqmd_documents_fts' };
      }

      if (sql.includes('MAX(d.modified_at)')) {
        return {
          count: 2,
          latest_modified_at: '2026-03-16T00:00:00.000Z',
          max_document_id: 2,
        };
      }

      if (sql.includes('COUNT(*) AS count')) {
        return { count: 2 };
      }

      return undefined;
    }),
    all: vi.fn(() => [{ model: 'embeddinggemma', documents: 2 }]),
  }));

  return {
    close: vi.fn(async () => {}),
    dbPath: '/tmp/index.sqlite',
    getStatus: vi.fn(async () => ({
      totalDocuments: 2,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [],
    })),
    internal: {
      db: {
        prepare,
      },
    },
  } as unknown as QMDStore;
}

describe('status core', () => {
  test('returns owned status vocabulary without transport-specific fields', async () => {
    const result = await readStatusCore(createFakeStatusStore(), {
      HOME: '/home/tester',
    });

    expect(result).toMatchObject({
      dbPath: '/tmp/index.sqlite',
      status: {
        totalDocuments: 2,
      },
      health: {
        kind: 'model-mismatch',
      },
      searchHealth: {
        kind: 'clean',
      },
    });
  });
});
