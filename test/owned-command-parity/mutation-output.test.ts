import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { handleEmbedCommand } from '../../src/commands/owned/embed.js';
import { handleUpdateCommand } from '../../src/commands/owned/update.js';
import { createContext, withTrailingNewline } from '../helpers.js';

describe('owned mutation parity output', () => {
  test('matches update success output snapshot', async () => {
    const result = await handleUpdateCommand(createContext(['update']), {
      run: async () => ({
        result: {
          collections: 2,
          indexed: 3,
          updated: 4,
          unchanged: 5,
          removed: 1,
          needsEmbedding: 6,
        },
      }),
    });

    await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
      resolve(
        process.cwd(),
        'test/fixtures/owned-command-parity/mutations/update-success.output.txt',
      ),
    );
  });

  test('matches embed success output snapshot', async () => {
    const result = await handleEmbedCommand(createContext(['embed', '--force']), {
      run: async () => ({
        docsProcessed: 3,
        chunksEmbedded: 12,
        errors: 1,
        durationMs: 3456,
      }),
    });

    await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
      resolve(
        process.cwd(),
        'test/fixtures/owned-command-parity/mutations/embed-success.output.txt',
      ),
    );
  });

  test('rejects de-surfaced update pull flag', async () => {
    const result = await handleUpdateCommand(createContext(['update', '--pull']));

    expect(result).toEqual({
      exitCode: 1,
      stderr: 'Unknown option for `qmd update`: --pull.',
    });
  });
});
