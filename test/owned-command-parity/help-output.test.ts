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

async function expectHelpOutput(argv: string[], fixturePath: string) {
  const capture = createIoCapture();
  const exitCode = await runCli(argv, capture.io);

  expect(exitCode).toBe(0);
  expect(capture.read().stderr).toBe('');
  await expect(capture.read().stdout).toMatchFileSnapshot(resolve(process.cwd(), fixturePath));
}

async function readHelpOutput(argv: string[]) {
  const capture = createIoCapture();
  const exitCode = await runCli(argv, capture.io);

  expect(exitCode).toBe(0);
  expect(capture.read().stderr).toBe('');
  return capture.read().stdout;
}

describe('owned command help output', () => {
  test('matches canonical query help output', async () => {
    await expectHelpOutput(
      ['query', '--help'],
      'test/fixtures/owned-command-parity/help/query-help.output.txt',
    );
  });

  test('matches canonical update help output and de-surfaces pull', async () => {
    await expectHelpOutput(
      ['update', '--help'],
      'test/fixtures/owned-command-parity/help/update-help.output.txt',
    );
  });

  test('matches canonical mcp help output and advertises local HTTP surface', async () => {
    await expectHelpOutput(
      ['mcp', '--help'],
      'test/fixtures/owned-command-parity/help/mcp-help.output.txt',
    );
  });

  test('matches canonical bench help output', async () => {
    await expectHelpOutput(
      ['bench', '--help'],
      'test/fixtures/owned-command-parity/help/bench-help.output.txt',
    );
  });

  test('keeps query help byte-identical across owned help entrypoints', async () => {
    const canonical = await readHelpOutput(['query', '--help']);

    await expect(readHelpOutput(['help', 'query'])).resolves.toBe(canonical);
    await expect(readHelpOutput(['--help', 'query'])).resolves.toBe(canonical);
    await expect(readHelpOutput(['help', 'query', '--help'])).resolves.toBe(canonical);
    await expect(readHelpOutput(['help', 'query', '-h'])).resolves.toBe(canonical);
  });

  test('keeps update help byte-identical across owned help entrypoints', async () => {
    const canonical = await readHelpOutput(['update', '--help']);

    await expect(readHelpOutput(['help', 'update'])).resolves.toBe(canonical);
    await expect(readHelpOutput(['help', 'update', '--help'])).resolves.toBe(canonical);
    await expect(readHelpOutput(['help', 'update', '-h'])).resolves.toBe(canonical);
  });

  test('keeps mcp help byte-identical across owned help entrypoints', async () => {
    const canonical = await readHelpOutput(['mcp', '--help']);

    await expect(readHelpOutput(['help', 'mcp'])).resolves.toBe(canonical);
    await expect(readHelpOutput(['help', 'mcp', '--help'])).resolves.toBe(canonical);
    await expect(readHelpOutput(['help', 'mcp', '-h'])).resolves.toBe(canonical);
  });

  test('keeps embed help byte-identical across owned help entrypoints', async () => {
    const canonical = await readHelpOutput(['embed', '--help']);

    await expect(readHelpOutput(['help', 'embed'])).resolves.toBe(canonical);
    await expect(readHelpOutput(['help', 'embed', '--help'])).resolves.toBe(canonical);
    await expect(readHelpOutput(['help', 'embed', '-h'])).resolves.toBe(canonical);
  });

  test('keeps bench help byte-identical across owned help entrypoints', async () => {
    const canonical = await readHelpOutput(['bench', '--help']);

    await expect(readHelpOutput(['help', 'bench'])).resolves.toBe(canonical);
    await expect(readHelpOutput(['help', 'bench', '--help'])).resolves.toBe(canonical);
    await expect(readHelpOutput(['help', 'bench', '-h'])).resolves.toBe(canonical);
  });
});
