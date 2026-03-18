import { resolve } from 'node:path';

import type { QMDStore } from '@tobilu/qmd';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SearchOutputRow } from '../../src/commands/owned/io/types.js';
import { handleSearchCommand } from '../../src/commands/owned/search.js';
import { createContext, withTrailingNewline } from '../helpers.js';

function createFakeStore(close = vi.fn(async () => {})): QMDStore {
  return {
    close,
    listCollections: async () => [{ name: 'docs' }],
    getDefaultCollectionNames: async () => ['docs'],
    searchLex: async () => [
      {
        filepath: 'qmd://docs/guide.md',
        displayPath: 'docs/guide.md',
        title: 'Guide',
        context: 'Docs',
        hash: 'abc123hash',
        docid: 'abc123',
        collectionName: 'docs',
        modifiedAt: '2026-03-12T00:00:00.000Z',
        bodyLength: 28,
        body: 'hangul search guidance\nsecond line',
        score: 0.93,
        source: 'fts' as const,
      },
    ],
    internal: {
      db: {
        prepare: vi.fn((sql: string) => ({
          get: vi.fn((...params: (string | number)[]) => {
            if (sql.includes('sqlite_master')) {
              return { name: 'kqmd_documents_fts' };
            }

            if (sql.includes('store_config')) {
              if (params[0] === 'kqmd_search_source_snapshot') {
                return {
                  value: JSON.stringify({
                    totalDocuments: 1,
                    latestModifiedAt: '2026-03-12T00:00:00.000Z',
                    maxDocumentId: 1,
                  }),
                };
              }

              if (params[0] === 'kqmd_search_collection_snapshots') {
                return {
                  value: JSON.stringify({
                    docs: {
                      totalDocuments: 1,
                      latestModifiedAt: '2026-03-12T00:00:00.000Z',
                      maxDocumentId: 1,
                    },
                  }),
                };
              }

              return { value: 'kiwi-cong-shadow-v1' };
            }

            if (sql.includes('MAX(d.modified_at)')) {
              return {
                count: 1,
                latest_modified_at: '2026-03-12T00:00:00.000Z',
                max_document_id: 1,
              };
            }

            if (sql.includes('COUNT(*) AS count')) {
              return { count: 1 };
            }

            return params;
          }),
          all: vi.fn(() => []),
        })),
      },
      getContextForFile: vi.fn(() => 'Docs'),
    },
  } as unknown as QMDStore;
}

const searchRows: SearchOutputRow[] = [
  {
    displayPath: 'docs/guide.md',
    title: 'Guide',
    body: 'hangul search guidance\nsecond line',
    context: 'Docs',
    score: 0.93,
    docid: 'abc123',
  },
];

function withNoColor<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';

  return run().finally(() => {
    if (previous === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previous;
    }
  });
}

describe('owned search parity output', () => {
  afterEach(() => {
    delete process.env.NO_COLOR;
  });

  test('matches json success output snapshot', async () => {
    const result = await handleSearchCommand(
      createContext(['search', '--json', '--full', 'hangul']),
      {
        run: async () => searchRows,
      },
    );

    await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
      resolve(
        process.cwd(),
        'test/fixtures/owned-command-parity/search/search-success.output.json',
      ),
    );
  });

  test('matches cli success output snapshot without color', async () => {
    const result = await withNoColor(() =>
      handleSearchCommand(createContext(['search', '--full', 'hangul']), {
        run: async () => searchRows,
      }),
    );

    await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
      resolve(process.cwd(), 'test/fixtures/owned-command-parity/search/search-success.output.cli'),
    );
  });

  test('matches empty csv output snapshot', async () => {
    const result = await handleSearchCommand(createContext(['search', '--csv', 'hangul']), {
      run: async () => [],
    });

    await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
      resolve(process.cwd(), 'test/fixtures/owned-command-parity/search/search-empty.output.csv'),
    );
  });

  test('runs the real search contract path through runtime and formatter', async () => {
    const close = vi.fn(async () => {});

    const result = await handleSearchCommand(
      createContext(['search', '--json', '--full', 'hangul']),
      {
        runtimeDependencies: {
          env: { HOME: '/home/tester' },
          existsSync: (path) => path === '/home/tester/.config/qmd/index.yml',
          createStore: vi.fn(async () => createFakeStore(close)),
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"file": "qmd://docs/guide.md"');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
