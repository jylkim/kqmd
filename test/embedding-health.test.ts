import { describe, expect, test } from 'vitest';

import {
  classifyEmbeddingHealth,
  hasEmbeddingMismatch,
  preferredEmbedCommand,
  type StoredEmbeddingModel,
  summarizeStoredEmbeddingModels,
} from '../src/commands/owned/embedding_health.js';

function models(...rows: Array<[string, number]>): StoredEmbeddingModel[] {
  return rows.map(([model, documents]) => ({ model, documents }));
}

describe('embedding health', () => {
  test('classifies clean indexes', () => {
    const health = classifyEmbeddingHealth(
      {
        totalDocuments: 3,
        needsEmbedding: 0,
      },
      'hf:qwen',
      models(['hf:qwen', 3]),
    );

    expect(health.kind).toBe('clean');
    expect(hasEmbeddingMismatch(health)).toBe(false);
    expect(preferredEmbedCommand(health)).toBe('qmd embed');
  });

  test('classifies missing embeddings separately from mismatches', () => {
    const health = classifyEmbeddingHealth(
      {
        totalDocuments: 3,
        needsEmbedding: 2,
      },
      'hf:qwen',
      models(['hf:qwen', 1]),
    );

    expect(health.kind).toBe('needs-embedding');
    expect(hasEmbeddingMismatch(health)).toBe(false);
  });

  test('classifies single wrong-model indexes as model mismatch', () => {
    const health = classifyEmbeddingHealth(
      {
        totalDocuments: 3,
        needsEmbedding: 0,
      },
      'hf:qwen',
      models(['embeddinggemma', 3]),
    );

    expect(health.kind).toBe('model-mismatch');
    expect(hasEmbeddingMismatch(health)).toBe(true);
    expect(preferredEmbedCommand(health)).toBe('qmd embed --force');
    expect(summarizeStoredEmbeddingModels(health)).toBe('embeddinggemma (3 docs)');
  });

  test('classifies mixed indexes when multiple models or missing docs exist', () => {
    const health = classifyEmbeddingHealth(
      {
        totalDocuments: 5,
        needsEmbedding: 1,
      },
      'hf:qwen',
      models(['hf:qwen', 2], ['embeddinggemma', 2]),
    );

    expect(health.kind).toBe('mixed-models');
    expect(hasEmbeddingMismatch(health)).toBe(true);
    expect(summarizeStoredEmbeddingModels(health)).toBe(
      'hf:qwen (2 docs), embeddinggemma (2 docs)',
    );
  });
});
