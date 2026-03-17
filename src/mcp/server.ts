import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  addLineNumbers,
  createStore,
  DEFAULT_MULTI_GET_MAX_BYTES,
  type ExpandedQuery,
  type QMDStore,
} from '@tobilu/qmd';
import { z } from 'zod';
import { isOwnedCommandError, validationError } from '../commands/owned/io/errors.js';
import { buildMcpQueryRows } from '../commands/owned/io/query_rows.js';
import type { QueryCommandInput } from '../commands/owned/io/types.js';
import {
  parseStructuredQueryDocument,
  validatePlainQueryText,
  validateSingleLineQueryText,
} from '../commands/owned/io/validate.js';
import { classifyQuery } from '../commands/owned/query_classifier.js';
import { executeQueryCore } from '../commands/owned/query_core.js';
import { readStatusCore } from '../commands/owned/status_core.js';
import { getDefaultDbPath } from '../config/qmd_paths.js';
import { type McpDaemonState, readMcpDaemonState } from './daemon_state.js';

export interface OwnedMcpServerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly daemonStateProvider?: () => McpDaemonState;
  readonly store?: QMDStore;
  readonly createStoreImpl?: typeof createStore;
  readonly startup?: {
    readonly dbPath: string;
    readonly configPath?: string;
  };
  readonly instructions?: string;
  readonly availableCollectionNames?: readonly string[];
  readonly defaultCollectionNames?: readonly string[];
  readonly sessionTtlMs?: number;
  readonly metadataTtlMs?: number;
}

const querySubSearchSchema = z.object({
  type: z.enum(['lex', 'vec', 'hyde']),
  query: z.string().min(1).max(500),
});

const queryRequestSchema = z
  .object({
    query: z.string().min(1).max(6000).optional(),
    searches: z.array(querySubSearchSchema).min(1).max(10).optional(),
    limit: z.number().int().min(1).max(100).optional().default(10),
    minScore: z.number().min(0).max(1).optional().default(0),
    candidateLimit: z.number().int().min(1).max(100).optional(),
    collections: z.array(z.string()).max(20).optional(),
    intent: z.string().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    const hasQuery = typeof value.query === 'string' && value.query.length > 0;
    const hasSearches = Array.isArray(value.searches) && value.searches.length > 0;

    if (hasQuery === hasSearches) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide exactly one of `query` or `searches`.',
        path: ['query'],
      });
    }
  });

const MAX_HTTP_BODY_BYTES = 64 * 1024;

class InvalidJsonBodyError extends Error {
  constructor() {
    super('Malformed JSON request body.');
    this.name = 'InvalidJsonBodyError';
  }
}

function encodeQmdPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function formatSearchSummary(
  results: Array<{
    readonly docid: string;
    readonly file: string;
    readonly title: string;
    readonly score: number;
  }>,
  query: string,
  advisories: readonly string[],
): string {
  const lines =
    results.length === 0
      ? [`No results found for "${query}"`]
      : [
          `Found ${results.length} result${results.length === 1 ? '' : 's'} for "${query}":`,
          '',
          ...results.map(
            (result) =>
              `${result.docid} ${Math.round(result.score * 100)}% ${result.file} - ${result.title}`,
          ),
        ];

  if (advisories.length > 0) {
    lines.push(
      '',
      'Advisories:',
      ...advisories.map((advisory) => `- ${advisory.replaceAll('\n', ' ')}`),
    );
  }

  return lines.join('\n');
}

function resolvePrimaryQuery(
  searches: Array<{ readonly type: 'lex' | 'vec' | 'hyde'; readonly query: string }>,
): string {
  return (
    searches.find((search) => search.type === 'lex')?.query ??
    searches.find((search) => search.type === 'vec')?.query ??
    searches[0]?.query ??
    ''
  );
}

