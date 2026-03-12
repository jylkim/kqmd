import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';
import type { OwnedRuntimeDependencies } from '../src/commands/owned/runtime.js';
import {
  openOwnedStoreSession,
  resolveOwnedRuntimePlan,
  withOwnedStore,
} from '../src/commands/owned/runtime.js';
import type { CommandExecutionContext } from '../src/types/command.js';

function createContext(indexName = 'index'): CommandExecutionContext {
  return {
    argv: [],
    commandArgs: [],
    indexName,
  };
}

function createFakeStore(close = vi.fn(async () => {})): QMDStore {
  return {
    close,
  } as unknown as QMDStore;
}

function createDependencies(
  options: {
    existingPaths?: string[];
    createStoreImpl?: OwnedRuntimeDependencies['createStore'];
    env?: NodeJS.ProcessEnv;
  } = {},
): OwnedRuntimeDependencies {
  const env = options.env ?? {
    HOME: '/home/tester',
  };
  const existingPaths = new Set(options.existingPaths ?? []);

  return {
    env,
    existsSync: (path) => existingPaths.has(path),
    createStore: options.createStoreImpl ?? vi.fn(async () => createFakeStore()),
  };
}

describe('owned runtime', () => {
  test('prefers config-file mode for search when config exists', () => {
    const dependencies = createDependencies({
      existingPaths: ['/home/tester/.config/qmd/work.yml'],
    });

    const plan = resolveOwnedRuntimePlan('search', createContext('work'), dependencies);

    expect(plan).toEqual({
      kind: 'config-file',
      command: 'search',
      indexName: 'work',
      dbPath: '/home/tester/.cache/qmd/work.sqlite',
      configPath: '/home/tester/.config/qmd/work.yml',
    });
  });

  test('prefers db-only reopen for search when config and db both exist', () => {
    const dependencies = createDependencies({
      existingPaths: ['/home/tester/.config/qmd/work.yml', '/home/tester/.cache/qmd/work.sqlite'],
    });

    const plan = resolveOwnedRuntimePlan('search', createContext('work'), dependencies);

    expect(plan).toEqual({
      kind: 'db-only',
      command: 'search',
      indexName: 'work',
      dbPath: '/home/tester/.cache/qmd/work.sqlite',
    });
  });

  test('allows db-only reopen for query when db exists and config is absent', () => {
    const dependencies = createDependencies({
      existingPaths: ['/home/tester/.cache/qmd/work.sqlite'],
    });

    const plan = resolveOwnedRuntimePlan('query', createContext('work'), dependencies);

    expect(plan).toEqual({
      kind: 'db-only',
      command: 'query',
      indexName: 'work',
      dbPath: '/home/tester/.cache/qmd/work.sqlite',
    });
  });

  test('treats status as a read command with db-only reopen', () => {
    const dependencies = createDependencies({
      existingPaths: ['/home/tester/.cache/qmd/work.sqlite'],
    });

    const plan = resolveOwnedRuntimePlan('status', createContext('work'), dependencies);

    expect(plan).toEqual({
      kind: 'db-only',
      command: 'status',
      indexName: 'work',
      dbPath: '/home/tester/.cache/qmd/work.sqlite',
    });
  });

  test('returns config-missing for search when config and db are both absent', () => {
    const dependencies = createDependencies();

    const plan = resolveOwnedRuntimePlan('search', createContext('docs'), dependencies);

    expect(plan).toEqual({
      kind: 'config-missing',
      command: 'search',
      indexName: 'docs',
      dbPath: '/home/tester/.cache/qmd/docs.sqlite',
      configPath: '/home/tester/.config/qmd/docs.yml',
      reason: 'no-config-or-db',
    });
  });

  test('requires config for update even when db exists', () => {
    const dependencies = createDependencies({
      existingPaths: ['/home/tester/.cache/qmd/docs.sqlite'],
    });

    const plan = resolveOwnedRuntimePlan('update', createContext('docs'), dependencies);

    expect(plan).toEqual({
      kind: 'config-missing',
      command: 'update',
      indexName: 'docs',
      dbPath: '/home/tester/.cache/qmd/docs.sqlite',
      configPath: '/home/tester/.config/qmd/docs.yml',
      reason: 'config-required',
    });
  });

  test('allows db-only reopen for embed when db exists and config is absent', () => {
    const dependencies = createDependencies({
      existingPaths: ['/home/tester/.cache/qmd/embed.sqlite'],
    });

    const plan = resolveOwnedRuntimePlan('embed', createContext('embed'), dependencies);

    expect(plan).toEqual({
      kind: 'db-only',
      command: 'embed',
      indexName: 'embed',
      dbPath: '/home/tester/.cache/qmd/embed.sqlite',
    });
  });

  test('passes configPath to createStore in config-file mode', async () => {
    const createStoreImpl = vi.fn(async () =>
      createFakeStore(),
    ) as unknown as OwnedRuntimeDependencies['createStore'];
    const dependencies = createDependencies({
      existingPaths: ['/home/tester/.config/qmd/work.yml'],
      createStoreImpl,
    });

    const result = await openOwnedStoreSession('search', createContext('work'), dependencies);

    expect(createStoreImpl).toHaveBeenCalledWith({
      dbPath: '/home/tester/.cache/qmd/work.sqlite',
      configPath: '/home/tester/.config/qmd/work.yml',
    });
    expect(result.kind).toBe('config-file');
  });

  test('wraps createStore failures as store-open-failed', async () => {
    const dependencies = createDependencies({
      existingPaths: ['/home/tester/.config/qmd/work.yml'],
      createStoreImpl: vi.fn(async () => {
        throw new Error('boom');
      }) as unknown as OwnedRuntimeDependencies['createStore'],
    });

    const result = await openOwnedStoreSession('search', createContext('work'), dependencies);

    expect(result).toMatchObject({
      kind: 'store-open-failed',
      command: 'search',
      indexName: 'work',
      dbPath: '/home/tester/.cache/qmd/work.sqlite',
      configPath: '/home/tester/.config/qmd/work.yml',
    });
    expect(result.kind === 'store-open-failed' ? result.cause.message : '').toBe('boom');
  });

  test('closes the store after successful callback execution', async () => {
    const close = vi.fn(async () => {});
    const createStoreImpl = vi.fn(async () =>
      createFakeStore(close),
    ) as unknown as OwnedRuntimeDependencies['createStore'];
    const dependencies = createDependencies({
      existingPaths: ['/home/tester/.config/qmd/work.yml'],
      createStoreImpl,
    });

    const result = await withOwnedStore(
      'search',
      createContext('work'),
      async (session) => {
        expect('close' in session).toBe(false);
        return session.dbPath;
      },
      dependencies,
    );

    expect(result).toBe('/home/tester/.cache/qmd/work.sqlite');
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('closes the store when callback throws', async () => {
    const close = vi.fn(async () => {});
    const createStoreImpl = vi.fn(async () =>
      createFakeStore(close),
    ) as unknown as OwnedRuntimeDependencies['createStore'];
    const dependencies = createDependencies({
      existingPaths: ['/home/tester/.config/qmd/work.yml'],
      createStoreImpl,
    });

    await expect(
      withOwnedStore(
        'search',
        createContext('work'),
        async (_session) => {
          throw new Error('callback failed');
        },
        dependencies,
      ),
    ).rejects.toThrow('callback failed');

    expect(close).toHaveBeenCalledTimes(1);
  });

  test('preserves callback failure when close also fails', async () => {
    const close = vi.fn(async () => {
      throw new Error('close failed');
    });
    const createStoreImpl = vi.fn(async () =>
      createFakeStore(close),
    ) as unknown as OwnedRuntimeDependencies['createStore'];
    const dependencies = createDependencies({
      existingPaths: ['/home/tester/.config/qmd/work.yml'],
      createStoreImpl,
    });

    await expect(
      withOwnedStore(
        'search',
        createContext('work'),
        async () => {
          throw new Error('callback failed');
        },
        dependencies,
      ),
    ).rejects.toThrow('callback failed');

    expect(close).toHaveBeenCalledTimes(1);
  });

  test('returns config-missing failure from withOwnedStore without opening the store', async () => {
    const createStoreImpl = vi.fn(async () =>
      createFakeStore(),
    ) as unknown as OwnedRuntimeDependencies['createStore'];
    const dependencies = createDependencies({
      createStoreImpl,
    });

    const result = await withOwnedStore(
      'search',
      createContext('missing'),
      async (_session) => 'unreachable',
      dependencies,
    );

    expect(result).toEqual({
      kind: 'config-missing',
      command: 'search',
      indexName: 'missing',
      dbPath: '/home/tester/.cache/qmd/missing.sqlite',
      configPath: '/home/tester/.config/qmd/missing.yml',
      reason: 'no-config-or-db',
    });
    expect(createStoreImpl).not.toHaveBeenCalled();
  });
});
