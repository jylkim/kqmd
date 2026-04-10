import { describe, expect, test } from 'vitest';

import { formatSearchExecutionResult } from '../src/commands/owned/io/format.js';
import { buildMcpQueryRows } from '../src/commands/owned/io/query_rows.js';
import type { QueryCommandInput, SearchOutputRow } from '../src/commands/owned/io/types.js';

function createInput(): QueryCommandInput {
  return {
    query: 'lex: agent orchestration',
    displayQuery: 'agent orchestration',
    format: 'json',
    limit: 5,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    explain: false,
    queryMode: 'structured',
    queries: [{ type: 'lex', query: 'agent orchestration', line: 1 }],
  };
}

function stripMcpLineNumbers(snippet: string | undefined): string {
  return (snippet ?? '').replace(/^\d+:\s/gm, '');
}

describe('query row parity', () => {
  test('cli and mcp row shaping use the same lexical snippet anchor', () => {
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/agent-orchestration.md',
        title: 'Agent Orchestration',
        body: 'display chunk',
        sourceBody:
          'intro line\n## Agent Orchestration\nagent orchestration appears here with the lexical anchor',
        context: 'docs',
        score: 0.83,
        docid: 'doc-1',
      },
    ];

    const cli = formatSearchExecutionResult(rows, createInput());
    const parsedCli = JSON.parse(cli.stdout ?? '[]') as Array<{
      snippet?: string;
      file: string;
      line?: number;
    }>;
    const mcp = buildMcpQueryRows(rows, 'agent orchestration');

    expect(parsedCli[0]?.file).toBe('qmd://docs/agent-orchestration.md');
    expect(parsedCli[0]).not.toHaveProperty('line');
    expect(parsedCli[0]?.snippet).toContain('agent orchestration appears here');
    expect(mcp[0]?.line).toBeGreaterThan(0);
    expect(mcp[0]?.snippet).toContain('agent orchestration appears here');
  });

  test('cli and mcp share bounded large-body snippet shaping', () => {
    const prefix = Array.from({ length: 2200 }, (_, index) => `prefix filler ${index}`).join('\n');
    const suffix = Array.from({ length: 2200 }, (_, index) => `suffix filler ${index}`).join('\n');
    const lexicalBlock = [
      'nearby lead-in',
      'agent orchestration appears here with the lexical anchor',
      'nearby follow-up',
    ].join('\n');
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/agent-orchestration.md',
        title: 'Agent Orchestration',
        body: 'display chunk',
        sourceBody: `${prefix}\n${lexicalBlock}\n${suffix}`,
        context: 'docs',
        score: 0.83,
        docid: 'doc-1',
      },
    ];

    const cli = formatSearchExecutionResult(rows, createInput());
    const parsedCli = JSON.parse(cli.stdout ?? '[]') as Array<{ snippet?: string; file: string }>;
    const mcp = buildMcpQueryRows(rows, 'agent orchestration');

    expect(parsedCli[0]?.snippet).toContain('agent orchestration appears here');
    expect(parsedCli[0]?.snippet).not.toContain('prefix filler 0');
    expect(stripMcpLineNumbers(mcp[0]?.snippet)).toBe(parsedCli[0]?.snippet ?? '');
  });
});
