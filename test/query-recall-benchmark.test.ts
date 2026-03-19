import { describe, expect, test } from 'vitest';
import {
  collectJsonKeyPaths,
  createReport,
  type QueryRecallRow,
  toMarkdown,
  toMarkdownSkeleton,
} from '../scripts/query_recall_benchmark_lib.js';

function createSampleRow(overrides: Partial<QueryRecallRow> = {}): QueryRecallRow {
  return {
    caseId: 'spacing-adaptive',
    category: 'spacing',
    expectedOutcome: 'hit',
    query: '지속 학습',
    targetDocs: ['docs/spacing-adaptive-target.md'],
    acceptableTargets: ['docs/spacing-adaptive-target.md'],
    selectedCollections: ['docs'],
    queryClass: 'short-korean-phrase',
    fetchLimit: 20,
    runtimeMode: 'native',
    includedInCoreAggregate: true,
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
        category: 'control',
        expectedOutcome: 'hit',
        includedInCoreAggregate: false,
      }),
      createSampleRow({
        caseId: 'control-weak-hit',
        category: 'control',
        expectedOutcome: 'miss',
        targetDocs: [],
        acceptableTargets: [],
        includedInCoreAggregate: false,
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
        category: 'control',
        expectedOutcome: 'hit',
        query: '"지속 학습"',
        includedInCoreAggregate: false,
      }),
      createSampleRow({
        caseId: 'question-upload',
        category: 'question',
        query: '문서 업로드 파싱은 어떻게 동작해?',
        includedInCoreAggregate: false,
      }),
    ]);

    expect(toMarkdownSkeleton(toMarkdown(report))).toMatchInlineSnapshot(`
      "# Korean Query Recall Metrics
      Date: <date>
      Command: \`bun run measure:query-recall\`
      이 문서는 upstream-compatible base query 대비 current kqmd query의 한국어 recall 비교 벤치마크다.
      synthetic fixture에서 띄어쓰기 변형, 복합어 분해, 한영 혼합 세 가지 query 패턴의 hit/miss를 비교하고, control/exploratory case는 별도 표로 분리한다.
      ## Method
      - 비교 레이어:
        - \`base\`: upstream-compatible base query
        - \`adaptive\`: base candidate set에 adaptive rerank만 적용한 결과
        - \`current\`: current kqmd query path (\`adaptive+assist\`)
      - 핵심 카테고리:
        - \`spacing\`: 띄어쓰기 변형
        - \`compound\`: 복합어 분해
        - \`mixed\`: 한영 혼합 기술어
      - control 카테고리:
        - \`conservative-syntax\`, \`weak-hit\`, \`ineligible\`, \`collection-isolation\`, \`no-target miss\`
      - aggregate 범위: core 카테고리만 포함
      - hit 정의: target 문서의 displayPath가 top-<n> 결과에 존재
      - miss 정의: target 문서가 top-<n>에 없으면 통과하며, empty top-<n> purity는 별도 signal로 본다
      - fixture/runtime: deterministic synthetic fixture, temp HOME/XDG/INDEX isolation, deterministic LLM stub, single-pass serial execution
      ## Results
      | Category | Query | Target | base | adaptive | current | Delta |
      |---|---|---|---|---|---|---|
      ## Controls
      | Query | Expected | base | current | Assist | Reason |
      |---|---|---|---|---|---|
      ## Exploratory
      | Query | Expected | current | Note |
      |---|---|---|---|
      ## Aggregate
      | Scope | Side | Hits | Total | Recall |
      |---|---|---:|---:|---:|
      ## Derived Signals
      - core current recall uplift vs upstream-compatible base: <n>%
      - question current recall uplift vs upstream-compatible base: <n>%
      - adaptive-only gain count: <n>
      - assist-rescue gain count: <n>
      - normalization applied count: <n>
      - negative control pass rate: <n>%
      - negative control empty-top<n> rate: <n>%
      - unresolved core miss count: <n>
      ## Notes
      - upstream baseline은 실제 upstream CLI subprocess가 아니라 upstream-compatible seam이다.
      - aggregate는 core 카테고리만 포함하고 control/exploratory case는 제외한다.
      - assist score normalization은 raw base score-domain과 동치가 아니다.
      - rescue dedupe는 \`docid || displayPath\`, rescue cap은 downstream policy 계약을 따른다.
      - 이 리포트는 recall correctness만 다루며, wall-clock latency/overhead 주장은 의도적으로 제외한다.
      - negative control pass rate는 \`expected=miss\` control만 포함하며, noise-only 반환은 empty-top<n> rate로 따로 본다.
      - deterministic fixture를 사용하므로 real vault 일반화에는 제한이 있다.
      - raw JSON below is the source-of-truth; markdown tables are derived views.
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
        "derivedSignals.negativeControlEmptyTop5Rate",
        "derivedSignals.negativeControlPassRate",
        "derivedSignals.normalizationAppliedCount",
        "derivedSignals.questionRecallUpliftPct",
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
        "rows[].includedInCoreAggregate",
        "rows[].normalizationAddedCandidates",
        "rows[].normalizationApplied",
        "rows[].normalizationReason",
        "rows[].query",
        "rows[].queryClass",
        "rows[].runtimeMode",
        "rows[].selectedCollections",
        "rows[].targetDocs",
        "rows[].winningLayer",
        "schemaVersion",
      ]
    `);
  });
});
