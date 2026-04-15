import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { HybridQueryResult, QMDStore, SearchResult } from '@tobilu/qmd';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { BenchCommandDependencies } from '../src/commands/owned/bench.js';
import { handleBenchCommand } from '../src/commands/owned/bench.js';
import { createContext, createRuntimeDependencies } from './helpers.js';

function createBenchStore(
  options: {
    defaultCollectionNames?: string[];
    searchVectorImpl?: () => Promise<SearchResult[]>;
    searchImpl?: () => Promise<HybridQueryResult[]>;
  } = {},
): QMDStore {
  return {
    close: vi.fn(async () => {}),
    listCollections: vi.fn(async () => [
      {
        name: 'docs',
        pwd: '/tmp/docs',
        glob_pattern: '**/*.md',
        doc_count: 1,
        active_count: 1,
        last_modified: null,
        includeByDefault: true,
      },
    ]),
    getDefaultCollectionNames: vi.fn(async () => options.defaultCollectionNames ?? ['docs']),
    searchLex: vi.fn(async () => [
      {
        displayPath: 'docs/auth.md',
        title: 'Auth',
        body: 'auth body',
        context: null,
        score: 0.9,
        docid: 'lex-1',
        chunkPos: 0,
        filepath: 'docs/auth.md',
      },
    ]),
    searchVector: vi.fn(
      options.searchVectorImpl ??
        (async () => [
          {
            displayPath: 'docs/auth.md',
            title: 'Auth',
            body: 'auth body',
            context: null,
            score: 0.8,
            docid: 'vec-1',
            chunkPos: 0,
            filepath: 'docs/auth.md',
          },
        ]),
    ),
    search: vi.fn(
      options.searchImpl ??
        (async () => [
          {
            displayPath: 'docs/auth.md',
            title: 'Auth',
            body: 'auth full body',
            bestChunk: 'auth full body',
            context: null,
            score: 0.85,
            docid: 'hybrid-1',
            bestChunkPos: 0,
            file: 'docs/auth.md',
          },
        ]),
    ),
    getStatus: vi.fn(async () => ({
      totalDocuments: 1,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [],
    })),
    internal: {
      db: {
        prepare: vi.fn((sql: string) => ({
          all: vi.fn(() => {
            if (sql.includes('content_vectors')) {
              return [{ model: 'embeddinggemma', documents: 1 }];
            }

            return [];
          }),
          get: vi.fn(() => {
            if (sql.includes('COUNT(*) AS count')) {
              return { count: 1 };
            }

            if (sql.includes('sqlite_master')) {
              return undefined;
            }

            return { value: undefined };
          }),
        })),
      },
    },
  } as unknown as QMDStore;
}

