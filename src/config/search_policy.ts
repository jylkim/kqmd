/**
 * 한국어 검색 정책(search policy) 설정.
 *
 * "정책"은 토크나이저 + 모델 조합을 식별하는 단위이다.
 * shadow table의 데이터가 어떤 정책으로 빌드되었는지 store_config에 기록하여,
 * 정책이 변경되면 인덱스 재구축이 필요함을 감지할 수 있다.
 *
 * 현재 유일한 정책: kiwi-cong-shadow-v1
 *   - tokenizer: kiwi (한국어 형태소 분석기)
 *   - modelType: cong (Kiwi의 경량 모델)
 *   - shadowTable: kqmd_documents_fts (FTS5 가상 테이블명)
 */

/** 정책 ID 형식: {tokenizer}-{model}-shadow-v{version} */
export const KQMD_DEFAULT_SEARCH_POLICY_ID = 'kiwi-cong-shadow-v1';
export const KQMD_SEARCH_POLICY_METADATA_KEY = 'kqmd_search_policy_id';
export const KQMD_SEARCH_COLLECTION_SNAPSHOTS_METADATA_KEY = 'kqmd_search_collection_snapshots';
export const KQMD_SEARCH_SOURCE_SNAPSHOT_METADATA_KEY = 'kqmd_search_source_snapshot';
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
