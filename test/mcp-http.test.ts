import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { QMDStore } from '@tobilu/qmd';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { startOwnedMcpHttpServer } from '../src/mcp/server.js';

function createFakeMcpStore(): QMDStore {
  const prepare = vi.fn((sql: string) => ({
    get: vi.fn((...params: (string | number)[]) => {
      if (sql.includes('store_config')) {
        return params[0] === 'kqmd_search_source_snapshot'
          ? {
              value: JSON.stringify({
                totalDocuments: 1,
                latestModifiedAt: '2026-03-16T00:00:00.000Z',
                maxDocumentId: 1,
              }),
            }
          : { value: 'kiwi-cong-shadow-v1' };
      }

      if (sql.includes('sqlite_master')) {
        return { name: 'kqmd_documents_fts' };
      }

      if (sql.includes('MAX(d.modified_at)')) {
        return {
          count: 1,
          latest_modified_at: '2026-03-16T00:00:00.000Z',
          max_document_id: 1,
        };
      }

      if (sql.includes('COUNT(*) AS count')) {
        return { count: 1 };
      }

      return undefined;
    }),
    all: vi.fn(() => {
      if (sql.includes('content_vectors')) {
        return [{ model: 'embeddinggemma', documents: 1 }];
      }

      return [];
    }),
  }));

  return {
    close: vi.fn(async () => {}),
    dbPath: '/home/tester/.cache/qmd/index.sqlite',
    search: vi.fn(async () => [
      {
        displayPath: 'docs/readme.md',
        title: 'README',
        bestChunk: 'HTTP MCP search result.',
        context: 'documentation',
        score: 0.91,
        docid: 'doc-1',
        bestChunkPos: 0,
      },
    ]),
    get: vi.fn(async () => ({
      displayPath: 'docs/readme.md',
      title: 'README',
      body: 'Line one\nLine two',
      context: 'documentation',
      filepath: '/repo/docs/readme.md',
    })),
    getDocumentBody: vi.fn(async () => 'Line one\nLine two'),
    multiGet: vi.fn(async () => ({
      docs: [],
      errors: [],
    })),
    getStatus: vi.fn(async () => ({
      totalDocuments: 1,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [
        {
          name: 'docs',
          path: '/repo/docs',
          pattern: '**/*.md',
          documents: 1,
          lastUpdated: '2026-03-16T00:00:00.000Z',
        },
      ],
    })),
    listCollections: vi.fn(async () => [{ name: 'docs' }]),
    getDefaultCollectionNames: vi.fn(async () => ['docs']),
    listContexts: vi.fn(async () => []),
    getGlobalContext: vi.fn(async () => undefined),
    internal: {
      db: {
        prepare,
      },
    },
  } as unknown as QMDStore;
}

