import type {
  QueryCommandInput,
  SearchAssistMetadata,
  SearchAssistReason,
  SearchOutputRow,
} from './io/types.js';
import { containsHangul } from './kiwi_tokenizer.js';
import type { QueryTraits } from './query_classifier.js';
import type { SearchIndexHealth } from './search_index_health.js';
import { shouldUseShadowSearchIndex } from './search_index_health.js';

export const QUERY_SEARCH_ASSIST_RESCUE_CAP = 2;
export const QUERY_SEARCH_ASSIST_TIMEOUT_MS = 75;
const SEARCH_ASSIST_WHOLE_FORM_SCORE_THRESHOLD = 0.55;
const SEARCH_ASSIST_FULL_TERM_SCORE_THRESHOLD = 0.6;

export interface QuerySearchAssistSkipPolicy {
  readonly kind: 'skip';
  readonly reason: Exclude<SearchAssistReason, 'strong-hit' | 'weak-hit' | 'timeout' | 'error'>;
}

export interface QuerySearchAssistEligiblePolicy {
  readonly kind: 'eligible';
  readonly query: string;
  readonly rescueCap: number;
  readonly timeoutMs: number;
  readonly selectedCollections: readonly string[];
  readonly traits: QueryTraits;
}

export type QuerySearchAssistPolicy = QuerySearchAssistSkipPolicy | QuerySearchAssistEligiblePolicy;

function normalizeAssistScore(score: number): number {
  return Math.max(0.4, Math.min(0.7, 0.4 + score * 0.3));
}

function buildRowSearchText(row: SearchOutputRow): string {
  return [row.title, row.sourceBody ?? row.body].join('\n').toLowerCase();
}

function dedupeKey(row: SearchOutputRow): string {
  return row.docid || row.displayPath;
}

export function hasConservativeLexSyntax(query: string): boolean {
  return query.includes('"') || /(?:^|\s)-(?:"|[^\s"])/.test(query);
}

export function shouldConsiderQuerySearchAssist(
  input: QueryCommandInput,
  traits: QueryTraits,
): boolean {
  if (input.queryMode !== 'plain') {
    return false;
  }

  return traits.queryClass === 'short-korean-phrase' || traits.queryClass === 'mixed-technical';
}

export function evaluateQuerySearchAssistPolicy(args: {
  readonly input: QueryCommandInput;
  readonly traits: QueryTraits;
  readonly searchHealth: SearchIndexHealth;
  readonly selectedCollections: readonly string[];
}): QuerySearchAssistPolicy {
  const { input, traits, searchHealth, selectedCollections } = args;

  if (!shouldConsiderQuerySearchAssist(input, traits) || !containsHangul(input.query)) {
    return { kind: 'skip', reason: 'ineligible' };
  }

  if (hasConservativeLexSyntax(input.query)) {
    return { kind: 'skip', reason: 'conservative-syntax' };
  }

  if (!shouldUseShadowSearchIndex(searchHealth)) {
    return { kind: 'skip', reason: 'dirty-health' };
  }

  return {
    kind: 'eligible',
    query: input.query,
    rescueCap: QUERY_SEARCH_ASSIST_RESCUE_CAP,
    timeoutMs: QUERY_SEARCH_ASSIST_TIMEOUT_MS,
    selectedCollections,
    traits,
  };
}

export function hasStrongSearchAssistHit(
  rows: readonly SearchOutputRow[],
  traits: QueryTraits,
): boolean {
  const meaningfulTerms = traits.terms.filter((term) => term.length > 1);

  return rows.some((row) => {
    const searchText = buildRowSearchText(row);
    if (
      traits.wholeForm.length > 0 &&
      searchText.includes(traits.wholeForm) &&
      row.score >= SEARCH_ASSIST_WHOLE_FORM_SCORE_THRESHOLD
    ) {
      return true;
    }

    return (
      meaningfulTerms.length > 0 &&
      meaningfulTerms.every((term) => searchText.includes(term)) &&
      row.score >= SEARCH_ASSIST_FULL_TERM_SCORE_THRESHOLD
    );
  });
}

export function normalizeSearchAssistRows(rows: readonly SearchOutputRow[]): SearchOutputRow[] {
  return rows.map((row) => ({
    ...row,
    score: normalizeAssistScore(row.score),
    sourceBody: row.sourceBody ?? row.body,
  }));
}

export function mergeRescueCandidates(
  baseRows: readonly SearchOutputRow[],
  assistRows: readonly SearchOutputRow[],
  rescueCap: number,
): { readonly rows: SearchOutputRow[]; readonly addedCandidates: number } {
  const seen = new Set(baseRows.map((row) => dedupeKey(row)));
  const rescued: SearchOutputRow[] = [];

  for (const row of assistRows) {
    if (rescued.length >= rescueCap) {
      break;
    }

    const key = dedupeKey(row);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    rescued.push(row);
  }

  const addedCandidates = rescued.length;
  const rescuedRows = rescued.map((row) => ({
    ...row,
    searchAssist: {
      rescued: true,
      reason: 'strong-hit',
      addedCandidates,
      source: 'shadow',
    } as SearchAssistMetadata,
  }));

  return {
    rows: [...baseRows, ...rescuedRows],
    addedCandidates,
  };
}
