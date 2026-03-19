import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

describe('bin smoke test', () => {
  const fixturePath = resolve(process.cwd(), 'test/fixtures/upstream-fixture.mjs');
  const binPath = resolve(process.cwd(), 'bin/qmd.js');
  const tempDir = mkdtempSync(join(tmpdir(), 'kqmd-smoke-'));
  const wrapperPath = resolve(
    tempDir,
    process.platform === 'win32' ? 'upstream-fixture.cmd' : 'upstream-fixture',
  );
  const bunBinary = resolveRuntimeBinary('bun', process.env.KQMD_BUN_BIN);
  const nodeBinary = resolveRuntimeBinary('node', process.env.KQMD_NODE_BIN);

  beforeAll(() => {
    execFileSync(bunBinary, ['run', 'build'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });

    writeUpstreamWrapper(fixturePath, wrapperPath, nodeBinary);
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('propagates passthrough argv and exit code through the published bin', () => {
    const result = spawnSync(nodeBinary, [binPath, 'collection', 'list'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KQMD_UPSTREAM_BIN: wrapperPath,
        TEST_UPSTREAM_EXIT_CODE: '17',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(17);
    expect(result.stdout).toContain('fixture argv: ["collection","list"]');
  }, 60_000);

  test('keeps bare help as an upstream passthrough entrypoint', () => {
    const result = spawnSync(nodeBinary, [binPath, 'help'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KQMD_UPSTREAM_BIN: wrapperPath,
        TEST_UPSTREAM_EXIT_CODE: '19',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(19);
    expect(result.stdout).toContain('fixture argv: ["help"]');
  }, 60_000);

  test('flushes large piped passthrough output through the published bin', () => {
    const largeFixturePath = resolve(tempDir, 'large-upstream-fixture.mjs');
    const largeWrapperPath = resolve(
      tempDir,
      process.platform === 'win32' ? 'large-upstream-fixture.cmd' : 'large-upstream-fixture',
    );

    writeFileSync(
      largeFixturePath,
      `#!/usr/bin/env node
process.stdout.write(\`fixture argv: \${JSON.stringify(process.argv.slice(2))}\\n\`);
process.stdout.write('x'.repeat(256 * 1024));
process.stdout.write('\\nfixture complete\\n');
process.exitCode = Number(process.env.TEST_UPSTREAM_EXIT_CODE ?? '0');
`,
      'utf8',
    );
    writeUpstreamWrapper(largeFixturePath, largeWrapperPath, nodeBinary);

    const result = spawnSync(nodeBinary, [binPath, 'collection', 'list'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KQMD_UPSTREAM_BIN: largeWrapperPath,
        TEST_UPSTREAM_EXIT_CODE: '23',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(23);
    expect(result.stdout).toContain('fixture argv: ["collection","list"]');
    expect(result.stdout).toContain('fixture complete');
    expect(result.stdout.length).toBeGreaterThan(256 * 1024);
  }, 60_000);
});

function resolveRuntimeBinary(command: 'bun' | 'node', override?: string): string {
  if (override) {
    return override;
  }

  if (basename(process.execPath).startsWith(command)) {
    return process.execPath;
  }

  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const output = execFileSync(lookupCommand, [command], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const [resolvedPath] = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (!resolvedPath) {
    throw new Error(`Unable to locate ${command} binary for smoke tests.`);
  }

  return resolvedPath;
}

function writeUpstreamWrapper(scriptPath: string, wrapperPath: string, nodeBinary: string): void {
  if (process.platform === 'win32') {
    writeFileSync(wrapperPath, `@echo off\r\n"${nodeBinary}" "${scriptPath}" %*\r\n`, 'utf8');
    return;
  }

  writeFileSync(wrapperPath, `#!/bin/sh\nexec "${nodeBinary}" "${scriptPath}" "$@"\n`, 'utf8');
  execFileSync('chmod', ['+x', wrapperPath], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
}
