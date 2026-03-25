import type { QMDStore } from '@tobilu/qmd';
import { describeEffectiveSearchPolicy } from '#src/config/search_policy.js';
import { normalizeSearchResults } from './io/format.js';
import type { QueryLexicalSignalStrength, SearchOutputRow } from './io/types.js';
import { containsHangul } from './kiwi_tokenizer.js';
import { hasConservativeLexSyntax } from './query_search_assist_policy.js';
import {
  preferredSearchRecoveryCommand,
  readSearchIndexHealth,
  type SearchIndexHealth,
  shouldUseShadowSearchIndex,
  summarizeStoredSearchPolicy,
} from './search_index_health.js';
import { searchShadowIndex } from './search_shadow_index.js';

const STRONG_SIGNAL_MIN_SCORE = 0.55;
const MODERATE_SIGNAL_MIN_SCORE = 0.45;
const MISSING_SEARCH_LEX_ERROR = 'Owned lexical probe requires store.searchLex() to be available.';

export interface QueryLexicalProbe {
  readonly rows: SearchOutputRow[];
  readonly signal: QueryLexicalSignalStrength;
  readonly usesShadowIndex: boolean;
  readonly conservativeSyntax: boolean;
  readonly searchHealth?: SearchIndexHealth;
  readonly warning?: string;
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

function filterRowsByCollections(
  rows: readonly SearchOutputRow[],
  selectedCollections: readonly string[],
): SearchOutputRow[] {
  if (selectedCollections.length <= 1) {
    return [...rows];
  }

  return rows.filter((row) => {
    const [collection] = row.displayPath.split('/');
    return collection ? selectedCollections.includes(collection) : false;
  });
}

function buildRowSearchText(row: SearchOutputRow): string {
  return [row.title, row.sourceBody ?? row.body].join('\n').toLowerCase();
}

function extractMeaningfulTerms(query: string): string[] {
  return (query.match(/[A-Za-z0-9_./:-]+|[가-힣]+/g) ?? [])
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 1);
}

function resolveLexicalSignal(
  query: string,
  rows: readonly SearchOutputRow[],
): QueryLexicalSignalStrength {
  if (rows.length === 0) {
    return 'none';
  }

  const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLowerCase();
  const meaningfulTerms = extractMeaningfulTerms(normalizedQuery);
  const topRows = rows.slice(0, 3);
  const wholeFormHit =
    normalizedQuery.length > 0 &&
    topRows.some((row) => buildRowSearchText(row).includes(normalizedQuery));
  const allTermsHit =
    meaningfulTerms.length > 0 &&
    topRows.some((row) => meaningfulTerms.every((term) => buildRowSearchText(row).includes(term)));
  const topScore = rows[0]?.score ?? 0;

  if (
    (wholeFormHit && topScore >= STRONG_SIGNAL_MIN_SCORE) ||
    (allTermsHit && topScore >= STRONG_SIGNAL_MIN_SCORE)
  ) {
    return 'strong';
  }

  if (wholeFormHit || allTermsHit || topScore >= MODERATE_SIGNAL_MIN_SCORE) {
    return 'moderate';
  }

  return 'weak';
}

export async function probeQueryLexicalCandidates(
  store: QMDStore,
  query: string,
  selectedCollections: readonly string[],
  limit = 20,
): Promise<QueryLexicalProbe> {
  const searchPolicy = describeEffectiveSearchPolicy();
  const koreanQuery = containsHangul(query);
  const conservativeSyntax = hasConservativeLexSyntax(query);
  const singleCollection = selectedCollections.length === 1 ? selectedCollections[0] : undefined;

  let searchHealth: SearchIndexHealth | undefined;
  if (koreanQuery && !conservativeSyntax) {
    searchHealth = readSearchIndexHealth(store.internal.db, searchPolicy, {
      collections: selectedCollections,
    });
  }

  const usesShadowIndex = Boolean(searchHealth && shouldUseShadowSearchIndex(searchHealth));
  if (!usesShadowIndex && typeof store.searchLex !== 'function') {
    throw new Error(MISSING_SEARCH_LEX_ERROR);
  }

  const rawRows =
    koreanQuery && !conservativeSyntax && usesShadowIndex
      ? normalizeSearchResults(
          searchShadowIndex(store.internal, query, {
            limit,
            collections: selectedCollections,
          }),
        )
      : normalizeSearchResults(
          await store.searchLex(query, {
            limit,
            collection: singleCollection,
          }),
        );

  const rows = filterRowsByCollections(rawRows, selectedCollections);

  return {
    rows,
    signal: resolveLexicalSignal(query, rows),
    usesShadowIndex,
    conservativeSyntax,
    searchHealth,
    warning:
      koreanQuery && !conservativeSyntax && searchHealth && !usesShadowIndex
        ? buildSearchPolicyWarning(
            searchPolicy.id,
            summarizeStoredSearchPolicy(searchHealth),
            searchHealth.indexedDocuments,
            searchHealth.totalDocuments,
          )
        : undefined,
  };
}
