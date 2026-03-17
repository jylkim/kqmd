import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  addLineNumbers,
  createStore,
  DEFAULT_MULTI_GET_MAX_BYTES,
  type QMDStore,
} from '@tobilu/qmd';
import { z } from 'zod';
import { isOwnedCommandError } from '#src/commands/owned/io/errors.js';
import { executeQueryCore } from '#src/commands/owned/query_core.js';
import { readStatusCore } from '#src/commands/owned/status_core.js';
import { getDefaultDbPath } from '#src/config/qmd_paths.js';
import { readMcpDaemonState } from './daemon_state.js';
import {
  buildQueryInputFromRequest,
  buildQueryResponse,
  encodeQmdPath,
} from './query.js';
import type { OwnedMcpServerOptions } from './types.js';
import { queryRequestSchema } from './types.js';

// Re-export public API for backwards compatibility
export type { OwnedMcpServerOptions } from './types.js';
export { startOwnedMcpHttpServer } from './http.js';

export async function buildInstructions(store: QMDStore, env: NodeJS.ProcessEnv): Promise<string> {
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
