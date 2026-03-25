import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';
import { executeLexicalCandidateSearch } from '../src/commands/owned/query_lexical_candidates.js';

function createStore(overrides: {
  readonly searchLex?: QMDStore['searchLex'];
  readonly sqliteMasterName?: string;
} = {}): QMDStore {
  return {
    close: vi.fn(async () => {}),
    searchLex:
      overrides.searchLex ??
      vi.fn(async () => [
        {
          displayPath: 'docs/readme.md',
          title: 'README',
          body: 'Auth flow details',
          context: 'documentation',
          score: 0.8,
          docid: 'doc-1',
          collectionName: 'docs',
          chunkPos: 0,
        },
      ]),
    internal: {
      db: {
        prepare: vi.fn((sql: string) => ({
          all: vi.fn(() => {
            if (sql.includes('COUNT(*)')) {
              return [{ count: 1 }];
            }

            if (sql.includes('content_vectors')) {
              return [{ model: 'embeddinggemma', documents: 1 }];
            }

            return [];
          }),
          get: vi.fn((...params: (string | number)[]) => {
            if (sql.includes('sqlite_master')) {
              return overrides.sqliteMasterName ? { name: overrides.sqliteMasterName } : undefined;
            }

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

describe('query lexical candidates', () => {
  test('uses legacy lexical search for non-hangul queries without reading shadow health', async () => {
    const store = createStore();

    const result = await executeLexicalCandidateSearch(store, "what's new", ['docs'], 20);

    expect(result.backend).toBe('legacy-lexical');
    expect(result.fallbackReason).toBe('non-hangul');
    expect(store.searchLex).toHaveBeenCalledWith("what's new", {
      limit: 20,
      collection: 'docs',
    });

    const prepare = store.internal.db.prepare as unknown as { mock: { calls: Array<[string]> } };
    expect(
      prepare.mock.calls.some(([sql]) => sql.includes('kqmd_search_') || sql.includes('sqlite_master')),
    ).toBe(false);
  });

  test('falls back to legacy lexical search with warning when shadow health is dirty', async () => {
    const store = createStore();

    const result = await executeLexicalCandidateSearch(store, '지속 학습', ['docs'], 20, {
      includePolicyWarning: true,
    });

    expect(result.backend).toBe('legacy-lexical');
    expect(result.fallbackReason).toBe('dirty-health');
    expect(result.stderr).toContain('Korean lexical search index is not ready for the current policy.');
    expect(result.searchHealth?.kind).not.toBe('clean');
    expect(store.searchLex).toHaveBeenCalledWith('지속 학습', {
      limit: 20,
      collection: 'docs',
    });
  });
});
