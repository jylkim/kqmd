import { execFile as execFileCallback } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createStore } from '@tobilu/qmd';

import { rebuildSearchShadowIndex } from '../src/commands/owned/search_shadow_index.js';
import { describeEffectiveSearchPolicy } from '../src/config/search_policy.js';
import {
  COLD_START_FIXTURES,
  createColdStartFixtureWorkspace,
  installDeterministicLlmStub,
  toAllowlistedBenchmarkPath,
  writeColdStartFixtureDocs,
} from './query_cold_start_benchmark_lib.js';

const execFile = promisify(execFileCallback);
const ITERATIONS = 5;
const FIXTURE_VERSION = 'cold-start-fixture-v1';
const SCHEMA_VERSION = 'ColdStartQueryBenchmarkV1';

type ColdStartSample = {
  readonly fixtureId: string;
  readonly retrievalKind: string;
  readonly heavyPathUsed: boolean;
  readonly elapsedMs: number;
  readonly peakRssBytes: number;
  readonly targetHitAt5: boolean;
  readonly top5Paths: readonly string[];
};

type ColdStartChildPayload = Omit<ColdStartSample, 'elapsedMs'>;

const probeScriptPath = fileURLToPath(new URL('./query_cold_start_probe.ts', import.meta.url));

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

function assertSafeSample(sample: ColdStartSample): void {
  for (const path of sample.top5Paths) {
    expectAllowlistedPath(path);
  }
}

function expectAllowlistedPath(path: string): void {
  if (toAllowlistedBenchmarkPath(path) !== path) {
    throw new Error(`Unsafe cold-start benchmark path detected: ${path}`);
  }
}

function buildProbeEnv(sampleRoot: string, dbPath: string): NodeJS.ProcessEnv {
  return {
    HOME: sampleRoot,
    XDG_CACHE_HOME: `${sampleRoot}/.cache`,
    XDG_CONFIG_HOME: `${sampleRoot}/.config`,
    QMD_CONFIG_DIR: `${sampleRoot}/.config/qmd`,
    INDEX_PATH: dbPath,
    NO_COLOR: '1',
  };
}

function copyDatabaseSnapshot(sourceDbPath: string, targetDbPath: string): void {
  copyFileSync(sourceDbPath, targetDbPath);

  for (const suffix of ['-wal', '-shm']) {
    const source = `${sourceDbPath}${suffix}`;
    const target = `${targetDbPath}${suffix}`;
    if (existsSync(source)) {
      copyFileSync(source, target);
    }
  }
}

function toMarkdown(report: {
  readonly aggregate: readonly Array<{
    readonly fixtureId: string;
    readonly retrievalKind: string;
    readonly heavyPathUsedRate: number;
    readonly hitAt5Rate: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly maxMs: number;
    readonly p95PeakRssBytes: number;
  }>;
  readonly rows: readonly ColdStartSample[];
}): string {
  const lines = [
    '# Query Cold Start Metrics',
    '',
    'Date: 2026-03-25',
    'Command: `bun run measure:query-cold-start`',
    '',
    '이 문서는 synthetic fixture와 fresh child process를 사용해 default query cold-start latency를 측정한 기록입니다.',
    'artifact에는 fixture id, allowlisted qmd path, aggregate latency/RSS만 남기고 raw query/HOME/XDG/temp path는 남기지 않습니다.',
    '',
    '## Results',
    '',
    '| Fixture | Retrieval | Heavy path rate | hit@5 | p50 (ms) | p95 (ms) | max (ms) | p95 peak RSS (bytes) |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
  ];

  for (const item of report.aggregate) {
    lines.push(
      `| ${item.fixtureId} | ${item.retrievalKind} | ${item.heavyPathUsedRate}% | ${item.hitAt5Rate}% | ${item.p50Ms} | ${item.p95Ms} | ${item.maxMs} | ${item.p95PeakRssBytes} |`,
    );
  }

  lines.push(
    '',
    '## Notes',
    '',
    '- fresh child process wall-clock을 사용합니다.',
    '- fixture DB snapshot은 동일하고, sample마다 HOME/XDG/cache를 분리합니다.',
    '- 결과는 synthetic fixture 기준이므로 실제 사용자 vault의 절대 수치가 아니라 regression 신호로 해석합니다.',
    '',
    '```json',
    JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        fixtureVersion: FIXTURE_VERSION,
        rows: report.rows,
        aggregate: report.aggregate,
      },
      null,
      2,
    ),
    '```',
  );

  return lines.join('\n');
}

