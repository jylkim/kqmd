import { describe, expect, test } from 'vitest';

import type { QueryCommandInput, SearchOutputRow } from '../src/commands/owned/io/types.js';
import { classifyQuery } from '../src/commands/owned/query_classifier.js';
import { hasStrongSearchAssistHit } from '../src/commands/owned/query_search_assist_policy.js';

function createInput(query: string): QueryCommandInput {
  return {
    query,
    displayQuery: query,
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

describe('query search assist policy', () => {
  test('detects a strong hit beyond the first returned shadow candidate', () => {
    const traits = classifyQuery(createInput('지속 학습'));
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/noise.md',
        title: 'Noise',
        body: '지속 관련 언급만 있습니다.',
        context: 'docs',
        score: 0.42,
        docid: 'noise',
      },
      {
        displayPath: 'docs/korean-search.md',
        title: '지속 학습 메모',
        body: '지속 학습은 문서 업로드 파싱과 연결됩니다.',
        sourceBody: '지속 학습은 문서 업로드 파싱과 연결됩니다.',
        context: 'docs',
        score: 0.91,
        docid: 'strong',
      },
    ];

    expect(hasStrongSearchAssistHit(rows, traits)).toBe(true);
  });
});
