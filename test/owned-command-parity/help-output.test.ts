import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { runCli } from '../../src/cli.js';

function createIoCapture() {
  let stdout = '';
  let stderr = '';

  return {
    io: {
      stdout: {
        write: (text: string) => {
          stdout += text;
          return true;
        },
      } as unknown as NodeJS.WriteStream,
      stderr: {
        write: (text: string) => {
          stderr += text;
          return true;
        },
      } as unknown as NodeJS.WriteStream,
    },
    read: () => ({ stdout, stderr }),
  };
}

describe('owned command help output', () => {
  test('matches query help output and keeps candidate-limit visible', async () => {
    const capture = createIoCapture();

    const exitCode = await runCli(['query', '--help'], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read().stderr).toBe('');
    await expect(capture.read().stdout).toMatchFileSnapshot(
      resolve(process.cwd(), 'test/fixtures/owned-command-parity/help/query-help.output.txt'),
    );
  });

  test('matches update help output and de-surfaces pull', async () => {
    const capture = createIoCapture();

    const exitCode = await runCli(['update', '--help'], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read().stderr).toBe('');
    await expect(capture.read().stdout).toMatchFileSnapshot(
      resolve(process.cwd(), 'test/fixtures/owned-command-parity/help/update-help.output.txt'),
    );
  });

  test('matches help alias output for owned commands', async () => {
    const capture = createIoCapture();

    const exitCode = await runCli(['help', 'update'], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.read().stderr).toBe('');
    await expect(capture.read().stdout).toMatchFileSnapshot(
      resolve(process.cwd(), 'test/fixtures/owned-command-parity/help/update-help.output.txt'),
    );
  });
});
