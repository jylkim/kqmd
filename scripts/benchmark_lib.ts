import type {
  QueryClass,
  QueryNormalizationReason,
  SearchAssistReason,
  SearchOutputRow,
} from '../src/commands/owned/io/types.js';
import {
  assertSafeSyntheticLabel,
  assertSafeSyntheticPath,
} from './benchmark_fixture_safety.js';

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

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export interface DisplayHints {
  readonly queries: ReadonlyMap<string, string>;
  readonly docContents: ReadonlyMap<string, string>;
}

const CATEGORY_LABELS: Record<QueryRecallCategory, string> = {
  spacing: '띄어쓰기',
  compound: '복합어',
  mixed: '한영 혼합',
  'long-query': '긴 쿼리',
  control: 'control',
};

export function formatDocExcerpt(
  docContent: string,
  query: string,
  maxLength = 50,
): string {
  const bodyLines = docContent
    .split('\n')
    .filter((line) => !line.startsWith('#') && line.trim().length > 0);

  const lowerQuery = query.toLowerCase();

  for (const line of bodyLines) {
    const idx = line.toLowerCase().indexOf(lowerQuery);
    if (idx >= 0) {
      const truncated =
        line.length > maxLength ? line.slice(0, maxLength) : line;
      const suffix = line.length > maxLength ? '...' : '';
      const matchEnd = idx + query.length;
      if (matchEnd <= truncated.length) {
        return (
          truncated.slice(0, idx) +
          '**' +
          truncated.slice(idx, matchEnd) +
          '**' +
          truncated.slice(matchEnd) +
          suffix
        );
      }
      return truncated + suffix;
    }
  }

  const first = bodyLines[0] ?? '';
  return first.length > maxLength ? first.slice(0, maxLength) + '...' : first;
}

function formatHit(summary: LayerSummary, isGain: boolean): string {
  if (summary.hitStatus === 'miss') return 'miss';
  return isGain ? `**${summary.hitStatus}**` : summary.hitStatus;
}

function formatPercent(value: number): string {
  return `${round(value)}%`;
}

function formatAggregateSide(side: QueryRecallSide): string {
  return side === 'upstream-compatible-base' ? 'QMD' : 'K-QMD';
}

export function toMarkdown(report: QueryRecallReport, hints?: DisplayHints): string {
  const coreRows = report.rows.filter((item) => item.aggregateScope === 'core');
  const controlRows = report.rows.filter((item) => item.category === 'control');

  const lines: string[] = [
    '# Korean Query Recall Benchmark',
    '',
    `Date: ${QUERY_RECALL_BENCHMARK_DATE}`,
    'Command: `bun run benchmark:query-recall`',
    '',
    'QMD의 query 명령에서 한국어 검색 품질을 비교한 벤치마크입니다.',
    '띄어쓰기 변형, 복합어, 한영 혼합, 긴 한국어 질문에서 QMD 대비 K-QMD의 검색 결과를 비교합니다.',
    '',
    '## 테스트 방법',
    '',
    '- synthetic fixture 문서에 대해 QMD와 K-QMD의 query 결과를 비교합니다.',
    '- hit: target 문서가 상위 5개 결과에 포함되면 검색 성공입니다.',
    '- miss: target 문서가 상위 5개 결과에 없으면 검색 실패입니다.',
    '',
    '## 결과',
    '',
  ];

  const queryLabel = hints ? '쿼리' : 'Case';
  const docLabel = hints ? '문서 내용' : 'Target';

  lines.push(
    `| 패턴 | ${queryLabel} | ${docLabel} | QMD | K-QMD |`,
    '|---|---|---|:---:|:---:|',
  );

  for (const row of coreRows) {
    const query = hints?.queries.get(row.caseId) ?? row.syntheticLabel;
    const targetDoc = row.targetDocs[0] ?? '';
    const docContent = hints?.docContents.get(targetDoc);
    const col3 = docContent
      ? formatDocExcerpt(docContent, query)
      : row.targetDocs.join(', ');
    const isGain = row.base.hitStatus === 'miss' && row.current.targetInTop5;

    lines.push(
      `| ${CATEGORY_LABELS[row.category]} | ${query} | ${col3} | ${row.base.hitStatus} | ${formatHit(row.current, isGain)} |`,
    );
  }

  // Controls
  if (controlRows.length > 0) {
    lines.push(
      '',
      '## 검증용 테스트',
      '',
      `| ${queryLabel} | 예상 | QMD | K-QMD | 설명 |`,
      '|---|---|:---:|:---:|---|',
    );

    for (const row of controlRows) {
      const query = hints?.queries.get(row.caseId) ?? row.syntheticLabel;
      lines.push(
        `| ${query} | ${row.expectedOutcome} | ${row.base.hitStatus} | ${row.current.hitStatus} | ${row.assistReason} |`,
      );
    }
  }

  // Aggregate
  const coreAggregate = report.aggregate.filter((row) => row.scope === 'core');

  lines.push(
    '',
    '## 요약',
    '',
    '| | Hits | Total | Recall |',
    '|---|---:|---:|---:|',
  );

  for (const row of coreAggregate) {
    const label = formatAggregateSide(row.side);
    const recall =
      row.recall === 100 ? `**${formatPercent(row.recall)}**` : formatPercent(row.recall);
    lines.push(`| ${label} | ${row.hits} | ${row.total} | ${recall} |`);
  }

  // Notes
  lines.push(
    '',
    '## Notes',
    '',
    '- deterministic synthetic fixture를 사용하므로 실제 vault와 결과가 다를 수 있습니다.',
    '- 이 벤치마크는 recall correctness만 다루며, 응답 시간은 측정하지 않습니다.',
    '- 아래 JSON은 전체 측정 데이터입니다.',
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
      line.startsWith('| 패턴 |') ||
      line.startsWith('| 쿼리 |') ||
      line.startsWith('| Case |') ||
      line.startsWith('| |') ||
      line.startsWith('|---')
    ) {
      skeleton.push(line);
      continue;
    }

    if (line.trimStart().startsWith('- ')) {
      skeleton.push(line.replace(/\d+(\.\d+)?/g, '<n>'));
      continue;
    }

    if (
      line.startsWith('QMD의 ') ||
      line.startsWith('띄어쓰기 변형')
    ) {
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
