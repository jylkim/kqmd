import type { EmbedResult, QMDStore, UpdateResult } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';
import { handleEmbedCommand } from '../src/commands/owned/embed.js';
import { resetKiwiForTests } from '../src/commands/owned/kiwi_tokenizer.js';
import { handleQueryCommand } from '../src/commands/owned/query.js';
import type { OwnedRuntimeDependencies } from '../src/commands/owned/runtime.js';
import { handleUpdateCommand } from '../src/commands/owned/update.js';
import { KQMD_DEFAULT_EMBED_MODEL_URI } from '../src/config/embedding_policy.js';
import type { CommandExecutionContext } from '../src/types/command.js';

function createContext(argv: string[]): CommandExecutionContext {
  return {
    argv,
    commandArgs: argv.slice(1),
  };
}

function createRuntimeDependencies(
  store: QMDStore,
  options: {
    existingPaths?: string[];
    env?: NodeJS.ProcessEnv;
  } = {},
): OwnedRuntimeDependencies {
  const existingPaths = new Set(options.existingPaths ?? ['/home/tester/.cache/qmd/index.sqlite']);

  return {
    env: options.env ?? {
      HOME: '/home/tester',
    },
    existsSync: (path) => existingPaths.has(path),
    createStore: vi.fn(async () => store),
  };
}

function createMismatchStore(overrides: Partial<QMDStore> = {}): QMDStore {
  const prepare = vi.fn((sql: string) => ({
    get: vi.fn(() => {
      if (sql.includes('store_config')) {
        return { value: undefined };
      }

      if (sql.includes('sqlite_master')) {
        return undefined;
      }

      if (sql.includes('MAX(d.modified_at)')) {
        return {
          count: 1,
          latest_modified_at: '2026-03-12T00:00:00.000Z',
          max_document_id: 1,
        };
      }

      if (sql.includes('COUNT(*) AS count')) {
        return { count: 1 };
      }

      return undefined;
    }),
    all: vi.fn(() => {
      if (sql.includes('content_vectors')) {
        return [{ model: 'embeddinggemma', documents: 1 }];
      }

      if (sql.includes('FROM documents d') && sql.includes('JOIN content c')) {
        return [];
      }

      return [];
    }),
    run: vi.fn(() => ({})),
  }));

  return {
    close: vi.fn(async () => {}),
    dbPath: '/home/tester/.cache/qmd/index.sqlite',
    listCollections: vi.fn(async () => [
      {
        name: 'docs',
        pwd: '/repo/docs',
        glob_pattern: '**/*.md',
        doc_count: 1,
        active_count: 1,
        last_modified: '2026-03-12T00:00:00.000Z',
        includeByDefault: true,
      },
    ]),
    getDefaultCollectionNames: vi.fn(async () => ['docs']),
    search: vi.fn(async () => [
      {
        file: 'qmd://docs/a.md',
        displayPath: 'docs/a.md',
        title: 'A',
        body: 'auth flow summary',
        bestChunk: 'auth flow summary',
        bestChunkPos: 0,
        score: 0.88,
        context: null,
        docid: 'abc123',
      },
    ]),
    getStatus: vi.fn(async () => ({
      totalDocuments: 1,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [],
    })),
    update: vi.fn(async () => ({
      collections: 1,
      indexed: 0,
      updated: 1,
      unchanged: 0,
      removed: 0,
      needsEmbedding: 0,
    })),
    embed: vi.fn(async () => ({
      docsProcessed: 1,
      chunksEmbedded: 3,
      errors: 0,
      durationMs: 10,
    })),
    internal: {
      db: {
        prepare,
        exec: vi.fn(() => {}),
      },
    },
    ...overrides,
  } as unknown as QMDStore;
}

