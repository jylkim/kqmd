import { Writable } from 'node:stream';

import { describe, expect, test } from 'vitest';

import { runCli } from '../src/cli.js';

function memoryWriter(chunks: string[]) {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  }) as NodeJS.WriteStream;
}

describe('unknown command handling', () => {
  test('returns a deterministic error for unsupported commands', async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await runCli(['vsearch', 'query'], {
      stdout: memoryWriter(stdoutChunks),
      stderr: memoryWriter(stderrChunks),
    });

    expect(exitCode).toBe(1);
    expect(stdoutChunks).toEqual([]);
    expect(stderrChunks.join('')).toContain('Unknown command: vsearch');
    expect(stderrChunks.join('')).toContain('owned: search, query, update, embed, status');
    expect(stderrChunks.join('')).toContain('passthrough: collection, ls, get, multi-get, mcp');
  });
});
