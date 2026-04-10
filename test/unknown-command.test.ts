import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { runCli } from '../src/cli.js';
import { memoryWriter } from './helpers.js';

describe('unknown command handling', () => {
  test('returns a deterministic error for unsupported commands', async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await runCli(['frobnicate', 'query'], {
      stdout: memoryWriter(stdoutChunks),
      stderr: memoryWriter(stderrChunks),
    });

    expect(exitCode).toBe(1);
    expect(stdoutChunks).toEqual([]);
    expect(stderrChunks.join('')).toContain('Unknown command: frobnicate');
    expect(stderrChunks.join('')).toContain(
      'owned: search, query, update, embed, status, mcp, cleanup',
    );
    expect(stderrChunks.join('')).toContain(
      'passthrough: bench, collection, ls, get, multi-get, skill, context, vsearch, pull',
    );
  });
});

describe('version output', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf-8'),
  );
  const expectedVersion = `kqmd ${packageJson.version} (qmd ${packageJson.dependencies['@tobilu/qmd']})`;

  test('--version outputs kqmd version with upstream reference', async () => {
    const stdoutChunks: string[] = [];

    const exitCode = await runCli(['--version'], {
      stdout: memoryWriter(stdoutChunks),
      stderr: memoryWriter([]),
    });

    expect(exitCode).toBe(0);
    expect(stdoutChunks.join('').trim()).toBe(expectedVersion);
  });

  test('-v outputs kqmd version with upstream reference', async () => {
    const stdoutChunks: string[] = [];

    const exitCode = await runCli(['-v'], {
      stdout: memoryWriter(stdoutChunks),
      stderr: memoryWriter([]),
    });

    expect(exitCode).toBe(0);
    expect(stdoutChunks.join('').trim()).toBe(expectedVersion);
  });
});
