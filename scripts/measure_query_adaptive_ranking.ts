import { performance } from 'node:perf_hooks';

import type { HybridQueryResult, QMDStore } from '@tobilu/qmd';

import { formatSearchExecutionResult } from '../src/commands/owned/io/format.js';
import type { QueryCommandInput } from '../src/commands/owned/io/types.js';
import { executeQueryCore } from '../src/commands/owned/query_core.js';

type ScenarioName =
  | 'short-korean-phrase'
  | 'short-korean-phrase-candidate40'
  | 'mixed-technical'
  | 'mixed-technical-explain'
  | 'mixed-technical-candidate40-large-body-vectors'
  | 'mixed-technical-candidate50-large-body-vectors-full'
  | 'mixed-technical-candidate50-large-body-vectors-explain';

type ScenarioMetrics = {
  readonly scenario: ScenarioName;
  readonly iterations: number;
  readonly fetchLimit: number;
  readonly rerankDisabledCalls: number;
  readonly rowCount: number;
  readonly maxBodyBytes: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly heapDeltaKb: number;
  readonly rssDeltaKb: number;
  readonly peakHeapKb: number;
  readonly peakRssKb: number;
};

type ScenarioConfig = {
  readonly name: ScenarioName;
  readonly query: string;
  readonly iterations: number;
  readonly rowCount: number;
  readonly candidateLimit?: number;
  readonly explain?: boolean;
  readonly full?: boolean;
  readonly largeBody?: boolean;
  readonly includeVectors?: boolean;
};

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

function createLargeBody(query: string, index: number): string {
  const section = [
    `## Section ${index + 1}`,
    '',
    `The ${query} guide keeps literal anchors visible in the title, heading, and body for rerank selection.`,
    'This paragraph intentionally repeats operational details to stress row shaping on larger documents.',
    'agent orchestration reliability depends on explicit candidate windows, stable snippets, and vector backoff.',
  ].join('\n');

  return Array.from({ length: 18 }, () => section).join('\n\n');
}

function createRows(config: ScenarioConfig): HybridQueryResult[] {
  const { query, rowCount, explain = false, largeBody = false, includeVectors = false } = config;
  return Array.from({ length: rowCount }, (_, index) => ({
    file: `docs/doc-${index + 1}.md`,
    displayPath: `docs/doc-${index + 1}.md`,
    title: index === 0 ? `${query} guide` : `General note ${index + 1}`,
    body:
      index === 0
        ? `# ${query} guide\n\n${
            largeBody ? createLargeBody(query, index) : `${query} appears in the heading and body.\n`
          }`
        : largeBody
          ? createLargeBody(query, index)
          : `general note ${index + 1}\n\nthis mentions ${query.split(' ')[0] ?? query} in passing.\n`,
    bestChunk:
      index === 0
        ? `${query} appears in the heading and body.`
        : `this mentions ${query.split(' ')[0] ?? query} in passing.`,
    bestChunkPos: 0,
    score: round(0.95 - index * 0.02),
    context: 'docs',
    docid: `doc-${index + 1}`,
    ...(explain
      ? {
          explain: {
            ftsScores: [round(0.8 - index * 0.01)],
            vectorScores:
              includeVectors && index < 6
                ? [round(Math.max(0.15, 0.42 - index * 0.03))]
                : index === 0
                  ? [0.35]
                  : [],
            rrf: {
              rank: index + 1,
              positionScore: round(1 / (index + 1)),
              weight: index < 3 ? 0.75 : 0.6,
              baseScore: 0.1,
              topRankBonus: index === 0 ? 0.05 : 0.02,
              totalScore: round(0.15 - index * 0.002),
              contributions: [],
            },
            rerankScore: round(0.7 - index * 0.01),
            blendedScore: round(0.8 - index * 0.01),
          },
        }
      : {}),
  }));
}

