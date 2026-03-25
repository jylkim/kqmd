import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createStore } from '@tobilu/qmd';

type BenchmarkCase = {
  readonly fixtureId: string;
  readonly query: string;
  readonly expectedTopPath: string;
};

type BenchmarkRow = {
  readonly fixtureId: string;
  readonly surface: 'cli-query';
  readonly retrievalKind: 'fast-default' | 'compatibility';
  readonly heavyPathUsed: boolean;
  readonly fallbackReason?: string;
  readonly elapsedMs: number;
  readonly peakRssBytes: number;
};

type ColdStartQueryBenchmarkV1 = {
  readonly version: 'ColdStartQueryBenchmarkV1';
  readonly generatedAt: string;
  readonly rows: readonly BenchmarkRow[];
};

const CASES: readonly BenchmarkCase[] = [
  {
    fixtureId: 'english-obsidian-cli',
    query: 'Works when Obsidian runs',
    expectedTopPath: 'docs/obsidian-cli-english.md',
  },
  {
    fixtureId: 'mixed-obsidian-korean',
    query: 'Obsidian 실행 중일때만 작동',
    expectedTopPath: 'docs/obsidian-cli-korean.md',
  },
];

const MAX_OUTPUT_BYTES = 128_000;
const POLL_INTERVAL_MS = 20;
const PROCESS_TIMEOUT_MS = 15_000;
const REPORT_DATE = '2026-03-25';

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index] ?? 0;
}

function assertNotSymlink(path: string, label: string): void {
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${path}`);
  }
}

function kbToBytes(kb: number): number {
  return kb * 1024;
}

function readProcessRssKb(pid: number): number {
  try {
    const output = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const parsed = Number.parseInt(output, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

async function prepareFixture(root: string): Promise<{ readonly dbPath: string }> {
  const docsDir = resolve(root, 'docs');
  mkdirSync(docsDir, { recursive: true });

  writeFileSync(
    join(docsDir, 'obsidian-cli-english.md'),
    [
      '# Obsidian CLI note',
      '',
      'Works when Obsidian runs and the CLI app is already active.',
      'The command only behaves correctly while Obsidian is running.',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(docsDir, 'obsidian-cli-korean.md'),
    [
      '# Obsidian CLI 메모',
      '',
      'Obsidian 실행 중일때만 작동하는 CLI 동작을 정리합니다.',
      'Obsidian이 켜져 있을 때만 해당 명령이 정상 동작합니다.',
    ].join('\n'),
    'utf8',
  );

  const dbPath = resolve(root, 'benchmark.sqlite');
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
  } finally {
    await store.close();
  }

  return { dbPath };
}

async function runCase(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  benchmarkCase: BenchmarkCase,
): Promise<BenchmarkRow> {
  const args = ['bin/qmd.js', 'query', '--json', '--explain', benchmarkCase.query];
  const startedAt = performance.now();
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  let peakRssKb = 0;
  let timedOut = false;

  const interval = setInterval(() => {
    if (child.pid) {
      peakRssKb = Math.max(peakRssKb, readProcessRssKb(child.pid));
    }
  }, POLL_INTERVAL_MS);
  interval.unref();

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, PROCESS_TIMEOUT_MS);
  timeout.unref();

  const collect = (chunk: string, current: string) => {
    const next = current + chunk;
    if (Buffer.byteLength(next, 'utf8') > MAX_OUTPUT_BYTES) {
      throw new Error(`Benchmark output exceeded ${MAX_OUTPUT_BYTES} bytes for ${benchmarkCase.fixtureId}.`);
    }
    return next;
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout = collect(chunk, stdout);
  });
  child.stderr.on('data', (chunk: string) => {
    stderr = collect(chunk, stderr);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  clearInterval(interval);
  clearTimeout(timeout);
  const elapsedMs = performance.now() - startedAt;

  if (timedOut) {
    throw new Error(`Cold-start benchmark timed out for ${benchmarkCase.fixtureId}.`);
  }

  if (exitCode !== 0) {
    throw new Error(`Cold-start benchmark failed for ${benchmarkCase.fixtureId} with exit code ${exitCode}.`);
  }

  if (stderr.trim().length > 0) {
    throw new Error(`Cold-start benchmark produced stderr for ${benchmarkCase.fixtureId}.`);
  }

  const parsed = JSON.parse(stdout) as {
    readonly query?: {
      readonly retrieval?: {
        readonly path: 'fast-default' | 'compatibility';
        readonly heavyPathUsed: boolean;
        readonly fallbackReason?: string;
      };
    };
    readonly results?: Array<{ readonly file: string }>;
  };

  const retrieval = parsed.query?.retrieval;
  if (!retrieval) {
    throw new Error(`Cold-start benchmark missing retrieval summary for ${benchmarkCase.fixtureId}.`);
  }

  if (retrieval.path !== 'fast-default' || retrieval.heavyPathUsed) {
    throw new Error(`Cold-start benchmark violated fast-default contract for ${benchmarkCase.fixtureId}.`);
  }

  if (!parsed.results?.some((row) => row.file === `qmd://${benchmarkCase.expectedTopPath}`)) {
    throw new Error(`Cold-start benchmark missed expected target for ${benchmarkCase.fixtureId}.`);
  }

  return {
    fixtureId: benchmarkCase.fixtureId,
    surface: 'cli-query',
    retrievalKind: retrieval.path,
    heavyPathUsed: retrieval.heavyPathUsed,
    ...(retrieval.fallbackReason ? { fallbackReason: retrieval.fallbackReason } : {}),
    elapsedMs: Number(elapsedMs.toFixed(2)),
    peakRssBytes: kbToBytes(peakRssKb),
  };
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const repoRoot = process.cwd();
const root = mkdtempSync(resolve(tmpdir(), 'kqmd-query-cold-start-'));
mkdirSync(resolve(root, '.cache'), { recursive: true });
mkdirSync(resolve(root, '.config'), { recursive: true });
assertNotSymlink(root, 'benchmark root');
assertNotSymlink(resolve(root, '.cache'), 'benchmark cache root');
assertNotSymlink(resolve(root, '.config'), 'benchmark config root');

