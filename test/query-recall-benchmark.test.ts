import { describe, expect, test } from 'vitest';
import {
  collectJsonKeyPaths,
  createReport,
  type QueryRecallRow,
  toMarkdown,
  toMarkdownSkeleton,
} from '../scripts/benchmark_lib.js';

function createSampleRow(overrides: Partial<QueryRecallRow> = {}): QueryRecallRow {
  return {
    caseId: 'spacing-adaptive',
    syntheticLabel: 'spacing-adaptive',
    category: 'spacing',
    aggregateScope: 'core',
    expectedOutcome: 'hit',
    targetDocs: ['docs/spacing-adaptive-target.md'],
    acceptableTargets: ['docs/spacing-adaptive-target.md'],
    selectedCollections: ['docs'],
    queryClass: 'short-korean-phrase',
    fetchLimit: 20,
    runtimeMode: 'native',
    normalizationApplied: false,
    normalizationReason: 'not-eligible',
    normalizationAddedCandidates: 0,
    assistApplied: false,
    assistReason: 'ineligible',
    addedCandidates: 0,
    base: {
      hitStatus: 'hit@4',
      firstHitRank: 4,
      targetInTop5: true,
      targetPresentAnyRank: true,
      top5Paths: [
        'docs/noise-000.md',
        'docs/noise-001.md',
        'docs/noise-002.md',
        'docs/spacing-adaptive-target.md',
        'docs/noise-003.md',
      ],
      unexpectedTop5Count: 4,
    },
    adaptive: {
      hitStatus: 'hit@1',
      firstHitRank: 1,
      targetInTop5: true,
      targetPresentAnyRank: true,
      top5Paths: [
        'docs/spacing-adaptive-target.md',
        'docs/noise-000.md',
        'docs/noise-001.md',
        'docs/noise-002.md',
        'docs/noise-003.md',
      ],
      unexpectedTop5Count: 4,
    },
    current: {
      hitStatus: 'hit@1',
      firstHitRank: 1,
      targetInTop5: true,
      targetPresentAnyRank: true,
      top5Paths: [
        'docs/spacing-adaptive-target.md',
        'docs/noise-000.md',
        'docs/noise-001.md',
        'docs/noise-002.md',
        'docs/noise-003.md',
      ],
      unexpectedTop5Count: 4,
    },
    winningLayer: 'adaptive-rank-only',
    ...overrides,
  };
}

