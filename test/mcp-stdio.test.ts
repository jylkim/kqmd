import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, test } from 'vitest';

describe('owned mcp stdio server', () => {
  afterEach(() => {
    // No-op. The transport closes the child process.
  });

  test('handles validation errors without corrupting the stdio protocol stream', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kqmd-mcp-stdio-'));
    mkdirSync(resolve(root, '.cache', 'qmd'), { recursive: true });
    const runtimeBinary = resolveRuntimeBinary();

    const transport = new StdioClientTransport({
      command: runtimeBinary.command,
      args: runtimeBinary.args,
      cwd: process.cwd(),
      env: {
        HOME: root,
        XDG_CACHE_HOME: resolve(root, '.cache'),
      },
      stderr: 'pipe',
    });
    const client = new Client({
      name: 'mcp-stdio-test-client',
      version: '1.0.0',
    });

    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['query', 'status']),
    );

    const invalid = await client.callTool({
      name: 'query',
      arguments: {
        searches: [],
      },
    });
    expect(invalid.isError).toBe(true);

    const status = await client.callTool({
      name: 'status',
      arguments: {},
    });
    expect(status.structuredContent).toMatchObject({
      transport: {
        mcp: {
          running: false,
        },
      },
    });

    await transport.close();
    await client.close();
  });
});

function resolveRuntimeBinary(): { command: string; args: string[] } {
  if (basename(process.execPath).startsWith('bun')) {
    return {
      command: process.execPath,
      args: [resolve(process.cwd(), 'src/cli.ts'), 'mcp'],
    };
  }

  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const output = execFileSync(lookupCommand, ['bun'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const [bunBinary] = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (!bunBinary) {
    throw new Error('Unable to locate bun binary for stdio MCP tests.');
  }

  return {
    command: bunBinary,
    args: [resolve(process.cwd(), 'src/cli.ts'), 'mcp'],
  };
}
