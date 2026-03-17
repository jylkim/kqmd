import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createStore, type QMDStore } from '@tobilu/qmd';
import { isOwnedCommandError } from '#src/commands/owned/io/errors.js';
import { executeQueryCore } from '#src/commands/owned/query_core.js';
import { getDefaultDbPath } from '#src/config/qmd_paths.js';
import { readMcpDaemonState } from './daemon_state.js';
import { buildQueryInputFromRequest, buildQueryResponse } from './query.js';
import { buildInstructions, createOwnedMcpServer } from './server.js';
import type { OwnedMcpServerOptions } from './types.js';
import { queryRequestSchema } from './types.js';

const MAX_HTTP_BODY_BYTES = 64 * 1024;

class InvalidJsonBodyError extends Error {
  constructor() {
    super('Malformed JSON request body.');
    this.name = 'InvalidJsonBodyError';
  }
}

function parseJsonBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InvalidJsonBodyError();
    }

    throw error;
  }
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function assertLocalOrigin(req: IncomingMessage): boolean {
  const origin = getHeader(req, 'origin');
  if (!origin) {
    return true;
  }

  const host = getHeader(req, 'host');
  if (!host) {
    return false;
  }

  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.origin === `http://${host}`;
  } catch {
    return false;
  }
}

async function collectBody(req: IncomingMessage, maxBytes = MAX_HTTP_BODY_BYTES): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBytes) {
      throw new RangeError('Request body too large');
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function startOwnedMcpHttpServer(
  port: number,
  options: OwnedMcpServerOptions & { readonly quiet?: boolean } = {},
): Promise<{
  readonly httpServer: ReturnType<typeof createServer>;
  readonly stop: () => Promise<void>;
}> {
  const env = options.env ?? process.env;
  const quiet = options.quiet ?? false;
  const createStoreImpl = options.createStoreImpl ?? createStore;
  const storeOptions = options.startup ?? {
    dbPath: getDefaultDbPath('index', env),
  };
  const store = options.store ?? (await createStoreImpl(storeOptions));
  const instructions = options.instructions ?? (await buildInstructions(store, env));
  const sessionTtlMs = options.sessionTtlMs ?? 5 * 60 * 1000;
  const metadataTtlMs = options.metadataTtlMs ?? 5 * 1000;
  let queryMetadataCache:
    | {
        readonly loadedAt: number;
        readonly availableCollectionNames: readonly string[];
        readonly defaultCollectionNames: readonly string[];
      }
    | undefined;
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: McpServer; expiresAt: number }
  >();
  const daemonStateProvider = options.daemonStateProvider ?? (() => readMcpDaemonState(env));

  function log(message: string): void {
    if (!quiet) {
      console.error(message);
    }
  }

  async function readQueryMetadata() {
    const now = Date.now();
    if (queryMetadataCache && now - queryMetadataCache.loadedAt < metadataTtlMs) {
      return queryMetadataCache;
    }

    const [availableCollections, defaultCollections] = await Promise.all([
      store.listCollections(),
      store.getDefaultCollectionNames(),
    ]);

    queryMetadataCache = {
      loadedAt: now,
      availableCollectionNames: availableCollections.map((collection) => collection.name),
      defaultCollectionNames: defaultCollections,
    };

    return queryMetadataCache;
  }

  function touchSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.expiresAt = Date.now() + sessionTtlMs;
  }

  async function evictExpiredSessions(): Promise<void> {
    const now = Date.now();
    const expiredSessions = [...sessions.entries()].filter(
      ([, session]) => session.expiresAt <= now,
    );

    await Promise.all(
      expiredSessions.map(async ([sessionId, session]) => {
        sessions.delete(sessionId);
        await session.transport.close();
        await session.server.close();
      }),
    );
  }

  async function createSession() {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, {
          transport,
          server,
          expiresAt: Date.now() + sessionTtlMs,
        });
      },
    });
    const queryMetadata = await readQueryMetadata();
    const server = await createOwnedMcpServer(store, {
      env,
      daemonStateProvider,
      instructions,
      availableCollectionNames: queryMetadata.availableCollectionNames,
      defaultCollectionNames: queryMetadata.defaultCollectionNames,
    });
    await server.connect(transport);
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) {
        sessions.delete(sessionId);
      }
    };

    return { transport, server };
  }

  const startedAt = Date.now();
  const sessionSweeper = setInterval(
    () => {
      void evictExpiredSessions();
    },
    Math.max(10, Math.min(sessionTtlMs, 30_000)),
  );
  sessionSweeper.unref();

  const httpServer = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (!assertLocalOrigin(req)) {
      writeJson(res, 403, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Forbidden origin.' },
        id: null,
      });
      return;
    }

    try {
      if (pathname === '/health' && req.method === 'GET') {
        writeJson(res, 200, {
          status: 'ok',
          uptime: Math.floor((Date.now() - startedAt) / 1000),
        });
        return;
      }

      if ((pathname === '/query' || pathname === '/search') && req.method === 'POST') {
        const rawBody = await collectBody(req);
        const parsedBody = queryRequestSchema.safeParse(parseJsonBody(rawBody));
        if (!parsedBody.success) {
          writeJson(res, 400, { error: 'Invalid query request body.' });
          return;
        }

        const normalized = buildQueryInputFromRequest(parsedBody.data);
        if (isOwnedCommandError(normalized)) {
          writeJson(res, 400, { error: normalized.stderr });
          return;
        }

        const queryMetadata = await readQueryMetadata();
        const result = await executeQueryCore(store, normalized.input, env, {}, queryMetadata);

        if ('kind' in result) {
          writeJson(res, 400, { error: result.stderr });
          return;
        }

        const response = buildQueryResponse(result, normalized.input);

        writeJson(res, 200, {
          query: response.query,
          results: response.rows,
          advisories: response.advisories,
        });
        return;
      }

      if (pathname === '/mcp') {
        const sessionId = getHeader(req, 'mcp-session-id');

        if (req.method === 'POST') {
          const rawBody = await collectBody(req);
          const body = rawBody.length > 0 ? parseJsonBody(rawBody) : undefined;

          if (sessionId) {
            const existing = sessions.get(sessionId);
            if (!existing) {
              writeJson(res, 404, {
                jsonrpc: '2.0',
                error: { code: -32001, message: 'Session not found' },
                id: body && typeof body === 'object' && 'id' in body ? body.id : null,
              });
              return;
            }

            touchSession(sessionId);
            await existing.transport.handleRequest(req, res, body);
            return;
          }

          if (!isInitializeRequest(body)) {
            writeJson(res, 400, {
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Bad Request: Missing session ID' },
              id: body && typeof body === 'object' && 'id' in body ? body.id : null,
            });
            return;
          }

          const session = await createSession();
          await session.transport.handleRequest(req, res, body);
          return;
        }

        if (req.method === 'GET' || req.method === 'DELETE') {
          if (!sessionId) {
            writeJson(res, 400, {
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Bad Request: Missing session ID' },
              id: null,
            });
            return;
          }

          const existing = sessions.get(sessionId);
          if (!existing) {
            writeJson(res, 404, {
              jsonrpc: '2.0',
              error: { code: -32001, message: 'Session not found' },
              id: null,
            });
            return;
          }

          touchSession(sessionId);
          await existing.transport.handleRequest(req, res);
          return;
        }
      }

      writeJson(res, 404, { error: 'Not Found' });
    } catch (error) {
      log(`MCP HTTP error: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof RangeError && error.message === 'Request body too large') {
        writeJson(res, 413, {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Payload Too Large' },
          id: null,
        });
        return;
      }
      if (error instanceof InvalidJsonBodyError) {
        writeJson(res, 400, {
          jsonrpc: '2.0',
          error: { code: -32700, message: error.message },
          id: null,
        });
        return;
      }
      writeJson(res, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, '127.0.0.1', () => resolve());
  });

  async function stop(): Promise<void> {
    clearInterval(sessionSweeper);
    for (const { transport, server } of sessions.values()) {
      await transport.close();
      await server.close();
    }
    sessions.clear();
    await store.close();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }

  process.on('SIGTERM', async () => {
    await stop();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await stop();
    process.exit(0);
  });

  log(`QMD MCP server listening on http://127.0.0.1:${port}/mcp`);
  return { httpServer, stop };
}
