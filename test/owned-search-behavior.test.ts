import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';
import type { OwnedRuntimeDependencies } from '../src/commands/owned/runtime.js';
import { handleSearchCommand } from '../src/commands/owned/search.js';
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
    existsSync: (path) => path === '/home/tester/.config/qmd/index.yml',
    createStore: vi.fn(async () => store),
  };
}

function createLegacyFallbackStore(): QMDStore {
  return {
    close: vi.fn(async () => {}),
    listCollections: vi.fn(async () => [{ name: 'docs' }]),
    getDefaultCollectionNames: vi.fn(async () => ['docs']),
    searchLex: vi.fn(async () => [
      {
        filepath: 'qmd://docs/guide.md',
        displayPath: 'docs/guide.md',
        title: 'Guide',
        context: 'Docs',
        hash: 'abc123hash',
        docid: 'abc123',
        collectionName: 'docs',
        modifiedAt: '2026-03-13T00:00:00.000Z',
        bodyLength: 16,
        body: '형태소분석기 소개',
        score: 0.91,
        source: 'fts' as const,
      },
    ]),
    internal: {
      db: {
        prepare: vi.fn((sql: string) => ({
          get: vi.fn(() => {
            if (sql.includes('store_config')) {
              return undefined;
            }

            if (sql.includes('sqlite_master')) {
              return undefined;
            }

            if (sql.includes('COUNT(*) AS count')) {
              return { count: 1 };
            }

            return undefined;
          }),
          all: vi.fn(() => []),
        })),
      },
      getContextForFile: vi.fn(() => 'Docs'),
    },
  } as unknown as QMDStore;
}

function createCleanShadowStore(): QMDStore {
  const searchLex = vi.fn(async () => []);

  return {
    close: vi.fn(async () => {}),
    listCollections: vi.fn(async () => [{ name: 'docs' }]),
    getDefaultCollectionNames: vi.fn(async () => ['docs']),
    searchLex,
    internal: {
      db: {
        prepare: vi.fn((sql: string) => ({
          get: vi.fn(() => {
            if (sql.includes('store_config')) {
              return { value: 'kiwi-cong-shadow-v1' };
            }

            if (sql.includes('sqlite_master')) {
              return { name: 'kqmd_documents_fts' };
            }

            if (sql.includes('COUNT(*) AS count')) {
              return { count: 1 };
            }

            return undefined;
          }),
          all: vi.fn(() => {
            if (sql.includes('FROM kqmd_documents_fts')) {
              return [
                {
                  filepath: 'qmd://docs/guide.md',
                  display_path: 'docs/guide.md',
                  title: 'Guide',
                  body: '형태소분석기 소개',
                  hash: 'abc123hash',
                  modified_at: '2026-03-13T00:00:00.000Z',
                  collection: 'docs',
                  bm25_score: -10,
                },
              ];
            }

            return [];
          }),
        })),
      },
      getContextForFile: vi.fn(() => 'Docs'),
    },
  } as unknown as QMDStore;
}

describe('owned search Korean fallback behavior', () => {
  test('preserves json stdout while warning on stale Korean search policy', async () => {
    const result = await handleSearchCommand(createContext(['search', '--json', '형태소 분석']), {
      runtimeDependencies: createRuntimeDependencies(createLegacyFallbackStore()),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"file": "qmd://docs/guide.md"');
    expect(result.stderr).toContain('Korean lexical search index is not ready');
    expect(result.stderr).toContain("Run 'qmd update'");
  });

  test('uses the clean shadow path for plain Hangul queries without warning', async () => {
    const store = createCleanShadowStore();

    const result = await handleSearchCommand(createContext(['search', '--json', '형태소 분석']), {
      runtimeDependencies: createRuntimeDependencies(store),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"file": "qmd://docs/guide.md"');
    expect(result.stderr).toBeUndefined();
    expect(store.searchLex).not.toHaveBeenCalled();
  });

  test('falls back to legacy search for quoted Hangul queries even when shadow index is clean', async () => {
    const store = createCleanShadowStore();
    store.searchLex = vi.fn(async () => [
      {
        filepath: 'qmd://docs/guide.md',
        displayPath: 'docs/guide.md',
        title: 'Guide',
        context: 'Docs',
        hash: 'abc123hash',
        docid: 'abc123',
        collectionName: 'docs',
        modifiedAt: '2026-03-13T00:00:00.000Z',
        bodyLength: 16,
        body: '형태소분석기 소개',
        score: 0.91,
        source: 'fts' as const,
      },
    ]);

    const result = await handleSearchCommand(createContext(['search', '"형태소 분석"']), {
      runtimeDependencies: createRuntimeDependencies(store),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBeUndefined();
    expect(store.searchLex).toHaveBeenCalledTimes(1);
  });
});