const { root, docsDir, notesDir, dbPath } = createColdStartFixtureWorkspace();
writeColdStartFixtureDocs(docsDir, notesDir);

const store = await createStore({
  dbPath,
  config: {
    collections: {
      docs: {
        path: docsDir,
        pattern: '**/*.md',
      },
      notes: {
        path: notesDir,
        pattern: '**/*.md',
        includeByDefault: false,
      },
    },
  },
});

try {
  installDeterministicLlmStub(store);
  await store.update();
  await rebuildSearchShadowIndex(store.internal.db, describeEffectiveSearchPolicy(), {
    tokenize: async (text) => text,
  });
} finally {
  await store.close();
}

try {
  const rows: ColdStartSample[] = [];

  for (const fixture of COLD_START_FIXTURES) {
    for (let attempt = 0; attempt < ITERATIONS; attempt += 1) {
      const sampleRoot = `${root}/sample-${fixture.fixtureId}-${attempt}`;
      const sampleDbPath = `${sampleRoot}/index.sqlite`;
      mkdirSync(`${sampleRoot}/.cache`, { recursive: true });
      mkdirSync(`${sampleRoot}/.config`, { recursive: true });
      copyDatabaseSnapshot(dbPath, sampleDbPath);

      const startedAt = performance.now();
      const { stdout } = await execFile(
        process.execPath,
        [
          probeScriptPath,
          '--fixture',
          fixture.fixtureId,
          '--db-path',
          sampleDbPath,
        ],
        {
          cwd: sampleRoot,
          env: buildProbeEnv(sampleRoot, sampleDbPath),
          shell: false,
          timeout: 30_000,
          maxBuffer: 128_000,
        },
      );
      const elapsedMs = performance.now() - startedAt;

      const sample = {
        ...(JSON.parse(stdout.trim()) as ColdStartChildPayload),
        elapsedMs: round(elapsedMs),
      } satisfies ColdStartSample;
      assertSafeSample(sample);
      rows.push(sample);
    }
  }

  const aggregate = COLD_START_FIXTURES.map((fixture) => {
    const samples = rows.filter((row) => row.fixtureId === fixture.fixtureId);
    const elapsed = samples.map((row) => row.elapsedMs);
    const rss = samples.map((row) => row.peakRssBytes);
    const heavyPathUsedRate =
      samples.length === 0
        ? 0
        : round((samples.filter((row) => row.heavyPathUsed).length / samples.length) * 100);
    const hitAt5Rate =
      samples.length === 0
        ? 0
        : round((samples.filter((row) => row.targetHitAt5).length / samples.length) * 100);

    if (hitAt5Rate < 100) {
      throw new Error(`Cold-start fixture missed target at top5: ${fixture.fixtureId}`);
    }

    return {
      fixtureId: fixture.fixtureId,
      retrievalKind: samples[0]?.retrievalKind ?? 'unknown',
      heavyPathUsedRate,
      hitAt5Rate,
      p50Ms: round(percentile(elapsed, 0.5)),
      p95Ms: round(percentile(elapsed, 0.95)),
      maxMs: round(Math.max(...elapsed)),
      p95PeakRssBytes: Math.round(percentile(rss, 0.95)),
    };
  });

  process.stdout.write(`${toMarkdown({ rows, aggregate })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
