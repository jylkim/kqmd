import { existsSync } from 'node:fs';

import { createStore, type QMDStore } from '@tobilu/qmd';

import { getConfigFilePath, getDefaultDbPath } from '../../config/qmd_paths.js';
import type { CommandExecutionContext, OwnedCommand } from '../../types/command.js';

type OpenableRuntimePlan =
  | {
      readonly kind: 'config-file';
      readonly command: OwnedCommand;
      readonly indexName: string;
      readonly dbPath: string;
      readonly configPath: string;
    }
  | {
      readonly kind: 'db-only';
      readonly command: OwnedCommand;
      readonly indexName: string;
      readonly dbPath: string;
    };

export type ConfigMissingFailure = {
  readonly kind: 'config-missing';
  readonly command: OwnedCommand;
  readonly indexName: string;
  readonly dbPath: string;
  readonly configPath: string;
  readonly reason: 'config-required' | 'no-config-or-db';
};

export type StoreOpenFailed = {
  readonly kind: 'store-open-failed';
  readonly command: OwnedCommand;
  readonly indexName: string;
  readonly dbPath: string;
  readonly configPath?: string;
  readonly cause: Error;
};

export type OwnedRuntimeFailure = ConfigMissingFailure | StoreOpenFailed;

export type OwnedRuntimePlan = OpenableRuntimePlan | ConfigMissingFailure;

export type OwnedStoreSession = OpenableRuntimePlan & {
  readonly store: QMDStore;
  close(): Promise<void>;
};

export interface OwnedRuntimeDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly existsSync: (path: string) => boolean;
  readonly createStore: typeof createStore;
}

function getDefaultDependencies(env: NodeJS.ProcessEnv = process.env): OwnedRuntimeDependencies {
  return {
    env,
    existsSync,
    createStore,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function assertNever(value: never): never {
  throw new Error(`Unhandled owned command: ${String(value)}`);
}

function getRuntimePaths(
  context: CommandExecutionContext,
  env: NodeJS.ProcessEnv,
): {
  readonly indexName: string;
  readonly dbPath: string;
  readonly configPath: string;
} {
  const indexName = context.indexName ?? 'index';

  return {
    indexName,
    dbPath: getDefaultDbPath(indexName, env),
    configPath: getConfigFilePath(indexName, env),
  };
}

export function resolveOwnedRuntimePlan(
  command: OwnedCommand,
  context: CommandExecutionContext,
  dependencies: OwnedRuntimeDependencies = getDefaultDependencies(),
): OwnedRuntimePlan {
  const { env, existsSync: hasPath } = dependencies;
  const { indexName, dbPath, configPath } = getRuntimePaths(context, env);
  const configExists = hasPath(configPath);
  const dbExists = hasPath(dbPath);

  switch (command) {
    case 'search':
    case 'query':
      if (configExists) {
        return { kind: 'config-file', command, indexName, dbPath, configPath };
      }

      if (dbExists) {
        return { kind: 'db-only', command, indexName, dbPath };
      }

      return {
        kind: 'config-missing',
        command,
        indexName,
        dbPath,
        configPath,
        reason: 'no-config-or-db',
      };

    case 'update':
      if (configExists) {
        return { kind: 'config-file', command, indexName, dbPath, configPath };
      }

      return {
        kind: 'config-missing',
        command,
        indexName,
        dbPath,
        configPath,
        reason: 'config-required',
      };

    case 'embed':
      if (configExists) {
        return { kind: 'config-file', command, indexName, dbPath, configPath };
      }

      if (dbExists) {
        return { kind: 'db-only', command, indexName, dbPath };
      }

      return {
        kind: 'config-missing',
        command,
        indexName,
        dbPath,
        configPath,
        reason: 'no-config-or-db',
      };
  }

  return assertNever(command);
}

export async function openOwnedStoreSession(
  command: OwnedCommand,
  context: CommandExecutionContext,
  dependencies: OwnedRuntimeDependencies = getDefaultDependencies(),
): Promise<OwnedStoreSession | OwnedRuntimeFailure> {
  const plan = resolveOwnedRuntimePlan(command, context, dependencies);

  if (plan.kind === 'config-missing') {
    return plan;
  }

  try {
    const store = await dependencies.createStore(
      plan.kind === 'config-file'
        ? { dbPath: plan.dbPath, configPath: plan.configPath }
        : { dbPath: plan.dbPath },
    );

    return {
      ...plan,
      store,
      close: () => store.close(),
    };
  } catch (error) {
    return {
      kind: 'store-open-failed',
      command: plan.command,
      indexName: plan.indexName,
      dbPath: plan.dbPath,
      configPath: plan.kind === 'config-file' ? plan.configPath : undefined,
      cause: toError(error),
    };
  }
}

export async function withOwnedStore<T>(
  command: OwnedCommand,
  context: CommandExecutionContext,
  run: (session: OwnedStoreSession) => Promise<T>,
  dependencies: OwnedRuntimeDependencies = getDefaultDependencies(),
): Promise<T | OwnedRuntimeFailure> {
  const session = await openOwnedStoreSession(command, context, dependencies);

  if (session.kind === 'config-missing' || session.kind === 'store-open-failed') {
    return session;
  }

  try {
    return await run(session);
  } finally {
    await session.close();
  }
}
