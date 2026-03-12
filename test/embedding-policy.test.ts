import { describe, expect, test } from 'vitest';

import {
  describeEffectiveEmbedModel,
  installKqmdEmbedModelDefault,
  KQMD_DEFAULT_EMBED_MODEL_URI,
  resolveEffectiveEmbedModel,
} from '../src/config/embedding_policy.js';

describe('embedding policy', () => {
  test('uses the K-QMD default model when no override is present', () => {
    expect(describeEffectiveEmbedModel({})).toEqual({
      uri: KQMD_DEFAULT_EMBED_MODEL_URI,
      source: 'default',
    });
    expect(resolveEffectiveEmbedModel({})).toBe(KQMD_DEFAULT_EMBED_MODEL_URI);
  });

  test('prefers explicit QMD_EMBED_MODEL overrides', () => {
    const env = {
      QMD_EMBED_MODEL: 'hf:custom/embedding/model.gguf',
    };

    expect(describeEffectiveEmbedModel(env)).toEqual({
      uri: 'hf:custom/embedding/model.gguf',
      source: 'env-override',
    });
    expect(resolveEffectiveEmbedModel(env)).toBe('hf:custom/embedding/model.gguf');
  });

  test('installs the default model only when override is absent', () => {
    const env: NodeJS.ProcessEnv = {};
    installKqmdEmbedModelDefault(env);
    expect(env.QMD_EMBED_MODEL).toBe(KQMD_DEFAULT_EMBED_MODEL_URI);

    const overridden: NodeJS.ProcessEnv = {
      QMD_EMBED_MODEL: 'hf:custom/keep/me.gguf',
    };
    installKqmdEmbedModelDefault(overridden);
    expect(overridden.QMD_EMBED_MODEL).toBe('hf:custom/keep/me.gguf');
  });
});
