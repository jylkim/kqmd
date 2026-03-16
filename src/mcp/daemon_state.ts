import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

import { getMcpLogPath, getMcpPidPath } from '../config/qmd_paths.js';

export interface McpDaemonState {
  readonly running: boolean;
  readonly pid?: number;
  readonly pidPath: string;
  readonly logPath: string;
  readonly advisory?: string;
}

export class UnsafeDaemonPathError extends Error {
  constructor(path: string) {
    super(`Refusing to use symbolic link path: ${path}`);
    this.name = 'UnsafeDaemonPathError';
  }
}

export function ensureRegularPath(path: string, rootPath?: string): void {
  let current = path;
  const stopAt = rootPath ? dirname(rootPath) : undefined;

  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new UnsafeDaemonPathError(current);
    }

    if (stopAt && current === stopAt) {
      return;
    }

    const parent = dirname(current);
    if (parent === current) {
      return;
    }

    current = parent;
  }
}

export function isExpectedMcpProcess(
  pid: number,
  entrypoint: string,
  execFileImpl: typeof execFileSync = execFileSync,
): boolean {
  if (process.platform === 'win32') {
    return true;
  }

  try {
    const command = execFileImpl('ps', ['-p', String(pid), '-o', 'command='], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
    })
      .trim()
      .replace(/\s+/g, ' ');

    return command.includes(entrypoint) && command.includes(' mcp');
  } catch {
    return false;
  }
}

export function readMcpDaemonState(env: NodeJS.ProcessEnv = process.env): McpDaemonState {
  const pidPath = getMcpPidPath(env);
  const logPath = getMcpLogPath(env);
  const qmdCacheDir = dirname(pidPath);

  try {
    ensureRegularPath(pidPath, qmdCacheDir);
    ensureRegularPath(logPath, qmdCacheDir);
  } catch (error) {
    return {
      running: false,
      pidPath,
      logPath,
      advisory: error instanceof Error ? error.message : String(error),
    };
  }

  if (!existsSync(pidPath)) {
    return { running: false, pidPath, logPath };
  }

  try {
    const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) {
      unlinkSync(pidPath);
      return { running: false, pidPath, logPath };
    }

    process.kill(pid, 0);
    return { running: true, pid, pidPath, logPath };
  } catch {
    try {
      unlinkSync(pidPath);
    } catch {
      // Keep the daemon state conservative if cleanup fails.
    }

    return { running: false, pidPath, logPath };
  }
}
