import { resolve } from 'node:path';

import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';
import { handleStatusCommand } from '../src/commands/owned/status.js';
import { KQMD_DEFAULT_EMBED_MODEL_URI } from '../src/config/embedding_policy.js';
import { createContext, createRuntimeDependencies, withTrailingNewline } from './helpers.js';

function createFakeStatusStore(): QMDStore {
  const prepare = vi.fn((sql: string) => ({
    get: vi.fn((...params: (string | number)[]) => {
      if (sql.includes('store_config')) {
        return params[0] === 'kqmd_search_source_snapshot'
          ? {
              value: JSON.stringify({
                totalDocuments: 3,
                latestModifiedAt: '2026-03-12T00:00:00.000Z',
                maxDocumentId: 3,
              }),
            }
          : { value: 'kiwi-cong-shadow-v1' };
      }

      if (sql.includes('sqlite_master')) {
        return { name: 'kqmd_documents_fts' };
      }

      if (sql.includes('MAX(d.modified_at)')) {
        return {
          count: 3,
          latest_modified_at: '2026-03-12T00:00:00.000Z',
          max_document_id: 3,
        };
      }

      if (sql.includes('COUNT(*) AS count')) {
        return { count: 3 };
      }

      return undefined;
    }),
    all: vi.fn(() => {
      if (sql.includes('content_vectors')) {
        return [{ model: 'embeddinggemma', documents: 3 }];
      }

      return [];
    }),
  }));

  return {
    close: vi.fn(async () => {}),
    dbPath: '/home/tester/.cache/qmd/index.sqlite',
    getStatus: vi.fn(async () => ({
      totalDocuments: 3,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [
        {
          name: 'docs',
          path: '/repo/docs',
          pattern: '**/*.md',
          documents: 3,
          lastUpdated: '2026-03-12T00:00:00.000Z',
        },
      ],
    })),
    internal: {
      db: {
        prepare,
      },
    },
  } as unknown as QMDStore;
}

function createStaleStatusStore(): QMDStore {
  const prepare = vi.fn((sql: string) => ({
    get: vi.fn((...params: (string | number)[]) => {
      if (sql.includes('store_config')) {
        return params[0] === 'kqmd_search_source_snapshot'
          ? {
              value: JSON.stringify({
                totalDocuments: 3,
                latestModifiedAt: '2026-03-12T00:00:00.000Z',
                maxDocumentId: 3,
              }),
            }
          : { value: 'kiwi-cong-shadow-v1' };
      }

      if (sql.includes('sqlite_master')) {
        return { name: 'kqmd_documents_fts' };
      }

      if (sql.includes('MAX(d.modified_at)')) {
        return {
          count: 3,
          latest_modified_at: '2026-03-13T00:00:00.000Z',
          max_document_id: 3,
        };
      }

      if (sql.includes('COUNT(*) AS count')) {
        return { count: 3 };
      }

      return undefined;
    }),
    all: vi.fn(() => {
      if (sql.includes('content_vectors')) {
        return [{ model: 'embeddinggemma', documents: 3 }];
      }

      return [];
    }),
  }));

  return {
    close: vi.fn(async () => {}),
    dbPath: '/home/tester/.cache/qmd/index.sqlite',
    getStatus: vi.fn(async () => ({
      totalDocuments: 3,
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

describe('owned status command', () => {
  test('matches mismatch output snapshot', async () => {
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';

    try {
      const result = await handleStatusCommand(createContext(['status']), {
        runtimeDependencies: createRuntimeDependencies(createFakeStatusStore()),
      });

      expect(result.stderr).toBeUndefined();
      await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
        resolve(process.cwd(), 'test/fixtures/status/status-mismatch.output.txt'),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previous;
      }
    }
  });

  test('keeps command-specific flags as upstream-compatible no-ops', async () => {
    const result = await handleStatusCommand(createContext(['status', '--json']), {
      runtimeDependencies: createRuntimeDependencies(createFakeStatusStore()),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBeUndefined();
  });

  test('works in a zero-config environment', async () => {
    const result = await handleStatusCommand(createContext(['status']), {
      runtimeDependencies: createRuntimeDependencies(createFakeStatusStore(), { existingPaths: [] }),
    });

    expect(result.exitCode).toBe(0);
  });

  test('uses the default effective model when rendering status', async () => {
    const result = await handleStatusCommand(createContext(['status']), {
      runtimeDependencies: createRuntimeDependencies(createFakeStatusStore()),
    });

    expect(result.stdout).toContain(KQMD_DEFAULT_EMBED_MODEL_URI);
  });

  test('computes stale search health from the live snapshot', async () => {
    const result = await handleStatusCommand(createContext(['status']), {
      runtimeDependencies: createRuntimeDependencies(createStaleStatusStore()),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Health:     stale shadow index');
  });
});
