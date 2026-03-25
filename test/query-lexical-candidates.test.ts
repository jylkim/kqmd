import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';

import { probeQueryLexicalCandidates } from '../src/commands/owned/query_lexical_candidates.js';

function createStore(searchLex?: NonNullable<QMDStore['searchLex']>): QMDStore {
  return {
    searchLex,
    internal: {
      db: {
        prepare: vi.fn(() => ({
          get: vi.fn(() => undefined),
        })),
      },
    },
  } as unknown as QMDStore;
}

describe('query lexical candidates', () => {
  test('classifies strong lexical hits from searchLex results', async () => {
    const result = await probeQueryLexicalCandidates(
      createStore(async () => [
        {
          filepath: 'docs/agent-orchestration.md',
          displayPath: 'docs/agent-orchestration.md',
          title: 'Agent Orchestration',
          body: 'agent orchestration in practice',
          bodyLength: 31,
          hash: 'hash-doc-1',
          modifiedAt: '2026-03-25T00:00:00.000Z',
          score: 0.91,
          source: 'fts',
          docid: 'doc-1',
          context: 'docs',
          collectionName: 'docs',
        },
      ]),
      'agent orchestration',
      ['docs'],
    );

    expect(result.signal).toBe('strong');
    expect(result.rows[0]?.displayPath).toBe('docs/agent-orchestration.md');
  });

  test('filters legacy lexical rows to the selected collections', async () => {
    const result = await probeQueryLexicalCandidates(
      createStore(async () => [
        {
          filepath: 'docs/guide.md',
          displayPath: 'docs/guide.md',
          title: 'Guide',
          body: 'agent guide',
          bodyLength: 11,
          hash: 'hash-doc-1',
          modifiedAt: '2026-03-25T00:00:00.000Z',
          score: 0.5,
          source: 'fts',
          docid: 'doc-1',
          context: 'docs',
          collectionName: 'docs',
        },
        {
          filepath: 'archive/old.md',
          displayPath: 'archive/old.md',
          title: 'Old',
          body: 'archived agent guide',
          bodyLength: 20,
          hash: 'hash-doc-2',
          modifiedAt: '2026-03-25T00:00:00.000Z',
          score: 0.49,
          source: 'fts',
          docid: 'doc-2',
          context: 'archive',
          collectionName: 'archive',
        },
      ]),
      'agent',
      ['docs', 'notes'],
    );

    expect(result.rows.map((row) => row.displayPath)).toEqual(['docs/guide.md']);
  });

  test('throws when searchLex is unavailable on the lexical fallback path', async () => {
    await expect(
      probeQueryLexicalCandidates(createStore(), 'agent orchestration', ['docs']),
    ).rejects.toThrow('Owned lexical probe requires store.searchLex() to be available.');
  });
});
