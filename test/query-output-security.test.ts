import { describe, expect, test } from 'vitest';

import { formatSearchExecutionResult } from '../src/commands/owned/io/format.js';
import { buildMcpQueryRows } from '../src/commands/owned/io/query_rows.js';
import type { QueryCommandInput, SearchOutputRow } from '../src/commands/owned/io/types.js';

const defaultExecution = {
  retrievalKind: 'cost-capped-structured' as const,
  fallbackReason: 'fast-default' as const,
  lexicalSignal: 'moderate' as const,
  embeddingApplied: true,
  expansionApplied: false,
  rerankApplied: true,
  heavyPathUsed: true,
  candidateWindow: 14,
};

function createInput(overrides: Partial<QueryCommandInput> = {}): QueryCommandInput {
  return {
    query: 'agent orchestration',
    displayQuery: 'agent orchestration',
    format: 'json',
    limit: 5,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    explain: true,
    queryMode: 'plain',
    ...overrides,
  };
}

describe('query output security', () => {
  test('json output does not serialize internal-only source body fields', () => {
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/agent-orchestration.md',
        title: 'Agent Orchestration',
        body: 'display snippet',
        sourceBody: 'internal full body should stay private',
        context: 'docs',
        score: 0.81,
        docid: 'doc-1',
        adaptive: {
          queryClass: 'mixed-technical',
          candidateSource: 'adaptive',
          vectorStrength: 'weak',
          baseScore: 0.7,
          adjustedScore: 0.81,
          phrase: 0.08,
          title: 0.06,
          heading: 0.04,
          coverage: 0.03,
          proximity: 0.02,
          literalAnchor: 0.08,
        },
        searchAssist: {
          rescued: true,
          reason: 'strong-hit',
          addedCandidates: 1,
          source: 'shadow',
        },
      },
    ];

    const result = formatSearchExecutionResult(rows, createInput());
    const parsed = JSON.parse(result.stdout ?? '[]') as Array<Record<string, unknown>>;

    expect(parsed[0]).toMatchObject({
      file: 'qmd://docs/agent-orchestration.md',
      adaptive: {
        queryClass: 'mixed-technical',
      },
      searchAssist: {
        rescued: true,
        reason: 'strong-hit',
        addedCandidates: 1,
        source: 'shadow',
      },
    });
    expect(parsed[0]).not.toHaveProperty('sourceBody');
    expect(parsed[0]).not.toHaveProperty('sourceChunkPos');
  });

  test('snippet anchoring prefers lexical match from source body', () => {
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/agent-orchestration.md',
        title: 'Agent Orchestration',
        body: 'non-matching display chunk',
        sourceBody:
          'intro line\nanother intro\nagent orchestration appears here with the real lexical match',
        context: 'docs',
        score: 0.81,
        docid: 'doc-1',
      },
    ];

    const shaped = buildMcpQueryRows(rows, 'agent orchestration');

    expect(shaped[0]?.snippet).toContain('agent orchestration appears here');
  });

  test('large source bodies are shaped around lexical anchors instead of full-body rescans', () => {
    const prefix = Array.from({ length: 2200 }, (_, index) => `prefix filler ${index}`).join('\n');
    const suffix = Array.from({ length: 2200 }, (_, index) => `suffix filler ${index}`).join('\n');
    const lexicalBlock = [
      'nearby lead-in',
      'agent orchestration appears here with the real lexical match',
      'nearby follow-up',
    ].join('\n');
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/agent-orchestration.md',
        title: 'Agent Orchestration',
        body: 'display chunk that should not force a full source rescan',
        sourceBody: `${prefix}\n${lexicalBlock}\n${suffix}`,
        context: 'docs',
        score: 0.81,
        docid: 'doc-1',
      },
    ];

    const result = formatSearchExecutionResult(rows, createInput());
    const parsed = JSON.parse(result.stdout ?? '[]') as Array<{ snippet?: string }>;

    expect(parsed[0]?.snippet).toContain('agent orchestration appears here');
    expect(parsed[0]?.snippet).toContain('nearby lead-in');
    expect(parsed[0]?.snippet).not.toContain('prefix filler 0');
    expect(parsed[0]?.snippet).not.toContain('suffix filler 2199');
  });

  test('json explain output only exposes allowlisted normalization summary fields', () => {
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/upload-parser.md',
        title: '문서 업로드 파서',
        body: '문서 업로드 파싱 동작을 설명합니다.',
        context: 'docs',
        score: 0.88,
        docid: 'doc-2',
      },
    ];

    const result = formatSearchExecutionResult(rows, createInput(), {
      mode: 'plain',
      primaryQuery: '문서 업로드 파싱은 어떻게 동작해?',
      queryClass: 'general',
      execution: defaultExecution,
      normalization: {
        applied: true,
        reason: 'applied',
        addedCandidates: 1,
      },
      searchAssist: {
        applied: false,
        reason: 'ineligible',
        addedCandidates: 0,
      },
    });
    const parsed = JSON.parse(result.stdout ?? '{}') as {
      query: Record<string, unknown>;
    };

    expect(parsed.query).toMatchObject({
      normalization: {
        applied: true,
        reason: 'applied',
        addedCandidates: 1,
      },
    });
    expect(parsed.query).not.toHaveProperty('normalizedQuery');
    expect(parsed.query).not.toHaveProperty('keptTerms');
    expect(parsed.query).not.toHaveProperty('removedTerms');
  });
});
