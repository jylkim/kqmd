import type { SearchResult } from '@tobilu/qmd';

import type { EffectiveSearchPolicy } from '#src/config/search_policy.js';
import {
  KQMD_SEARCH_COLLECTION_SNAPSHOTS_METADATA_KEY,
  KQMD_SEARCH_POLICY_METADATA_KEY,
  KQMD_SEARCH_SHADOW_TABLE,
  KQMD_SEARCH_SOURCE_SNAPSHOT_METADATA_KEY,
} from '#src/config/search_policy.js';
import type { MinimalDatabase } from '#src/types/database.js';
import { buildShadowProjectionText, type KiwiTokenizerDependencies } from './kiwi_tokenizer.js';
import type {
  SearchCollectionSnapshotMap,
  SearchSourceSnapshot,
} from './search_index_health.js';

type SearchStoreLike = {
  readonly db: MinimalDatabase;
  getContextForFile(filepath: string): string | null;
};

type RebuildRow = {
  readonly id: number;
  readonly collection: string;
  readonly path: string;
  readonly title: string;
  readonly body: string;
  readonly modified_at?: string;
};

type ShadowSearchRow = {
  readonly filepath: string;
  readonly display_path: string;
  readonly title: string;
  readonly body: string;
  readonly hash: string;
  readonly modified_at: string;
  readonly collection: string;
  readonly bm25_score: number;
};

export interface SearchShadowIndexDependencies {
  readonly tokenize?: (text: string, dependencies?: KiwiTokenizerDependencies) => Promise<string>;
  readonly kiwiDependencies?: KiwiTokenizerDependencies;
}

export interface SearchShadowIndexRebuildResult {
  readonly indexedDocuments: number;
  readonly projectionDurationMs: number;
  readonly writeDurationMs: number;
  readonly totalDurationMs: number;
  readonly sourceSnapshot: SearchSourceSnapshot;
}

function sanitizeFTS5Term(term: string): string {
  return term.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase();
}

function buildFTS5Query(query: string): string | null {
  const positive: string[] = [];
  const negative: string[] = [];
  let index = 0;
  const source = query.trim();

  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index] ?? '')) {
      index += 1;
    }

    if (index >= source.length) {
      break;
    }

    const negated = source[index] === '-';
    if (negated) {
      index += 1;
    }

    if (source[index] === '"') {
      const start = index + 1;
      index += 1;
      while (index < source.length && source[index] !== '"') {
        index += 1;
      }

      const phrase = source.slice(start, index).trim();
      index += 1;
      if (!phrase) {
        continue;
      }

      const sanitized = phrase
        .split(/\s+/)
        .map((term) => sanitizeFTS5Term(term))
        .filter(Boolean)
        .join(' ');
      if (!sanitized) {
        continue;
      }

      const ftsPhrase = `"${sanitized}"`;
      if (negated) {
        negative.push(ftsPhrase);
      } else {
        positive.push(ftsPhrase);
      }

      continue;
    }

    const start = index;
    while (index < source.length && !/[\s"]/.test(source[index] ?? '')) {
      index += 1;
    }

    const sanitized = sanitizeFTS5Term(source.slice(start, index));
    if (!sanitized) {
      continue;
    }

    const ftsTerm = `"${sanitized}"*`;
    if (negated) {
      negative.push(ftsTerm);
    } else {
      positive.push(ftsTerm);
    }
  }

  if (positive.length === 0) {
    return null;
  }

  let result = positive.join(' AND ');
  for (const term of negative) {
    result = `${result} NOT ${term}`;
  }

  return result;
}

function toDocId(hash: string): string {
  return hash.slice(0, 6);
}

function buildShadowProjection(
  collection: string,
  path: string,
  title: string,
  body: string,
  tokenize: (text: string, dependencies?: KiwiTokenizerDependencies) => Promise<string>,
  dependencies?: KiwiTokenizerDependencies,
): Promise<{
  readonly filepath: string;
  readonly title: string;
  readonly body: string;
}> {
  return Promise.all([
    tokenize(`${collection}/${path}`, dependencies),
    tokenize(title, dependencies),
    tokenize(body, dependencies),
  ]).then(([filepathProjection, titleProjection, bodyProjection]) => ({
    filepath: filepathProjection,
    title: titleProjection,
    body: bodyProjection,
  }));
}

