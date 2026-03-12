import {
  type EffectiveSearchPolicy,
  KQMD_SEARCH_POLICY_METADATA_KEY,
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

function shadowTableExists(db: MinimalDatabase, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { name?: string } | undefined;

  return typeof row?.name === 'string';
}

function countActiveDocuments(db: MinimalDatabase, collections?: readonly string[]): number {
  const { clause, params } = buildCollectionClause(collections);
  const row = db
    .prepare(
      ['SELECT COUNT(*) AS count', 'FROM documents d', 'WHERE d.active = 1', clause]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    )
    .get(...params) as { count?: number } | undefined;

  return row?.count ?? 0;
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
  totalDocuments: number,
  indexedDocuments: number,
  hasShadowTable: boolean,
): SearchIndexHealth {
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

  if (!hasShadowTable || !storedPolicyId) {
    return {
      kind: 'untracked-index',
      expectedPolicy,
      storedPolicyId,
      totalDocuments,
      indexedDocuments,
      missingDocuments,
    };
  }

  if (missingDocuments > 0) {
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
    readonly shadowTableName?: string;
  } = {},
): SearchIndexHealth {
  const shadowTableName = options.shadowTableName ?? expectedPolicy.shadowTable;
  const hasShadowTable = shadowTableExists(db, shadowTableName);
  const totalDocuments = countActiveDocuments(db, options.collections);
  const indexedDocuments = hasShadowTable
    ? countIndexedDocuments(db, shadowTableName, options.collections)
    : 0;

  return classifySearchIndexHealth(
    expectedPolicy,
    readStoredPolicyId(db),
    totalDocuments,
    indexedDocuments,
    hasShadowTable,
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
