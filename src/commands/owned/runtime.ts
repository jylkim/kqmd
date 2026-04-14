/**
 * Store 세션 관리 — 커맨드별 config/DB 요구사항을 해석하고 QMDStore를 열고 닫는다.
 *
 * 커맨드마다 config 파일과 DB 파일의 필요 여부가 다르다:
 *   - update:        config 필수 (컬렉션 정의가 있어야 인덱싱 가능)
 *   - search/query:  DB만 있으면 동작, 둘 다 없으면 실패
 *   - embed:         config 우선, DB만 있어도 동작
 *   - status/mcp:    DB 우선, 없어도 최소한의 정보 표시
 *
 * 이 로직을 resolveOwnedRuntimePlan()에서 결정하고,
 * openOwnedStoreSession()과 withOwnedStore()가 실제 열기/닫기를 관리한다.
 */
import { existsSync } from 'node:fs';

import { createStore, type QMDStore } from '@tobilu/qmd';

import { getConfigFilePath, getDefaultDbPath } from '#src/config/qmd_paths.js';
import type { CommandExecutionContext, OwnedCommand } from '#src/types/command.js';

/**
 * Store를 열 수 있는 실행 계획.
 * 'config-file': config.yml + DB 모두 사용
 * 'db-only': DB만으로 동작 (읽기 전용 커맨드)
 */
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

/**
 * Store를 열 수 없는 실패 상태.
 * 'config-required': update처럼 config가 반드시 필요한 커맨드인데 config가 없음
 * 'no-config-or-db': search/query처럼 최소한 DB는 필요한데 둘 다 없음
 */
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

export type OwnedStoreContext = Omit<OwnedStoreSession, 'close'>;

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
    case 'status':
      if (dbExists) {
        return { kind: 'db-only', command, indexName, dbPath };
      }

      if (configExists) {
        return { kind: 'config-file', command, indexName, dbPath, configPath };
      }

      return { kind: 'db-only', command, indexName, dbPath };

    case 'search':
    case 'query':
    case 'bench':
      if (dbExists) {
        return { kind: 'db-only', command, indexName, dbPath };
      }

      if (configExists) {
        return { kind: 'config-file', command, indexName, dbPath, configPath };
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

    case 'mcp':
      if (dbExists) {
        return { kind: 'db-only', command, indexName, dbPath };
      }

      if (configExists) {
        return { kind: 'config-file', command, indexName, dbPath, configPath };
      }

      return { kind: 'db-only', command, indexName, dbPath };

    case 'cleanup':
      if (dbExists) {
        return { kind: 'db-only', command, indexName, dbPath };
      }

      if (configExists) {
        return { kind: 'config-file', command, indexName, dbPath, configPath };
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
  run: (session: OwnedStoreContext) => Promise<T>,
  dependencies: OwnedRuntimeDependencies = getDefaultDependencies(),
): Promise<T | OwnedRuntimeFailure> {
  const session = await openOwnedStoreSession(command, context, dependencies);

  if (session.kind === 'config-missing' || session.kind === 'store-open-failed') {
    return session;
  }

  const { close, ...sessionContext } = session;

  try {
    const result = await run(sessionContext);
    await close();
    return result;
  } catch (error) {
    try {
      await close();
    } catch {
      // Preserve the primary callback failure.
    }

    throw error;
  }
}
