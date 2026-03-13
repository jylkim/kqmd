import { describe, expect, test } from 'vitest';
import {
  classifySearchIndexHealth,
  hasSearchIndexMismatch,
  preferredSearchRecoveryCommand,
  type SearchSourceSnapshot,
  shouldUseShadowSearchIndex,
  summarizeStoredSearchPolicy,
} from '../src/commands/owned/search_index_health.js';
import { describeEffectiveSearchPolicy } from '../src/config/search_policy.js';

describe('search index health', () => {
  const policy = describeEffectiveSearchPolicy();
  const cleanSnapshot: SearchSourceSnapshot = {
    totalDocuments: 3,
    latestModifiedAt: '2026-03-13T00:00:00.000Z',
    maxDocumentId: 3,
  };

  test('classifies clean indexes', () => {
    const health = classifySearchIndexHealth(
      policy,
      policy.id,
      cleanSnapshot,
      3,
      true,
      cleanSnapshot,
    );

    expect(health.kind).toBe('clean');
    expect(hasSearchIndexMismatch(health)).toBe(false);
    expect(shouldUseShadowSearchIndex(health)).toBe(true);
    expect(summarizeStoredSearchPolicy(health)).toBe(policy.id);
  });

  test('classifies untracked indexes', () => {
    const health = classifySearchIndexHealth(policy, undefined, cleanSnapshot, 0, false);

    expect(health.kind).toBe('untracked-index');
    expect(hasSearchIndexMismatch(health)).toBe(true);
    expect(shouldUseShadowSearchIndex(health)).toBe(false);
    expect(preferredSearchRecoveryCommand()).toBe('qmd update');
  });

  test('classifies policy mismatch indexes', () => {
    const health = classifySearchIndexHealth(
      policy,
      'legacy-v0',
      cleanSnapshot,
      3,
      true,
      cleanSnapshot,
    );

    expect(health.kind).toBe('policy-mismatch');
    expect(hasSearchIndexMismatch(health)).toBe(true);
  });

  test('classifies stale shadow indexes', () => {
    const staleSnapshot: SearchSourceSnapshot = {
      totalDocuments: 5,
      latestModifiedAt: '2026-03-13T01:00:00.000Z',
      maxDocumentId: 5,
    };
    const health = classifySearchIndexHealth(
      policy,
      policy.id,
      staleSnapshot,
      2,
      true,
      staleSnapshot,
    );

    expect(health.kind).toBe('stale-shadow-index');
    expect(health.missingDocuments).toBe(3);
    expect(hasSearchIndexMismatch(health)).toBe(true);
  });

  test('classifies stale shadow indexes when the source snapshot drifts without document count changes', () => {
    const currentSnapshot: SearchSourceSnapshot = {
      totalDocuments: 3,
      latestModifiedAt: '2026-03-13T02:00:00.000Z',
      maxDocumentId: 3,
    };

    const health = classifySearchIndexHealth(
      policy,
      policy.id,
      currentSnapshot,
      3,
      true,
      cleanSnapshot,
    );

    expect(health.kind).toBe('stale-shadow-index');
    expect(health.missingDocuments).toBe(0);
    expect(hasSearchIndexMismatch(health)).toBe(true);
  });

  test('classifies a clean collection-scoped snapshot independently from the global snapshot', () => {
    const docsSnapshot: SearchSourceSnapshot = {
      totalDocuments: 1,
      latestModifiedAt: '2026-03-13T00:00:00.000Z',
      maxDocumentId: 1,
    };

    const health = classifySearchIndexHealth(
      policy,
      policy.id,
      docsSnapshot,
      1,
      true,
      docsSnapshot,
    );

    expect(health.kind).toBe('clean');
    expect(hasSearchIndexMismatch(health)).toBe(false);
  });
});
