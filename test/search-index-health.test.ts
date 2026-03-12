import { describe, expect, test } from 'vitest';
import {
  classifySearchIndexHealth,
  hasSearchIndexMismatch,
  preferredSearchRecoveryCommand,
  shouldUseShadowSearchIndex,
  summarizeStoredSearchPolicy,
} from '../src/commands/owned/search_index_health.js';
import { describeEffectiveSearchPolicy } from '../src/config/search_policy.js';

describe('search index health', () => {
  const policy = describeEffectiveSearchPolicy();

  test('classifies clean indexes', () => {
    const health = classifySearchIndexHealth(policy, policy.id, 3, 3, true);

    expect(health.kind).toBe('clean');
    expect(hasSearchIndexMismatch(health)).toBe(false);
    expect(shouldUseShadowSearchIndex(health)).toBe(true);
    expect(summarizeStoredSearchPolicy(health)).toBe(policy.id);
  });

  test('classifies untracked indexes', () => {
    const health = classifySearchIndexHealth(policy, undefined, 3, 0, false);

    expect(health.kind).toBe('untracked-index');
    expect(hasSearchIndexMismatch(health)).toBe(true);
    expect(shouldUseShadowSearchIndex(health)).toBe(false);
    expect(preferredSearchRecoveryCommand()).toBe('qmd update');
  });

  test('classifies policy mismatch indexes', () => {
    const health = classifySearchIndexHealth(policy, 'legacy-v0', 3, 3, true);

    expect(health.kind).toBe('policy-mismatch');
    expect(hasSearchIndexMismatch(health)).toBe(true);
  });

  test('classifies stale shadow indexes', () => {
    const health = classifySearchIndexHealth(policy, policy.id, 5, 2, true);

    expect(health.kind).toBe('stale-shadow-index');
    expect(health.missingDocuments).toBe(3);
    expect(hasSearchIndexMismatch(health)).toBe(true);
  });
});
