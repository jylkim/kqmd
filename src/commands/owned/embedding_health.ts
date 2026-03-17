/**
 * 임베딩 헬스 체크 — DB에 저장된 임베딩 모델 상태를 분석한다.
 *
 * 헬스 상태:
 *   - clean:           현재 모델로 모든 문서가 임베딩됨
 *   - needs-embedding:  모델은 맞지만 아직 임베딩되지 않은 문서가 있음
 *   - model-mismatch:   단일 모델이지만 현재 설정과 다름 (qmd embed --force 필요)
 *   - mixed-models:     여러 모델이 혼재됨 (모델 변경 중 중단된 상태)
 */
import type { IndexStatus, QMDStore } from '@tobilu/qmd';
import type { MinimalDatabase } from '#src/types/database.js';

export interface StoredEmbeddingModel {
  readonly model: string;
  readonly documents: number;
}

type EmbeddingHealthBase = {
  readonly expectedModel: string;
  readonly storedModels: readonly StoredEmbeddingModel[];
  readonly missingDocuments: number;
  readonly mismatchedDocuments: number;
};

export type EmbeddingHealth =
  | (EmbeddingHealthBase & { readonly kind: 'clean' })
  | (EmbeddingHealthBase & { readonly kind: 'needs-embedding' })
  | (EmbeddingHealthBase & { readonly kind: 'model-mismatch' })
  | (EmbeddingHealthBase & { readonly kind: 'mixed-models' });

type StoreLike = Pick<QMDStore, 'getStatus'> & {
  readonly internal: {
    readonly db: MinimalDatabase;
  };
};

export function readStoredEmbeddingModels(
  db: MinimalDatabase,
  collections?: readonly string[],
): StoredEmbeddingModel[] {
  const filters = collections && collections.length > 0 ? collections : undefined;
  const placeholders = filters?.map(() => '?').join(', ');
  const sql = [
    'SELECT cv.model as model, COUNT(DISTINCT d.hash) AS documents',
    'FROM documents d',
    'JOIN content_vectors cv ON cv.hash = d.hash AND cv.seq = 0',
    'WHERE d.active = 1',
    filters ? `AND d.collection IN (${placeholders})` : undefined,
    'GROUP BY cv.model',
    'ORDER BY documents DESC, cv.model ASC',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  return db
    .prepare(sql)
    .all(...(filters ?? []))
    .map((row) => row as { model: string; documents: number });
}

export function classifyEmbeddingHealth(
  status: Pick<IndexStatus, 'totalDocuments' | 'needsEmbedding'>,
  expectedModel: string,
  storedModels: readonly StoredEmbeddingModel[],
): EmbeddingHealth {
  const missingDocuments = status.needsEmbedding;
  const mismatchedDocuments = storedModels
    .filter((row) => row.model !== expectedModel)
    .reduce((sum, row) => sum + row.documents, 0);

  if (status.totalDocuments === 0 && storedModels.length === 0) {
    return {
      kind: 'clean',
      expectedModel,
      storedModels,
      missingDocuments,
      mismatchedDocuments,
    };
  }

  if (mismatchedDocuments === 0) {
    return {
      kind: missingDocuments > 0 ? 'needs-embedding' : 'clean',
      expectedModel,
      storedModels,
      missingDocuments,
      mismatchedDocuments,
    };
  }

  if (
    storedModels.length === 1 &&
    missingDocuments === 0 &&
    storedModels[0]?.model !== expectedModel
  ) {
    return {
      kind: 'model-mismatch',
      expectedModel,
      storedModels,
      missingDocuments,
      mismatchedDocuments,
    };
  }

  return {
    kind: 'mixed-models',
    expectedModel,
    storedModels,
    missingDocuments,
    mismatchedDocuments,
  };
}

export async function readEmbeddingHealth(
  store: StoreLike,
  expectedModel: string,
  options: {
    readonly status?: Pick<IndexStatus, 'totalDocuments' | 'needsEmbedding'>;
    readonly collections?: readonly string[];
  } = {},
): Promise<EmbeddingHealth> {
  const status = options.status ?? (await store.getStatus());
  const storedModels = readStoredEmbeddingModels(store.internal.db, options.collections);
  return classifyEmbeddingHealth(status, expectedModel, storedModels);
}

export function hasEmbeddingMismatch(health: EmbeddingHealth): boolean {
  return health.kind === 'model-mismatch' || health.kind === 'mixed-models';
}

export function summarizeStoredEmbeddingModels(health: EmbeddingHealth): string {
  if (health.storedModels.length === 0) {
    return 'none';
  }

  return health.storedModels.map((row) => `${row.model} (${row.documents} docs)`).join(', ');
}

export function preferredEmbedCommand(health: EmbeddingHealth): 'qmd embed' | 'qmd embed --force' {
  return hasEmbeddingMismatch(health) ? 'qmd embed --force' : 'qmd embed';
}
