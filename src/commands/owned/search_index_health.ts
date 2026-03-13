import {
  type EffectiveSearchPolicy,
  KQMD_SEARCH_COLLECTION_SNAPSHOTS_METADATA_KEY,
  KQMD_SEARCH_POLICY_METADATA_KEY,
  KQMD_SEARCH_SOURCE_SNAPSHOT_METADATA_KEY,
} from '../../config/search_policy.js';

interface MinimalStatement {
  get: (...params: (string | number)[]) => unknown;
}

interface MinimalDatabase {
  prepare(sql: string): MinimalStatement;
}

type SearchIndexHealthBase = {
  readonly expectedPolicy: EffectiveSearchPolicy;
  readonly storedPolicyId?: string;
  readonly totalDocuments: number;
  readonly indexedDocuments: number;
  readonly missingDocuments: number;
};

export interface SearchSourceSnapshot {
  readonly totalDocuments: number;
  readonly latestModifiedAt?: string;
  readonly maxDocumentId?: number;
}

type SearchCollectionSnapshotMap = Record<string, SearchSourceSnapshot>;

export type SearchIndexHealth =
  | (SearchIndexHealthBase & { readonly kind: 'clean' })
  | (SearchIndexHealthBase & { readonly kind: 'untracked-index' })
  | (SearchIndexHealthBase & { readonly kind: 'policy-mismatch' })
  | (SearchIndexHealthBase & { readonly kind: 'stale-shadow-index' });

function buildCollectionClause(collections?: readonly string[]): {
  readonly clause?: string;
  readonly params: string[];
} {
  if (!collections || collections.length === 0) {
    return { params: [] };
  }

  return {
    clause: `AND d.collection IN (${collections.map(() => '?').join(', ')})`,
    params: [...collections],
  };
}

function readStoredPolicyId(db: MinimalDatabase): string | undefined {
  const row = db
    .prepare(`SELECT value FROM store_config WHERE key = ?`)
    .get(KQMD_SEARCH_POLICY_METADATA_KEY) as { value?: string } | undefined;

  return typeof row?.value === 'string' ? row.value : undefined;
}

function readStoredSnapshot(db: MinimalDatabase, key: string): SearchSourceSnapshot | undefined {
  const row = db.prepare(`SELECT value FROM store_config WHERE key = ?`).get(key) as
    | { value?: string }
    | undefined;

  if (typeof row?.value !== 'string') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(row.value) as Partial<SearchSourceSnapshot>;
    if (typeof parsed.totalDocuments !== 'number') {
      return undefined;
    }

    return {
      totalDocuments: parsed.totalDocuments,
      latestModifiedAt:
        typeof parsed.latestModifiedAt === 'string' ? parsed.latestModifiedAt : undefined,
      maxDocumentId: typeof parsed.maxDocumentId === 'number' ? parsed.maxDocumentId : undefined,
    };
  } catch {
    return undefined;
  }
}

function readStoredSourceSnapshot(db: MinimalDatabase): SearchSourceSnapshot | undefined {
  return readStoredSnapshot(db, KQMD_SEARCH_SOURCE_SNAPSHOT_METADATA_KEY);
}

function readStoredCollectionSnapshots(
  db: MinimalDatabase,
): SearchCollectionSnapshotMap | undefined {
  const row = db
    .prepare(`SELECT value FROM store_config WHERE key = ?`)
    .get(KQMD_SEARCH_COLLECTION_SNAPSHOTS_METADATA_KEY) as { value?: string } | undefined;

  if (typeof row?.value !== 'string') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(row.value) as Record<string, Partial<SearchSourceSnapshot>>;
    const entries = Object.entries(parsed).filter(
      ([, value]) => typeof value.totalDocuments === 'number',
    );

    if (entries.length === 0) {
      return undefined;
    }

    return Object.fromEntries(
      entries.map(([collection, value]) => [
        collection,
        {
          totalDocuments: value.totalDocuments as number,
          latestModifiedAt:
            typeof value.latestModifiedAt === 'string' ? value.latestModifiedAt : undefined,
          maxDocumentId: typeof value.maxDocumentId === 'number' ? value.maxDocumentId : undefined,
        },
      ]),
    );
  } catch {
    return undefined;
  }
}

function shadowTableExists(db: MinimalDatabase, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { name?: string } | undefined;

  return typeof row?.name === 'string';
}

