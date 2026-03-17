/**
 * 임베딩 모델 설정.
 *
 * URI 형식: hf:{org}/{repo}/{file}
 *   - hf: HuggingFace 프로바이더
 *   - GGUF: llama.cpp 호환 양자화 포맷
 *   - Q8_0: 8bit 양자화 (정확도/성능 균형)
 *
 * QMD_EMBED_MODEL 환경변수로 오버라이드 가능하다.
 */
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

/**
 * upstream qmd가 사용할 임베딩 모델을 환경변수로 주입한다.
 * upstream은 QMD_EMBED_MODEL 환경변수를 읽어 모델을 결정하므로,
 * 사용자가 명시적으로 설정하지 않은 경우 kqmd 기본값을 채워넣는다.
 */
export function installKqmdEmbedModelDefault(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.QMD_EMBED_MODEL) {
    env.QMD_EMBED_MODEL = KQMD_DEFAULT_EMBED_MODEL_URI;
  }
}
