import type { QMDStore, SearchResult } from '@tobilu/qmd';
import { describeEffectiveSearchPolicy } from '#src/config/search_policy.js';
import { normalizeSearchResults } from './io/format.js';
import type {
  QueryRetrievalFallbackReason,
  SearchOutputRow,
} from './io/types.js';
import { containsHangul } from './kiwi_tokenizer.js';
import { hasConservativeLexSyntax } from './query_search_assist_policy.js';
import {
  preferredSearchRecoveryCommand,
  readSearchIndexHealth,
  shouldUseShadowSearchIndex,
  summarizeStoredSearchPolicy,
  type SearchIndexHealth,
} from './search_index_health.js';
import { searchShadowIndex } from './search_shadow_index.js';

export interface LexicalCandidateSearchResult {
  readonly rows: SearchOutputRow[];
  readonly backend: 'shadow' | 'legacy-lexical';
  readonly fallbackReason?: QueryRetrievalFallbackReason;
  readonly searchHealth?: SearchIndexHealth;
  readonly stderr?: string;
}

function buildSearchPolicyWarning(
  expectedPolicyId: string,
  storedPolicy: string,
  indexedDocuments: number,
  totalDocuments: number,
): string {
  return [
    'Korean lexical search index is not ready for the current policy.',
    `Expected search policy: ${expectedPolicyId}`,
    `Stored search policy: ${storedPolicy}`,
    `Indexed documents: ${indexedDocuments}/${totalDocuments}`,
    `Falling back to legacy lexical search. Run '${preferredSearchRecoveryCommand()}' to rebuild the Korean search index.`,
  ].join('\n');
}

async function runLegacyLexicalSearch(
  store: QMDStore,
  query: string,
  selectedCollections: readonly string[],
  limit: number,
): Promise<SearchResult[]> {
  const singleCollection = selectedCollections.length === 1 ? selectedCollections[0] : undefined;
  let results = await store.searchLex(query, {
    limit,
    collection: singleCollection,
  });

  if (selectedCollections.length > 1) {
    results = results.filter((result) => selectedCollections.includes(result.collectionName));
  }

  return results;
}

export async function executeLexicalCandidateSearch(
  store: QMDStore,
  query: string,
  selectedCollections: readonly string[],
  limit: number,
  options: {
    readonly includePolicyWarning?: boolean;
  } = {},
): Promise<LexicalCandidateSearchResult> {
  const koreanQuery = containsHangul(query);
  const conservativeSyntax = hasConservativeLexSyntax(query);

  if (!koreanQuery) {
    return {
      rows: normalizeSearchResults(
        await runLegacyLexicalSearch(store, query, selectedCollections, limit),
      ),
      backend: 'legacy-lexical',
      fallbackReason: 'non-hangul',
    };
  }

  if (conservativeSyntax) {
    return {
      rows: normalizeSearchResults(
        await runLegacyLexicalSearch(store, query, selectedCollections, limit),
      ),
      backend: 'legacy-lexical',
      fallbackReason: 'conservative-syntax',
    };
  }

  const searchPolicy = describeEffectiveSearchPolicy();
  const searchHealth = readSearchIndexHealth(store.internal.db, searchPolicy, {
    collections: [...selectedCollections],
  });

  if (!shouldUseShadowSearchIndex(searchHealth)) {
    return {
      rows: normalizeSearchResults(
        await runLegacyLexicalSearch(store, query, selectedCollections, limit),
      ),
      backend: 'legacy-lexical',
      fallbackReason: 'dirty-health',
      searchHealth,
      stderr: options.includePolicyWarning
        ? buildSearchPolicyWarning(
            searchPolicy.id,
            summarizeStoredSearchPolicy(searchHealth),
            searchHealth.indexedDocuments,
            searchHealth.totalDocuments,
          )
        : undefined,
    };
  }

  return {
    rows: normalizeSearchResults(
      searchShadowIndex(store.internal, query, {
        limit,
        collections: [...selectedCollections],
      }),
    ),
    backend: 'shadow',
    searchHealth,
  };
}
