/**
 * Korean FTS5 shadow index.
 *
 * upstream qmd의 기본 FTS 검색은 한국어 형태소 분석을 지원하지 않는다.
 * 이 모듈은 Kiwi 토크나이저로 문서를 사전 처리(projection)한 뒤,
 * 별도의 FTS5 가상 테이블("shadow table")에 저장하여 한국어 검색을 구현한다.
 *
 * 흐름: 원본 문서 → Kiwi 토큰화 → FTS5 shadow table INSERT → BM25 검색
 *
 * shadow table의 rowid는 documents.id와 1:1 매핑되어 JOIN으로 원본 메타데이터를 복원한다.
 */
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

/** FTS5 특수문자를 제거하고 소문자로 정규화한다. 유니코드 문자와 숫자, 아포스트로피만 남긴다. */
function sanitizeFTS5Term(term: string): string {
  return term.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase();
}

/**
 * 사용자 검색 쿼리를 SQLite FTS5 MATCH 구문으로 변환한다.
 *
 * 지원하는 구문:
 *   - 일반 단어: prefix 매칭 → `"term"*`
 *   - "따옴표 구문": exact phrase 매칭 → `"term1 term2"`
 *   - -부정: NOT 절로 변환 → `NOT "term"`
 *   - 여러 positive 항은 AND로 결합
 *
 * positive 항이 없으면 null을 반환하여 빈 검색을 방지한다.
 *
 * 예시: `react -vue "상태 관리"` → `"react"* AND "상태 관리" NOT "vue"*`
 */
function buildFTS5Query(query: string): string | null {
  const positive: string[] = [];
  const negative: string[] = [];
  let index = 0;
  const source = query.trim();

  while (index < source.length) {
    // 공백 건너뛰기
    while (index < source.length && /\s/.test(source[index] ?? '')) {
      index += 1;
    }

    if (index >= source.length) {
      break;
    }

    // '-' prefix → 부정 검색
    const negated = source[index] === '-';
    if (negated) {
      index += 1;
    }

    // 따옴표로 감싼 구문 → FTS5 phrase query (exact match)
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

    // 일반 단어 → prefix 매칭 ("term"*)으로 변환하여 부분 일치도 허용
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

  // positive 항은 AND로 결합, negative 항은 NOT으로 추가
  let result = positive.join(' AND ');
  for (const term of negative) {
    result = `${result} NOT ${term}`;
  }

  return result;
}

/** content hash 앞 6자를 문서 식별자로 사용한다 (CLI 출력용 short ID). */
function toDocId(hash: string): string {
  return hash.slice(0, 6);
}

/**
 * 문서의 filepath/title/body를 Kiwi 토크나이저로 변환하여 FTS5에 저장할 projection을 만든다.
 * 세 필드를 병렬로 토큰화하여 성능을 확보한다.
 */
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

/**
 * FTS5 shadow table을 생성한다.
 * porter + unicode61 토크나이저를 사용하여 영문 stemming과 유니코드 정규화를 기본 적용한다.
 * (한국어 형태소 분석은 projection 단계에서 Kiwi가 미리 처리한다.)
 */
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

/**
 * shadow index를 전체 재구축한다.
 *
 * 1. 모든 active 문서를 읽어 Kiwi로 projection 생성 (병렬)
 * 2. 트랜잭션 안에서 기존 FTS 데이터 삭제 → 새 projection INSERT
 * 3. store_config에 정책 ID와 스냅샷 메타데이터 저장 (health 추적용)
 *
 * 실패 시 트랜잭션을 롤백하여 기존 인덱스를 보존한다.
 */
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

/**
 * shadow FTS5 index에서 검색을 실행한다.
 *
 * 쿼리를 FTS5 MATCH 구문으로 변환한 뒤, documents/content 테이블과 JOIN하여
 * 원본 메타데이터를 복원한다. BM25 스코어를 0~1 범위로 정규화하여 반환한다.
 *
 * bm25() 가중치: filepath=10.0, title=1.0 (파일 경로 매칭에 높은 가중치)
 */
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
    // BM25 원시 스코어(음수, 낮을수록 좋음)를 0~1 범위로 정규화한다.
    // sigmoid 변환: |s| / (1 + |s|) → 0에 가까울수록 관련도 낮음, 1에 가까울수록 높음.
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
