import type { QMDStore } from '@tobilu/qmd';
import { normalizeSearchResults } from './io/format.js';
import type { SearchAssistReason, SearchOutputRow } from './io/types.js';
import {
  hasStrongSearchAssistHit,
  normalizeSearchAssistRows,
  type QuerySearchAssistEligiblePolicy,
} from './query_search_assist_policy.js';
import { searchShadowIndex } from './search_shadow_index.js';

export interface QuerySearchAssistDependencies {
  readonly resolveSearchAssistRows?: (
    store: QMDStore,
    policy: QuerySearchAssistEligiblePolicy,
  ) => Promise<SearchOutputRow[]>;
}

export interface QuerySearchAssistResult {
  readonly rows: SearchOutputRow[];
  readonly reason: Extract<SearchAssistReason, 'strong-hit' | 'weak-hit' | 'timeout' | 'error'>;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed out/i.test(error.message);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Query search assist timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function resolveQuerySearchAssist(
  store: QMDStore,
  policy: QuerySearchAssistEligiblePolicy,
  dependencies: QuerySearchAssistDependencies = {},
): Promise<QuerySearchAssistResult> {
  try {
    const rows = dependencies.resolveSearchAssistRows
      ? await withTimeout(dependencies.resolveSearchAssistRows(store, policy), policy.timeoutMs)
      : normalizeSearchResults(
          searchShadowIndex(store.internal, policy.query, {
            limit: Math.max(policy.rescueCap * 3, 6),
            collections: policy.selectedCollections,
          }),
        );

    if (!hasStrongSearchAssistHit(rows, policy.traits)) {
      return { rows: [], reason: 'weak-hit' };
    }

    return {
      rows: normalizeSearchAssistRows(rows),
      reason: 'strong-hit',
    };
  } catch (error) {
    return {
      rows: [],
      reason: isTimeoutError(error) ? 'timeout' : 'error',
    };
  }
}
