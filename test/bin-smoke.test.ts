import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, test } from 'vitest';

describe('bin smoke test', () => {
  const fixturePath = resolve(process.cwd(), 'test/fixtures/upstream-fixture.mjs');
  const binPath = resolve(process.cwd(), 'bin/qmd.js');

  beforeAll(() => {
    chmodSync(fixturePath, 0o755);
    execFileSync('npm', ['run', 'build'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
  });

  test('propagates passthrough argv and exit code through the published bin', () => {
    const result = spawnSync(binPath, ['status', '--json'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KQMD_UPSTREAM_BIN: fixturePath,
        TEST_UPSTREAM_EXIT_CODE: '17',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(17);
    expect(result.stdout).toContain('fixture argv: ["status","--json"]');
  });
});
