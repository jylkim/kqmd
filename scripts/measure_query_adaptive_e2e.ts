import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createStore } from '@tobilu/qmd';

import { executeQueryCore } from '../src/commands/owned/query_core.js';
import { formatSearchExecutionResult, normalizeHybridQueryResults } from '../src/commands/owned/io/format.js';
import type { QueryCommandInput } from '../src/commands/owned/io/types.js';
import { executeOwnedQuerySearch } from '../src/commands/owned/query_runtime.js';

type ScenarioMetric = {
  readonly scenario: string;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly heapDeltaKb: number;
  readonly rssDeltaKb: number;
  readonly peakHeapKb: number;
  readonly peakRssKb: number;
};

type QueryRuntimeDeps = Parameters<typeof executeQueryCore>[3];

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function createFixtureWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'kqmd-query-e2e-'));
  const docsDir = join(root, 'docs');
  mkdirSync(docsDir, { recursive: true });
  return {
    root,
    docsDir,
    dbPath: join(root, 'index.sqlite'),
  };
}

function writeFixtureDocs(docsDir: string): void {
  const docs = [
    {
      name: 'adaptive-korean-ranking.md',
      body: [
        '# 지속 학습 메모',
        '',
        '## 적용 방향',
        '지속 학습은 문서 업로드 파싱과 연결됩니다.',
        '짧은 한국어 구 검색에서 phrase와 heading을 같이 봅니다.',
      ].join('\n'),
    },
    {
      name: 'agent-orchestration.md',
      body: [
        '# Agent Orchestration',
        '',
        '## Design',
        'agent orchestration in practice with literal anchors and title matches.',
        'mixed technical query를 설명 가능하게 정렬합니다.',
        '',
        ...Array.from({ length: 24 }, (_, index) =>
          `Large body section ${index + 1}: agent orchestration keeps literal anchors, candidate windows, and vector backoff aligned for explainability.`,
        ),
      ].join('\n'),
    },
  ];

  for (const doc of docs) {
    writeFileSync(join(docsDir, doc.name), doc.body, 'utf8');
  }

  for (let index = 0; index < 80; index += 1) {
    writeFileSync(
      join(docsDir, `noise-${index.toString().padStart(3, '0')}.md`),
      [
        `# General Note ${index}`,
        '',
        '이 문서는 일반적인 개발 메모입니다.',
        `agent 와 orchestration 이라는 단어가 ${index % 3 === 0 ? '드물게' : '가끔'} 등장합니다.`,
        `지속 이라는 단어가 ${index % 4 === 0 ? '한 번' : '거의 없이'} 등장합니다.`,
      ].join('\n'),
      'utf8',
    );
  }
}

function createInput(query: string, explain = false): QueryCommandInput {
  return {
    query,
    displayQuery: query,
    format: 'json',
    limit: 5,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    collections: ['docs'],
    explain,
    queryMode: 'plain',
  };
}

function createDeterministicVector(query: string): number[] {
  const lower = query.toLowerCase();

  if (lower.includes('agent orchestration')) {
    return [0.92, 0.08, 0.77, 0.14];
  }

  if (lower.includes('지속 학습')) {
    return [0.14, 0.91, 0.18, 0.74];
  }

  return [0.2, 0.2, 0.2, 0.2];
}

function installDeterministicLlmStub(store: Awaited<ReturnType<typeof createStore>>): void {
  store.internal.llm = {
    expandQuery: async () => [],
    embedBatch: async (texts: readonly string[]) =>
      texts.map((text) => ({
        embedding: createDeterministicVector(text),
      })),
    rerank: async (_query: string, documents: readonly { file: string; text: string }[]) => ({
      results: documents.map((document, index) => ({
        file: document.file,
        score:
          document.text.toLowerCase().includes('agent orchestration') ||
          document.text.includes('Agent Orchestration')
            ? round(0.95 - index * 0.01)
            : round(0.65 - index * 0.01),
      })),
    }),
  } as never;
}

