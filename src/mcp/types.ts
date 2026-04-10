import type { createStore, QMDStore } from '@tobilu/qmd';
import { z } from 'zod';
import type { McpDaemonState } from './daemon_state.js';

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

export const querySubSearchSchema = z.object({
  type: z.enum(['lex', 'vec', 'hyde']),
  query: z.string().min(1).max(500),
});

export const queryRequestSchema = z
  .object({
    query: z.string().min(1).max(6000).optional(),
    searches: z.array(querySubSearchSchema).min(1).max(10).optional(),
    limit: z.number().int().min(1).max(100).optional().default(10),
    minScore: z.number().min(0).max(1).optional().default(0),
    candidateLimit: z.number().int().min(1).max(100).optional(),
    rerank: z.boolean().optional(),
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