describe('query recall benchmark helpers', () => {
  test('treats miss expectations as target absence instead of empty results', () => {
    const missWithNoise = {
      hitStatus: 'miss' as const,
      firstHitRank: null,
      targetInTop5: false,
      targetPresentAnyRank: false,
      top5Paths: ['docs/noise-weak-hit.md'],
      unexpectedTop5Count: 1,
    };
    const report = createReport([
      createSampleRow({
        caseId: 'control-quoted',
        syntheticLabel: 'control-quoted',
        category: 'control',
        aggregateScope: 'excluded',
        expectedOutcome: 'hit',
      }),
      createSampleRow({
        caseId: 'control-weak-hit',
        syntheticLabel: 'control-weak-hit',
        category: 'control',
        aggregateScope: 'excluded',
        expectedOutcome: 'miss',
        targetDocs: [],
        acceptableTargets: [],
        base: missWithNoise,
        adaptive: missWithNoise,
        current: missWithNoise,
        winningLayer: 'none',
      }),
    ]);

    expect(report.derivedSignals.negativeControlPassRate).toBe(100);
    expect(report.derivedSignals.negativeControlEmptyTop5Rate).toBe(0);
  });

  test('renders a stable markdown skeleton', () => {
    const report = createReport([
      createSampleRow(),
      createSampleRow({
        caseId: 'control-quoted',
        syntheticLabel: 'control-quoted',
        category: 'control',
        aggregateScope: 'excluded',
        expectedOutcome: 'hit',
      }),
      createSampleRow({
        caseId: 'long-query-question-upload',
        syntheticLabel: 'long-query-question-upload',
        category: 'long-query',
        aggregateScope: 'core',
      }),
    ]);

    expect(toMarkdownSkeleton(toMarkdown(report))).toMatchInlineSnapshot(`
      "# Korean Query Recall Benchmark
      Date: <date>
      Command: \`bun run benchmark:query-recall\`
      QMD의 query 명령에서 한국어 검색 품질을 비교한 벤치마크입니다.
      띄어쓰기 변형, 복합어, 한영 혼합, 긴 한국어 질문에서 QMD 대비 K-QMD의 검색 결과를 비교합니다.
      ## 테스트 방법
      - synthetic fixture 문서에 대해 QMD와 K-QMD의 query 결과를 비교합니다.
      - hit: target 문서가 상위 <n>개 결과에 포함되면 검색 성공입니다.
      - miss: target 문서가 상위 <n>개 결과에 없으면 검색 실패입니다.
      ## 결과
      | 패턴 | Case | Target | QMD | K-QMD |
      |---|---|---|:---:|:---:|
      ## 검증용 테스트
      | Case | 예상 | QMD | K-QMD | 설명 |
      |---|---|:---:|:---:|---|
      ## 요약
      | | Hits | Total | Recall |
      |---|---:|---:|---:|
      ## Notes
      - deterministic synthetic fixture를 사용하므로 실제 vault와 결과가 다를 수 있습니다.
      - 이 벤치마크는 recall correctness만 다루며, 응답 시간은 측정하지 않습니다.
      - 아래 JSON은 전체 측정 데이터입니다.
      \`\`\`json
        "schemaVersion": "<version>",
        "fixtureVersion": "<version>",
        "datasetId": "<dataset>",
      \`\`\`"
    `);
  });

  test('collects stable JSON key paths', () => {
    const report = createReport([createSampleRow()]);

    expect(collectJsonKeyPaths(report)).toMatchInlineSnapshot(`
      [
        "aggregate",
        "aggregate[].hits",
        "aggregate[].recall",
        "aggregate[].scope",
        "aggregate[].side",
        "aggregate[].total",
        "datasetId",
        "derivedSignals",
        "derivedSignals.adaptiveOnlyGainCount",
        "derivedSignals.assistRescueGainCount",
        "derivedSignals.coreRecallUpliftPct",
        "derivedSignals.diagnosticLongQueryCount",
        "derivedSignals.longQueryRecallUpliftPct",
        "derivedSignals.nativeLongQueryCount",
        "derivedSignals.negativeControlEmptyTop5Rate",
        "derivedSignals.negativeControlPassRate",
        "derivedSignals.normalizationAppliedCount",
        "derivedSignals.unresolvedCoreMissCount",
        "fixtureVersion",
        "rows",
        "rows[].acceptableTargets",
        "rows[].adaptive",
        "rows[].adaptive.firstHitRank",
        "rows[].adaptive.hitStatus",
        "rows[].adaptive.targetInTop5",
        "rows[].adaptive.targetPresentAnyRank",
        "rows[].adaptive.top5Paths",
        "rows[].adaptive.unexpectedTop5Count",
        "rows[].addedCandidates",
        "rows[].aggregateScope",
        "rows[].assistApplied",
        "rows[].assistReason",
        "rows[].base",
        "rows[].base.firstHitRank",
        "rows[].base.hitStatus",
        "rows[].base.targetInTop5",
        "rows[].base.targetPresentAnyRank",
        "rows[].base.top5Paths",
        "rows[].base.unexpectedTop5Count",
        "rows[].caseId",
        "rows[].category",
        "rows[].current",
        "rows[].current.firstHitRank",
        "rows[].current.hitStatus",
        "rows[].current.targetInTop5",
        "rows[].current.targetPresentAnyRank",
        "rows[].current.top5Paths",
        "rows[].current.unexpectedTop5Count",
        "rows[].expectedOutcome",
        "rows[].fetchLimit",
        "rows[].normalizationAddedCandidates",
        "rows[].normalizationApplied",
        "rows[].normalizationReason",
        "rows[].queryClass",
        "rows[].runtimeMode",
        "rows[].selectedCollections",
        "rows[].syntheticLabel",
        "rows[].targetDocs",
        "rows[].winningLayer",
        "schemaVersion",
      ]
    `);
  });

  test('rejects unsafe persisted synthetic labels and paths', () => {
    expect(() =>
      createReport([
        createSampleRow({
          syntheticLabel: '문서 업로드 파싱은 어떻게 동작해?',
        }),
      ]),
    ).toThrow(/Unsafe synthetic label detected/);

    expect(() =>
      createReport([
        createSampleRow({
          targetDocs: ['/Users/jylkim/private.md'],
        }),
      ]),
    ).toThrow(/Unsafe synthetic fixture content detected|Unsafe synthetic path detected/);
  });
});
