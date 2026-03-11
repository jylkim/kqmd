import { spawn } from 'node:child_process';

import { locateUpstreamBinary, type UpstreamBinary } from './upstream_locator.js';

export interface DelegateResult {
  readonly binaryPath: string;
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
}

interface SpawnedProcessLike {
  once(event: 'error', listener: (error: Error) => void): this;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

type SpawnLike = typeof spawn;

export interface DelegateOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly spawnImpl?: SpawnLike;
  readonly stdio?: 'inherit' | 'pipe';
  readonly upstreamBinary?: UpstreamBinary;
}

export async function delegatePassthrough(
  argv: readonly string[],
  options: DelegateOptions = {},
): Promise<DelegateResult> {
  const upstreamBinary = options.upstreamBinary ?? locateUpstreamBinary(options.env);
  const spawnImpl = options.spawnImpl ?? spawn;

  return new Promise((resolve, reject) => {
    const child = spawnImpl(upstreamBinary.path, [...argv], {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: options.stdio ?? 'inherit',
      windowsHide: true,
    }) as SpawnedProcessLike;

    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({
        binaryPath: upstreamBinary.path,
        exitCode: code ?? 1,
        signal,
      });
    });
  });
}
