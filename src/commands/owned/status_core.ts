import type { QMDStore } from '@tobilu/qmd';

import { describeEffectiveEmbedModel } from '../../config/embedding_policy.js';
import { describeEffectiveSearchPolicy } from '../../config/search_policy.js';
import { readEmbeddingHealth } from './embedding_health.js';
import type { StatusCommandOutput } from './io/types.js';
import { readSearchIndexHealth } from './search_index_health.js';

export async function readStatusCore(
  store: QMDStore,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StatusCommandOutput> {
  const effectiveModel = describeEffectiveEmbedModel(env);
  const searchPolicy = describeEffectiveSearchPolicy();
  const status = await store.getStatus();
  const health = await readEmbeddingHealth(store, effectiveModel.uri, {
    status,
  });
  const searchHealth = readSearchIndexHealth(store.internal.db, searchPolicy);

  return {
    dbPath: store.dbPath,
    effectiveModel,
    searchPolicy,
    status,
    health,
    searchHealth,
  };
}