function createVectorSignaledHybridDeps(
  store: Awaited<ReturnType<typeof createStore>>,
): Required<Pick<QueryRuntimeDeps, 'hybridQuery'>> {
  return {
    hybridQuery: async (_internal, query, options) => {
      const lexRows = await store.searchLex(query, {
        collection: options?.collection,
        limit: Math.max(options?.candidateLimit ?? 20, options?.limit ?? 5),
      });
      const candidateRows = lexRows.slice(0, options?.candidateLimit ?? lexRows.length);

      const rows = await Promise.all(
        candidateRows.map(async (row, index) => {
          const body = (await store.getDocumentBody(row.filepath)) ?? '';
          const vectorScore = round(
            Math.max(0.12, createDeterministicVector(row.filepath)[0] - index * 0.02),
          );

          return {
            file: row.filepath,
            displayPath: row.displayPath,
            title: row.title,
            body,
            bestChunk:
              body.split('\n').find((line) => line.toLowerCase().includes('agent orchestration')) ??
              body.split('\n')[0] ??
              '',
            bestChunkPos: Math.max(0, body.toLowerCase().indexOf('agent orchestration')),
            score: round(Math.max(0.2, row.score - index * 0.01 + vectorScore * 0.05)),
            context: row.collectionName,
            docid: row.docid,
            explain: {
              ftsScores: [round(row.score)],
              vectorScores: [vectorScore],
              rrf: {
                rank: index + 1,
                positionScore: round(1 / (index + 1)),
                weight: index < 2 ? 0.75 : 0.6,
                baseScore: 0.1,
                topRankBonus: index === 0 ? 0.05 : 0.02,
                totalScore: round(0.15 - index * 0.002),
                contributions: [],
              },
              rerankScore: round(0.92 - index * 0.01),
              blendedScore: round(Math.max(0.2, row.score + vectorScore * 0.04)),
            },
          };
        }),
      );

      return rows.slice(0, options?.limit ?? rows.length);
    },
  };
}

async function measureAdaptive(
  store: Awaited<ReturnType<typeof createStore>>,
  input: QueryCommandInput,
  iterations: number,
  runtimeDependencies: QueryRuntimeDeps = {},
): Promise<ScenarioMetric> {
  const durations: number[] = [];
  const heapBefore = process.memoryUsage().heapUsed;
  const rssBefore = process.memoryUsage().rss;
  let peakHeap = heapBefore;
  let peakRss = rssBefore;

  await executeQueryCore(store, input, { HOME: '/tmp' }, runtimeDependencies);

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    const result = await executeQueryCore(store, input, { HOME: '/tmp' }, runtimeDependencies);
    if ('kind' in result) {
      throw new Error(result.stderr);
    }
    formatSearchExecutionResult(result.rows, input);
    durations.push(performance.now() - startedAt);
    const memory = process.memoryUsage();
    peakHeap = Math.max(peakHeap, memory.heapUsed);
    peakRss = Math.max(peakRss, memory.rss);
  }

  const heapAfter = process.memoryUsage().heapUsed;
  const rssAfter = process.memoryUsage().rss;

  return {
    scenario: input.explain ? `${input.query} (adaptive explain)` : `${input.query} (adaptive)`,
    p50Ms: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
    heapDeltaKb: round((heapAfter - heapBefore) / 1024),
    rssDeltaKb: round((rssAfter - rssBefore) / 1024),
    peakHeapKb: round(peakHeap / 1024),
    peakRssKb: round(peakRss / 1024),
  };
}

async function measureBaseline(
  store: Awaited<ReturnType<typeof createStore>>,
  input: QueryCommandInput,
  iterations: number,
  runtimeDependencies: QueryRuntimeDeps = {},
): Promise<ScenarioMetric> {
  const durations: number[] = [];
  const selectedCollections = ['docs'];
  const heapBefore = process.memoryUsage().heapUsed;
  const rssBefore = process.memoryUsage().rss;
  let peakHeap = heapBefore;
  let peakRss = rssBefore;

  await executeOwnedQuerySearch(store, input, selectedCollections, runtimeDependencies);

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    const result = await executeOwnedQuerySearch(
      store,
      input,
      selectedCollections,
      runtimeDependencies,
    );
    const rows = normalizeHybridQueryResults(result);
    formatSearchExecutionResult(rows, input);
    durations.push(performance.now() - startedAt);
    const memory = process.memoryUsage();
    peakHeap = Math.max(peakHeap, memory.heapUsed);
    peakRss = Math.max(peakRss, memory.rss);
  }

  const heapAfter = process.memoryUsage().heapUsed;
  const rssAfter = process.memoryUsage().rss;

  return {
    scenario: `${input.query} (baseline)`,
    p50Ms: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
    heapDeltaKb: round((heapAfter - heapBefore) / 1024),
    rssDeltaKb: round((rssAfter - rssBefore) / 1024),
    peakHeapKb: round(peakHeap / 1024),
    peakRssKb: round(peakRss / 1024),
  };
}