function createCollectionAwareStore(): QMDStore {
  const prepare = vi.fn((sql: string) => ({
    get: vi.fn((...params: (string | number)[]) => {
      if (sql.includes('store_config')) {
        return { value: undefined };
      }

      if (sql.includes('sqlite_master')) {
        return undefined;
      }

      if (sql.includes('COUNT(*) AS count')) {
        return { count: params.includes('docs') ? 1 : 2 };
      }

      return undefined;
    }),
    all: vi.fn((...params: (string | number)[]) => {
      if (sql.includes('content_vectors')) {
        return params.includes('docs')
          ? [{ model: KQMD_DEFAULT_EMBED_MODEL_URI, documents: 1 }]
          : [
              { model: KQMD_DEFAULT_EMBED_MODEL_URI, documents: 1 },
              { model: 'embeddinggemma', documents: 1 },
            ];
      }

      if (sql.includes('FROM documents d') && sql.includes('JOIN content c')) {
        return [];
      }

      return [];
    }),
    run: vi.fn(() => ({})),
  }));

  return {
    close: vi.fn(async () => {}),
    dbPath: '/home/tester/.cache/qmd/index.sqlite',
    listCollections: vi.fn(async () => [
      {
        name: 'docs',
        pwd: '/repo/docs',
        glob_pattern: '**/*.md',
        doc_count: 1,
        active_count: 1,
        last_modified: '2026-03-12T00:00:00.000Z',
        includeByDefault: true,
      },
      {
        name: 'notes',
        pwd: '/repo/notes',
        glob_pattern: '**/*.md',
        doc_count: 1,
        active_count: 1,
        last_modified: '2026-03-12T00:00:00.000Z',
        includeByDefault: false,
      },
    ]),
    getDefaultCollectionNames: vi.fn(async () => ['docs']),
    search: vi.fn(async () => [
      {
        file: 'qmd://docs/a.md',
        displayPath: 'docs/a.md',
        title: 'A',
        body: 'auth flow summary',
        bestChunk: 'auth flow summary',
        bestChunkPos: 0,
        score: 0.88,
        context: null,
        docid: 'abc123',
      },
    ]),
    getStatus: vi.fn(async () => ({
      totalDocuments: 2,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [],
    })),
    internal: {
      db: {
        prepare,
        exec: vi.fn(() => {}),
      },
    },
  } as unknown as QMDStore;
}