function createStore(rows: readonly HybridQueryResult[]) {
  let fetchLimit = 0;
  let rerankDisabledCalls = 0;
  const recordLimit = (limit: number | undefined, rerankDisabled: boolean) => {
    fetchLimit = Math.max(fetchLimit, limit ?? 0);
    if (rerankDisabled) {
      rerankDisabledCalls += 1;
    }
  };

  const store = {
    close: async () => {},
    listCollections: async () => [{ name: 'docs' }],
    getDefaultCollectionNames: async () => ['docs'],
    getStatus: async () => ({
      totalDocuments: rows.length,
      needsEmbedding: 0,
      hasVectorIndex: false,
      collections: [],
    }),
    search: async (options: { limit?: number; rerank?: boolean }) => {
      recordLimit(options.limit, options.rerank === false);
      return rows.slice(0, options.limit ?? rows.length);
    },
    internal: {
      db: {
        prepare(sql: string) {
          return {
            all: () => {
              if (sql.includes('content_vectors')) {
                return [{ model: 'embeddinggemma', documents: rows.length }];
              }

              return [];
            },
            get: () => {
              if (sql.includes('COUNT(*) AS count')) {
                return { count: rows.length };
              }

              return undefined;
            },
          };
        },
      },
    },
  } as unknown as QMDStore;

  return {
    store,
    getFetchLimit: () => fetchLimit,
    getRerankDisabledCalls: () => rerankDisabledCalls,
    hybridQuery: async (
      _internal: unknown,
      _query: string,
      options?: { limit?: number; skipRerank?: boolean },
    ) => {
      recordLimit(options?.limit, options?.skipRerank === true);
      return rows.slice(0, options?.limit ?? rows.length);
    },
  };
}

function createInput(scenario: ScenarioName): QueryCommandInput {
  const base: QueryCommandInput = {
    query:
      scenario === 'short-korean-phrase' || scenario === 'short-korean-phrase-candidate40'
        ? '지속 학습'
        : 'agent orchestration',
    displayQuery:
      scenario === 'short-korean-phrase' || scenario === 'short-korean-phrase-candidate40'
        ? '지속 학습'
        : 'agent orchestration',
    format: 'json',
    limit: 5,
    minScore: 0,
    all: false,
    full: scenario === 'mixed-technical-candidate50-large-body-vectors-full',
    lineNumbers: false,
    explain:
      scenario === 'mixed-technical-explain' ||
      scenario === 'mixed-technical-candidate50-large-body-vectors-explain',
    queryMode: 'plain',
  };

  if (scenario === 'short-korean-phrase-candidate40') {
    return {
      ...base,
      limit: 10,
      candidateLimit: 40,
    };
  }

  if (scenario === 'mixed-technical-candidate40-large-body-vectors') {
    return {
      ...base,
      candidateLimit: 40,
    };
  }

  if (
    scenario === 'mixed-technical-candidate50-large-body-vectors-full' ||
    scenario === 'mixed-technical-candidate50-large-body-vectors-explain'
  ) {
    return {
      ...base,
      candidateLimit: 50,
    };
  }

  return base;
}

