import { resolve } from 'node:path';

import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';
import type { OwnedRuntimeDependencies } from '../src/commands/owned/runtime.js';
import { handleStatusCommand } from '../src/commands/owned/status.js';
import { KQMD_DEFAULT_EMBED_MODEL_URI } from '../src/config/embedding_policy.js';
import type { CommandExecutionContext } from '../src/types/command.js';

function createContext(argv: string[]): CommandExecutionContext {
  return {
    argv,
    commandArgs: argv.slice(1),
  };
}

function withTrailingNewline(stdout: string | undefined): string {
  return stdout ? `${stdout}\n` : '';
}

function createRuntimeDependencies(store: QMDStore): OwnedRuntimeDependencies {
  const existingPaths = new Set(['/home/tester/.cache/qmd/index.sqlite']);

  return {
    env: {
      HOME: '/home/tester',
    },
    existsSync: (path) => existingPaths.has(path),
    createStore: vi.fn(async () => store),
  };
}

function createFakeStatusStore(): QMDStore {
  return {
    close: vi.fn(async () => {}),
    dbPath: '/home/tester/.cache/qmd/index.sqlite',
    getStatus: vi.fn(async () => ({
      totalDocuments: 3,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [
        {
          name: 'docs',
          path: '/repo/docs',
          pattern: '**/*.md',
          documents: 3,
          lastUpdated: '2026-03-12T00:00:00.000Z',
        },
      ],
    })),
    internal: {
      db: {
        prepare: vi.fn(() => ({
          all: vi.fn(() => [{ model: 'embeddinggemma', documents: 3 }]),
        })),
      },
    },
  } as unknown as QMDStore;
}

describe('owned status command', () => {
  test('matches mismatch output snapshot', async () => {
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';

    try {
      const result = await handleStatusCommand(createContext(['status']), {
        runtimeDependencies: createRuntimeDependencies(createFakeStatusStore()),
      });

      expect(result.stderr).toBeUndefined();
      await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
        resolve(process.cwd(), 'test/fixtures/status/status-mismatch.output.txt'),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previous;
      }
    }
  });

  test('rejects command-specific flags', async () => {
    const result = await handleStatusCommand(createContext(['status', '--json']), {
      runtimeDependencies: createRuntimeDependencies(createFakeStatusStore()),
    });

    expect(result).toEqual({
      exitCode: 1,
      stderr: 'The `status` command does not accept command-specific flags.',
    });
  });

  test('uses the default effective model when rendering status', async () => {
    const result = await handleStatusCommand(createContext(['status']), {
      runtimeDependencies: createRuntimeDependencies(createFakeStatusStore()),
    });

    expect(result.stdout).toContain(KQMD_DEFAULT_EMBED_MODEL_URI);
  });
});
