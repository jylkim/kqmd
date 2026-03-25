import type { ExpandedQuery, HybridQueryExplain, IndexStatus } from '@tobilu/qmd';
import type { EmbeddingHealth } from '#src/commands/owned/embedding_health.js';
import type { SearchIndexHealth } from '#src/commands/owned/search_index_health.js';
import type { EffectiveEmbedModel } from '#src/config/embedding_policy.js';
import type { EffectiveSearchPolicy } from '#src/config/search_policy.js';

export type SearchOutputFormat = 'cli' | 'json' | 'csv' | 'md' | 'xml' | 'files';

export interface SearchCommandInput {
  readonly query: string;
  readonly format: SearchOutputFormat;
  readonly limit: number;
  readonly minScore: number;
  readonly all: boolean;
  readonly full: boolean;
  readonly lineNumbers: boolean;
  readonly collections?: string[];
}

export interface QueryCommandInput extends SearchCommandInput {
  readonly candidateLimit?: number;
  readonly disableRerank?: boolean;
  readonly fetchLimit?: number;
  readonly explain: boolean;
  readonly intent?: string;
  readonly queryMode: 'plain' | 'structured';
  readonly queries?: ExpandedQuery[];
  readonly displayQuery: string;
}

export type QueryClass = 'short-korean-phrase' | 'mixed-technical' | 'general' | 'structured';

export interface PlainQuerySearchRequest extends SearchCommandInput {
  readonly candidateLimit?: number;
  readonly disableRerank?: boolean;
  readonly fetchLimit?: number;
  readonly explain: boolean;
  readonly intent?: string;
  readonly preExpandedQueries?: ExpandedQuery[];
  readonly queryMode: 'plain';
  readonly runtimeKind?: 'cost-capped-structured' | 'compatibility-hybrid' | 'compatibility-public';
  readonly displayQuery: string;
}

export type SearchAssistReason =
  | 'strong-hit'
  | 'ineligible'
  | 'dirty-health'
  | 'conservative-syntax'
  | 'weak-hit'
  | 'timeout'
  | 'error';

export interface AdaptiveQueryExplain {
  readonly queryClass: QueryClass;
  readonly candidateSource: 'adaptive' | 'structured-compatibility';
  readonly vectorStrength: 'strong' | 'weak' | 'absent';
  readonly baseScore: number;
  readonly adjustedScore: number;
  readonly phrase: number;
  readonly title: number;
  readonly heading: number;
  readonly coverage: number;
  readonly proximity: number;
  readonly literalAnchor: number;
}

export type QueryNormalizationReason =
  | 'not-eligible'
  | 'applied'
  | 'skipped-guard'
  | 'skipped-same-or-empty'
  | 'failed-open'
  | 'latency-budget';

export interface QueryNormalizationSkipPlan {
  readonly kind: 'skip';
  readonly reason: Exclude<QueryNormalizationReason, 'applied' | 'failed-open' | 'latency-budget'>;
}

export interface QueryNormalizationApplyPlan {
  readonly kind: 'apply';
  readonly normalizedQuery: string;
  readonly keptTerms: readonly string[];
}

export type QueryNormalizationPlan = QueryNormalizationSkipPlan | QueryNormalizationApplyPlan;

export interface QueryNormalizationSummary {
  readonly applied: boolean;
  readonly reason: QueryNormalizationReason;
  readonly addedCandidates: number;
}

export interface SearchAssistSummary {
  readonly applied: boolean;
  readonly reason: SearchAssistReason;
  readonly addedCandidates: number;
}

export type QueryLexicalSignalStrength = 'strong' | 'moderate' | 'weak' | 'none';

export type QueryExecutionFallbackReason =
  | 'fast-default'
  | 'conservative-syntax'
  | 'compatibility-structured'
  | 'compatibility-explicit-intent'
  | 'compatibility-explicit-candidate-limit'
  | 'compatibility-explicit-collection-filter'
  | 'compatibility-multi-collection-default'
  | 'compatibility-public-fallback';

export interface QueryExecutionStagesSummary {
  readonly retrievalKind:
    | 'cost-capped-structured'
    | 'compatibility-hybrid'
    | 'compatibility-public'
    | 'structured-compatibility';
  readonly fallbackReason: QueryExecutionFallbackReason;
  readonly lexicalSignal: QueryLexicalSignalStrength;
  readonly embeddingApplied: boolean;
  readonly expansionApplied: boolean;
  readonly rerankApplied: boolean;
  readonly heavyPathUsed: boolean;
  readonly candidateWindow: number;
}

export interface QueryExecutionSummary {
  readonly mode: QueryCommandInput['queryMode'];
  readonly primaryQuery: string;
  readonly intent?: string;
  readonly queryClass: QueryClass;
  readonly execution: QueryExecutionStagesSummary;
  readonly normalization: QueryNormalizationSummary;
  readonly searchAssist: SearchAssistSummary;
}

export interface SearchAssistMetadata {
  readonly rescued: true;
  readonly reason: Extract<SearchAssistReason, 'strong-hit'>;
  readonly addedCandidates: number;
  readonly source: 'shadow';
}

export type UpdateCommandInput = Record<string, never>;

export interface EmbedCommandInput {
  readonly force: boolean;
}

export type StatusCommandInput = Record<string, never>;

export interface SearchOutputRow {
  readonly displayPath: string;
  readonly title: string;
  readonly body: string;
  readonly sourceBody?: string;
  readonly context: string | null;
  readonly score: number;
  readonly docid: string;
  readonly chunkPos?: number;
  readonly sourceChunkPos?: number;
  readonly explain?: HybridQueryExplain;
  readonly adaptive?: AdaptiveQueryExplain;
  readonly normalization?: {
    readonly supplemented: true;
  };
  readonly searchAssist?: SearchAssistMetadata;
}

export interface StatusCommandOutput {
  readonly dbPath: string;
  readonly effectiveModel: EffectiveEmbedModel;
  readonly searchPolicy: EffectiveSearchPolicy;
  readonly status: IndexStatus;
  readonly health: EmbeddingHealth;
  readonly searchHealth: SearchIndexHealth;
}

export interface OwnedCommandError {
  readonly kind: 'usage' | 'validation' | 'runtime' | 'execution';
  readonly stderr: string;
  readonly exitCode: 1;
}

export type CleanupCommandInput = Record<string, never>;

export interface CleanupCommandOutput {
  readonly cachedResponsesCleared: number;
  readonly inactiveDocumentsRemoved: number;
  readonly orphanedContentRemoved: number;
  readonly orphanedEmbeddingsRemoved: number;
  readonly vacuumed: boolean;
  readonly shadowIndexRebuilt: boolean;
  readonly shadowIndexDocuments?: number;
}

export type ParseResult<T> = { readonly kind: 'ok'; readonly input: T } | OwnedCommandError;
