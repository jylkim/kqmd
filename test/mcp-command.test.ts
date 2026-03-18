import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { handleMcpCommand } from '../src/commands/owned/mcp.js';
import { createContext, memoryWriter } from './helpers.js';

describe('owned mcp command', () => {
  test('shows owned mcp help output', async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await runCli(['mcp', '--help'], {
      stdout: memoryWriter(stdoutChunks),
      stderr: memoryWriter(stderrChunks),
    });

    expect(exitCode).toBe(0);
    expect(stderrChunks).toEqual([]);
    expect(stdoutChunks.join('')).toContain('Usage: qmd mcp [options]');
    expect(stdoutChunks.join('')).toContain('qmd mcp --http --daemon');
  });

  test('stop is a no-op when the daemon is not running', async () => {
    const result = await handleMcpCommand(createContext(['mcp', 'stop']), {
      env: {
        HOME: '/tmp/kqmd-mcp-test-home',
        XDG_CACHE_HOME: '/tmp/kqmd-mcp-test-cache',
      },
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'Not running (no PID file).',
    });
  });

  test('daemon start fails fast when the port is already in use', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kqmd-mcp-daemon-'));
    const cacheHome = resolve(root, '.cache');
    mkdirSync(resolve(cacheHome, 'qmd'), { recursive: true });

    const occupied = createNetServer();
    await new Promise<void>((resolveReady, reject) => {
      occupied.once('error', reject);
      occupied.listen(0, '127.0.0.1', () => resolveReady());
    });
    const address = occupied.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to determine occupied test port.');
    }

    const previousHome = process.env.HOME;
    const previousCache = process.env.XDG_CACHE_HOME;
    process.env.HOME = root;
    process.env.XDG_CACHE_HOME = cacheHome;

    try {
      const result = await handleMcpCommand(
        createContext(['mcp', '--http', '--daemon', '--port', String(address.port)]),
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('already in use');
    } finally {
      await new Promise<void>((resolveClosed) => occupied.close(() => resolveClosed()));
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousCache === undefined) {
        delete process.env.XDG_CACHE_HOME;
      } else {
        process.env.XDG_CACHE_HOME = previousCache;
      }
    }
  });

  test('passes named-index startup options through to stdio mode', async () => {
    const startOwnedMcpServer = vi.fn(async () => {});

    const result = await handleMcpCommand(createContext(['--index', 'work', 'mcp'], 'work'), {
      env: {
        HOME: '/home/tester',
      },
      startOwnedMcpServer,
    });

    expect(result).toEqual({ exitCode: 0, directIO: true });
    expect(startOwnedMcpServer).toHaveBeenCalledWith({
      env: {
        HOME: '/home/tester',
      },
      startup: {
        indexName: 'work',
        dbPath: '/home/tester/.cache/qmd/work.sqlite',
      },
    });
  });

  test('passes config bootstrap options through to http mode when only config exists', async () => {
    const startOwnedMcpHttpServer = vi.fn(async () => ({
      httpServer: {} as never,
      stop: async () => {},
    }));

    const result = await handleMcpCommand(
      createContext(['--index', 'docs', 'mcp', '--http'], 'docs'),
      {
        env: {
          HOME: '/home/tester',
        },
        existsSync: (path) => path === '/home/tester/.config/qmd/docs.yml',
        startOwnedMcpHttpServer,
      },
    );

    expect(result).toEqual({ exitCode: 0, directIO: true });
    expect(startOwnedMcpHttpServer).toHaveBeenCalledWith(8181, {
      env: {
        HOME: '/home/tester',
      },
      startup: {
        indexName: 'docs',
        dbPath: '/home/tester/.cache/qmd/docs.sqlite',
        configPath: '/home/tester/.config/qmd/docs.yml',
      },
    });
  });
});
