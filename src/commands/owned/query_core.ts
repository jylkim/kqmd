import type { QMDStore } from '@tobilu/qmd';

import { describeEffectiveEmbedModel } from '../../config/embedding_policy.js';
import {
  hasEmbeddingMismatch,
  readEmbeddingHealth,
  summarizeStoredEmbeddingModels,
} from './embedding_health.js';
import { normalizeHybridQueryResults } from './io/format.js';
import type { OwnedCommandError, QueryCommandInput, SearchOutputRow } from './io/types.js';
import { resolveSelectedCollections } from './io/validate.js';
import { executeOwnedQuerySearch, type QueryRuntimeDependencies } from './query_runtime.js';

export interface QueryCoreSuccess {
  readonly rows: SearchOutputRow[];
  readonly advisories: readonly string[];
}

export interface QueryCoreOptions {
  readonly availableCollectionNames?: readonly string[];
  readonly defaultCollectionNames?: readonly string[];
}

function buildEmbeddingMismatchAdvisory(expectedModel: string, storedModels: string): string {
  return [
    'Embedding model mismatch detected.',
    `Expected effective model: ${expectedModel}`,
    `Stored models: ${storedModels}`,
    "Run 'qmd embed --force' to rebuild embeddings for the current model.",
  ].join('\n');
}

export async function executeQueryCore(
  store: QMDStore,
  input: QueryCommandInput,
  env: NodeJS.ProcessEnv = process.env,
  runtimeDependencies: QueryRuntimeDependencies = {},
  options: QueryCoreOptions = {},
): Promise<QueryCoreSuccess | OwnedCommandError> {
  const effectiveModel = describeEffectiveEmbedModel(env);
  const [availableCollectionNames, defaultCollectionNames] =
    options.availableCollectionNames && options.defaultCollectionNames
      ? [options.availableCollectionNames, options.defaultCollectionNames]
      : await Promise.all([
          store
            .listCollections()
            .then((collections) => collections.map((collection) => collection.name)),
          store.getDefaultCollectionNames(),
        ]);

  const selectedCollections = resolveSelectedCollections(
    input.collections,
    [...availableCollectionNames],
    [...defaultCollectionNames],
  );

  if ('kind' in selectedCollections) {
    return selectedCollections;
  }

  if (
    input.candidateLimit !== undefined &&
    input.queryMode === 'plain' &&
    selectedCollections.length > 1
  ) {
    return {
      kind: 'validation',
      exitCode: 1,
      stderr: 'The `--candidate-limit` option currently supports at most one collection filter.',
    };
  }

  const health = await readEmbeddingHealth(store, effectiveModel.uri, {
    collections: selectedCollections,
  });
  const results = await executeOwnedQuerySearch(
    store,
    input,
    selectedCollections,
    runtimeDependencies,
  );

  return {
    rows: normalizeHybridQueryResults(results),
    advisories: hasEmbeddingMismatch(health)
      ? [buildEmbeddingMismatchAdvisory(effectiveModel.uri, summarizeStoredEmbeddingModels(health))]
      : [],
  };
}
