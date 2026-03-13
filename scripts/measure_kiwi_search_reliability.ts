import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore } from '@tobilu/qmd';

import { buildLexicalSearchText } from '../src/commands/owned/kiwi_tokenizer.js';
import { readSearchIndexHealth } from '../src/commands/owned/search_index_health.js';
import {
  rebuildSearchShadowIndex,
  searchShadowIndex,
} from '../src/commands/owned/search_shadow_index.js';
import { describeEffectiveSearchPolicy } from '../src/config/search_policy.js';

type ScaleName = 'small' | 'medium' | 'large';

type ScaleMetrics = {
  readonly scale: ScaleName;
  readonly documents: number;
  readonly updateMs: number;
  readonly rebuildMs: number;
  readonly projectionMs: number;
  readonly writeMs: number;
  readonly healthReadProxyColdMs: number;
  readonly healthReadProxyHotMs: number;
  readonly shadowSearchHelperProxyP50Ms: number;
  readonly shadowSearchHelperProxyP95Ms: number;
  readonly legacySearchLexProxyP50Ms: number;
  readonly legacySearchLexProxyP95Ms: number;
  readonly idleWriterHealthProbeMs: number;
  readonly idleWriterShadowProbeMs: number;
  readonly idleWriterProbeError?: string;
};

function round(value: number): number {
  return Number(value.toFixed(2));
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function createFixtureWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'kqmd-kiwi-metrics-'));
  const docsDir = join(root, 'docs');
  mkdirSync(docsDir, { recursive: true });
  return {
    root,
    docsDir,
    dbPath: join(root, 'index.sqlite'),
  };
}

function writeFixtureDocs(docsDir: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const filename = join(docsDir, `doc-${index.toString().padStart(4, '0')}.md`);
    writeFileSync(
      filename,
      [
        `# 형태소분석기 문서 ${index}`,
        '',
        '거대언어모델과 형태소분석기 비교 메모입니다.',
        '',
        `문서 번호 ${index} 입니다.`,
      ].join('\n'),
      'utf8',
    );
  }
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

function now(): number {
  return performance.now();
}

async function measureScale(scale: ScaleName, documents: number): Promise<ScaleMetrics> {
  const { root, docsDir, dbPath } = createFixtureWorkspace();
  writeFixtureDocs(docsDir, documents);

  const store = await createFixtureStore(dbPath, docsDir);
  const policy = describeEffectiveSearchPolicy();
  const cleanQuery = buildLexicalSearchText('형태소 분석', ['형태소', '분석']);

  try {
    const updateStart = now();
    await store.update();
    const updateMs = now() - updateStart;

    const rebuild = await rebuildSearchShadowIndex(store.internal.db, policy, {
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

    // This harness times internal helper/proxy calls, not end-to-end CLI command execution.
    const statusColdStart = now();
    readSearchIndexHealth(store.internal.db, policy);
    const healthReadProxyColdMs = now() - statusColdStart;

    const statusHotStart = now();
    readSearchIndexHealth(store.internal.db, policy);
    const healthReadProxyHotMs = now() - statusHotStart;

    const cleanSearchRuns: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const start = now();
      searchShadowIndex(store.internal, cleanQuery, { limit: 10 });
      cleanSearchRuns.push(now() - start);
    }

    const mutatedDoc = join(docsDir, 'doc-0000.md');
    writeFileSync(
      mutatedDoc,
      ['# 형태소분석기 문서 0', '', '수정된 문서입니다.'].join('\n'),
      'utf8',
    );
    await store.update();

    const fallbackSearchRuns: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const start = now();
      await store.searchLex('문서', { limit: 10, collection: 'docs' });
      fallbackSearchRuns.push(now() - start);
    }

    const probeStore = await createStore({ dbPath });
    let idleWriterHealthProbeMs = 0;
    let idleWriterShadowProbeMs = 0;
    let idleWriterProbeError: string | undefined;

    try {
      store.internal.db.exec('BEGIN IMMEDIATE');

      const readStart = now();
      readSearchIndexHealth(probeStore.internal.db, policy);
      idleWriterHealthProbeMs = now() - readStart;

      const searchStart = now();
      searchShadowIndex(probeStore.internal, cleanQuery, { limit: 5, collections: ['docs'] });
      idleWriterShadowProbeMs = now() - searchStart;
    } catch (error) {
      idleWriterProbeError = error instanceof Error ? error.message : String(error);
    } finally {
      store.internal.db.exec('ROLLBACK');
      await probeStore.close();
    }

    return {
      scale,
      documents,
      updateMs: round(updateMs),
      rebuildMs: round(rebuild.totalDurationMs),
      projectionMs: round(rebuild.projectionDurationMs),
      writeMs: round(rebuild.writeDurationMs),
      healthReadProxyColdMs: round(healthReadProxyColdMs),
      healthReadProxyHotMs: round(healthReadProxyHotMs),
      shadowSearchHelperProxyP50Ms: round(percentile(cleanSearchRuns, 0.5)),
      shadowSearchHelperProxyP95Ms: round(percentile(cleanSearchRuns, 0.95)),
      legacySearchLexProxyP50Ms: round(percentile(fallbackSearchRuns, 0.5)),
      legacySearchLexProxyP95Ms: round(percentile(fallbackSearchRuns, 0.95)),
      idleWriterHealthProbeMs: round(idleWriterHealthProbeMs),
      idleWriterShadowProbeMs: round(idleWriterShadowProbeMs),
      idleWriterProbeError,
    };
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function toMarkdown(metrics: readonly ScaleMetrics[]): string {
  const lines = [
    '| Scale | Docs | store.update() (ms) | Rebuild (ms) | Projection (ms) | Write (ms) | Health-read proxy cold/hot (ms) | Shadow helper proxy p50/p95 (ms) | Legacy searchLex proxy p50/p95 (ms) | Idle-writer health/shadow probe (ms) | Probe error |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  ];

  for (const item of metrics) {
    lines.push(
      `| ${item.scale} | ${item.documents} | ${item.updateMs} | ${item.rebuildMs} | ${item.projectionMs} | ${item.writeMs} | ${item.healthReadProxyColdMs} / ${item.healthReadProxyHotMs} | ${item.shadowSearchHelperProxyP50Ms} / ${item.shadowSearchHelperProxyP95Ms} | ${item.legacySearchLexProxyP50Ms} / ${item.legacySearchLexProxyP95Ms} | ${item.idleWriterHealthProbeMs} / ${item.idleWriterShadowProbeMs} | ${item.idleWriterProbeError ?? 'none'} |`,
    );
  }

  return lines.join('\n');
}

const metrics = await Promise.all([
  measureScale('small', 10),
  measureScale('medium', 100),
  measureScale('large', 500),
]);

console.log(toMarkdown(metrics));
console.log('\nJSON');
console.log(JSON.stringify(metrics, null, 2));