function shapeQueryRows(
  rows: Awaited<ReturnType<typeof executeQueryCore>> extends infer Result
    ? Result extends { rows: infer QueryRows }
      ? QueryRows
      : never
    : never,
  primaryQuery: string,
  intent?: string,
) {
  return buildMcpQueryRows(rows, primaryQuery, intent);
}

function buildQueryResponse(
  result: Awaited<ReturnType<typeof executeQueryCore>> extends infer QueryResult
    ? QueryResult extends { rows: infer QueryRows; advisories: infer QueryAdvisories }
      ? { readonly rows: QueryRows; readonly advisories: QueryAdvisories }
      : never
    : never,
  input: QueryCommandInput,
) {
  const rows = shapeQueryRows(result.rows, input.displayQuery, input.intent);

  return {
    primaryQuery: input.displayQuery,
    rows,
    advisories: result.advisories,
    query: {
      mode: input.queryMode,
      primaryQuery: input.displayQuery,
      intent: input.intent,
      queryClass: classifyQuery(input).queryClass,
    },
    text: formatSearchSummary(
      rows.map((row) => ({
        docid: row.docid,
        file: row.file,
        title: row.title,
        score: row.score,
      })),
      input.displayQuery,
      result.advisories,
    ),
  };
}

function normalizeCollections(
  collections?: string[],
): string[] | undefined | ReturnType<typeof validationError> {
  if (!collections) {
    return collections;
  }

  for (const [index, collection] of collections.entries()) {
    const validation = validateSingleLineQueryText(collection, `Collection ${index + 1}`);
    if (validation) {
      return validation;
    }
  }

  return collections;
}

function buildStructuredQueryText(
  searches: Array<{ readonly type: 'lex' | 'vec' | 'hyde'; readonly query: string }>,
  intent?: string,
) {
  return [
    ...searches.map((search) => `${search.type}: ${search.query}`),
    ...(intent ? [`intent: ${intent}`] : []),
  ].join('\n');
}

function normalizeStructuredSearches(
  searches: Array<{ readonly type: 'lex' | 'vec' | 'hyde'; readonly query: string }>,
  intent?: string,
) {
  const parsed = parseStructuredQueryDocument(buildStructuredQueryText(searches, intent));
  if (isOwnedCommandError(parsed)) {
    return parsed;
  }

  if (parsed === null) {
    return validationError('Structured query payload must include at least one search.');
  }

  return {
    searches: parsed.searches as ExpandedQuery[],
    intent: parsed.intent,
  };
}

