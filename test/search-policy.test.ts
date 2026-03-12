import { describe, expect, test } from 'vitest';

import {
  describeEffectiveSearchPolicy,
  KQMD_DEFAULT_SEARCH_POLICY_ID,
  KQMD_SEARCH_POLICY_METADATA_KEY,
  KQMD_SEARCH_SHADOW_TABLE,
  resolveEffectiveSearchPolicyId,
} from '../src/config/search_policy.js';

describe('search policy', () => {
  test('returns the canonical K-QMD Korean search policy', () => {
    expect(describeEffectiveSearchPolicy()).toEqual({
      id: KQMD_DEFAULT_SEARCH_POLICY_ID,
      tokenizer: 'kiwi',
      modelType: 'cong',
      shadowTable: KQMD_SEARCH_SHADOW_TABLE,
      source: 'default',
    });
    expect(resolveEffectiveSearchPolicyId()).toBe(KQMD_DEFAULT_SEARCH_POLICY_ID);
    expect(KQMD_SEARCH_POLICY_METADATA_KEY).toBe('kqmd_search_policy_id');
  });
});
