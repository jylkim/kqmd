import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';

import { handleQueryCommand } from '../src/commands/owned/query.js';
import { createContext, createRuntimeDependencies } from './helpers.js';

function createCollectionStore(): QMDStore {
  return {
    close: vi.fn(async () => {}),
    listCollections: vi.fn(async () => [{ name: 'docs' }, { name: 'notes' }]),
    getDefaultCollectionNames: vi.fn(async () => ['docs']),
    searchLex: vi.fn(async () => []),
    search: vi.fn(async () => []),
    getStatus: vi.fn(async () => ({
      totalDocuments: 2,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [],
    })),
    internal: {
      db: {
        prepare: vi.fn((sql: string) => ({
          all: vi.fn(() => {
            if (sql.includes('content_vectors')) {
              return [{ model: 'embeddinggemma', documents: 2 }];
            }

            return [];
          }),
          get: vi.fn(() => {
            if (sql.includes('COUNT(*) AS count')) {
              return { count: 2 };
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

describe('owned query command', () => {
  test('rejects candidate-limit on plain queries with multiple collection filters', async () => {
    const result = await handleQueryCommand(
      createContext(['query', '--candidate-limit', '10', '-c', 'docs', '-c', 'notes', 'auth flow']),
      {
        runtimeDependencies: createRuntimeDependencies(createCollectionStore()),
      },
    );

    expect(result).toEqual({
      exitCode: 1,
      stderr: 'The `--candidate-limit` option currently supports at most one collection filter.',
    });
  });

  test('rejects oversized candidate-limit on mixed technical plain queries', async () => {
    const result = await handleQueryCommand(
      createContext(['query', '--candidate-limit', '80', '지속 learning']),
      {
        runtimeDependencies: createRuntimeDependencies(createCollectionStore()),
      },
    );

    expect(result).toEqual({
      exitCode: 1,
      stderr:
        'Mixed technical plain queries support `--candidate-limit` up to 50 to keep rerank cost bounded.',
    });
  });

  test('accepts oversized candidate-limit on general english plain queries', async () => {
    const run = vi.fn(async () => ({
      rows: [],
    }));

    const result = await handleQueryCommand(
      createContext(['query', '--json', '--candidate-limit', '80', "what's new"]),
      {
        run,
      },
    );

    expect(run).toHaveBeenCalled();
    expect(result).toEqual({
      exitCode: 0,
      stdout: '[]',
    });
  });

  test('passes explicit rerank disable and chunk strategy through parsed query input', async () => {
    const run = vi.fn(async () => ({
      rows: [],
    }));

    const result = await handleQueryCommand(
      createContext([
        'query',
        '--json',
        '--no-rerank',
        '--chunk-strategy',
        'regex',
        '문서 업로드 파싱 순서는 어떻게 동작해?',
      ]),
      {
        run,
      },
    );

    expect(run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: '문서 업로드 파싱 순서는 어떻게 동작해?',
        displayQuery: '문서 업로드 파싱 순서는 어떻게 동작해?',
        queryMode: 'plain',
        disableRerank: true,
        chunkStrategy: 'regex',
      }),
      undefined,
    );
    expect(result).toEqual({
      exitCode: 0,
      stdout: '[]',
    });
  });
});
