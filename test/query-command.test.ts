import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';

import { handleQueryCommand } from '../src/commands/owned/query.js';
import type { OwnedRuntimeDependencies } from '../src/commands/owned/runtime.js';
import type { CommandExecutionContext } from '../src/types/command.js';

function createContext(argv: string[]): CommandExecutionContext {
  return {
    argv,
    commandArgs: argv.slice(1),
  };
}

function createRuntimeDependencies(store: QMDStore): OwnedRuntimeDependencies {
  return {
    env: {
      HOME: '/home/tester',
    },
    existsSync: (path) => path === '/home/tester/.cache/qmd/index.sqlite',
    createStore: vi.fn(async () => store),
  };
}

function createCollectionStore(): QMDStore {
  return {
    close: vi.fn(async () => {}),
    listCollections: vi.fn(async () => [{ name: 'docs' }, { name: 'notes' }]),
    getDefaultCollectionNames: vi.fn(async () => ['docs']),
    search: vi.fn(async () => []),
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
});
