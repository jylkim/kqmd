import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import { locateUpstreamBinary, type UpstreamBinary } from './upstream_locator.js';

export interface DelegatePipedResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function collectStream(stream: Readable): Buffer[] {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  return chunks;
}

export async function delegatePassthroughPiped(
  argv: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv; readonly upstreamBinary?: UpstreamBinary } = {},
): Promise<DelegatePipedResult> {
  const upstreamBinary = options.upstreamBinary ?? locateUpstreamBinary(options.env);

  return new Promise((resolve, reject) => {
    const child = spawn(upstreamBinary.path, [...argv], {
      cwd: process.cwd(),
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ['inherit', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutChunks = collectStream(child.stdout!);
    const stderrChunks = collectStream(child.stderr!);
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });
  });
}
