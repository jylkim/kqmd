import { describe, expect, test } from 'vitest';

import { buildMcpQueryRows } from '../src/commands/owned/io/query_rows.js';
import type { QueryCommandInput, SearchOutputRow } from '../src/commands/owned/io/types.js';
import { buildQueryResponse } from '../src/mcp/query.js';

function createInput(overrides: Partial<QueryCommandInput> = {}): QueryCommandInput {
  return {
    query: '지속 학습',
    displayQuery: '지속 학습',
    format: 'json',
    limit: 5,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    explain: false,
    queryMode: 'plain',
    ...overrides,
  };
}

describe('mcp query response', () => {
  test('includes allowlisted search assist metadata in rows and query summary', () => {
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/korean-search.md',
        title: '지속 학습 메모',
        body: '지속 학습은 문서 업로드 파싱과 연결됩니다.',
        sourceBody: '지속 학습은 문서 업로드 파싱과 연결됩니다.',
        context: 'documentation',
        score: 0.99,
        docid: 'assist',
        searchAssist: {
          rescued: true,
          reason: 'strong-hit',
          addedCandidates: 1,
          source: 'shadow',
        },
      },
    ];

    const response = buildQueryResponse(
      {
        rows,
        advisories: [],
        query: {
          mode: 'plain',
          primaryQuery: '지속 학습',
          queryClass: 'short-korean-phrase',
          normalization: {
            applied: false,
            reason: 'not-eligible',
            addedCandidates: 0,
          },
          searchAssist: {
            applied: true,
            reason: 'strong-hit',
            addedCandidates: 1,
          },
        },
        searchAssist: {
          applied: true,
          reason: 'strong-hit',
          addedCandidates: 1,
        },
      },
      createInput(),
    );

    expect(response.query).toMatchObject({
      mode: 'plain',
      primaryQuery: '지속 학습',
      queryClass: 'short-korean-phrase',
      normalization: {
        applied: false,
        reason: 'not-eligible',
        addedCandidates: 0,
      },
      searchAssist: {
        applied: true,
        reason: 'strong-hit',
        addedCandidates: 1,
      },
    });
  });

  test('buildMcpQueryRows keeps searchAssist allowlist and omits internal source fields', () => {
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/korean-search.md',
        title: '지속 학습 메모',
        body: 'display snippet',
        sourceBody: 'internal body',
        context: 'documentation',
        score: 0.99,
        docid: 'assist',
        searchAssist: {
          rescued: true,
          reason: 'strong-hit',
          addedCandidates: 1,
          source: 'shadow',
        },
      },
    ];

    const shaped = buildMcpQueryRows(rows, '지속 학습');

    expect(shaped[0]).toMatchObject({
      searchAssist: {
        rescued: true,
        reason: 'strong-hit',
        addedCandidates: 1,
        source: 'shadow',
      },
    });
    expect(shaped[0]).not.toHaveProperty('sourceBody');
    expect(shaped[0]).not.toHaveProperty('sourceChunkPos');
  });

  test('applies limit and minScore before shaping rows and summary text', () => {
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/high-score.md',
        title: 'High Score',
        body: 'top ranked result',
        context: 'documentation',
        score: 0.91,
        docid: 'high',
      },
      {
        displayPath: 'docs/limit-cutoff.md',
        title: 'Limit Cutoff',
        body: 'would survive minScore but not limit',
        context: 'documentation',
        score: 0.83,
        docid: 'limit',
      },
      {
        displayPath: 'docs/min-score-cutoff.md',
        title: 'Min Score Cutoff',
        body: 'below the minimum score threshold',
        context: 'documentation',
        score: 0.42,
        docid: 'min-score',
      },
    ];

    const response = buildQueryResponse(
      {
        rows,
        advisories: [],
        query: {
          mode: 'plain',
          primaryQuery: '지속 학습',
          queryClass: 'short-korean-phrase',
          normalization: {
            applied: false,
            reason: 'not-eligible',
            addedCandidates: 0,
          },
          searchAssist: {
            applied: false,
            reason: 'ineligible',
            addedCandidates: 0,
          },
        },
      },
      createInput({ limit: 1, minScore: 0.5 }),
    );

    expect(response.rows).toMatchObject([
      {
        docid: '#high',
        file: 'docs/high-score.md',
        title: 'High Score',
      },
    ]);
    expect(response.rows).toHaveLength(1);
    expect(response.text).toContain('Found 1 result for "지속 학습":');
    expect(response.text).toContain('#high 91% docs/high-score.md - High Score');
    expect(response.text).not.toContain('Limit Cutoff');
    expect(response.text).not.toContain('Min Score Cutoff');
  });
});
