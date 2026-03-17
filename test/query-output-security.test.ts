import { describe, expect, test } from 'vitest';

import { formatSearchExecutionResult } from '../src/commands/owned/io/format.js';
import { buildMcpQueryRows } from '../src/commands/owned/io/query_rows.js';
import type { QueryCommandInput, SearchOutputRow } from '../src/commands/owned/io/types.js';

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
      },
    ];

    const result = formatSearchExecutionResult(rows, createInput());
    const parsed = JSON.parse(result.stdout ?? '[]') as Array<Record<string, unknown>>;

    expect(parsed[0]).toMatchObject({
      file: 'qmd://docs/agent-orchestration.md',
      adaptive: {
        queryClass: 'mixed-technical',
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
});
