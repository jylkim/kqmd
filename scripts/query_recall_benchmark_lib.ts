import type {
  QueryClass,
  QueryNormalizationReason,
  SearchAssistReason,
  SearchOutputRow,
} from '../src/commands/owned/io/types.js';
import {
  assertSafeSyntheticLabel,
  assertSafeSyntheticPath,
} from './query_recall_fixture_safety.js';

export const QUERY_RECALL_BENCHMARK_DATE = '2026-03-20';
export const QUERY_RECALL_SCHEMA_VERSION = '3';
export const QUERY_RECALL_FIXTURE_VERSION = '2';
export const QUERY_RECALL_DATASET_ID = 'kqmd-query-recall-v2';
export const TOP_K = 5;

export type QueryRecallCategory = 'spacing' | 'compound' | 'mixed' | 'long-query' | 'control';
export type QueryRecallExpectedOutcome = 'hit' | 'miss';
export type QueryRecallRuntimeMode = 'native' | 'injected-control';
export type QueryRecallSide = 'upstream-compatible-base' | 'current-kqmd';
export type QueryRecallAggregateScope = 'core' | 'long-query' | 'excluded';

export interface QueryRecallCase {
  readonly caseId: string;
  readonly syntheticLabel: string;
  readonly category: QueryRecallCategory;
  readonly expectedOutcome: QueryRecallExpectedOutcome;
  readonly query: string;
  readonly targetDocs: readonly string[];
  readonly acceptableTargets?: readonly string[];
  readonly collections?: readonly string[];
}

export interface LayerSummary {
  readonly hitStatus: 'miss' | `hit@${number}`;
  readonly firstHitRank: number | null;
  readonly targetInTop5: boolean;
  readonly targetPresentAnyRank: boolean;
  readonly top5Paths: readonly string[];
  readonly unexpectedTop5Count: number;
}

export type WinningLayer =
  | 'none'
  | 'base'
  | 'adaptive-rank-only'
  | 'assist-rescue'
  | 'tie'
  | 'regression';

export interface QueryRecallRow {
  readonly caseId: string;
  readonly syntheticLabel: string;
  readonly category: QueryRecallCategory;
  readonly aggregateScope: QueryRecallAggregateScope;
  readonly expectedOutcome: QueryRecallExpectedOutcome;
  readonly targetDocs: readonly string[];
  readonly acceptableTargets: readonly string[];
  readonly selectedCollections: readonly string[];
  readonly queryClass: QueryClass;
  readonly fetchLimit: number;
  readonly runtimeMode: QueryRecallRuntimeMode;
  readonly normalizationApplied: boolean;
  readonly normalizationReason: QueryNormalizationReason;
  readonly normalizationAddedCandidates: number;
  readonly assistApplied: boolean;
  readonly assistReason: SearchAssistReason;
  readonly addedCandidates: number;
  readonly base: LayerSummary;
  readonly adaptive: LayerSummary;
  readonly current: LayerSummary;
  readonly winningLayer: WinningLayer;
}

export interface QueryRecallAggregateRow {
  readonly scope: 'core' | 'long-query';
  readonly side: QueryRecallSide;
  readonly hits: number;
  readonly total: number;
  readonly recall: number;
}

export interface QueryRecallDerivedSignals {
  readonly coreRecallUpliftPct: number;
  readonly longQueryRecallUpliftPct: number;
  readonly nativeLongQueryCount: number;
  readonly diagnosticLongQueryCount: number;
  readonly adaptiveOnlyGainCount: number;
  readonly assistRescueGainCount: number;
  readonly normalizationAppliedCount: number;
  readonly negativeControlPassRate: number;
  readonly negativeControlEmptyTop5Rate: number;
  readonly unresolvedCoreMissCount: number;
}

export interface QueryRecallReport {
  readonly schemaVersion: string;
  readonly fixtureVersion: string;
  readonly datasetId: string;
  readonly rows: readonly QueryRecallRow[];
  readonly aggregate: readonly QueryRecallAggregateRow[];
  readonly derivedSignals: QueryRecallDerivedSignals;
}

