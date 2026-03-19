import { describe, expect, test } from 'vitest';

import { buildMcpQueryRows } from '../src/commands/owned/io/query_rows.js';
import type { QueryCommandInput, SearchOutputRow } from '../src/commands/owned/io/types.js';
import { buildQueryResponse } from '../src/mcp/query.js';

function createInput(): QueryCommandInput {
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
});
