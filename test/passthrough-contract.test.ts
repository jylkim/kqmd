import { EventEmitter } from 'node:events';

import { describe, expect, test, vi } from 'vitest';

import { delegatePassthrough } from '../src/passthrough/delegate.js';
import { locateUpstreamBinary } from '../src/passthrough/upstream_locator.js';

describe('passthrough contract', () => {
  test('prefers explicit upstream binary override when provided', () => {
    const resolved = locateUpstreamBinary({
      ...process.env,
      KQMD_UPSTREAM_BIN: '/tmp/qmd-upstream',
    });

    expect(resolved).toEqual({
      path: '/tmp/qmd-upstream',
      source: 'env',
    });
  });

  test('resolves the upstream package bin by default', () => {
    const resolved = locateUpstreamBinary(process.env);

    expect(resolved.source).toBe('package-bin');
    expect(resolved.path).toContain('@tobilu/qmd');
    expect(resolved.path.endsWith('/bin/qmd')).toBe(true);
  });

  test('delegates argv with shell disabled and inherited stdio by default', async () => {
    const spawnImpl = vi.fn((command: string, args: string[], options: object) => {
      const child = new EventEmitter();

      process.nextTick(() => {
        child.emit('close', 17, null);
      });

      return Object.assign(child, {
        command,
        args,
        options,
      });
    });

    const result = await delegatePassthrough(['status'], {
      spawnImpl: spawnImpl as never,
      upstreamBinary: {
        path: '/tmp/upstream-qmd',
        source: 'env',
      },
    });

    expect(result).toEqual({
      binaryPath: '/tmp/upstream-qmd',
      exitCode: 17,
      signal: null,
    });
    expect(spawnImpl).toHaveBeenCalledWith('/tmp/upstream-qmd', ['status'], {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
  });
});
