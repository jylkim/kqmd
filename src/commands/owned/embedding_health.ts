import type { IndexStatus, QMDStore } from '@tobilu/qmd';

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

interface MinimalDatabase {
  prepare(sql: string): {
    all: (...params: unknown[]) => unknown[];
  };
}

type StoreLike = Pick<QMDStore, 'getStatus'> & {
  readonly internal: {
    readonly db: MinimalDatabase;
  };
};

export function readStoredEmbeddingModels(db: MinimalDatabase): StoredEmbeddingModel[] {
  return db
    .prepare(
      `
        SELECT model, COUNT(DISTINCT hash) AS documents
        FROM content_vectors
        WHERE seq = 0
        GROUP BY model
        ORDER BY documents DESC, model ASC
      `,
    )
    .all()
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
): Promise<EmbeddingHealth> {
  const status = await store.getStatus();
  const storedModels = readStoredEmbeddingModels(store.internal.db);
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
