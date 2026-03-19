import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { QMDStore } from '@tobilu/qmd';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { createOwnedMcpServer } from '../src/mcp/server.js';

function createFakeMcpStore(): QMDStore {
  const prepare = vi.fn((sql: string) => ({
    get: vi.fn((...params: (string | number)[]) => {
      if (sql.includes('store_config')) {
        if (params[0] === 'kqmd_search_source_snapshot') {
          return {
            value: JSON.stringify({
              totalDocuments: 1,
              latestModifiedAt: '2026-03-16T00:00:00.000Z',
              maxDocumentId: 1,
            }),
          };
        }

        if (params[0] === 'kqmd_search_collection_snapshots') {
          return {
            value: JSON.stringify({
              docs: {
                totalDocuments: 1,
                latestModifiedAt: '2026-03-16T00:00:00.000Z',
                maxDocumentId: 1,
              },
            }),
          };
        }

        return { value: 'kiwi-cong-shadow-v1' };
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

      if (sql.includes('FROM kqmd_documents_fts')) {
        return [
          {
            filepath: 'qmd://docs/korean-search.md',
            display_path: 'docs/korean-search.md',
            title: '지속 학습 메모',
            body: '지속 학습은 문서 업로드 파싱과 연결됩니다.',
            hash: 'assist123hash',
            modified_at: '2026-03-16T00:00:00.000Z',
            collection: 'docs',
            bm25_score: -12,
          },
        ];
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
        bestChunk: 'Hangul query handling for MCP clients.',
        context: 'documentation',
        score: 0.81,
        docid: 'doc-1',
        bestChunkPos: 0,
      },
    ]),
    get: vi.fn(async (pathOrDocid: string) => {
      if (pathOrDocid === 'docs/readme.md' || pathOrDocid === '#doc-1') {
        return {
          displayPath: 'docs/readme.md',
          title: 'README',
          body: 'Line one\nLine two',
          context: 'documentation',
          filepath: '/repo/docs/readme.md',
        };
      }

      return { error: 'not-found', similarFiles: ['docs/readme.md'] };
    }),
    getDocumentBody: vi.fn(async () => 'Line one\nLine two'),
    multiGet: vi.fn(async () => ({
      docs: [
        {
          skipped: false,
          doc: {
            displayPath: 'docs/readme.md',
            title: 'README',
            body: 'Line one\nLine two',
            context: 'documentation',
          },
        },
      ],
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
    listContexts: vi.fn(async () => [
      {
        collection: 'docs',
        path: '',
        context: 'Documentation collection',
      },
    ]),
    getGlobalContext: vi.fn(async () => 'Repository knowledge base'),
    internal: {
      db: {
        prepare,
      },
      getContextForFile: vi.fn(() => 'documentation'),
    },
  } as unknown as QMDStore;
}

describe('owned mcp server', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('lists upstream-compatible tools and resources', async () => {
    const store = createFakeMcpStore();
    const server = await createOwnedMcpServer(store, {
      env: { HOME: '/home/tester' },
      daemonStateProvider: () => ({
        running: false,
        pidPath: '/home/tester/.cache/qmd/mcp.pid',
        logPath: '/home/tester/.cache/qmd/mcp.log',
      }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'mcp-test-client',
      version: '1.0.0',
    });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    expect(client.getInstructions()).toContain('Use `get` to inspect one document in full');
    expect(client.getInstructions()).toContain('Use `status` before or after retrieval');

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['query', 'get', 'multi_get', 'status']),
    );

    const resources = await client.listResourceTemplates();
    expect(resources.resourceTemplates.map((resource) => resource.name)).toEqual(
      expect.arrayContaining(['document']),
    );

    await client.close();
    await server.close();
  });

  test('serves query, status, and document reads through the local server', async () => {
    const store = createFakeMcpStore();
    const server = await createOwnedMcpServer(store, {
      env: { HOME: '/home/tester' },
      daemonStateProvider: () => ({
        running: true,
        pid: 4321,
        pidPath: '/home/tester/.cache/qmd/mcp.pid',
        logPath: '/home/tester/.cache/qmd/mcp.log',
      }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'mcp-test-client',
      version: '1.0.0',
    });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const query = await client.callTool({
      name: 'query',
      arguments: {
        searches: [{ type: 'lex', query: 'hangul query' }],
      },
    });
    expect(query.structuredContent).toMatchObject({
      results: [
        {
          file: 'docs/readme.md',
          title: 'README',
        },
      ],
    });

    const plainQuery = await client.callTool({
      name: 'query',
      arguments: {
        query: '지속 학습',
      },
    });
    expect((plainQuery.structuredContent as { query: unknown }).query).toMatchObject({
      mode: 'plain',
      primaryQuery: '지속 학습',
      queryClass: 'short-korean-phrase',
    });
    expect((plainQuery.structuredContent as { results: unknown[] }).results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adaptive: expect.objectContaining({
            queryClass: 'short-korean-phrase',
          }),
        }),
      ]),
    );

    const status = await client.callTool({
      name: 'status',
      arguments: {},
    });
    expect(status.structuredContent).toMatchObject({
      domain: {
        status: {
          totalDocuments: 1,
        },
      },
      transport: {
        mcp: {
          running: true,
          pid: 4321,
        },
      },
      advisories: [],
    });

    const resource = await client.readResource({
      uri: 'qmd://docs/readme.md',
    });
    expect(resource.contents[0]).toMatchObject({
      uri: 'qmd://docs/readme.md',
    });

    await client.close();
    await server.close();
  });

  test('applies limit and minScore to query tool results', async () => {
    const store = createFakeMcpStore();
    vi.mocked(store.search).mockResolvedValueOnce([
      {
        displayPath: 'docs/high-score.md',
        file: '/repo/docs/high-score.md',
        title: 'High Score',
        body: 'top ranked result',
        bestChunk: 'top ranked result',
        context: 'documentation',
        score: 0.91,
        docid: 'high',
        bestChunkPos: 0,
      },
      {
        displayPath: 'docs/limit-cutoff.md',
        file: '/repo/docs/limit-cutoff.md',
        title: 'Limit Cutoff',
        body: 'would survive minScore but not limit',
        bestChunk: 'would survive minScore but not limit',
        context: 'documentation',
        score: 0.83,
        docid: 'limit',
        bestChunkPos: 0,
      },
      {
        displayPath: 'docs/min-score-cutoff.md',
        file: '/repo/docs/min-score-cutoff.md',
        title: 'Min Score Cutoff',
        body: 'below the threshold',
        bestChunk: 'below the threshold',
        context: 'documentation',
        score: 0.42,
        docid: 'min-score',
        bestChunkPos: 0,
      },
    ]);
    const server = await createOwnedMcpServer(store, {
      env: { HOME: '/home/tester' },
      daemonStateProvider: () => ({
        running: false,
        pidPath: '/home/tester/.cache/qmd/mcp.pid',
        logPath: '/home/tester/.cache/qmd/mcp.log',
      }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'mcp-test-client',
      version: '1.0.0',
    });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const query = await client.callTool({
        name: 'query',
        arguments: {
          searches: [{ type: 'lex', query: 'http mcp' }],
          limit: 1,
          minScore: 0.5,
        },
      });

      expect(query.structuredContent).toMatchObject({
        results: [
          {
            docid: '#high',
            file: 'docs/high-score.md',
            title: 'High Score',
          },
        ],
      });
      expect((query.structuredContent as { results: unknown[] }).results).toHaveLength(1);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