function assertSafePersistedRows(rows: readonly QueryRecallRow[]): void {
  for (const row of rows) {
    assertSafeSyntheticLabel(row.syntheticLabel);
    for (const targetDoc of row.targetDocs) {
      assertSafeSyntheticPath(targetDoc);
    }
    for (const acceptableTarget of row.acceptableTargets) {
      assertSafeSyntheticPath(acceptableTarget);
    }
    for (const displayPath of row.base.top5Paths) {
      assertSafeSyntheticPath(displayPath);
    }
    for (const displayPath of row.adaptive.top5Paths) {
      assertSafeSyntheticPath(displayPath);
    }
    for (const displayPath of row.current.top5Paths) {
      assertSafeSyntheticPath(displayPath);
    }
  }
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function didMeetExpectedOutcome(
  summary: LayerSummary,
  expectedOutcome: QueryRecallExpectedOutcome,
): boolean {
  return expectedOutcome === 'hit' ? summary.targetInTop5 : !summary.targetInTop5;
}

export function summarizeLayer(
  rows: readonly SearchOutputRow[],
  targets: readonly string[],
  acceptableTargets: readonly string[],
): LayerSummary {
  const top5Paths = rows.slice(0, TOP_K).map((row) => row.displayPath);
  const firstHitIndex = rows.findIndex((row) => targets.includes(row.displayPath));
  const firstHitRank = firstHitIndex >= 0 ? firstHitIndex + 1 : null;
  const targetPresentAnyRank = firstHitRank !== null;
  const targetInTop5 = firstHitRank !== null && firstHitRank <= TOP_K;
  const accepted = new Set(acceptableTargets);
  const unexpectedTop5Count =
    accepted.size === 0
      ? top5Paths.length
      : top5Paths.filter((displayPath) => !accepted.has(displayPath)).length;

  return {
    hitStatus: firstHitRank === null ? 'miss' : (`hit@${firstHitRank}` as const),
    firstHitRank,
    targetInTop5,
    targetPresentAnyRank,
    top5Paths,
    unexpectedTop5Count,
  };
}

export function determineWinningLayer(args: {
  readonly base: LayerSummary;
  readonly adaptive: LayerSummary;
  readonly current: LayerSummary;
  readonly assistApplied: boolean;
}): WinningLayer {
  const { base, adaptive, current, assistApplied } = args;

  if (!current.targetInTop5 && (base.targetInTop5 || adaptive.targetInTop5)) {
    return 'regression';
  }

  if (
    assistApplied &&
    current.targetInTop5 &&
    (!adaptive.targetInTop5 ||
      (current.firstHitRank !== null &&
        adaptive.firstHitRank !== null &&
        current.firstHitRank < adaptive.firstHitRank))
  ) {
    return 'assist-rescue';
  }

  if (
    adaptive.targetInTop5 &&
    (!base.targetInTop5 ||
      (adaptive.firstHitRank !== null &&
        base.firstHitRank !== null &&
        adaptive.firstHitRank < base.firstHitRank))
  ) {
    return 'adaptive-rank-only';
  }

  if (
    base.targetInTop5 &&
    adaptive.firstHitRank === base.firstHitRank &&
    current.firstHitRank === base.firstHitRank
  ) {
    return 'base';
  }

  if (current.targetInTop5 || adaptive.targetInTop5 || base.targetInTop5) {
    return 'tie';
  }

  return 'none';
}

export function createReport(rows: readonly QueryRecallRow[]): QueryRecallReport {
  assertSafePersistedRows(rows);
  const coreRows = rows.filter((row) => row.aggregateScope === 'core');
  const longQueryRows = rows.filter(
    (row) => row.category === 'long-query' && row.runtimeMode === 'native',
  );
  const diagnosticLongQueryRows = rows.filter(
    (row) => row.category === 'long-query' && row.runtimeMode === 'injected-control',
  );
  const negativeControlRows = rows.filter(
    (row) => row.category === 'control' && row.expectedOutcome === 'miss',
  );

  const aggregate: QueryRecallAggregateRow[] = [
    {
      scope: 'core',
      side: 'upstream-compatible-base',
      hits: coreRows.filter((row) => didMeetExpectedOutcome(row.base, row.expectedOutcome)).length,
      total: coreRows.length,
      recall:
        coreRows.length === 0
          ? 0
          : round(
              (coreRows.filter((row) => didMeetExpectedOutcome(row.base, row.expectedOutcome))
                .length /
                coreRows.length) *
                100,
            ),
    },
    {
      scope: 'core',
      side: 'current-kqmd',
      hits: coreRows.filter((row) => didMeetExpectedOutcome(row.current, row.expectedOutcome))
        .length,
      total: coreRows.length,
      recall:
        coreRows.length === 0
          ? 0
          : round(
              (coreRows.filter((row) => didMeetExpectedOutcome(row.current, row.expectedOutcome))
                .length /
                coreRows.length) *
                100,
            ),
    },
    {
      scope: 'long-query',
      side: 'upstream-compatible-base',
      hits: longQueryRows.filter((row) => didMeetExpectedOutcome(row.base, row.expectedOutcome))
        .length,
      total: longQueryRows.length,
      recall:
        longQueryRows.length === 0
          ? 0
          : round(
              (longQueryRows.filter((row) => didMeetExpectedOutcome(row.base, row.expectedOutcome))
                .length /
                longQueryRows.length) *
                100,
            ),
    },
    {
      scope: 'long-query',
      side: 'current-kqmd',
      hits: longQueryRows.filter((row) => didMeetExpectedOutcome(row.current, row.expectedOutcome))
        .length,
      total: longQueryRows.length,
      recall:
        longQueryRows.length === 0
          ? 0
          : round(
              (longQueryRows.filter((row) => didMeetExpectedOutcome(row.current, row.expectedOutcome))
                .length /
                longQueryRows.length) *
                100,
            ),
    },
  ];

  const currentCoreHits = aggregate[1]?.hits ?? 0;
  const negativeControlPasses = negativeControlRows.filter((row) =>
    didMeetExpectedOutcome(row.current, row.expectedOutcome),
  ).length;
  const negativeControlEmptyTop5Passes = negativeControlRows.filter(
    (row) => row.current.top5Paths.length === 0,
  ).length;

  return {
    schemaVersion: QUERY_RECALL_SCHEMA_VERSION,
    fixtureVersion: QUERY_RECALL_FIXTURE_VERSION,
    datasetId: QUERY_RECALL_DATASET_ID,
    rows,
    aggregate,
    derivedSignals: {
      coreRecallUpliftPct:
        aggregate[0] && aggregate[1] ? round((aggregate[1].recall ?? 0) - (aggregate[0].recall ?? 0)) : 0,
      longQueryRecallUpliftPct:
        aggregate[2] && aggregate[3] ? round((aggregate[3].recall ?? 0) - (aggregate[2].recall ?? 0)) : 0,
      nativeLongQueryCount: longQueryRows.length,
      diagnosticLongQueryCount: diagnosticLongQueryRows.length,
      adaptiveOnlyGainCount: coreRows.filter((row) => row.winningLayer === 'adaptive-rank-only').length,
      assistRescueGainCount: coreRows.filter((row) => row.winningLayer === 'assist-rescue').length,
      normalizationAppliedCount: coreRows.filter((row) => row.normalizationApplied).length,
      negativeControlPassRate:
        negativeControlRows.length === 0
          ? 0
          : round((negativeControlPasses / negativeControlRows.length) * 100),
      negativeControlEmptyTop5Rate:
        negativeControlRows.length === 0
          ? 0
          : round((negativeControlEmptyTop5Passes / negativeControlRows.length) * 100),
      unresolvedCoreMissCount: Math.max(0, coreRows.length - currentCoreHits),
    },
  };
}

function formatLayer(summary: LayerSummary): string {
  return summary.hitStatus;
}

function formatPercent(value: number): string {
  return `${round(value)}%`;
}

function formatDelta(base: LayerSummary, current: LayerSummary): string {
  const baseHit = base.targetInTop5 ? 1 : 0;
  const currentHit = current.targetInTop5 ? 1 : 0;
  const delta = currentHit - baseHit;
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export function toMarkdown(report: QueryRecallReport): string {
  const coreRows = report.rows.filter((item) => item.aggregateScope === 'core');
  const controlRows = report.rows.filter((item) => item.category === 'control');
  const longQueryRows = report.rows.filter(
    (item) => item.category === 'long-query' && item.runtimeMode === 'native',
  );
  const diagnosticRows = report.rows.filter(
    (item) => item.category === 'long-query' && item.runtimeMode === 'injected-control',
  );
  const lines: string[] = [
    '# Korean Query Recall Metrics',
    '',
    `Date: ${QUERY_RECALL_BENCHMARK_DATE}`,
    'Command: `bun run measure:query-recall`',
    '',
    '이 문서는 upstream-compatible base query 대비 current kqmd query의 한국어 recall correctness 비교 벤치마크다.',
    'synthetic fixture에서 띄어쓰기 변형, 복합어 분해, 한영 혼합 기술어, 긴 한국어 plain query를 비교하고, control/diagnostic case는 별도 표로 분리한다.',
    '',
    '## Method',
    '',
    '- 비교 레이어:',
    '  - `base`: upstream-compatible base query',
    '  - `adaptive`: base candidate set에 adaptive rerank만 적용한 결과',
    '  - `current`: current kqmd query path (`adaptive+assist`)',
    '- 핵심 카테고리:',
    '  - `spacing`: 띄어쓰기 변형',
    '  - `compound`: 복합어 분해',
    '  - `mixed`: 한영 혼합 기술어',
    '  - `long-query`: native long Korean plain query guardrail',
    '- control 카테고리:',
    '  - `conservative-syntax`, `weak-hit`, `ineligible`, `collection-isolation`, `no-target miss`',
    '- aggregate 범위: core 카테고리에는 native `long-query`가 포함되며, diagnostic injected case와 control은 제외한다',
    '- persisted surface: benchmark markdown/raw JSON은 synthetic label만 남기고 raw query와 intent는 남기지 않는다',
    '- hit 정의: target 문서의 displayPath가 top-5 결과에 존재',
    '- miss 정의: target 문서가 top-5에 없으면 통과하며, empty top-5 purity는 별도 signal로 본다',
    '- fixture/runtime: deterministic synthetic fixture, temp HOME/XDG/INDEX isolation, deterministic LLM stub, deterministic timing seam, single-pass serial execution',
    '',
    '## Results',
    '',
    '| Category | Case | Target | base | adaptive | current | Delta |',
    '|---|---|---|---|---|---|---|',
  ];

  for (const row of coreRows) {
    lines.push(
      `| ${row.category} | ${row.syntheticLabel} | ${row.targetDocs.join(', ')} | ${formatLayer(row.base)} | ${formatLayer(row.adaptive)} | ${formatLayer(row.current)} | ${formatDelta(row.base, row.current)} |`,
    );
  }

  lines.push(
    '',
    '## Controls',
    '',
    '| Case | Expected | base | current | Assist | Reason |',
    '|---|---|---|---|---|---|',
  );

  for (const row of controlRows) {
    lines.push(
      `| ${row.syntheticLabel} | ${row.expectedOutcome} | ${formatLayer(row.base)} | ${formatLayer(row.current)} | ${row.assistApplied ? 'yes' : 'no'} | ${row.assistReason} |`,
    );
  }

  lines.push(
    '',
    '## Long Query',
    '',
    '| Case | Target | base | current | In Core |',
    '|---|---|---|---|---|',
  );

  for (const row of longQueryRows) {
    lines.push(
      `| ${row.syntheticLabel} | ${row.targetDocs.join(', ')} | ${formatLayer(row.base)} | ${formatLayer(row.current)} | ${row.aggregateScope === 'core' ? 'yes' : 'no'} |`,
    );
  }

  lines.push(
    '',
    '## Diagnostics',
    '',
    '| Case | Current | Mode |',
    '|---|---|---|',
  );

  for (const row of diagnosticRows) {
    lines.push(`| ${row.syntheticLabel} | ${formatLayer(row.current)} | ${row.runtimeMode} |`);
  }

  lines.push(
    '',
    '## Aggregate',
    '',
    '| Scope | Side | Hits | Total | Recall |',
    '|---|---|---:|---:|---:|',
  );

  for (const row of report.aggregate) {
    lines.push(`| ${row.scope} | ${row.side} | ${row.hits} | ${row.total} | ${formatPercent(row.recall)} |`);
  }

  lines.push(
    '',
    '## Derived Signals',
    '',
    `- core current recall uplift vs upstream-compatible base: ${formatPercent(report.derivedSignals.coreRecallUpliftPct)}`,
    `- long-query current recall uplift vs upstream-compatible base: ${formatPercent(report.derivedSignals.longQueryRecallUpliftPct)}`,
    `- native long-query count: ${report.derivedSignals.nativeLongQueryCount}`,
    `- diagnostic long-query count: ${report.derivedSignals.diagnosticLongQueryCount}`,
    `- adaptive-only gain count: ${report.derivedSignals.adaptiveOnlyGainCount}`,
    `- assist-rescue gain count: ${report.derivedSignals.assistRescueGainCount}`,
    `- normalization applied count: ${report.derivedSignals.normalizationAppliedCount}`,
    `- negative control pass rate: ${formatPercent(report.derivedSignals.negativeControlPassRate)}`,
    `- negative control empty-top5 rate: ${formatPercent(report.derivedSignals.negativeControlEmptyTop5Rate)}`,
    `- unresolved core miss count: ${report.derivedSignals.unresolvedCoreMissCount}`,
    '',
    '## Notes',
    '',
    '- upstream baseline은 실제 upstream CLI subprocess가 아니라 upstream-compatible seam이다.',
    '- core aggregate는 native `long-query`를 포함하고 control/diagnostic case는 제외한다.',
    '- benchmark markdown/raw JSON은 synthetic label만 persisted surface로 사용한다.',
    '- assist score normalization은 raw base score-domain과 동치가 아니다.',
    '- rescue dedupe는 `docid || displayPath`, rescue cap은 downstream policy 계약을 따른다.',
    '- 이 리포트는 recall correctness만 다루며, wall-clock latency/overhead나 production representativeness 주장은 하지 않는다.',
    '- negative control pass rate는 `expected=miss` control만 포함하며, noise-only 반환은 empty-top5 rate로 따로 본다.',
    '- deterministic fixture를 사용하므로 real vault 일반화에는 제한이 있다.',
    '- raw JSON below is the source-of-truth; markdown tables are derived views.',
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```',
  );

  return lines.join('\n');
}

export function toMarkdownSkeleton(markdown: string): string {
  const lines = markdown.split('\n');
  const skeleton: string[] = [];

  for (const line of lines) {
    if (line.startsWith('#')) {
      skeleton.push(line);
      continue;
    }

    if (line.startsWith('Date: ')) {
      skeleton.push('Date: <date>');
      continue;
    }

    if (line.startsWith('Command: ')) {
      skeleton.push(line);
      continue;
    }

    if (
      line.startsWith('| Category |') ||
      line.startsWith('| Scope |') ||
      line.startsWith('| Case |') ||
      line.startsWith('|---')
    ) {
      skeleton.push(line);
      continue;
    }

    if (line.trimStart().startsWith('- ')) {
      skeleton.push(line.replace(/\d+(\.\d+)?/g, '<n>'));
      continue;
    }

    if (line.startsWith('이 문서는 ') || line.startsWith('synthetic fixture에서 ')) {
      skeleton.push(line);
      continue;
    }

    if (line === '```json' || line === '```') {
      skeleton.push(line);
      continue;
    }

    if (line.includes('"schemaVersion"')) {
      skeleton.push('  "schemaVersion": "<version>",');
      continue;
    }

    if (line.includes('"fixtureVersion"')) {
      skeleton.push('  "fixtureVersion": "<version>",');
      continue;
    }

    if (line.includes('"datasetId"')) {
      skeleton.push('  "datasetId": "<dataset>",');
      continue;
    }
  }

  return skeleton.join('\n');
}

export function collectJsonKeyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    const keyPaths = new Set<string>();
    value.forEach((item) => {
      for (const keyPath of collectJsonKeyPaths(item, `${prefix}[]`)) {
        keyPaths.add(keyPath);
      }
    });
    return [...keyPaths].sort();
  }

  if (value && typeof value === 'object') {
    const keyPaths = new Set<string>();
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      keyPaths.add(path);
      for (const nestedPath of collectJsonKeyPaths(nested, path)) {
        keyPaths.add(nestedPath);
      }
    }
    return [...keyPaths].sort();
  }

  return [];
}
