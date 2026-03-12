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

function createFixtureWorkspace(): { root: string; docsDir: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'kqmd-search-shadow-'));
  const docsDir = join(root, 'docs');
  mkdirSync(docsDir, { recursive: true });

  return {
    root,
    docsDir,
    dbPath: join(root, 'index.sqlite'),
  };
}

async function createFixtureStore(dbPath: string, docsDir: string) {
  return createStore({
    dbPath,
    config: {
      collections: {
        docs: {
          path: docsDir,
          pattern: '**/*.md',
        },
      },
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

    const store = await createFixtureStore(dbPath, docsDir);

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

      expect(rebuilt).toBe(1);
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
});