describe('owned bench command', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('passes parsed bench input to injected runner', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kqmd-bench-'));
    tempDirs.push(tempDir);
    const fixturePath = join(tempDir, 'fixture.json');
    writeFileSync(
      fixturePath,
      JSON.stringify({
        description: 'fixture',
        version: 1,
        queries: [
          {
            id: 'q1',
            query: 'auth',
            type: 'exact',
            description: 'query',
            expected_files: ['docs/auth.md'],
            expected_in_top_k: 1,
          },
        ],
      }),
      'utf8',
    );

    const run = vi.fn(async () => ({
      comparison: {
        schema_version: '1',
        baseline: 'upstream',
        fixture_label: 'fixture.json',
        collection: 'docs',
        measurement_policy: {
          collection_scope: {
            mode: 'single-collection',
            label: 'docs',
          },
          latency_scope: 'single-run-per-backend',
          latency_comparable: false,
          latency_note: 'Latency is informational only.',
          raw_queries_exposed: false,
        },
        upstream: {
          timestamp: '20260414T000000',
          fixture_label: 'fixture.json',
          results: [],
          summary: {
            bm25: {
              status: 'ok',
              available_runs: 1,
              total_runs: 1,
              unavailable_runs: 0,
              avg_precision: 1,
              avg_recall: 1,
              avg_mrr: 1,
              avg_f1: 1,
              avg_latency_ms: 1,
            },
            vector: {
              status: 'ok',
              available_runs: 1,
              total_runs: 1,
              unavailable_runs: 0,
              avg_precision: 1,
              avg_recall: 1,
              avg_mrr: 1,
              avg_f1: 1,
              avg_latency_ms: 1,
            },
            hybrid: {
              status: 'ok',
              available_runs: 1,
              total_runs: 1,
              unavailable_runs: 0,
              avg_precision: 1,
              avg_recall: 1,
              avg_mrr: 1,
              avg_f1: 1,
              avg_latency_ms: 1,
            },
            full: {
              status: 'ok',
              available_runs: 1,
              total_runs: 1,
              unavailable_runs: 0,
              avg_precision: 1,
              avg_recall: 1,
              avg_mrr: 1,
              avg_f1: 1,
              avg_latency_ms: 1,
            },
          },
        },
        current: {
          timestamp: '20260414T000000',
          fixture_label: 'fixture.json',
          results: [],
          summary: {
            bm25: {
              status: 'ok',
              available_runs: 1,
              total_runs: 1,
              unavailable_runs: 0,
              avg_precision: 1,
              avg_recall: 1,
              avg_mrr: 1,
              avg_f1: 1,
              avg_latency_ms: 1,
            },
            vector: {
              status: 'ok',
              available_runs: 1,
              total_runs: 1,
              unavailable_runs: 0,
              avg_precision: 1,
              avg_recall: 1,
              avg_mrr: 1,
              avg_f1: 1,
              avg_latency_ms: 1,
            },
            hybrid: {
              status: 'ok',
              available_runs: 1,
              total_runs: 1,
              unavailable_runs: 0,
              avg_precision: 1,
              avg_recall: 1,
              avg_mrr: 1,
              avg_f1: 1,
              avg_latency_ms: 1,
            },
            full: {
              status: 'ok',
              available_runs: 1,
              total_runs: 1,
              unavailable_runs: 0,
              avg_precision: 1,
              avg_recall: 1,
              avg_mrr: 1,
              avg_f1: 1,
              avg_latency_ms: 1,
            },
          },
        },
        representatives: [],
      } as const,
    }));

    const result = await handleBenchCommand(
      createContext(['bench', '--json', '-c', 'docs', fixturePath]),
      { run: run as unknown as NonNullable<BenchCommandDependencies['run']> },
    );

    expect(run).toHaveBeenCalledWith(
      expect.anything(),
      {
        fixturePath,
        json: true,
        collection: 'docs',
      },
      undefined,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"schema_version": "1"');
  });

  test('rejects unsupported bench options', async () => {
    const result = await handleBenchCommand(createContext(['bench', '--csv', 'fixture.json']));

    expect(result).toEqual({
      exitCode: 1,
      stderr: 'Unknown option for `qmd bench`: --csv.',
    });
  });

  test('rejects leaked flags and multiple collection overrides', async () => {
    await expect(
      handleBenchCommand(createContext(['bench', '--no-rerank', 'fixture.json'])),
    ).resolves.toEqual({
      exitCode: 1,
      stderr: 'Unknown option for `qmd bench`: --no-rerank.',
    });

    await expect(
      handleBenchCommand(createContext(['bench', '-c', 'docs', '-c', 'notes', 'fixture.json'])),
    ).resolves.toEqual({
      exitCode: 1,
      stderr: 'The `qmd bench` command accepts only one `-c` / `--collection` value.',
    });
  });

  test('runs minimal compare bench flow against current store and returns json wrapper', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kqmd-bench-'));
    tempDirs.push(tempDir);
    const fixturePath = join(tempDir, 'fixture.json');
    writeFileSync(
      fixturePath,
      JSON.stringify({
        description: 'fixture',
        version: 1,
        queries: [
          {
            id: 'auth-query',
            query: 'auth',
            type: 'exact',
            description: 'query',
            expected_files: ['docs/auth.md'],
            expected_in_top_k: 1,
          },
        ],
      }),
      'utf8',
    );

    const result = await handleBenchCommand(createContext(['bench', '--json', fixturePath]), {
      runtimeDependencies: createRuntimeDependencies(createBenchStore()),
      now: () => new Date('2026-04-14T00:00:00.000Z'),
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout ?? '{}') as {
      schema_version: string;
      baseline: string;
      fixture_label: string;
      measurement_policy: {
        raw_queries_exposed: boolean;
        collection_scope: { mode: string; label: string };
      };
      upstream: { results: Array<{ id: string }> };
      current: { results: Array<{ id: string }> };
    };

    expect(output.schema_version).toBe('1');
    expect(output.baseline).toBe('upstream');
    expect(output.fixture_label).toMatch(/^fixture-[a-f0-9]{8}$/);
    expect(output.measurement_policy.raw_queries_exposed).toBe(false);
    expect(output.measurement_policy.collection_scope.label).toBe('docs');
    expect(output.upstream.results[0]?.id).toBe('auth-query');
    expect(output.current.results[0]?.id).toBe('auth-query');
    expect(result.stdout).not.toContain(fixturePath);
    expect(result.stdout).not.toContain('"query"');
  });

  test('rejects malformed fixture queries before scoring', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kqmd-bench-'));
    tempDirs.push(tempDir);
    const fixturePath = join(tempDir, 'fixture.json');
    writeFileSync(
      fixturePath,
      JSON.stringify({
        description: 'fixture',
        version: 1,
        queries: [
          {
            id: 'auth-query',
            query: 'auth',
            type: 'exact',
            description: 'query',
            expected_files: [123],
            expected_in_top_k: 1,
          },
        ],
      }),
      'utf8',
    );

    const result = await handleBenchCommand(createContext(['bench', fixturePath]), {
      runtimeDependencies: createRuntimeDependencies(createBenchStore()),
    });

    expect(result).toEqual({
      exitCode: 1,
      stderr:
        'Invalid fixture: benchmark query auth-query must define safe relative expected_files paths.',
    });
  });

  test('requires explicit collection when multiple collections exist without a single default scope', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kqmd-bench-'));
    tempDirs.push(tempDir);
    const fixturePath = join(tempDir, 'fixture.json');
    writeFileSync(
      fixturePath,
      JSON.stringify({
        description: 'fixture',
        version: 1,
        queries: [
          {
            id: 'auth-query',
            query: 'auth',
            type: 'exact',
            description: 'query',
            expected_files: ['docs/auth.md'],
            expected_in_top_k: 1,
          },
        ],
      }),
      'utf8',
    );

    const multiCollectionStore = {
      ...createBenchStore({ defaultCollectionNames: ['docs', 'notes'] }),
      listCollections: vi.fn(async () => [
        {
          name: 'docs',
          pwd: '/tmp/docs',
          glob_pattern: '**/*.md',
          doc_count: 1,
          active_count: 1,
          last_modified: null,
          includeByDefault: true,
        },
        {
          name: 'notes',
          pwd: '/tmp/notes',
          glob_pattern: '**/*.md',
          doc_count: 1,
          active_count: 1,
          last_modified: null,
          includeByDefault: true,
        },
      ]),
    } as unknown as QMDStore;

    const result = await handleBenchCommand(createContext(['bench', '--json', fixturePath]), {
      runtimeDependencies: createRuntimeDependencies(multiCollectionStore),
    });

    expect(result).toEqual({
      exitCode: 1,
      stderr:
        'The `qmd bench` command requires an explicit collection or exactly one default collection.',
    });
  });

  test('surfaces unavailable backends distinctly in bench json output', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kqmd-bench-'));
    tempDirs.push(tempDir);
    const fixturePath = join(tempDir, 'fixture.json');
    writeFileSync(
      fixturePath,
      JSON.stringify({
        description: 'fixture',
        version: 1,
        queries: [
          {
            id: 'auth-query',
            query: 'auth',
            type: 'exact',
            description: 'query',
            expected_files: ['docs/auth.md'],
            expected_in_top_k: 1,
          },
        ],
      }),
      'utf8',
    );

    const store = createBenchStore({
      searchVectorImpl: async () => {
        throw new Error('vector unavailable');
      },
    });

    const result = await handleBenchCommand(createContext(['bench', '--json', fixturePath]), {
      runtimeDependencies: createRuntimeDependencies(store),
      now: () => new Date('2026-04-14T00:00:00.000Z'),
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout ?? '{}') as {
      current: {
        results: Array<{
          backends: {
            vector: { status: string; f1: number | null };
          };
        }>;
        summary: {
          vector: {
            status: string;
            available_runs: number;
            total_runs: number;
            unavailable_runs: number;
            avg_f1: number | null;
          };
        };
      };
    };

    expect(output.current.results[0]?.backends.vector.status).toBe('unavailable');
    expect(output.current.results[0]?.backends.vector.f1).toBeNull();
    expect(output.current.summary.vector.status).toBe('unavailable');
    expect(output.current.summary.vector.available_runs).toBe(0);
    expect(output.current.summary.vector.total_runs).toBe(1);
    expect(output.current.summary.vector.unavailable_runs).toBe(1);
    expect(output.current.summary.vector.avg_f1).toBeNull();
  });

  test('fails with explicit bench guidance when no index or config exists', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kqmd-bench-'));
    tempDirs.push(tempDir);
    const fixturePath = join(tempDir, 'fixture.json');
    writeFileSync(
      fixturePath,
      JSON.stringify({
        description: 'fixture',
        version: 1,
        queries: [
          {
            id: 'auth-query',
            query: 'auth',
            type: 'exact',
            description: 'query',
            expected_files: ['docs/auth.md'],
            expected_in_top_k: 1,
          },
        ],
      }),
      'utf8',
    );

    const result = await handleBenchCommand(createContext(['bench', fixturePath]), {
      runtimeDependencies: createRuntimeDependencies(createBenchStore(), {
        existingPaths: [],
        env: { HOME: '/home/tester' },
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'The `bench` command requires an existing qmd index or config-backed index.',
    );
  });
});
