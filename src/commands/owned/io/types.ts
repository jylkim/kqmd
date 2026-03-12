import type { ExpandedQuery, HybridQueryExplain } from '@tobilu/qmd';

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
  readonly explain: boolean;
  readonly intent?: string;
  readonly queryMode: 'plain' | 'structured';
  readonly queries?: ExpandedQuery[];
  readonly displayQuery: string;
}

export interface UpdateCommandInput {
  readonly pull: boolean;
}

export interface EmbedCommandInput {
  readonly force: boolean;
}

export interface SearchOutputRow {
  readonly displayPath: string;
  readonly title: string;
  readonly body: string;
  readonly context: string | null;
  readonly score: number;
  readonly docid: string;
  readonly chunkPos?: number;
  readonly explain?: HybridQueryExplain;
}

export interface OwnedCommandError {
  readonly kind: 'usage' | 'validation' | 'runtime' | 'execution';
  readonly stderr: string;
  readonly exitCode: 1;
}

export type ParseResult<T> = { readonly kind: 'ok'; readonly input: T } | OwnedCommandError;