async function measureScenario(scenario: ScenarioName): Promise<ScenarioMetrics> {
  const scenarioConfig: ScenarioConfig =
    scenario === 'short-korean-phrase'
      ? { name: scenario, query: '지속 학습', iterations: 100, rowCount: 20 }
      : scenario === 'short-korean-phrase-candidate40'
        ? {
            name: scenario,
            query: '지속 학습',
            iterations: 100,
            rowCount: 40,
            candidateLimit: 40,
          }
        : scenario === 'mixed-technical'
          ? { name: scenario, query: 'agent orchestration', iterations: 100, rowCount: 20 }
          : scenario === 'mixed-technical-explain'
            ? {
                name: scenario,
                query: 'agent orchestration',
                iterations: 100,
                rowCount: 20,
                explain: true,
              }
            : scenario === 'mixed-technical-candidate40-large-body-vectors'
              ? {
                  name: scenario,
                  query: 'agent orchestration',
                  iterations: 60,
                  rowCount: 40,
                  candidateLimit: 40,
                  explain: true,
                  largeBody: true,
                  includeVectors: true,
                }
              : scenario === 'mixed-technical-candidate50-large-body-vectors-full'
                ? {
                    name: scenario,
                    query: 'agent orchestration',
                    iterations: 60,
                    rowCount: 50,
                    candidateLimit: 50,
                    full: true,
                    largeBody: true,
                    includeVectors: true,
                  }
                : {
                    name: scenario,
                    query: 'agent orchestration',
                    iterations: 60,
                    rowCount: 50,
                    candidateLimit: 50,
                    explain: true,
                    largeBody: true,
                    includeVectors: true,
                  };
  const rows = createRows(scenarioConfig);
  const { store, getFetchLimit, getRerankDisabledCalls, hybridQuery } = createStore(rows);
  const input = createInput(scenario);
  const durations: number[] = [];
  const heapBefore = process.memoryUsage().heapUsed;
  const rssBefore = process.memoryUsage().rss;
  let peakHeap = heapBefore;
  let peakRss = rssBefore;

  for (let index = 0; index < scenarioConfig.iterations; index += 1) {
    const startedAt = performance.now();
    const result = await executeQueryCore(store, input, { HOME: '/tmp' }, { hybridQuery });
    if ('kind' in result) {
      throw new Error(`Unexpected query core failure for ${scenario}: ${result.stderr}`);
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
    scenario,
    iterations: scenarioConfig.iterations,
    fetchLimit: getFetchLimit(),
    rerankDisabledCalls: getRerankDisabledCalls(),
    rowCount: rows.length,
    maxBodyBytes: Math.max(...rows.map((row) => Buffer.byteLength(row.body, 'utf8'))),
    p50Ms: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
    heapDeltaKb: round((heapAfter - heapBefore) / 1024),
    rssDeltaKb: round((rssAfter - rssBefore) / 1024),
    peakHeapKb: round(peakHeap / 1024),
    peakRssKb: round(peakRss / 1024),
  };
}

function toMarkdown(metrics: readonly ScenarioMetrics[]): string {
  const lines = [
    '# Adaptive Query Ranking Metrics',
    '',
    'Date: 2026-03-17',
    'Command: `bun run measure:query-adaptive`',
    '',
    '이 문서는 adaptive query ranking의 local overhead 참고값이다.',
    '실제 corpus / model latency 대신 local classification, ranking, row shaping, formatting 오버헤드를 비교하기 위한 synthetic harness다.',
    '',
    '| Scenario | Iterations | Fetch limit | rerank=false calls | Rows | Max body (bytes) | p50 (ms) | p95 (ms) | Heap delta (KB) | RSS delta (KB) | Peak heap (KB) | Peak RSS (KB) |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];

  for (const item of metrics) {
    lines.push(
      `| ${item.scenario} | ${item.iterations} | ${item.fetchLimit} | ${item.rerankDisabledCalls} | ${item.rowCount} | ${item.maxBodyBytes} | ${item.p50Ms} | ${item.p95Ms} | ${item.heapDeltaKb} | ${item.rssDeltaKb} | ${item.peakHeapKb} | ${item.peakRssKb} |`,
    );
  }

  return lines.join('\n');
}

const metrics = await Promise.all([
  measureScenario('short-korean-phrase'),
  measureScenario('short-korean-phrase-candidate40'),
  measureScenario('mixed-technical'),
  measureScenario('mixed-technical-explain'),
  measureScenario('mixed-technical-candidate40-large-body-vectors'),
  measureScenario('mixed-technical-candidate50-large-body-vectors-full'),
  measureScenario('mixed-technical-candidate50-large-body-vectors-explain'),
]);

const mixedTechnical = metrics.find((item) => item.scenario === 'mixed-technical');
const mixedTechnicalExplain = metrics.find((item) => item.scenario === 'mixed-technical-explain');
const mixedTechnicalCandidate40 = metrics.find(
  (item) => item.scenario === 'mixed-technical-candidate40-large-body-vectors',
);
const mixedTechnicalCandidate50 = metrics.find(
  (item) => item.scenario === 'mixed-technical-candidate50-large-body-vectors-full',
);
const explainOverheadPct =
  mixedTechnical && mixedTechnicalExplain && mixedTechnical.p95Ms > 0
    ? round(((mixedTechnicalExplain.p95Ms - mixedTechnical.p95Ms) / mixedTechnical.p95Ms) * 100)
    : 0;
const candidate50RegressionPct =
  mixedTechnicalCandidate40 && mixedTechnicalCandidate50 && mixedTechnicalCandidate40.p95Ms > 0
    ? round(
        ((mixedTechnicalCandidate50.p95Ms - mixedTechnicalCandidate40.p95Ms) /
          mixedTechnicalCandidate40.p95Ms) *
          100,
      )
    : 0;

console.log(
  `${toMarkdown(metrics)}\n\n## Derived Signals\n\n- mixed-technical explain p95 overhead: ${explainOverheadPct}%\n- mixed-technical candidate50/full p95 regression vs candidate40/explain large-body vectors: ${candidate50RegressionPct}%`,
);
console.log('\nJSON');
console.log(JSON.stringify(metrics, null, 2));
