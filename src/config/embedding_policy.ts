export const KQMD_DEFAULT_EMBED_MODEL_URI =
  'hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf';

export interface EffectiveEmbedModel {
  readonly uri: string;
  readonly source: 'default' | 'env-override';
}

export function describeEffectiveEmbedModel(
  env: NodeJS.ProcessEnv = process.env,
): EffectiveEmbedModel {
  const override = env.QMD_EMBED_MODEL;

  if (override) {
    return { uri: override, source: 'env-override' };
  }

  return { uri: KQMD_DEFAULT_EMBED_MODEL_URI, source: 'default' };
}

export function resolveEffectiveEmbedModel(env: NodeJS.ProcessEnv = process.env): string {
  return describeEffectiveEmbedModel(env).uri;
}

export function installKqmdEmbedModelDefault(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.QMD_EMBED_MODEL) {
    env.QMD_EMBED_MODEL = KQMD_DEFAULT_EMBED_MODEL_URI;
  }
}
