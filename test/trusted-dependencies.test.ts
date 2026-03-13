import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

import { describe, expect, test } from 'vitest';

describe('trusted dependency drift', () => {
  test('has no untrusted dependencies with lifecycle scripts', () => {
    const output = execFileSync(resolveBunBinary(process.env.KQMD_BUN_BIN), ['pm', 'untrusted'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
    });

    const untrustedPackages = output
      .split(/\r?\n/)
      .filter((line) => /^(?:\.\/|\.\\)node_modules[\\/]/.test(line.trim()));

    expect(untrustedPackages).toEqual([]);
  });
});

function resolveBunBinary(override?: string): string {
  if (override) {
    return override;
  }

  if (basename(process.execPath).startsWith('bun')) {
    return process.execPath;
  }

  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const output = execFileSync(lookupCommand, ['bun'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const [resolvedPath] = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (!resolvedPath) {
    throw new Error('Unable to locate Bun binary for trusted dependency checks.');
  }

  return resolvedPath;
}
