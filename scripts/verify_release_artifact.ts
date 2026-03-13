import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

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
    throw new Error(`Unable to locate ${command} binary for release artifact checks.`);
  }

  return resolvedPath;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function runAndAssert(command: string, args: string[], options: Parameters<typeof spawnSync>[2]) {
  const result = spawnSync(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        result.stdout ? `stdout:\n${result.stdout}` : undefined,
        result.stderr ? `stderr:\n${result.stderr}` : undefined,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  return result;
}

const root = process.cwd();
const bunBinary = resolveRuntimeBinary('bun', process.env.KQMD_BUN_BIN);
const nodeBinary = resolveRuntimeBinary('node', process.env.KQMD_NODE_BIN);
const tempDir = mkdtempSync(join(tmpdir(), 'kqmd-release-artifact-'));

try {
  const tarballName = execFileSync(bunBinary, ['pm', 'pack', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
  })
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .at(-1);

  assert(tarballName, 'bun pm pack --quiet did not return a tarball filename.');

  const tarballPath = resolve(root, tarballName);
  assert(existsSync(tarballPath), `Packed tarball not found: ${tarballPath}`);

  const tarEntries = execFileSync('tar', ['-tf', tarballPath], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
  })
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  assert(
    tarEntries.some((entry) => entry.startsWith('package/bin/')),
    'Packed tarball is missing package/bin/ contents.',
  );
  assert(
    tarEntries.some((entry) => entry.startsWith('package/dist/')),
    'Packed tarball is missing package/dist/ contents.',
  );
  assert(tarEntries.includes('package/README.md'), 'Packed tarball is missing package/README.md.');
  assert(tarEntries.includes('package/LICENSE'), 'Packed tarball is missing package/LICENSE.');

  writeFileSync(
    resolve(tempDir, 'package.json'),
    JSON.stringify({ name: 'kqmd-artifact-smoke', private: true }, null, 2),
    'utf8',
  );

  execFileSync(bunBinary, ['add', tarballPath], {
    cwd: tempDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const installedBinPath = resolve(tempDir, 'node_modules', 'kqmd', 'bin', 'qmd.js');
  assert(existsSync(installedBinPath), `Installed package bin not found: ${installedBinPath}`);

  const queryHelp = runAndAssert(nodeBinary, [installedBinPath, 'query', '--help'], {
    cwd: tempDir,
    encoding: 'utf8',
    env: process.env,
  });
  assert(
    queryHelp.stdout.includes('--candidate-limit'),
    'Installed query help is missing --candidate-limit.',
  );

  const updateHelp = runAndAssert(nodeBinary, [installedBinPath, 'update', '--help'], {
    cwd: tempDir,
    encoding: 'utf8',
    env: process.env,
  });
  assert(!updateHelp.stdout.includes('--pull'), 'Installed update help still advertises --pull.');

  const fixturePath = resolve(root, 'test/fixtures/upstream-fixture.mjs');
  const wrapperPath = resolve(
    tempDir,
    process.platform === 'win32' ? 'upstream-fixture.cmd' : 'upstream-fixture',
  );

  if (process.platform === 'win32') {
    writeFileSync(wrapperPath, `@echo off\r\n"${nodeBinary}" "${fixturePath}" %*\r\n`, 'utf8');
  } else {
    writeFileSync(wrapperPath, `#!/bin/sh\nexec "${nodeBinary}" "${fixturePath}" "$@"\n`, 'utf8');
    execFileSync('chmod', ['+x', wrapperPath], {
      cwd: tempDir,
      stdio: 'pipe',
    });
  }

  const passthrough = spawnSync(nodeBinary, [installedBinPath, 'collection', 'list'], {
    cwd: tempDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      KQMD_UPSTREAM_BIN: wrapperPath,
      TEST_UPSTREAM_EXIT_CODE: '17',
    },
  });

  if (passthrough.status !== 17) {
    throw new Error(
      [
        'Installed passthrough bin did not preserve the delegated exit code.',
        passthrough.stdout ? `stdout:\n${passthrough.stdout}` : undefined,
        passthrough.stderr ? `stderr:\n${passthrough.stderr}` : undefined,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  assert(
    passthrough.stdout.includes('fixture argv: ["collection","list"]'),
    'Installed passthrough bin did not preserve delegated argv.',
  );

  process.stdout.write(`Release artifact verification passed for ${tarballName}\n`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