describe('owned embedding-aware behavior', () => {
  test('query warns on mismatch via stderr while preserving stdout', async () => {
    const result = await handleQueryCommand(createContext(['query', 'auth flow']), {
      runtimeDependencies: createRuntimeDependencies(createMismatchStore()),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('docs/a.md');
    expect(result.stderr).toContain('Embedding model mismatch detected.');
    expect(result.stderr).toContain("Run 'qmd embed --force'");
  });

  test('query does not warn for unrelated collection mismatches', async () => {
    const result = await handleQueryCommand(createContext(['query', '-c', 'docs', 'auth flow']), {
      runtimeDependencies: createRuntimeDependencies(createCollectionAwareStore()),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBeUndefined();
  });

  test('embed blocks mismatch without force', async () => {
    const embed = vi.fn(
      async (): Promise<EmbedResult> => ({
        docsProcessed: 1,
        chunksEmbedded: 2,
        errors: 0,
        durationMs: 1,
      }),
    );

    const result = await handleEmbedCommand(createContext(['embed']), {
      runtimeDependencies: createRuntimeDependencies(
        createMismatchStore({
          embed,
        }),
      ),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Stored embeddings do not match');
    expect(result.stderr).toContain("Run 'qmd embed --force'");
    expect(embed).not.toHaveBeenCalled();
  });

  test('embed force passes the effective model explicitly', async () => {
    const embed = vi.fn(
      async (): Promise<EmbedResult> => ({
        docsProcessed: 1,
        chunksEmbedded: 2,
        errors: 0,
        durationMs: 1,
      }),
    );

    const result = await handleEmbedCommand(createContext(['embed', '--force']), {
      runtimeDependencies: createRuntimeDependencies(
        createMismatchStore({
          embed,
        }),
      ),
    });

    expect(result.exitCode).toBe(0);
    expect(embed).toHaveBeenCalledWith({
      force: true,
      model: KQMD_DEFAULT_EMBED_MODEL_URI,
    });
  });

  test('update prefers force guidance when mismatch exists', async () => {
    const update = vi.fn(
      async (): Promise<UpdateResult> => ({
        collections: 1,
        indexed: 0,
        updated: 1,
        unchanged: 0,
        removed: 0,
        needsEmbedding: 0,
      }),
    );

    const result = await handleUpdateCommand(createContext(['update']), {
      runtimeDependencies: createRuntimeDependencies(
        createMismatchStore({
          update,
        }),
        {
          existingPaths: [
            '/home/tester/.cache/qmd/index.sqlite',
            '/home/tester/.config/qmd/index.yml',
          ],
        },
      ),
      searchIndexDependencies: {
        kiwiDependencies: {
          loadModelFiles: async () => ({}),
          createBuilder: (async () => ({
            build: async () =>
              ({
                ready: () => true,
                isTypoTolerant: () => false,
                analyze: () => ({ tokens: [], score: 0 }),
                analyzeTopN: () => [],
                tokenize: () => [],
                tokenizeTopN: () => [],
                splitIntoSents: () => ({ spans: [], tokenResult: null }),
                joinSent: () => ({ str: '', ranges: null }),
                getCutOffThreshold: () => 0,
                setCutOffThreshold: () => {},
                getUnkScoreBias: () => 0,
                setUnkScoreBias: () => {},
                getUnkScoreScale: () => 0,
                setUnkScoreScale: () => {},
                getMaxUnkFormSize: () => 0,
                setMaxUnkFormSize: () => {},
                getSpaceTolerance: () => 0,
                setSpaceTolerance: () => {},
                getSpacePenalty: () => 0,
                setSpacePenalty: () => {},
                getTypoCostWeight: () => 0,
                setTypoCostWeight: () => {},
                getIntegrateAllomorphic: () => true,
                setIntegrateAllomorphic: () => {},
                createMorphemeSet: () => 0,
                destroyMorphemeSet: () => {},
              }) as never,
          })) as never,
        },
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Run 'qmd embed --force'");
  });

  test('update fails before store.update when Kiwi bootstrap preflight fails', async () => {
    resetKiwiForTests();

    const update = vi.fn(
      async (): Promise<UpdateResult> => ({
        collections: 1,
        indexed: 0,
        updated: 1,
        unchanged: 0,
        removed: 0,
        needsEmbedding: 0,
      }),
    );

    const result = await handleUpdateCommand(createContext(['update']), {
      runtimeDependencies: createRuntimeDependencies(
        createMismatchStore({
          update,
        }),
        {
          existingPaths: [
            '/home/tester/.cache/qmd/index.sqlite',
            '/home/tester/.config/qmd/index.yml',
          ],
        },
      ),
      searchIndexDependencies: {
        kiwiDependencies: {
          createBuilder: vi.fn(async () => {
            throw new Error('kiwi bootstrap failed');
          }),
        },
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('kiwi bootstrap failed');
    expect(update).not.toHaveBeenCalled();

    resetKiwiForTests();
  });

  test('update sanitizes symlink cache failures without exposing local paths', async () => {
    resetKiwiForTests();

    const update = vi.fn(
      async (): Promise<UpdateResult> => ({
        collections: 1,
        indexed: 0,
        updated: 1,
        unchanged: 0,
        removed: 0,
        needsEmbedding: 0,
      }),
    );

    const result = await handleUpdateCommand(createContext(['update']), {
      runtimeDependencies: createRuntimeDependencies(
        createMismatchStore({
          update,
        }),
        {
          existingPaths: [
            '/home/tester/.cache/qmd/index.sqlite',
            '/home/tester/.config/qmd/index.yml',
          ],
        },
      ),
      searchIndexDependencies: {
        kiwiDependencies: {
          lstat: (async () => ({
            isSymbolicLink: () => true,
          })) as unknown as typeof import('node:fs/promises').lstat,
          createBuilder: (async () => ({
            build: async () =>
              ({
                ready: () => true,
                tokenize: () => [],
              }) as never,
          })) as never,
        },
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Kiwi model path must not be a symlink.');
    expect(result.stderr).not.toContain('/home/tester');
    expect(update).not.toHaveBeenCalled();

    resetKiwiForTests();
  });
});
