import { Writable } from 'node:stream';

import type { QMDStore } from '@tobilu/qmd';
import { vi } from 'vitest';
import type { OwnedRuntimeDependencies } from '../src/commands/owned/runtime.js';
import type { CommandExecutionContext } from '../src/types/command.js';

export function createContext(argv: string[], indexName?: string): CommandExecutionContext {
  return { argv, commandArgs: argv.slice(1), indexName };
}

export function createRuntimeDependencies(
  store: QMDStore,
  options: {
    existingPaths?: string[];
    env?: NodeJS.ProcessEnv;
  } = {},
): OwnedRuntimeDependencies {
  const paths = new Set(options.existingPaths ?? ['/home/tester/.cache/qmd/index.sqlite']);
  return {
    env: options.env ?? { HOME: '/home/tester' },
    existsSync: (path) => paths.has(path),
    createStore: vi.fn(async () => store),
  };
}

export function memoryWriter(chunks: string[]) {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  }) as NodeJS.WriteStream;
}

export function withTrailingNewline(stdout: string | undefined): string {
  return stdout ? `${stdout}\n` : '';
}
