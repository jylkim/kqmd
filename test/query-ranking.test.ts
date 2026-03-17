import { describe, expect, test } from 'vitest';
import type { QueryCommandInput, SearchOutputRow } from '../src/commands/owned/io/types.js';
import { classifyQuery } from '../src/commands/owned/query_classifier.js';
import { rankQueryRows } from '../src/commands/owned/query_ranking.js';

function createInput(overrides: Partial<QueryCommandInput> = {}): QueryCommandInput {
  return {
    query: '지속 학습',
    format: 'cli',
    limit: 5,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    explain: false,
    queryMode: 'plain',
    displayQuery: '지속 학습',
    ...overrides,
  };
}

describe('query ranking', () => {
  test('promotes phrase and heading matches over scattered mentions', () => {
    const traits = classifyQuery(createInput());
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'daily/2026-01-23.md',
        title: '금요일, 1월 23일, 2026',
        body: '상단 청크',
        sourceBody:
          '# 금요일\n\n오늘도 문서를 읽었습니다.\n\n다른 메모...\n\n지속적 개선에 대한 짧은 문장 하나.',
        context: 'daily',
        score: 0.88,
        docid: 'a',
      },
      {
        displayPath: 'notes/korean-search.md',
        title: '지속 학습 메모',
        body: '지속 학습은 문서 업로드 파싱과 연결됩니다.',
        sourceBody:
          '# 지속 학습 메모\n\n## 적용 방향\n지속 학습은 문서 업로드 파싱과 연결됩니다.\n',
        context: 'notes',
        score: 0.78,
        docid: 'b',
      },
    ];

    const ranked = rankQueryRows(rows, traits);

    expect(ranked[0]?.docid).toBe('b');
    expect(ranked[0]?.adaptive?.phrase).toBeGreaterThan(0);
    expect(ranked[0]?.adaptive?.heading).toBeGreaterThan(0);
  });

  test('treats mixed technical literal anchors as first-class signals', () => {
    const traits = classifyQuery(
      createInput({
        query: '지속 learning',
        displayQuery: '지속 learning',
      }),
    );
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/overview.md',
        title: 'Overview',
        body: 'generic chunk',
        sourceBody: 'This document mentions learning in different places without Korean anchor.',
        context: 'docs',
        score: 0.68,
        docid: 'a',
        explain: {
          ftsScores: [0.7],
          vectorScores: [0.55],
          rrf: {
            rank: 1,
            positionScore: 1,
            weight: 0.75,
            baseScore: 0.1,
            topRankBonus: 0.05,
            totalScore: 0.15,
            contributions: [],
          },
          rerankScore: 0.6,
          blendedScore: 0.68,
        },
      },
      {
        displayPath: 'docs/agent-orchestration.md',
        title: '지속 learning notes',
        body: '지속 learning in practice',
        sourceBody: '# 지속 learning notes\n\n지속 learning in practice.\n',
        context: 'docs',
        score: 0.76,
        docid: 'b',
        explain: {
          ftsScores: [0.68],
          vectorScores: [0.2],
          rrf: {
            rank: 2,
            positionScore: 0.5,
            weight: 0.75,
            baseScore: 0.1,
            topRankBonus: 0.02,
            totalScore: 0.12,
            contributions: [],
          },
          rerankScore: 0.4,
          blendedScore: 0.76,
        },
      },
    ];

    const ranked = rankQueryRows(rows, traits);

    expect(ranked[0]?.docid).toBe('b');
    expect(ranked[0]?.adaptive?.literalAnchor).toBeGreaterThan(0);
  });

  test('falls back to display chunk when source body is oversized without a source anchor', () => {
    const traits = classifyQuery(createInput());
    const rows: SearchOutputRow[] = [
      {
        displayPath: 'docs/huge.md',
        title: 'Huge note',
        body: '지속 학습 핵심 메모',
        sourceBody: `${'x'.repeat(20_000)}\n끝`,
        context: 'docs',
        score: 0.6,
        docid: 'a',
      },
    ];

    const ranked = rankQueryRows(rows, traits);

    expect(ranked[0]?.adaptive?.phrase).toBeGreaterThan(0);
  });
});