export function ensureSearchShadowTable(db: MinimalDatabase): void {
  db.exec(
    [
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${KQMD_SEARCH_SHADOW_TABLE} USING fts5(`,
      '  filepath,',
      '  title,',
      '  body,',
      "  tokenize='porter unicode61'",
      ')',
    ].join('\n'),
  );
}

function listActiveDocuments(db: MinimalDatabase): RebuildRow[] {
  return db
    .prepare(
      [
        'SELECT d.id, d.collection, d.path, d.title, c.doc AS body, d.modified_at',
        'FROM documents d',
        'JOIN content c ON c.hash = d.hash',
        'WHERE d.active = 1',
        'ORDER BY d.id ASC',
      ].join('\n'),
    )
    .all()
    .map((row) => row as RebuildRow);
}

function beginTransaction(db: MinimalDatabase): void {
  db.exec('BEGIN IMMEDIATE');
}

function commitTransaction(db: MinimalDatabase): void {
  db.exec('COMMIT');
}

function rollbackTransaction(db: MinimalDatabase): void {
  db.exec('ROLLBACK');
}

function buildSearchSourceSnapshot(rows: readonly RebuildRow[]): SearchSourceSnapshot {
  let latestModifiedAt: string | undefined;
  let maxDocumentId: number | undefined;

  for (const row of rows) {
    if (latestModifiedAt === undefined || (row.modified_at && row.modified_at > latestModifiedAt)) {
      latestModifiedAt = row.modified_at;
    }

    if (maxDocumentId === undefined || row.id > maxDocumentId) {
      maxDocumentId = row.id;
    }
  }

  return {
    totalDocuments: rows.length,
    latestModifiedAt,
    maxDocumentId,
  };
}

function buildCollectionSnapshots(rows: readonly RebuildRow[]): SearchCollectionSnapshotMap {
  const snapshots: SearchCollectionSnapshotMap = {};

  for (const row of rows) {
    const current = snapshots[row.collection];

    snapshots[row.collection] = {
      totalDocuments: (current?.totalDocuments ?? 0) + 1,
      latestModifiedAt:
        current?.latestModifiedAt === undefined ||
        (row.modified_at && row.modified_at > current.latestModifiedAt)
          ? row.modified_at
          : current.latestModifiedAt,
      maxDocumentId:
        current?.maxDocumentId === undefined || row.id > current.maxDocumentId
          ? row.id
          : current.maxDocumentId,
    };
  }

  return snapshots;
}

function upsertSearchMetadata(db: MinimalDatabase, key: string, value: string): void {
  db.prepare(
    [
      'INSERT INTO store_config (key, value) VALUES (?, ?)',
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ].join('\n'),
  ).run(key, value);
}

export async function rebuildSearchShadowIndex(
  db: MinimalDatabase,
  policy: EffectiveSearchPolicy,
  dependencies: SearchShadowIndexDependencies = {},
): Promise<SearchShadowIndexRebuildResult> {
  const totalStart = Date.now();
  const tokenize =
    dependencies.tokenize ??
    ((text: string, kiwiDependencies?: KiwiTokenizerDependencies) =>
      buildShadowProjectionText(text, kiwiDependencies));
  const kiwiDependencies = dependencies.kiwiDependencies;
  const rows = listActiveDocuments(db);
  const snapshot = buildSearchSourceSnapshot(rows);
  const collectionSnapshots = buildCollectionSnapshots(rows);
  const projectionStart = Date.now();
  const projections = await Promise.all(
    rows.map(async (row) => ({
      rowId: row.id,
      projection: await buildShadowProjection(
        row.collection,
        row.path,
        row.title,
        row.body,
        tokenize,
        kiwiDependencies,
      ),
    })),
  );
  const projectionDurationMs = Date.now() - projectionStart;

  const writeStart = Date.now();
  beginTransaction(db);
  try {
    ensureSearchShadowTable(db);

    db.prepare(`DELETE FROM ${KQMD_SEARCH_SHADOW_TABLE}`).run();

    const insert = db.prepare(
      `INSERT INTO ${KQMD_SEARCH_SHADOW_TABLE}(rowid, filepath, title, body) VALUES (?, ?, ?, ?)`,
    );

    for (const { rowId, projection } of projections) {
      insert.run(rowId, projection.filepath, projection.title, projection.body);
    }

    upsertSearchMetadata(db, KQMD_SEARCH_POLICY_METADATA_KEY, policy.id);
    upsertSearchMetadata(db, KQMD_SEARCH_SOURCE_SNAPSHOT_METADATA_KEY, JSON.stringify(snapshot));
    upsertSearchMetadata(
      db,
      KQMD_SEARCH_COLLECTION_SNAPSHOTS_METADATA_KEY,
      JSON.stringify(collectionSnapshots),
    );
    commitTransaction(db);
    const writeDurationMs = Date.now() - writeStart;
    return {
      indexedDocuments: rows.length,
      projectionDurationMs,
      writeDurationMs,
      totalDurationMs: Date.now() - totalStart,
      sourceSnapshot: snapshot,
    };
  } catch (error) {
    rollbackTransaction(db);
    throw error;
  }
}

export function searchShadowIndex(
  store: SearchStoreLike,
  query: string,
  options: {
    readonly limit: number;
    readonly collections?: readonly string[];
  },
): SearchResult[] {
  const ftsQuery = buildFTS5Query(query);
  if (!ftsQuery) {
    return [];
  }

  const filters = options.collections && options.collections.length > 0 ? options.collections : [];
  const whereCollection =
    filters.length > 0 ? `AND d.collection IN (${filters.map(() => '?').join(', ')})` : undefined;
  const sql = [
    'SELECT',
    "  'qmd://' || d.collection || '/' || d.path AS filepath,",
    "  d.collection || '/' || d.path AS display_path,",
    '  d.title,',
    '  content.doc AS body,',
    '  d.hash,',
    '  d.modified_at,',
    '  d.collection,',
    `  bm25(${KQMD_SEARCH_SHADOW_TABLE}, 10.0, 1.0) AS bm25_score`,
    `FROM ${KQMD_SEARCH_SHADOW_TABLE} f`,
    'JOIN documents d ON d.id = f.rowid',
    'JOIN content ON content.hash = d.hash',
    `WHERE ${KQMD_SEARCH_SHADOW_TABLE} MATCH ? AND d.active = 1`,
    whereCollection,
    'ORDER BY bm25_score ASC LIMIT ?',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  const rows = store.db
    .prepare(sql)
    .all(ftsQuery, ...filters, options.limit)
    .map((row) => row as ShadowSearchRow);

  return rows.map((row) => {
    const score = Math.abs(row.bm25_score) / (1 + Math.abs(row.bm25_score));

    return {
      filepath: row.filepath,
      displayPath: row.display_path,
      title: row.title,
      context: store.getContextForFile(row.filepath),
      hash: row.hash,
      docid: toDocId(row.hash),
      collectionName: row.collection,
      modifiedAt: row.modified_at,
      bodyLength: row.body.length,
      body: row.body,
      score,
      source: 'fts',
    };
  });
}
