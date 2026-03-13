import type { QMDStore, UpdateResult } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';
import { resetKiwiForTests } from '../src/commands/owned/kiwi_tokenizer.js';
import type { OwnedRuntimeDependencies } from '../src/commands/owned/runtime.js';
import { handleUpdateCommand } from '../src/commands/owned/update.js';
import type { CommandExecutionContext } from '../src/types/command.js';

function createContext(argv: string[]): CommandExecutionContext {
  return {
    argv,
    commandArgs: argv.slice(1),
  };
}

function createRuntimeDependencies(store: QMDStore): OwnedRuntimeDependencies {
  return {
    env: {
      HOME: '/home/tester',
    },
    existsSync: (path) =>
      path === '/home/tester/.cache/qmd/index.sqlite' ||
      path === '/home/tester/.config/qmd/index.yml',
    createStore: vi.fn(async () => store),
  };
}

function createNoOpUpdateStore(runSpy: ReturnType<typeof vi.fn>): QMDStore {
  const prepare = vi.fn((sql: string) => ({
    get: vi.fn((...params: (string | number)[]) => {
      if (sql.includes('store_config')) {
        return params[0] === 'kqmd_search_source_snapshot'
          ? {
              value: JSON.stringify({
                totalDocuments: 1,
                latestModifiedAt: '2026-03-13T00:00:00.000Z',
                maxDocumentId: 1,
              }),
            }
          : { value: 'kiwi-cong-shadow-v1' };
      }

      if (sql.includes('sqlite_master')) {
        return { name: 'kqmd_documents_fts' };
      }

      if (sql.includes('MAX(d.modified_at)')) {
        return {
          count: 1,
          latest_modified_at: '2026-03-13T00:00:00.000Z',
          max_document_id: 1,
        };
      }

      if (sql.includes('COUNT(*) AS count')) {
        return { count: 1 };
      }

      return undefined;
    }),
    all: vi.fn(() => {
      if (sql.includes('content_vectors')) {
        return [{ model: 'embeddinggemma', documents: 1 }];
      }

      if (sql.includes('FROM documents d') && sql.includes('JOIN content c')) {
        return [];
      }

      return [];
    }),
    run: runSpy,
  }));

  return {
    close: vi.fn(async () => {}),
    getStatus: vi.fn(async () => ({
      totalDocuments: 1,
      needsEmbedding: 0,
    })),
    update: vi.fn(
      async (): Promise<UpdateResult> => ({
        collections: 1,
        indexed: 0,
        updated: 0,
        unchanged: 1,
        removed: 0,
        needsEmbedding: 0,
      }),
    ),
    internal: {
      db: {
        prepare,
        exec: vi.fn(() => {}),
      },
    },
  } as unknown as QMDStore;
}

describe('owned update command', () => {
  test('skips metadata writes on no-op updates when search state is already clean', async () => {
    resetKiwiForTests();
    const runSpy = vi.fn(() => ({}));

    try {
      const result = await handleUpdateCommand(createContext(['update']), {
        runtimeDependencies: createRuntimeDependencies(createNoOpUpdateStore(runSpy)),
        searchIndexDependencies: {
          kiwiDependencies: {
            loadModelFiles: async () => ({}),
            createBuilder: async () => ({
              build: async () =>
                ({
                  tokenize: () => [],
                }) as never,
            }),
          },
        },
      });

      expect(result.exitCode).toBe(0);
      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      resetKiwiForTests();
    }
  });
});