export function readCurrentSearchSourceSnapshot(
  db: MinimalDatabase,
  collections?: readonly string[],
): SearchSourceSnapshot {
  const { clause, params } = buildCollectionClause(collections);
  const row = db
    .prepare(
      [
        'SELECT',
        '  COUNT(*) AS count,',
        '  MAX(d.modified_at) AS latest_modified_at,',
        '  MAX(d.id) AS max_document_id',
        'FROM documents d',
        'WHERE d.active = 1',
        clause,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    )
    .get(...params) as
    | { count?: number; latest_modified_at?: string; max_document_id?: number }
    | undefined;

  return {
    totalDocuments: row?.count ?? 0,
    latestModifiedAt: row?.latest_modified_at,
    maxDocumentId: row?.max_document_id,
  };
}

function aggregateStoredCollectionSnapshot(
  snapshots: SearchCollectionSnapshotMap | undefined,
  collections?: readonly string[],
): SearchSourceSnapshot | undefined {
  if (!snapshots || !collections || collections.length === 0) {
    return undefined;
  }

  let totalDocuments = 0;
  let latestModifiedAt: string | undefined;
  let maxDocumentId: number | undefined;
  let matchedCollections = 0;

  for (const collection of new Set(collections)) {
    const snapshot = snapshots[collection];
    if (!snapshot) {
      continue;
    }

    matchedCollections += 1;
    totalDocuments += snapshot.totalDocuments;

    if (
      latestModifiedAt === undefined ||
      (snapshot.latestModifiedAt && snapshot.latestModifiedAt > latestModifiedAt)
    ) {
      latestModifiedAt = snapshot.latestModifiedAt;
    }

    if (
      maxDocumentId === undefined ||
      (snapshot.maxDocumentId !== undefined && snapshot.maxDocumentId > maxDocumentId)
    ) {
      maxDocumentId = snapshot.maxDocumentId;
    }
  }

  if (matchedCollections === 0) {
    return undefined;
  }

  return {
    totalDocuments,
    latestModifiedAt,
    maxDocumentId,
  };
}

function countIndexedDocuments(
  db: MinimalDatabase,
  tableName: string,
  collections?: readonly string[],
): number {
  const { clause, params } = buildCollectionClause(collections);
  const row = db
    .prepare(
      [
        'SELECT COUNT(*) AS count',
        `FROM ${tableName} f`,
        'JOIN documents d ON d.id = f.rowid',
        'WHERE d.active = 1',
        clause,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    )
    .get(...params) as { count?: number } | undefined;

  return row?.count ?? 0;
}

export function classifySearchIndexHealth(
  expectedPolicy: EffectiveSearchPolicy,
  storedPolicyId: string | undefined,
  currentSnapshot: SearchSourceSnapshot,
  indexedDocuments: number,
  hasShadowTable: boolean,
  storedSnapshot?: SearchSourceSnapshot,
): SearchIndexHealth {
  const totalDocuments = currentSnapshot.totalDocuments;
  const missingDocuments = Math.max(totalDocuments - indexedDocuments, 0);

  if (storedPolicyId && storedPolicyId !== expectedPolicy.id) {
    return {
      kind: 'policy-mismatch',
      expectedPolicy,
      storedPolicyId,
      totalDocuments,
      indexedDocuments,
      missingDocuments,
    };
  }

  const snapshotMatches =
    storedSnapshot &&
    storedSnapshot.totalDocuments === currentSnapshot.totalDocuments &&
    storedSnapshot.latestModifiedAt === currentSnapshot.latestModifiedAt &&
    storedSnapshot.maxDocumentId === currentSnapshot.maxDocumentId;

  if (totalDocuments === 0) {
    return {
      kind: 'clean',
      expectedPolicy,
      storedPolicyId,
      totalDocuments,
      indexedDocuments,
      missingDocuments,
    };
  }

  if (!hasShadowTable || !storedPolicyId || !storedSnapshot) {
    return {
      kind: 'untracked-index',
      expectedPolicy,
      storedPolicyId,
      totalDocuments,
      indexedDocuments,
      missingDocuments,
    };
  }

  if (missingDocuments > 0 || !snapshotMatches) {
    return {
      kind: 'stale-shadow-index',
      expectedPolicy,
      storedPolicyId,
      totalDocuments,
      indexedDocuments,
      missingDocuments,
    };
  }

  return {
    kind: 'clean',
    expectedPolicy,
    storedPolicyId,
    totalDocuments,
    indexedDocuments,
    missingDocuments,
  };
}

export function readSearchIndexHealth(
  db: MinimalDatabase,
  expectedPolicy: EffectiveSearchPolicy,
  options: {
    readonly collections?: readonly string[];
    readonly currentSnapshot?: SearchSourceSnapshot;
    readonly shadowTableName?: string;
  } = {},
): SearchIndexHealth {
  const shadowTableName = options.shadowTableName ?? expectedPolicy.shadowTable;
  const hasShadowTable = shadowTableExists(db, shadowTableName);
  const currentSnapshot =
    options.currentSnapshot ?? readCurrentSearchSourceSnapshot(db, options.collections);
  const indexedDocuments = hasShadowTable
    ? countIndexedDocuments(db, shadowTableName, options.collections)
    : 0;
  const storedSnapshot =
    options.collections && options.collections.length > 0
      ? aggregateStoredCollectionSnapshot(readStoredCollectionSnapshots(db), options.collections)
      : readStoredSourceSnapshot(db);

  return classifySearchIndexHealth(
    expectedPolicy,
    readStoredPolicyId(db),
    currentSnapshot,
    indexedDocuments,
    hasShadowTable,
    storedSnapshot,
  );
}

export function hasSearchIndexMismatch(health: SearchIndexHealth): boolean {
  return health.kind !== 'clean';
}

export function shouldUseShadowSearchIndex(health: SearchIndexHealth): boolean {
  return health.kind === 'clean';
}

export function summarizeStoredSearchPolicy(health: SearchIndexHealth): string {
  return health.storedPolicyId ?? 'none';
}

export function preferredSearchRecoveryCommand(): 'qmd update' {
  return 'qmd update';
}