function toMarkdown(
  metrics: readonly ScenarioMetric[],
  regressionPct: number,
  explainOverheadPct: number,
  vectorRegressionPct: number,
  vectorExplainOverheadPct: number,
): string {
  const lines = [
    '# Adaptive Query Ranking E2E Metrics',
    '',
    'Date: 2026-03-17',
    'Command: `bun run measure:query-adaptive-e2e`',
    '',
    '이 문서는 temp fixture store에서 `createStore() + update()` 이후 warm-cache query를 재는 end-to-end benchmark다.',
    'vectors absent fixture와 deterministic vector-signaled hybrid fixture를 같이 측정한다.',
    'vector-signaled 케이스는 sqlite-vec availability와 무관하게 deterministic helper/LLM stub로 비용 축을 고정한다.',
    '',
    '| Scenario | p50 (ms) | p95 (ms) | Heap delta (KB) | RSS delta (KB) | Peak heap (KB) | Peak RSS (KB) |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];

  for (const item of metrics) {
    lines.push(
      `| ${item.scenario} | ${item.p50Ms} | ${item.p95Ms} | ${item.heapDeltaKb} | ${item.rssDeltaKb} | ${item.peakHeapKb} | ${item.peakRssKb} |`,
    );
  }

  lines.push(
    '',
    '## Derived Signals',
    '',
    `- mixed-technical adaptive p95 regression vs baseline: ${regressionPct}%`,
    `- mixed-technical explain p95 overhead vs adaptive: ${explainOverheadPct}%`,
    `- vector+candidate40 adaptive p95 regression vs baseline: ${vectorRegressionPct}%`,
    `- vector+candidate50 explain/full p95 overhead vs vector+candidate40 adaptive: ${vectorExplainOverheadPct}%`,
  );

  return lines.join('\n');
}

const iterations = 100;
const { root, docsDir, dbPath } = createFixtureWorkspace();
writeFixtureDocs(docsDir);

try {
  const store = await createStore({
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

  try {
    await store.update();
    installDeterministicLlmStub(store);

    const shortKorean = await measureAdaptive(store, createInput('지속 학습'), iterations);
    const mixedBaseline = await measureBaseline(store, createInput('agent orchestration'), iterations);
    const mixedAdaptive = await measureAdaptive(store, createInput('agent orchestration'), iterations);
    const mixedExplain = await measureAdaptive(
      store,
      createInput('agent orchestration', true),
      iterations,
    );

    const vectorRuntimeDeps = createVectorSignaledHybridDeps(store);

    const vectorCandidate40Input = {
      ...createInput('agent orchestration'),
      explain: true,
      candidateLimit: 40,
    };
    const vectorCandidate50ExplainInput = {
      ...createInput('agent orchestration', true),
      candidateLimit: 50,
      full: true,
    };

    const vectorBaseline = await measureBaseline(
      store,
      vectorCandidate40Input,
      iterations,
      vectorRuntimeDeps,
    );
    const vectorAdaptive = await measureAdaptive(
      store,
      vectorCandidate40Input,
      iterations,
      vectorRuntimeDeps,
    );
    const vectorExplainFull = await measureAdaptive(
      store,
      vectorCandidate50ExplainInput,
      iterations,
      vectorRuntimeDeps,
    );

    const regressionPct =
      mixedBaseline.p95Ms > 0
        ? round(((mixedAdaptive.p95Ms - mixedBaseline.p95Ms) / mixedBaseline.p95Ms) * 100)
        : 0;
    const explainOverheadPct =
      mixedAdaptive.p95Ms > 0
        ? round(((mixedExplain.p95Ms - mixedAdaptive.p95Ms) / mixedAdaptive.p95Ms) * 100)
        : 0;
    const vectorRegressionPct =
      vectorBaseline.p95Ms > 0
        ? round(((vectorAdaptive.p95Ms - vectorBaseline.p95Ms) / vectorBaseline.p95Ms) * 100)
        : 0;
    const vectorExplainOverheadPct =
      vectorAdaptive.p95Ms > 0
        ? round(((vectorExplainFull.p95Ms - vectorAdaptive.p95Ms) / vectorAdaptive.p95Ms) * 100)
        : 0;

    console.log(
      toMarkdown(
        [
          shortKorean,
          mixedBaseline,
          mixedAdaptive,
          mixedExplain,
          {
            ...vectorBaseline,
            scenario: 'agent orchestration (baseline, vectors present, candidate40)',
          },
          {
            ...vectorAdaptive,
            scenario: 'agent orchestration (adaptive, vectors present, candidate40)',
          },
          {
            ...vectorExplainFull,
            scenario: 'agent orchestration (adaptive explain+full, vectors present, candidate50)',
          },
        ],
        regressionPct,
        explainOverheadPct,
        vectorRegressionPct,
        vectorExplainOverheadPct,
      ),
    );
  } finally {
    await store.close();
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
