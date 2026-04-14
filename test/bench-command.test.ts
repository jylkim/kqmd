import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { QMDStore } from '@tobilu/qmd';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { handleBenchCommand } from '../src/commands/owned/bench.js';
import { createContext, createRuntimeDependencies } from './helpers.js';

function createBenchStore(): QMDStore {
  return {
    close: vi.fn(async () => {}),
    listCollections: vi.fn(async () => [{ name: 'docs' }]),
    getDefaultCollectionNames: vi.fn(async () => ['docs']),
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
    searchVector: vi.fn(async () => [
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
    search: vi.fn(async (_options?: { rerank?: boolean }) => [
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
        schema_version: '1' as const,
        baseline: 'upstream' as const,
        fixture: fixturePath,
        collection: 'docs',
        upstream: {
          timestamp: '20260414T000000',
          fixture: fixturePath,
          results: [],
          summary: {
            bm25: { avg_precision: 1, avg_recall: 1, avg_mrr: 1, avg_f1: 1, avg_latency_ms: 1 },
            vector: { avg_precision: 1, avg_recall: 1, avg_mrr: 1, avg_f1: 1, avg_latency_ms: 1 },
            hybrid: { avg_precision: 1, avg_recall: 1, avg_mrr: 1, avg_f1: 1, avg_latency_ms: 1 },
            full: { avg_precision: 1, avg_recall: 1, avg_mrr: 1, avg_f1: 1, avg_latency_ms: 1 },
          },
        },
        current: {
          timestamp: '20260414T000000',
          fixture: fixturePath,
          results: [],
          summary: {
            bm25: { avg_precision: 1, avg_recall: 1, avg_mrr: 1, avg_f1: 1, avg_latency_ms: 1 },
            vector: { avg_precision: 1, avg_recall: 1, avg_mrr: 1, avg_f1: 1, avg_latency_ms: 1 },
            hybrid: { avg_precision: 1, avg_recall: 1, avg_mrr: 1, avg_f1: 1, avg_latency_ms: 1 },
            full: { avg_precision: 1, avg_recall: 1, avg_mrr: 1, avg_f1: 1, avg_latency_ms: 1 },
          },
        },
        representatives: [],
      },
    }));

    const result = await handleBenchCommand(
      createContext(['bench', '--json', '-c', 'docs', fixturePath]),
      { run },
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
    expect(result.stdout).toBeDefined();
    const output = JSON.parse(result.stdout ?? '{}') as {
      schema_version: string;
      baseline: string;
      upstream: { results: Array<{ id: string }> };
      current: { results: Array<{ id: string }> };
    };

    expect(output.schema_version).toBe('1');
    expect(output.baseline).toBe('upstream');
    expect(output.upstream.results[0]?.id).toBe('auth-query');
    expect(output.current.results[0]?.id).toBe('auth-query');
  });
});
