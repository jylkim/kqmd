import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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

type PackageJson = {
  version?: string;
  dependencies?: Record<string, string>;
};

function readVersionStringFromPackageMetadata(packageJsonPath: string): string {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson;
  const kqmdVersion = packageJson.version;
  const upstreamVersion = packageJson.dependencies?.['@tobilu/qmd'];

  assert(kqmdVersion, `Package metadata is missing version: ${packageJsonPath}`);
  assert(
    upstreamVersion,
    `Package metadata is missing @tobilu/qmd dependency version: ${packageJsonPath}`,
  );

  return `kqmd ${kqmdVersion} (qmd ${upstreamVersion})`;
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

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate a free port for release artifact checks.'));
        return;
      }

      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(url: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }

      lastError = new Error(`Unexpected health status: ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(100);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Timed out waiting for MCP health endpoint.');
}

async function closeQuietly(closeFn: () => Promise<void>): Promise<void> {
  try {
    await closeFn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Connection closed|transport is not connected|not connected/i.test(message)) {
      throw error;
    }
  }
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
  const installedPackageJsonPath = resolve(tempDir, 'node_modules', 'kqmd', 'package.json');
  assert(
    existsSync(installedPackageJsonPath),
    `Installed package metadata not found: ${installedPackageJsonPath}`,
  );
  const expectedVersion = readVersionStringFromPackageMetadata(installedPackageJsonPath);

  const packageEnv = {
    ...process.env,
    HOME: tempDir,
    XDG_CACHE_HOME: resolve(tempDir, '.cache'),
  };
  mkdirSync(resolve(packageEnv.XDG_CACHE_HOME, 'qmd'), { recursive: true });

  const version = runAndAssert(nodeBinary, [installedBinPath, '--version'], {
    cwd: tempDir,
    encoding: 'utf8',
    env: packageEnv,
  });
  assert(
    version.stdout.trim() === expectedVersion,
    `Installed version output did not match package metadata.\nExpected: ${expectedVersion}\nReceived: ${version.stdout.trim()}`,
  );

  const queryHelp = runAndAssert(nodeBinary, [installedBinPath, 'query', '--help'], {
    cwd: tempDir,
    encoding: 'utf8',
    env: packageEnv,
  });
  assert(
    queryHelp.stdout.includes('--candidate-limit'),
    'Installed query help is missing --candidate-limit.',
  );
  assert(queryHelp.stdout.includes('--no-rerank'), 'Installed query help is missing --no-rerank.');
  assert(
    queryHelp.stdout.includes('--chunk-strategy'),
    'Installed query help is missing --chunk-strategy.',
  );

  const benchHelp = runAndAssert(nodeBinary, [installedBinPath, 'bench', '--help'], {
    cwd: tempDir,
    encoding: 'utf8',
    env: packageEnv,
  });
  assert(
    benchHelp.stdout.includes('qmd bench <fixture.json>'),
    'Installed bench help is missing the bench command surface.',
  );

  const updateHelp = runAndAssert(nodeBinary, [installedBinPath, 'update', '--help'], {
    cwd: tempDir,
    encoding: 'utf8',
    env: packageEnv,
  });
  assert(!updateHelp.stdout.includes('--pull'), 'Installed update help still advertises --pull.');

  const stdioClient = new Client({
    name: 'artifact-stdio-client',
    version: '1.0.0',
  });
  const stdioTransport = new StdioClientTransport({
    command: nodeBinary,
    args: [installedBinPath, 'mcp'],
    cwd: tempDir,
    env: packageEnv,
    stderr: 'pipe',
  });
  await stdioClient.connect(stdioTransport);
  const stdioTools = await stdioClient.listTools();
  assert(
    stdioTools.tools.some((tool) => tool.name === 'query'),
    'Installed stdio MCP server is missing the query tool.',
  );
  const stdioQueryTool = stdioTools.tools.find((tool) => tool.name === 'query');
  assert(stdioQueryTool, 'Installed stdio MCP server is missing the query tool definition.');
  assert(
    Object.prototype.hasOwnProperty.call(
      (stdioQueryTool.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
      'rerank',
    ),
    'Installed stdio MCP query schema is missing the rerank field.',
  );
  await closeQuietly(() => stdioClient.close());
  await closeQuietly(() => stdioTransport.close());

  const port = await getFreePort();
  const daemonStart = runAndAssert(
    nodeBinary,
    [installedBinPath, 'mcp', '--http', '--daemon', '--port', String(port)],
    {
      cwd: tempDir,
      encoding: 'utf8',
      env: packageEnv,
    },
  );
  assert(
    daemonStart.stdout.includes(`http://127.0.0.1:${port}/mcp`),
    'Installed MCP daemon did not report the expected HTTP endpoint.',
  );

  await waitForHealth(`http://127.0.0.1:${port}/health`);

  const httpClient = new Client({
    name: 'artifact-http-client',
    version: '1.0.0',
  });
  const httpTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  await httpClient.connect(httpTransport);
  const httpTools = await httpClient.listTools();
  assert(
    httpTools.tools.some((tool) => tool.name === 'status'),
    'Installed HTTP MCP server is missing the status tool.',
  );
  const httpQueryTool = httpTools.tools.find((tool) => tool.name === 'query');
  assert(httpQueryTool, 'Installed HTTP MCP server is missing the query tool definition.');
  assert(
    Object.prototype.hasOwnProperty.call(
      (httpQueryTool.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
      'rerank',
    ),
    'Installed HTTP MCP query schema is missing the rerank field.',
  );
  await closeQuietly(() => httpClient.close());
  await closeQuietly(() => httpTransport.close());

  const daemonStop = runAndAssert(nodeBinary, [installedBinPath, 'mcp', 'stop'], {
    cwd: tempDir,
    encoding: 'utf8',
    env: packageEnv,
  });
  assert(
    daemonStop.stdout.includes('Stopped QMD MCP server'),
    'Installed MCP daemon did not stop cleanly.',
  );

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
      ...packageEnv,
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
