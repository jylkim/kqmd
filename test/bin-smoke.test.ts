import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

describe('bin smoke test', () => {
  const fixturePath = resolve(process.cwd(), 'test/fixtures/upstream-fixture.mjs');
  const binPath = resolve(process.cwd(), 'bin/qmd.js');
  const tempDir = mkdtempSync(join(tmpdir(), 'kqmd-smoke-'));
  const wrapperPath = resolve(
    tempDir,
    process.platform === 'win32' ? 'upstream-fixture.cmd' : 'upstream-fixture',
  );

  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });

    if (process.platform === 'win32') {
      writeFileSync(
        wrapperPath,
        `@echo off\r\n"${process.execPath}" "${fixturePath}" %*\r\n`,
        'utf8',
      );
    } else {
      writeFileSync(
        wrapperPath,
        `#!/bin/sh\nexec "${process.execPath}" "${fixturePath}" "$@"\n`,
        'utf8',
      );
      execFileSync('chmod', ['+x', wrapperPath], {
        cwd: process.cwd(),
        stdio: 'pipe',
      });
    }
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('propagates passthrough argv and exit code through the published bin', () => {
    const result = spawnSync(process.execPath, [binPath, 'status', '--json'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KQMD_UPSTREAM_BIN: wrapperPath,
        TEST_UPSTREAM_EXIT_CODE: '17',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(17);
    expect(result.stdout).toContain('fixture argv: ["status","--json"]');
  });
});
