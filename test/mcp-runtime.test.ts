import type { QMDStore } from '@tobilu/qmd';
import { describe, expect, test, vi } from 'vitest';

import { startOwnedMcpHttpServer, startOwnedMcpServer } from '../src/mcp/server.js';

function createStore(): QMDStore {
  return {
    close: vi.fn(async () => {}),
    dbPath: '/tmp/index.sqlite',
    getStatus: vi.fn(async () => ({
      totalDocuments: 0,
      needsEmbedding: 0,
      hasVectorIndex: false,
      collections: [],
    })),
    listContexts: vi.fn(async () => []),
    getGlobalContext: vi.fn(async () => undefined),
    listCollections: vi.fn(async () => []),
    getDefaultCollectionNames: vi.fn(async () => []),
    get: vi.fn(async () => ({ error: 'not-found', similarFiles: [] })),
    getDocumentBody: vi.fn(async () => null),
    multiGet: vi.fn(async () => ({ docs: [], errors: [] })),
    internal: {
      db: {
        prepare: vi.fn((sql: string) => ({
          all: vi.fn(() => []),
          get: vi.fn(() => {
            if (sql.includes('COUNT(*) AS count')) {
              return { count: 0 };
            }
            return undefined;
          }),
        })),
      },
    },
  } as unknown as QMDStore;
}

describe('mcp runtime opening policy', () => {
  test('starts stdio server with db-only createStore options', async () => {
    const store = createStore();
    const createStoreImpl = vi.fn(async () => store);
    const connect = vi
      .spyOn(
        (await import('@modelcontextprotocol/sdk/server/mcp.js')).McpServer.prototype,
        'connect',
      )
      .mockResolvedValue(undefined);

    await startOwnedMcpServer({
      env: { HOME: '/home/tester' },
      createStoreImpl,
    });

    expect(createStoreImpl).toHaveBeenCalledWith({
      dbPath: '/home/tester/.cache/qmd/index.sqlite',
    });

    connect.mockRestore();
  });

  test('starts http server with db-only createStore options', async () => {
    const store = createStore();
    const createStoreImpl = vi.fn(async () => store);
    const { stop } = await startOwnedMcpHttpServer(0, {
      env: { HOME: '/home/tester' },
      quiet: true,
      createStoreImpl,
      daemonStateProvider: () => ({
        running: false,
        pidPath: '/home/tester/.cache/qmd/mcp.pid',
        logPath: '/home/tester/.cache/qmd/mcp.log',
      }),
    });

    expect(createStoreImpl).toHaveBeenCalledWith({
      dbPath: '/home/tester/.cache/qmd/index.sqlite',
    });

    await stop();
  });

  test('starts stdio server with config-file options when config bootstrap is required', async () => {
    const store = createStore();
    const createStoreImpl = vi.fn(async () => store);
    const connect = vi
      .spyOn(
        (await import('@modelcontextprotocol/sdk/server/mcp.js')).McpServer.prototype,
        'connect',
      )
      .mockResolvedValue(undefined);

    await startOwnedMcpServer({
      env: { HOME: '/home/tester' },
      createStoreImpl,
      startup: {
        dbPath: '/home/tester/.cache/qmd/docs.sqlite',
        configPath: '/home/tester/.config/qmd/docs.yml',
      },
    });

    expect(createStoreImpl).toHaveBeenCalledWith({
      dbPath: '/home/tester/.cache/qmd/docs.sqlite',
      configPath: '/home/tester/.config/qmd/docs.yml',
    });

    connect.mockRestore();
  });
});
