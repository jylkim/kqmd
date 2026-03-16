import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  ensureRegularPath,
  isExpectedMcpProcess,
  readMcpDaemonState,
  UnsafeDaemonPathError,
} from '../src/mcp/daemon_state.js';

describe('mcp daemon state', () => {
  test('rejects symlinked daemon paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'kqmd-daemon-'));
    const target = resolve(root, 'target.pid');
    const link = resolve(root, 'link.pid');
    writeFileSync(target, '123', 'utf8');
    symlinkSync(target, link);

    expect(() => ensureRegularPath(link)).toThrow(UnsafeDaemonPathError);
  });

  test('returns advisory for unsafe daemon paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'kqmd-daemon-'));
    const cacheHome = resolve(root, '.cache');
    const realCache = resolve(root, 'real-cache');
    const qmdCacheLink = resolve(cacheHome, 'qmd');
    const pidPath = resolve(qmdCacheLink, 'mcp.pid');
    const logPath = resolve(qmdCacheLink, 'mcp.log');

    mkdirSync(realCache, { recursive: true });
    mkdirSync(cacheHome, { recursive: true });
    symlinkSync(realCache, qmdCacheLink, 'dir');
    writeFileSync(resolve(realCache, 'mcp.pid'), '123', 'utf8');
    writeFileSync(resolve(realCache, 'mcp.log'), '', 'utf8');

    const state = readMcpDaemonState({
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
    });

    expect(state.running).toBe(false);
    expect(state.advisory).toContain('Refusing to use symbolic link path');
    expect(state.pidPath).toBe(pidPath);
    expect(state.logPath).toBe(logPath);
  });

  test('requires expected mcp process shape before stopping', () => {
    const result = isExpectedMcpProcess(
      123,
      '/tmp/bin/qmd.js',
      (() => '/usr/bin/node /tmp/bin/qmd.js mcp --http --port 8181') as never,
    );

    expect(result).toBe(true);
  });

  test('rejects unrelated process shapes', () => {
    const result = isExpectedMcpProcess(
      123,
      '/tmp/bin/qmd.js',
      (() => '/usr/bin/python worker.py') as never,
    );

    expect(result).toBe(false);
  });
});
