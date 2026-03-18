import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';
import { handleCleanupCommand } from '../src/commands/owned/cleanup.js';
import { resetKiwiForTests } from '../src/commands/owned/kiwi_tokenizer.js';
import type { OwnedRuntimeDependencies } from '../src/commands/owned/runtime.js';
import type { CommandExecutionContext } from '../src/types/command.js';

function createContext(argv: string[]): CommandExecutionContext {
  return {
    argv,
    commandArgs: argv.slice(1),
  };
}

function createRuntimeDependencies(
  store: QMDStore,
  overrides: { dbExists?: boolean; configExists?: boolean } = {},
): OwnedRuntimeDependencies {
  const { dbExists = true, configExists = true } = overrides;
  return {
    env: { HOME: '/home/tester' },
    existsSync: (path) => {
      if (path === '/home/tester/.cache/qmd/index.sqlite') return dbExists;
      if (path === '/home/tester/.config/qmd/index.yml') return configExists;
      return false;
    },
    createStore: vi.fn(async () => store),
  };
}

function createCleanupStore(options: {
  deleteLLMCache?: number;
  cleanupOrphanedVectors?: number;
  deleteInactiveDocuments?: number;
  cleanupOrphanedContent?: number;
  searchHealthClean?: boolean;
}): QMDStore {
  const {
    deleteLLMCache = 0,
    cleanupOrphanedVectors = 0,
    deleteInactiveDocuments = 0,
    cleanupOrphanedContent = 0,
    searchHealthClean = true,
  } = options;

  const prepare = vi.fn((sql: string) => ({
    get: vi.fn((...params: (string | number)[]) => {
      if (sql.includes('store_config')) {
        if (params[0] === 'kqmd_search_source_snapshot') {
          return {
            value: JSON.stringify({
              totalDocuments: 1,
              latestModifiedAt: '2026-03-13T00:00:00.000Z',
              maxDocumentId: 1,
            }),
          };
        }

        return { value: searchHealthClean ? 'kiwi-cong-shadow-v1' : undefined };
      }

      if (sql.includes('sqlite_master')) {
        return searchHealthClean ? { name: 'kqmd_documents_fts' } : undefined;
      }

      if (sql.includes('MAX(d.modified_at)')) {
        return { count: 1, latest_modified_at: '2026-03-13T00:00:00.000Z', max_document_id: 1 };
      }

      if (sql.includes('COUNT(*) AS count')) {
        return { count: searchHealthClean ? 1 : 0 };
      }

      return undefined;
    }),
    all: vi.fn(() => []),
    run: vi.fn(() => ({})),
  }));

  return {
    close: vi.fn(async () => {}),
    internal: {
      db: { prepare, exec: vi.fn(() => {}) },
      deleteLLMCache: vi.fn(() => deleteLLMCache),
      cleanupOrphanedVectors: vi.fn(() => cleanupOrphanedVectors),
      deleteInactiveDocuments: vi.fn(() => deleteInactiveDocuments),
      cleanupOrphanedContent: vi.fn(() => cleanupOrphanedContent),
      vacuumDatabase: vi.fn(),
    },
  } as unknown as QMDStore;
}

describe('owned cleanup command', () => {
  test('formats cleanup results correctly', async () => {
    const result = await handleCleanupCommand(createContext(['cleanup']), {
      run: async () => ({
        cachedResponsesCleared: 3,
        inactiveDocumentsRemoved: 1,
        orphanedContentRemoved: 4,
        orphanedEmbeddingsRemoved: 2,
        vacuumed: true,
        shadowIndexRebuilt: false,
      }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Cached responses cleared:   3');
    expect(result.stdout).toContain('Orphaned embeddings removed: 2');
    expect(result.stdout).toContain('Inactive documents removed: 1');
    expect(result.stdout).toContain('Orphaned content removed:   4');
    expect(result.stdout).toContain('Vacuumed:                   yes');
    expect(result.stdout).toContain('skipped');
  });

  test('rebuilds shadow index when inactive documents are removed', async () => {
    resetKiwiForTests();
    const store = createCleanupStore({ deleteInactiveDocuments: 2 });

    try {
      const result = await handleCleanupCommand(createContext(['cleanup']), {
        runtimeDependencies: createRuntimeDependencies(store),
        searchIndexDependencies: {
          kiwiDependencies: {
            loadModelFiles: async () => ({}),
            createBuilder: async () => ({
              build: async () => ({ tokenize: () => [] }) as never,
            }),
          },
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Shadow index rebuilt');
    } finally {
      resetKiwiForTests();
    }
  });

  test('rebuilds shadow index on health mismatch even without removals', async () => {
    resetKiwiForTests();
    const store = createCleanupStore({ searchHealthClean: false });

    try {
      const result = await handleCleanupCommand(createContext(['cleanup']), {
        runtimeDependencies: createRuntimeDependencies(store),
        searchIndexDependencies: {
          kiwiDependencies: {
            loadModelFiles: async () => ({}),
            createBuilder: async () => ({
              build: async () => ({ tokenize: () => [] }) as never,
            }),
          },
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Shadow index rebuilt');
    } finally {
      resetKiwiForTests();
    }
  });

  test('skips shadow index rebuild when health is clean and no removals', async () => {
    const store = createCleanupStore({});

    const result = await handleCleanupCommand(createContext(['cleanup']), {
      runtimeDependencies: createRuntimeDependencies(store),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('skipped');
  });

  test('returns usage error for extra positional arguments', async () => {
    const result = await handleCleanupCommand(createContext(['cleanup', 'extra']));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Usage: qmd cleanup');
  });

  test('returns runtime error when no DB or config exists', async () => {
    const store = createCleanupStore({});

    const result = await handleCleanupCommand(createContext(['cleanup']), {
      runtimeDependencies: createRuntimeDependencies(store, {
        dbExists: false,
        configExists: false,
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No existing index or config found');
  });
});