try {
  const { dbPath } = await prepareFixture(root);
  const env = {
    ...process.env,
    HOME: root,
    XDG_CACHE_HOME: resolve(root, '.cache'),
    XDG_CONFIG_HOME: resolve(root, '.config'),
    QMD_CONFIG_DIR: resolve(root, '.config', 'qmd'),
    INDEX_PATH: dbPath,
  };

  const rows: BenchmarkRow[] = [];
  for (const benchmarkCase of CASES) {
    rows.push(await runCase(repoRoot, env, benchmarkCase));
  }

  const payload: ColdStartQueryBenchmarkV1 = {
    version: 'ColdStartQueryBenchmarkV1',
    generatedAt: new Date().toISOString(),
    rows,
  };

  const markdown = [
    '# Query Cold Start Metrics',
    '',
    `Date: ${REPORT_DATE}`,
    'Command: `bun run measure:query-cold-start`',
    '',
    '이 문서는 synthetic fixture와 temp HOME/XDG/INDEX_PATH sandbox를 사용해 first-query cold-start wall-clock을 측정한다.',
    '모델 다운로드나 실제 사용자 cache/config/index 재사용 없이 fast-default 계약만 검증한다.',
    '',
    '## Method',
    '',
    '- fresh child process per case',
    '- synthetic fixture only',
    '- `--json --explain` output에서 retrieval summary를 검증',
    '- stderr, raw query text, absolute path, temp directory path는 artifact에 남기지 않음',
    '',
    '## Results',
    '',
    '| Fixture | Surface | Retrieval | Heavy path | Fallback | Wall-clock (ms) | Peak RSS |',
    '|---|---|---|---|---|---:|---:|',
    ...rows.map(
      (row) =>
        `| ${row.fixtureId} | ${row.surface} | ${row.retrievalKind} | ${row.heavyPathUsed ? 'yes' : 'no'} | ${row.fallbackReason ?? 'none'} | ${row.elapsedMs.toFixed(2)} | ${formatBytes(row.peakRssBytes)} |`,
    ),
    '',
    '## Aggregate',
    '',
    `- wall-clock p50: ${percentile(rows.map((row) => row.elapsedMs), 0.5).toFixed(2)} ms`,
    `- wall-clock p95: ${percentile(rows.map((row) => row.elapsedMs), 0.95).toFixed(2)} ms`,
    `- max wall-clock: ${Math.max(...rows.map((row) => row.elapsedMs)).toFixed(2)} ms`,
    `- max RSS: ${formatBytes(Math.max(...rows.map((row) => row.peakRssBytes)))}`,
    '',
    '## Schema',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n');

  process.stdout.write(`${markdown}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
