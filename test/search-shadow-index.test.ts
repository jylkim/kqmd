import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore } from '@tobilu/qmd';
import { afterEach, describe, expect, test } from 'vitest';
import { buildLexicalSearchText } from '../src/commands/owned/kiwi_tokenizer.js';
import { readSearchIndexHealth } from '../src/commands/owned/search_index_health.js';
import {
  rebuildSearchShadowIndex,
  searchShadowIndex,
} from '../src/commands/owned/search_shadow_index.js';
import { describeEffectiveSearchPolicy } from '../src/config/search_policy.js';

function createFixtureWorkspace(): {
  root: string;
  docsDir: string;
  notesDir: string;
  dbPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'kqmd-search-shadow-'));
  const docsDir = join(root, 'docs');
  const notesDir = join(root, 'notes');
  mkdirSync(docsDir, { recursive: true });
  mkdirSync(notesDir, { recursive: true });

  return {
    root,
    docsDir,
    notesDir,
    dbPath: join(root, 'index.sqlite'),
  };
}

async function createFixtureStore(dbPath: string, collections: Record<string, string>) {
  return createStore({
    dbPath,
    config: {
      collections: Object.fromEntries(
        Object.entries(collections).map(([name, path]) => [
          name,
          {
            path,
            pattern: '**/*.md',
          },
        ]),
      ),
    },
  });
}

describe('search shadow index', () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('rebuilds a clean shadow index and improves Korean compound recall', async () => {
    const { root, docsDir, dbPath } = createFixtureWorkspace();
    workspaces.push(root);

    writeFileSync(
      join(docsDir, 'guide.md'),
      ['# 형태소분석기', '', '거대언어모델 정리 문서입니다.'].join('\n'),
      'utf8',
    );

    const store = await createFixtureStore(dbPath, { docs: docsDir });

    try {
      await store.update();

      const policy = describeEffectiveSearchPolicy();
      expect(readSearchIndexHealth(store.internal.db, policy).kind).toBe('untracked-index');

      const rebuilt = await rebuildSearchShadowIndex(store.internal.db, policy, {
        tokenize: async (text) => {
          let projection = text;

          if (text.includes('형태소분석기')) {
            projection = `${projection} 형태소 분석`;
          }

          if (text.includes('거대언어모델')) {
            projection = `${projection} 거대 언어 모델`;
          }

          return projection;
        },
      });

      expect(rebuilt.indexedDocuments).toBe(1);
      expect(rebuilt.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(rebuilt.writeDurationMs).toBeGreaterThanOrEqual(0);
      expect(readSearchIndexHealth(store.internal.db, policy).kind).toBe('clean');

      const compoundResults = searchShadowIndex(
        store.internal,
        buildLexicalSearchText('형태소 분석', ['형태소', '분석']),
        { limit: 10 },
      );
      const modelResults = searchShadowIndex(store.internal, '모델', { limit: 10 });

      expect(compoundResults[0]?.displayPath).toBe('docs/guide.md');
      expect(modelResults[0]?.displayPath).toBe('docs/guide.md');
    } finally {
      await store.close();
    }
  });

  test('marks the shadow index stale when documents change without a rebuild', async () => {
    const { root, docsDir, dbPath } = createFixtureWorkspace();
    workspaces.push(root);

    const guidePath = join(docsDir, 'guide.md');
    writeFileSync(guidePath, ['# 형태소분석기', '', '첫 번째 내용입니다.'].join('\n'), 'utf8');

    const store = await createFixtureStore(dbPath, { docs: docsDir });

    try {
      await store.update();

      const policy = describeEffectiveSearchPolicy();
      await rebuildSearchShadowIndex(store.internal.db, policy, {
        tokenize: async (text) => text,
      });

      expect(readSearchIndexHealth(store.internal.db, policy).kind).toBe('clean');

      writeFileSync(guidePath, ['# 형태소분석기', '', '두 번째 내용입니다.'].join('\n'), 'utf8');
      await store.update();

      expect(readSearchIndexHealth(store.internal.db, policy).kind).toBe('stale-shadow-index');
    } finally {
      await store.close();
    }
  });

  test('binds FTS queries and collection filters instead of interpolating user input into SQL', () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];

    const store = {
      db: {
        exec: () => undefined,
        prepare: (sql: string) => {
          capturedSql = sql;

          return {
            get: () => undefined,
            run: () => undefined,
            all: (...params: unknown[]) => {
              capturedParams = params;
              return [];
            },
          };
        },
      },
      getContextForFile: () => null,
    };

    searchShadowIndex(store, '"형태소 분석" -모델; DROP TABLE docs;', {
      limit: 5,
      collections: ["docs' OR 1=1 --", 'notes'],
    });

    expect(capturedSql).toContain('MATCH ?');
    expect(capturedSql).toContain('d.collection IN (?, ?)');
    expect(capturedSql).not.toContain("docs' OR 1=1 --");
    expect(capturedParams).toEqual([
      '"형태소 분석" AND "drop"* AND "table"* AND "docs"* NOT "모델"*',
      "docs' OR 1=1 --",
      'notes',
      5,
    ]);
  });

  test('keeps collection-scoped shadow search clean when the selected collection snapshot matches', async () => {
    const { root, docsDir, notesDir, dbPath } = createFixtureWorkspace();
    workspaces.push(root);

    writeFileSync(
      join(docsDir, 'guide.md'),
      ['# 형태소분석기', '', 'docs 내용입니다.'].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(notesDir, 'memo.md'),
      ['# 메모', '', 'notes 내용입니다.'].join('\n'),
      'utf8',
    );

    const store = await createFixtureStore(dbPath, { docs: docsDir, notes: notesDir });

    try {
      await store.update();

      const policy = describeEffectiveSearchPolicy();
      await rebuildSearchShadowIndex(store.internal.db, policy, {
        tokenize: async (text) => (text.includes('형태소분석기') ? `${text} 형태소 분석` : text),
      });

      writeFileSync(
        join(notesDir, 'memo.md'),
        ['# 메모', '', 'notes가 바뀌었습니다.'].join('\n'),
        'utf8',
      );
      await store.update();

      expect(readSearchIndexHealth(store.internal.db, policy).kind).toBe('stale-shadow-index');
      expect(readSearchIndexHealth(store.internal.db, policy, { collections: ['docs'] }).kind).toBe(
        'clean',
      );
      expect(
        searchShadowIndex(
          store.internal,
          buildLexicalSearchText('형태소 분석', ['형태소', '분석']),
          {
            limit: 5,
            collections: ['docs'],
          },
        )[0]?.displayPath,
      ).toBe('docs/guide.md');
    } finally {
      await store.close();
    }
  });
});
