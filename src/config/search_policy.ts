export const KQMD_DEFAULT_SEARCH_POLICY_ID = 'kiwi-cong-shadow-v1';
export const KQMD_SEARCH_POLICY_METADATA_KEY = 'kqmd_search_policy_id';
export const KQMD_SEARCH_SHADOW_TABLE = 'kqmd_documents_fts';

export interface EffectiveSearchPolicy {
  readonly id: string;
  readonly tokenizer: 'kiwi';
  readonly modelType: 'cong';
  readonly shadowTable: typeof KQMD_SEARCH_SHADOW_TABLE;
  readonly source: 'default';
}

export function describeEffectiveSearchPolicy(): EffectiveSearchPolicy {
  return {
    id: KQMD_DEFAULT_SEARCH_POLICY_ID,
    tokenizer: 'kiwi',
    modelType: 'cong',
    shadowTable: KQMD_SEARCH_SHADOW_TABLE,
    source: 'default',
  };
}

export function resolveEffectiveSearchPolicyId(): string {
  return describeEffectiveSearchPolicy().id;
}