describe('owned mcp http server', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('serves health and mcp tool calls over HTTP', async () => {
    const store = createFakeMcpStore();
    const { httpServer, stop } = await startOwnedMcpHttpServer(0, {
      env: { HOME: '/home/tester' },
      quiet: true,
      store,
      sessionTtlMs: 20,
      metadataTtlMs: 5_000,
      daemonStateProvider: () => ({
        running: false,
        pidPath: '/home/tester/.cache/qmd/mcp.pid',
        logPath: '/home/tester/.cache/qmd/mcp.log',
      }),
    });

    const address = httpServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ status: 'ok' });

    const exactOrigin = await fetch(`${baseUrl}/health`, {
      headers: {
        origin: `http://127.0.0.1:${port}`,
      },
    });
    expect(exactOrigin.status).toBe(200);

    const client = new Client({
      name: 'mcp-http-test-client',
      version: '1.0.0',
    });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['query', 'status']),
    );
    expect(store.listCollections).toHaveBeenCalledTimes(1);
    expect(store.getDefaultCollectionNames).toHaveBeenCalledTimes(1);

    const badRequest = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/list',
        params: {},
      }),
    });
    expect(badRequest.status).toBe(400);
    await expect(badRequest.json()).resolves.toMatchObject({
      error: {
        message: 'Bad Request: Missing session ID',
      },
    });

    const badOrigin = await fetch(`${baseUrl}/health`, {
      headers: {
        origin: 'http://evil.example',
      },
    });
    expect(badOrigin.status).toBe(403);

    const crossPortOrigin = await fetch(`${baseUrl}/health`, {
      headers: {
        origin: 'http://localhost:9999',
      },
    });
    expect(crossPortOrigin.status).toBe(403);

    const unknownSession = await fetch(`${baseUrl}/mcp`, {
      method: 'GET',
      headers: {
        'mcp-session-id': 'missing-session',
      },
    });
    expect(unknownSession.status).toBe(404);
    await expect(unknownSession.json()).resolves.toMatchObject({
      error: {
        message: 'Session not found',
      },
    });

    const invalidAliasBody = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        searches: [{ type: 'lex', query: 'http mcp' }],
        limit: '10',
      }),
    });
    expect(invalidAliasBody.status).toBe(400);
    await expect(invalidAliasBody.json()).resolves.toMatchObject({
      error: 'Invalid query request body.',
    });

    const multilineStructuredSearch = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        searches: [{ type: 'lex', query: 'auth\nflow' }],
      }),
    });
    expect(multilineStructuredSearch.status).toBe(400);
    await expect(multilineStructuredSearch.json()).resolves.toMatchObject({
      error:
        'Line 2 is missing a lex:/vec:/hyde:/intent: prefix. Each line in a query document must start with one.',
    });

    const controlCharIntent = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: 'http mcp',
        intent: 'doc\u0007s',
      }),
    });
    expect(controlCharIntent.status).toBe(400);
    await expect(controlCharIntent.json()).resolves.toMatchObject({
      error: 'Intent contains unsupported control characters.',
    });

    const outOfRangeAliasBody = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        searches: [{ type: 'lex', query: 'http mcp' }],
        candidateLimit: -1,
      }),
    });
    expect(outOfRangeAliasBody.status).toBe(400);
    await expect(outOfRangeAliasBody.json()).resolves.toMatchObject({
      error: 'Invalid query request body.',
    });

    const oversizedBody = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        searches: [{ type: 'lex', query: 'x'.repeat(70_000) }],
      }),
    });
    expect(oversizedBody.status).toBe(413);
    await expect(oversizedBody.json()).resolves.toMatchObject({
      error: {
        message: 'Payload Too Large',
      },
    });

    const malformedAliasBody = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"query":"http mcp"',
    });
    expect(malformedAliasBody.status).toBe(400);
    await expect(malformedAliasBody.json()).resolves.toMatchObject({
      error: {
        message: 'Malformed JSON request body.',
      },
    });

    const query = await client.callTool({
      name: 'query',
      arguments: {
        query: '지속 학습',
        intent: 'documentation',
      },
    });
    expect(query.structuredContent).toMatchObject({
      query: {
        mode: 'plain',
        primaryQuery: '지속 학습',
        queryClass: 'short-korean-phrase',
      },
      results: [
        {
          file: 'docs/readme.md',
          adaptive: {
            queryClass: 'short-korean-phrase',
          },
        },
      ],
    });

    const aliasQuery = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: '지속 학습',
        intent: 'documentation',
      }),
    });
    expect(aliasQuery.status).toBe(200);
    const aliasQueryBody = (await aliasQuery.json()) as {
      results: Array<{ snippet: string }>;
      advisories: string[];
    };
    expect(aliasQueryBody.results[0]?.snippet).toBe(
      (query.structuredContent as { results: Array<{ snippet: string }> }).results[0]?.snippet ??
        '',
    );
    expect(aliasQueryBody).toMatchObject({
      query: {
        mode: 'plain',
        queryClass: 'short-korean-phrase',
      },
      results: [
        {
          adaptive: {
            queryClass: 'short-korean-phrase',
          },
        },
      ],
    });

    const status = await client.callTool({
      name: 'status',
      arguments: {},
    });
    expect(status.structuredContent).toMatchObject({
      transport: {
        mcp: {
          running: false,
        },
      },
    });

    const concurrentResults = await Promise.all([
      client.callTool({
        name: 'query',
        arguments: {
          searches: [{ type: 'lex', query: 'http mcp' }],
        },
      }),
      client.callTool({
        name: 'status',
        arguments: {},
      }),
    ]);
    expect(concurrentResults).toHaveLength(2);

    const invalidTool = await client.callTool({
      name: 'query',
      arguments: {
        query: 'auth\nflow',
      },
    });
    expect(invalidTool.isError).toBe(true);

    const malformedMcpRequest = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0"',
    });
    expect(malformedMcpRequest.status).toBe(400);
    await expect(malformedMcpRequest.json()).resolves.toMatchObject({
      error: {
        code: -32700,
        message: 'Malformed JSON request body.',
      },
    });

    expect(store.listCollections).toHaveBeenCalledTimes(1);
    expect(store.getDefaultCollectionNames).toHaveBeenCalledTimes(1);

    const sessionId = transport.sessionId;
    expect(sessionId).toBeDefined();
    await sleep(50);
    if (!sessionId) {
      throw new Error('Expected an MCP session ID after HTTP connect.');
    }

    const expiredSession = await fetch(`${baseUrl}/mcp`, {
      method: 'GET',
      headers: {
        'mcp-session-id': sessionId,
      },
    });
    expect(expiredSession.status).toBe(404);

    await transport.close();
    await client.close();
    await stop();
  });
});