function buildQueryInputFromRequest(
  body: z.infer<typeof queryRequestSchema>,
): { readonly input: QueryCommandInput } | ReturnType<typeof validationError> {
  const collections = normalizeCollections(body.collections);
  if (isOwnedCommandError(collections)) {
    return collections;
  }

  if (body.searches) {
    const normalized = normalizeStructuredSearches(body.searches, body.intent);
    if (isOwnedCommandError(normalized)) {
      return normalized;
    }

    const primaryQuery = resolvePrimaryQuery(normalized.searches);
    return {
      input: {
        query: buildStructuredQueryText(normalized.searches, normalized.intent),
        format: 'json',
        limit: body.limit ?? 10,
        minScore: body.minScore ?? 0,
        all: false,
        full: false,
        lineNumbers: false,
        collections,
        candidateLimit: body.candidateLimit,
        explain: false,
        intent: normalized.intent,
        queryMode: 'structured',
        queries: normalized.searches,
        displayQuery: primaryQuery,
      },
    };
  }

  const query = body.query ?? '';
  const structuredQuery = parseStructuredQueryDocument(query);
  if (isOwnedCommandError(structuredQuery)) {
    return structuredQuery;
  }

  if (structuredQuery?.intent && body.intent) {
    return validationError(
      'Structured query documents with `intent:` cannot also provide a top-level `intent`.',
    );
  }

  if (structuredQuery === null) {
    const validation = validatePlainQueryText(query);
    if (validation) {
      return validation;
    }

    if (body.intent) {
      const intentValidation = validateSingleLineQueryText(body.intent, 'Intent');
      if (intentValidation) {
        return intentValidation;
      }
    }

    return {
      input: {
        query,
        format: 'json',
        limit: body.limit ?? 10,
        minScore: body.minScore ?? 0,
        all: false,
        full: false,
        lineNumbers: false,
        collections,
        candidateLimit: body.candidateLimit,
        explain: false,
        intent: body.intent,
        queryMode: 'plain',
        displayQuery: query,
      },
    };
  }

  return {
    input: {
      query,
      format: 'json',
      limit: body.limit ?? 10,
      minScore: body.minScore ?? 0,
      all: false,
      full: false,
      lineNumbers: false,
      collections,
      candidateLimit: body.candidateLimit,
      explain: false,
      intent: structuredQuery.intent,
      queryMode: 'structured',
      queries: structuredQuery.searches,
      displayQuery: resolvePrimaryQuery(structuredQuery.searches),
    },
  };
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

async function buildInstructions(store: QMDStore, env: NodeJS.ProcessEnv): Promise<string> {
  const status = await readStatusCore(store, env);
  const contexts = await store.listContexts();
  const globalCtx = await store.getGlobalContext();
  const lines = [
    `QMD is your local search engine over ${status.status.totalDocuments} markdown documents.`,
  ];

  if (globalCtx) {
    lines.push(`Context: ${globalCtx}`);
  }

  if (status.status.collections.length > 0) {
    lines.push('', 'Collections (scope with `collections` parameter):');
    for (const collection of status.status.collections) {
      const rootContext = contexts.find(
        (context) =>
          context.collection === collection.name && (context.path === '' || context.path === '/'),
      );
      lines.push(
        `  - "${collection.name}" (${collection.documents} docs)${
          rootContext ? ` — ${rootContext.context}` : ''
        }`,
      );
    }
  }

  if (status.health.kind !== 'clean') {
    lines.push('', `Embedding health: ${status.health.kind.replaceAll('-', ' ')}`);
  }

  if (status.searchHealth.kind !== 'clean') {
    lines.push(
      '',
      `Korean lexical search health: ${status.searchHealth.kind.replaceAll('-', ' ')}`,
    );
  }

  lines.push(
    '',
    'Workflow:',
    '  - Use `query` to find relevant documents first.',
    '  - Use `get` to inspect one document in full or from a specific line.',
    '  - Use `multi_get` when you need a small batch of matched documents.',
    '  - Use `status` before or after retrieval when you need index, embedding, or daemon health.',
  );

  return lines.join('\n');
}

export async function createOwnedMcpServer(
  store: QMDStore,
  options: OwnedMcpServerOptions = {},
): Promise<McpServer> {
  const env = options.env ?? process.env;
  const daemonStateProvider = options.daemonStateProvider ?? (() => readMcpDaemonState(env));
  const server = new McpServer(
    { name: 'qmd', version: '0.1.0' },
    { instructions: options.instructions ?? (await buildInstructions(store, env)) },
  );

  server.registerResource(
    'document',
    new ResourceTemplate('qmd://{+path}', { list: undefined }),
    {
      title: 'QMD Document',
      description: 'A markdown document from the local QMD index.',
      mimeType: 'text/markdown',
    },
    async (uri, { path }) => {
      const pathString = Array.isArray(path) ? path.join('/') : (path ?? '');
      const decodedPath = decodeURIComponent(pathString);
      const result = await store.get(decodedPath, { includeBody: true });

      if ('error' in result) {
        return { contents: [{ uri: uri.href, text: `Document not found: ${decodedPath}` }] };
      }

      let text = addLineNumbers(result.body ?? '');
      if (result.context) {
        text = `<!-- Context: ${result.context} -->\n\n${text}`;
      }

      return {
        contents: [
          {
            uri: uri.href,
            name: result.displayPath,
            title: result.title || result.displayPath,
            mimeType: 'text/markdown',
            text,
          },
        ],
      };
    },
  );

  server.registerTool(
    'query',
    {
      title: 'Query',
      description:
        'Search the knowledge base using either a plain adaptive query or structured lex/vec/hyde sub-queries.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: queryRequestSchema as never,
    } as never,
    (async ({
      query,
      searches,
      limit,
      minScore,
      candidateLimit,
      collections,
      intent,
    }: {
      query?: string;
      searches?: Array<{ readonly type: 'lex' | 'vec' | 'hyde'; readonly query: string }>;
      limit: number;
      minScore: number;
      candidateLimit?: number;
      collections?: string[];
      intent?: string;
    }) => {
      const normalized = buildQueryInputFromRequest({
        query,
        searches,
        limit,
        minScore,
        candidateLimit,
        collections,
        intent,
      });
      if (isOwnedCommandError(normalized)) {
        return {
          content: [{ type: 'text', text: normalized.stderr }],
          isError: true,
        };
      }

      const result = await executeQueryCore(
        store,
        normalized.input,
        env,
        {},
        {
          availableCollectionNames: options.availableCollectionNames,
          defaultCollectionNames: options.defaultCollectionNames,
        },
      );

      if ('kind' in result) {
        return {
          content: [{ type: 'text', text: result.stderr }],
          isError: true,
        };
      }

      const response = buildQueryResponse(result, normalized.input);

      return {
        content: [
          {
            type: 'text',
            text: response.text,
          },
        ],
        structuredContent: {
          query: response.query,
          results: response.rows,
          advisories: response.advisories,
        },
      };
    }) as never,
  );

  server.registerTool(
    'get',
    {
      title: 'Get Document',
      description: 'Retrieve a document by display path or docid, optionally sliced by line range.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({
        file: z.string().min(1).max(2000),
        fromLine: z.number().int().min(1).max(1_000_000).optional(),
        maxLines: z.number().int().min(1).max(10_000).optional(),
        lineNumbers: z.boolean().optional().default(false),
      }) as never,
    } as never,
    (async ({
      file,
      fromLine,
      maxLines,
      lineNumbers,
    }: {
      file: string;
      fromLine?: number;
      maxLines?: number;
      lineNumbers: boolean;
    }) => {
      let parsedFromLine = fromLine;
      let lookup = file;
      const suffix = lookup.match(/:(\d+)$/);
      if (suffix && parsedFromLine === undefined) {
        parsedFromLine = Number.parseInt(suffix[1], 10);
        lookup = lookup.slice(0, -suffix[0].length);
      }

      const result = await store.get(lookup, { includeBody: false });
      if ('error' in result) {
        return {
          content: [
            {
              type: 'text',
              text:
                result.similarFiles.length > 0
                  ? `Document not found: ${file}\n\nDid you mean one of these?\n${result.similarFiles
                      .map((entry) => `  - ${entry}`)
                      .join('\n')}`
                  : `Document not found: ${file}`,
            },
          ],
          isError: true,
        };
      }

      let text =
        (await store.getDocumentBody(result.filepath, { fromLine: parsedFromLine, maxLines })) ??
        '';
      if (lineNumbers) {
        text = addLineNumbers(text, parsedFromLine ?? 1);
      }
      if (result.context) {
        text = `<!-- Context: ${result.context} -->\n\n${text}`;
      }

      return {
        content: [
          {
            type: 'resource',
            resource: {
              uri: `qmd://${encodeQmdPath(result.displayPath)}`,
              name: result.displayPath,
              title: result.title,
              mimeType: 'text/markdown',
              text,
            },
          },
        ],
      };
    }) as never,
  );

  server.registerTool(
    'multi_get',
    {
      title: 'Multi-Get Documents',
      description: 'Retrieve multiple documents by glob pattern or comma-separated path list.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({
        pattern: z.string().min(1).max(2000),
        maxLines: z.number().int().min(1).max(10_000).optional(),
        maxBytes: z.number().int().min(1).max(1_000_000).optional().default(10_240),
        lineNumbers: z.boolean().optional().default(false),
      }) as never,
    } as never,
    (async ({
      pattern,
      maxLines,
      maxBytes,
      lineNumbers,
    }: {
      pattern: string;
      maxLines?: number;
      maxBytes: number;
      lineNumbers: boolean;
    }) => {
      const { docs, errors } = await store.multiGet(pattern, {
        includeBody: true,
        maxBytes: maxBytes ?? DEFAULT_MULTI_GET_MAX_BYTES,
      });

      if (docs.length === 0 && errors.length === 0) {
        return {
          content: [{ type: 'text', text: `No files matched pattern: ${pattern}` }],
          isError: true,
        };
      }

      const content: Array<Record<string, unknown>> = [];
      if (errors.length > 0) {
        content.push({ type: 'text', text: `Errors:\n${errors.join('\n')}` });
      }

      for (const result of docs) {
        if (result.skipped) {
          content.push({
            type: 'text',
            text: `[SKIPPED: ${result.doc.displayPath} - ${result.skipReason}]`,
          });
          continue;
        }

        let text = result.doc.body ?? '';
        if (maxLines !== undefined) {
          const lines = text.split('\n');
          text = lines.slice(0, maxLines).join('\n');
          if (lines.length > maxLines) {
            text += `\n\n[... truncated ${lines.length - maxLines} more lines]`;
          }
        }
        if (lineNumbers) {
          text = addLineNumbers(text);
        }
        if (result.doc.context) {
          text = `<!-- Context: ${result.doc.context} -->\n\n${text}`;
        }

        content.push({
          type: 'resource',
          resource: {
            uri: `qmd://${encodeQmdPath(result.doc.displayPath)}`,
            name: result.doc.displayPath,
            title: result.doc.title,
            mimeType: 'text/markdown',
            text,
          },
        });
      }

      return { content };
    }) as never,
  );

  server.registerTool(
    'status',
    {
      title: 'Index Status',
      description: 'Show index health and MCP daemon state using K-QMD-owned status vocabulary.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({}) as never,
    } as never,
    (async () => {
      const status = await readStatusCore(store, env);
      const daemon = daemonStateProvider();
      const advisories = daemon.advisory ? [daemon.advisory] : [];
      const summary = [
        'QMD Index Status:',
        `  Total documents: ${status.status.totalDocuments}`,
        `  Needs embedding: ${status.status.needsEmbedding}`,
        `  Vector index: ${status.status.hasVectorIndex ? 'yes' : 'no'}`,
        `  Embedding health: ${status.health.kind}`,
        `  Korean search health: ${status.searchHealth.kind}`,
        `  MCP: ${daemon.running ? `running (PID ${daemon.pid})` : 'not running'}`,
        ...(advisories.length > 0
          ? ['', 'Advisories:', ...advisories.map((advisory) => `  - ${advisory}`)]
          : []),
      ];

      for (const collection of status.status.collections) {
        summary.push(`    - ${collection.name} (${collection.documents} docs)`);
      }

      return {
        content: [{ type: 'text', text: summary.join('\n') }],
        structuredContent: {
          domain: {
            status: status.status,
            health: status.health,
            searchHealth: status.searchHealth,
            effectiveModel: status.effectiveModel.uri,
            searchPolicy: status.searchPolicy.id,
          },
          transport: {
            mcp: daemon,
          },
          advisories,
        },
      };
    }) as never,
  );

  return server;
}

export async function startOwnedMcpServer(options: OwnedMcpServerOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const createStoreImpl = options.createStoreImpl ?? createStore;
  const storeOptions = options.startup ?? {
    dbPath: getDefaultDbPath('index', env),
  };
  const store = options.store ?? (await createStoreImpl(storeOptions));
  const server = await createOwnedMcpServer(store, options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
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
