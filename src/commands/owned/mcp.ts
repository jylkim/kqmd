import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createStore } from '@tobilu/qmd';

import { getMcpPidPath } from '#src/config/qmd_paths.js';
import {
  ensureRegularPath,
  isExpectedMcpProcess,
  readMcpDaemonState,
  UnsafeDaemonPathError,
} from '#src/mcp/daemon_state.js';
import { startOwnedMcpHttpServer, startOwnedMcpServer } from '#src/mcp/server.js';
import type { CommandExecutionContext, CommandExecutionResult } from '#src/types/command.js';
import { parseOwnedArgs, type ParsedValues } from './io/parse.js';
import { resolveOwnedRuntimePlan } from './runtime.js';

function usage(): CommandExecutionResult {
  return {
    exitCode: 1,
    stderr: 'Usage: qmd mcp [--http [--port <n>] [--daemon] | stop]',
  };
}

function validation(message: string): CommandExecutionResult {
  return {
    exitCode: 1,
    stderr: message,
  };
}

function resolvePort(rawValue: string | undefined): number | CommandExecutionResult {
  if (rawValue === undefined) {
    return 8181;
  }

  if (!/^\d+$/.test(rawValue)) {
    return validation('The `--port` option must be a positive integer.');
  }

  const port = Number.parseInt(rawValue, 10);
  if (port < 1 || port > 65535) {
    return validation('The `--port` option must be between 1 and 65535.');
  }

  return port;
}

async function assertPortAvailable(port: number): Promise<true | CommandExecutionResult> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', () => {
      resolve(validation(`Port ${port} is already in use. Try a different port with --port.`));
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForDaemonReady(
  child: ReturnType<typeof spawn>,
  port: number,
  timeoutMs = 5_000,
): Promise<true | CommandExecutionResult> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      return validation(
        `MCP daemon exited before startup completed (exit code ${child.exitCode}).`,
      );
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Keep polling until timeout or child exit.
    }

    await sleep(100);
  }

  return validation(`Timed out waiting for MCP daemon to start on port ${port}.`);
}

async function stopDaemon(env: NodeJS.ProcessEnv = process.env): Promise<CommandExecutionResult> {
  const pidPath = getMcpPidPath(env);
  const entrypoint = process.argv[1];

  if (!existsSync(pidPath)) {
    return {
      exitCode: 0,
      stdout: 'Not running (no PID file).',
    };
  }

  try {
    ensureRegularPath(pidPath, dirname(pidPath));
    const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
    process.kill(pid, 0);

    if (entrypoint && !isExpectedMcpProcess(pid, entrypoint)) {
      return validation(
        `Refusing to stop PID ${pid}: process does not look like a K-QMD MCP daemon.`,
      );
    }

    process.kill(pid, 'SIGTERM');
    unlinkSync(pidPath);
    return {
      exitCode: 0,
      stdout: `Stopped QMD MCP server (PID ${pid}).`,
    };
  } catch (error) {
    if (error instanceof UnsafeDaemonPathError) {
      return validation(error.message);
    }

    try {
      unlinkSync(pidPath);
    } catch {
      // Keep the stop path best-effort.
    }

    return {
      exitCode: 0,
      stdout: 'Cleaned up stale PID file (server was not running).',
    };
  }
}

async function startDaemon(
  port: number,
  options: {
    readonly env: NodeJS.ProcessEnv;
    readonly indexName?: string;
  },
): Promise<CommandExecutionResult> {
  const env = options.env;
  const portAvailability = await assertPortAvailable(port);
  if (portAvailability !== true) {
    return portAvailability;
  }

  const daemonState = readMcpDaemonState(env);
  if (daemonState.advisory) {
    return validation(daemonState.advisory);
  }
  if (daemonState.running) {
    return validation(`Already running (PID ${daemonState.pid}). Run 'qmd mcp stop' first.`);
  }

  ensureRegularPath(daemonState.pidPath, dirname(daemonState.pidPath));
  ensureRegularPath(daemonState.logPath, dirname(daemonState.logPath));
  mkdirSync(dirname(daemonState.pidPath), { recursive: true });

  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return validation('Unable to determine the CLI entrypoint for daemon mode.');
  }

  const logFd = openSync(resolve(daemonState.logPath), 'w');
  const childArgs = [
    entrypoint,
    ...(options.indexName ? ['--index', options.indexName] : []),
    'mcp',
    '--http',
    '--port',
    String(port),
  ];
  const child = spawn(process.execPath, childArgs, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    detached: true,
    shell: false,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });

  const readiness = await waitForDaemonReady(child, port);
  if (readiness !== true) {
    try {
      process.kill(child.pid ?? 0, 'SIGTERM');
    } catch {
      // Child may already be gone.
    }
    closeSync(logFd);
    return readiness;
  }

  child.unref();
  closeSync(logFd);
  writeFileSync(daemonState.pidPath, String(child.pid));
  return {
    exitCode: 0,
    stdout: [
      `Started on http://127.0.0.1:${port}/mcp (PID ${child.pid})`,
      `Logs: ${daemonState.logPath}`,
    ].join('\n'),
  };
}


function resolveMcpStartupOptions(
  context: CommandExecutionContext,
  env: NodeJS.ProcessEnv,
  hasPath: (path: string) => boolean = existsSync,
): {
  readonly indexName?: string;
  readonly dbPath: string;
  readonly configPath?: string;
} {
  const plan = resolveOwnedRuntimePlan('mcp', context, {
    env,
    existsSync: hasPath,
    createStore,
  });

  return {
    indexName: context.indexName,
    dbPath: plan.dbPath,
    configPath: plan.kind === 'config-file' ? plan.configPath : undefined,
  };
}

export interface McpCommandDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly existsSync?: (path: string) => boolean;
  readonly startOwnedMcpServer?: typeof startOwnedMcpServer;
  readonly startOwnedMcpHttpServer?: typeof startOwnedMcpHttpServer;
}

export async function handleMcpCommand(
  context: CommandExecutionContext,
  dependencies: McpCommandDependencies = {},
): Promise<CommandExecutionResult> {
  const env = dependencies.env ?? process.env;
  const { values, positionals } = parseOwnedArgs(context.argv);
  const subcommand = positionals[1];

  if (subcommand === 'stop') {
    if (positionals.length > 2 || values.http || values.daemon || values.port) {
      return usage();
    }

    return stopDaemon(env);
  }

  if (positionals.length > 1) {
    return usage();
  }

  const http = Boolean(values.http);
  const daemon = Boolean(values.daemon);
  const port = resolvePort(typeof values.port === 'string' ? values.port : undefined);
  if (typeof port !== 'number') {
    return port;
  }

  const startup = resolveMcpStartupOptions(context, env, dependencies.existsSync);

  if (daemon && !http) {
    return validation('The `--daemon` option requires `--http`.');
  }

  if (http && daemon) {
    return startDaemon(port, {
      env,
      indexName: startup.indexName,
    });
  }

  if (http) {
    await (dependencies.startOwnedMcpHttpServer ?? startOwnedMcpHttpServer)(port, {
      env,
      startup,
    });
    return { exitCode: 0, directIO: true };
  }

  await (dependencies.startOwnedMcpServer ?? startOwnedMcpServer)({
    env,
    startup,
  });
  return { exitCode: 0, directIO: true };
}
