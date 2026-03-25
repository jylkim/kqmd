import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore, type HybridQueryResult, type QMDStore } from '@tobilu/qmd';

import { executeQueryCore } from '../src/commands/owned/query_core.js';
import { classifyQuery, resolveFetchLimitForQuery, shouldDisableRerankForQuery } from '../src/commands/owned/query_classifier.js';
import { normalizeHybridQueryResults } from '../src/commands/owned/io/format.js';
import type { QueryCommandInput, SearchOutputRow } from '../src/commands/owned/io/types.js';
import { executeOwnedQuerySearch, type QueryRuntimeDependencies } from '../src/commands/owned/query_runtime.js';
import { rankQueryRows } from '../src/commands/owned/query_ranking.js';
import { rebuildSearchShadowIndex } from '../src/commands/owned/search_shadow_index.js';
import { describeEffectiveSearchPolicy } from '../src/config/search_policy.js';
import {
  collectJsonKeyPaths,
  createReport,
  determineWinningLayer,
  type DisplayHints,
  type QueryRecallAggregateScope,
  type QueryRecallCase,
  summarizeLayer,
  toMarkdown,
} from './benchmark_lib.js';
import {
  assertSafeSyntheticLabel,
  assertSafeSyntheticPath,
  assertSafeSyntheticTexts,
} from './benchmark_fixture_safety.js';

type QueryBenchmarkDependencies = Parameters<typeof executeQueryCore>[3];
type CollectionSnapshots = {
  readonly availableCollectionNames: readonly string[];
  readonly defaultCollectionNames: readonly string[];
};

type BenchmarkCaseRuntime = {
  readonly caseDefinition: QueryRecallCase;
  readonly input: QueryCommandInput;
  readonly runtimeMode: 'native' | 'injected-control';
  readonly dependencies?: QueryBenchmarkDependencies;
};

type BenchmarkContext = {
  readonly input: QueryCommandInput;
  readonly traits: ReturnType<typeof classifyQuery>;
  readonly selectedCollections: readonly string[];
  readonly availableCollectionNames: readonly string[];
  readonly defaultCollectionNames: readonly string[];
  readonly effectiveBaseInput: QueryCommandInput;
  readonly env: NodeJS.ProcessEnv;
  readonly runtimeMode: 'native' | 'injected-control';
};

const TARGET_DOCS: Record<string, string> = {
  // --- CI/CD, Kubernetes 배포 ---
  'devops-deploy.md': [
    '# CI/CD 배포 로그',
    '',
    '## Jenkins에서 GitHub Actions 전환',
    'Jenkins파이프라인에서 GitHub Actions로 전환을 진행했습니다.',
    '빌드스크립트를 리팩토링하고 캐싱 전략을 최적화했습니다.',
    'Docker이미지 빌드 시간이 40% 단축되었습니다.',
    '',
    '## Kubernetes 운영',
    'HPA 임계값을 CPU 70%에서 60%로 낮추고 replica 수를 조정했습니다.',
  ].join('\n'),

  // --- AI 에이전트 설계 ---
  'agent-architecture.md': [
    '# 멀티에이전트 시스템 설계',
    '',
    '서브에이전트 패턴으로 멀티에이전트 시스템을 구성합니다.',
    '오케스트레이터가 작업을 분배하고 각 워커를 관리합니다.',
    '시스템프롬프트 주입 기능과 맥락 관리가 핵심 요구사항입니다.',
    '',
    '승인 플로우를 구현하여 위험한 도구 호출을 사전에 차단합니다.',
    '가드레일을 설정하여 허용 범위를 벗어나지 않도록 합니다.',
  ].join('\n'),

  // --- 보안/샌드박싱 ---
  'security-sandbox.md': [
    '# 샌드박싱 보안 아키텍처',
    '',
    'seccomp필터와 Landlock LSM을 결합한 다층 방어를 구현합니다.',
    '공급망공격 방지를 위해 의존성 무결성 검증 절차를 도입했습니다.',
    '보안취약점 스캔 결과를 감사 로그에 기록합니다.',
    '',
    '각 계층별 격리 정책과 탈출 방지 전략을 정리합니다.',
  ].join('\n'),

  // --- Python 에코시스템 ---
  'python-migration.md': [
    '# Python 저장소 마이그레이션',
    '',
    'pytest실행 환경을 uv로 전환했습니다.',
    'ruff린팅 규칙을 추가하고 기존 pylint 설정을 대체했습니다.',
    '타입힌트를 Python 3.10+ 문법으로 모더나이제이션했습니다.',
    '',
    'pyproject.toml로 빌드 설정을 통합하고 의존성을 정리했습니다.',
  ].join('\n'),

  // --- 프론트엔드 마이그레이션 ---
  'frontend-sprint.md': [
    '# UI 마이그레이션 스프린트',
    '',
    'MUI에서 shadcn/ui로 컴포넌트 마이그레이션을 진행합니다.',
    'Tailwind설정과 디자인토큰 통합을 완료했습니다.',
    'Storybook문서화를 추가하여 컴포넌트 카탈로그를 구축합니다.',
    '',
    '이번 스프린트에서 Button, Dialog, Table 컴포넌트를 완료합니다.',
  ].join('\n'),

  // --- 코드 리뷰 미팅 ---
  'meeting-review.md': [
    '# 코드 리뷰 미팅 노트',
    '',
    '리팩토링이 완료된 모듈의 테스트커버리지를 확인했습니다.',
    '통합테스트 실행 시간이 3분에서 45초로 단축되었습니다.',
    '정적분석 도구를 PMD에서 SonarQube로 전환하는 안건을 논의했습니다.',
    '',
    '## Action Items',
    '- 다음 주까지 SonarQube 파일럿 환경 구성',
  ].join('\n'),

  // --- 모니터링/관측 ---
  'observability-guide.md': [
    '# OpenTelemetry 적용 가이드',
    '',
    '분산추적 설정과 메트릭수집 파이프라인을 구축합니다.',
    'Grafana대시보드에 API 레이턴시와 에러율 패널을 추가합니다.',
    '로그 집계 시스템을 Loki로 통합하는 방법을 설명합니다.',
    '',
    'span context propagation과 sampling 전략을 다룹니다.',
  ].join('\n'),

  // --- Rust 시스템 프로그래밍 ---
  'rust-sdk.md': [
    '# PAGER Rust SDK 개발 노트',
    '',
    'PyO3바인딩으로 Python에서 Rust 코어를 호출합니다.',
    '이벤트드리븐 아키텍처를 Tower 미들웨어로 구현했습니다.',
    'SQLite에 이벤트소싱 패턴을 적용하여 상태를 관리합니다.',
    '',
    'cargo nextest로 병렬 테스트를 실행합니다.',
  ].join('\n'),

  // --- Long-query 전용 target 문서 ---
  'security-scan-faq.md': [
    '# 보안 취약점 스캔 FAQ',
    '',
    '보안 취약점 스캔 동작 단계와 결과 해석 방법을 설명합니다.',
    '스캔 대상 범위 설정과 오탐 처리 절차를 정리합니다.',
    '정기 스캔 스케줄과 긴급 패치 판단 기준을 안내합니다.',
  ].join('\n'),

  'observability-setup.md': [
    '# Grafana 대시보드 설정 가이드',
    '',
    'Grafana 대시보드 설정 방법과 패널 구성을 정리한 가이드입니다.',
    '데이터소스 연결, 알림 규칙, 변수 템플릿 설정을 다룹니다.',
    'JSON 모델 내보내기와 팀 공유 방법을 안내합니다.',
  ].join('\n'),

  'python-test-setup.md': [
    '# pytest 실행 환경 설정',
    '',
    'pytest 실행 환경 설정 단계와 conftest 구성을 설명합니다.',
    'fixture 계층 구조와 marker 규칙을 정리합니다.',
    'CI에서의 병렬 실행 옵션과 커버리지 리포트 설정을 안내합니다.',
  ].join('\n'),
};

const DOC_NOISE: readonly string[] = [
  ['# 빌드 환경 점검', '', '빌드 캐시를 정리하고 배포 환경을 점검했습니다.', '로컬에서 스크립트 동작을 확인했습니다.'].join('\n'),
  ['# 보안 감사 결과', '', '보안 정책을 검토하고 감사 로그를 확인했습니다.', '취약점 패치 일정을 수립합니다.'].join('\n'),
  ['# 테스트 전략 회의', '', '테스트 자동화 범위를 논의했습니다.', '커버리지 목표를 80%로 상향 조정합니다.'].join('\n'),
  ['# Python 환경 정리', '', 'uv로 가상 환경을 재구성했습니다.', '린트 규칙 충돌을 해결했습니다.'].join('\n'),
  ['# 디자인 시스템 검토', '', '디자인 시스템 컴포넌트 목록을 정리했습니다.', '토큰 네이밍 규칙을 확정합니다.'].join('\n'),
  ['# 모니터링 운영 메모', '', '메트릭 임계값을 재조정하고 알림 규칙을 갱신했습니다.', '대시보드 레이아웃을 개선합니다.'].join('\n'),
  ['# Rust 모듈 리뷰', '', '이벤트 처리 로직을 리뷰했습니다.', '미들웨어 체인 순서를 재배치합니다.'].join('\n'),
  ['# 에이전트 운영 일지', '', '에이전트 응답 속도를 모니터링했습니다.', '프롬프트 튜닝 실험 결과를 기록합니다.'].join('\n'),
  ['# 스프린트 회고', '', '이번 스프린트에서 완료한 작업을 정리했습니다.', '다음 스프린트 목표를 설정합니다.'].join('\n'),
  ['# 팀 온보딩 가이드', '', '신규 입사자를 위한 개발 환경 설정 가이드입니다.', '로컬 실행 방법과 코드 규칙을 안내합니다.'].join('\n'),
  ['# 보안 스캔 일정', '', '보안 스캔 일정과 담당자를 정리합니다.', '취약점이라는 단어 없이 스캔 절차만 설명합니다.'].join('\n'),
];

const NOTES_DOCS: Record<string, string> = {
  'team-notes.md': ['# Team Notes', '', "what's new this week", 'release checklist and general updates'].join('\n'),
  'release-notes.md': ['# Release Notes', '', '이번 주 변경 사항을 요약합니다.', '운영 메모만 포함합니다.'].join('\n'),
};

const DECOMPOSITION_MAP: ReadonlyMap<string, string> = new Map([
  ['빌드스크립트', '빌드 스크립트'],
  ['서브에이전트', '서브 에이전트'],
  ['멀티에이전트', '멀티 에이전트'],
  ['시스템프롬프트', '시스템 프롬프트'],
  ['공급망공격', '공급망 공격'],
  ['보안취약점', '보안 취약점'],
  ['타입힌트', '타입 힌트'],
  ['디자인토큰', '디자인 토큰'],
  ['테스트커버리지', '테스트 커버리지'],
  ['통합테스트', '통합 테스트'],
  ['정적분석', '정적 분석'],
  ['분산추적', '분산 추적'],
  ['메트릭수집', '메트릭 수집'],
  ['이벤트소싱', '이벤트 소싱'],
  ['이벤트드리븐', '이벤트 드리븐'],
  ['Jenkins파이프라인', 'Jenkins 파이프라인'],
  ['Docker이미지', 'Docker 이미지'],
  ['pytest실행', 'pytest 실행'],
  ['ruff린팅', 'ruff 린팅'],
  ['Tailwind설정', 'Tailwind 설정'],
  ['Storybook문서화', 'Storybook 문서화'],
  ['Grafana대시보드', 'Grafana 대시보드'],
  ['PyO3바인딩', 'PyO3 바인딩'],
  ['seccomp필터', 'seccomp 필터'],
]);

const CORE_CASES: readonly BenchmarkCaseRuntime[] = [
  // --- spacing: 띄어쓰기 변형 ---
  createCase({
    caseId: 'spacing-security',
    syntheticLabel: 'spacing-security',
    category: 'spacing',
    expectedOutcome: 'hit',
    query: '보안 취약점',
    targetDocs: ['docs/security-sandbox.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'spacing-coverage',
    syntheticLabel: 'spacing-coverage',
    category: 'spacing',
    expectedOutcome: 'hit',
    query: '테스트 커버리지',
    targetDocs: ['docs/meeting-review.md'],
    collections: ['docs'],
  }),
  // --- compound: 복합어 sub-token ---
  createCase({
    caseId: 'compound-prompt',
    syntheticLabel: 'compound-prompt',
    category: 'compound',
    expectedOutcome: 'hit',
    query: '프롬프트',
    targetDocs: ['docs/agent-architecture.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'compound-tracing',
    syntheticLabel: 'compound-tracing',
    category: 'compound',
    expectedOutcome: 'hit',
    query: '추적',
    targetDocs: ['docs/observability-guide.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'compound-sourcing',
    syntheticLabel: 'compound-sourcing',
    category: 'compound',
    expectedOutcome: 'hit',
    query: '소싱',
    targetDocs: ['docs/rust-sdk.md'],
    collections: ['docs'],
  }),
  // --- mixed: 한영 혼합 ---
  createCase({
    caseId: 'mixed-pipeline',
    syntheticLabel: 'mixed-pipeline',
    category: 'mixed',
    expectedOutcome: 'hit',
    query: '파이프라인',
    targetDocs: ['docs/devops-deploy.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'mixed-dashboard',
    syntheticLabel: 'mixed-dashboard',
    category: 'mixed',
    expectedOutcome: 'hit',
    query: '대시보드',
    targetDocs: ['docs/observability-guide.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'mixed-binding',
    syntheticLabel: 'mixed-binding',
    category: 'mixed',
    expectedOutcome: 'hit',
    query: '바인딩',
    targetDocs: ['docs/rust-sdk.md'],
    collections: ['docs'],
  }),
];

const CONTROL_CASES: readonly BenchmarkCaseRuntime[] = [
  createCase({
    caseId: 'control-quoted',
    syntheticLabel: 'control-quoted',
    category: 'control',
    expectedOutcome: 'hit',
    query: '"보안 취약점"',
    targetDocs: ['docs/security-scan-faq.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'control-negated',
    syntheticLabel: 'control-negated',
    category: 'control',
    expectedOutcome: 'hit',
    query: '보안 취약점 -파이프라인',
    targetDocs: ['docs/security-scan-faq.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'control-ineligible',
    syntheticLabel: 'control-ineligible',
    category: 'control',
    expectedOutcome: 'hit',
    query: "what's new",
    targetDocs: ['notes/team-notes.md'],
    collections: ['notes'],
  }),
  createCase({
    caseId: 'control-collection-isolation',
    syntheticLabel: 'control-collection-isolation',
    category: 'control',
    expectedOutcome: 'miss',
    query: '추적',
    targetDocs: ['docs/observability-guide.md'],
    collections: ['notes'],
  }),
  createCase({
    caseId: 'control-no-target',
    syntheticLabel: 'control-no-target',
    category: 'control',
    expectedOutcome: 'miss',
    query: '양자 방화벽',
    targetDocs: [],
    collections: ['docs'],
  }),
  createInjectedControlCase({
    caseId: 'control-weak-hit',
    syntheticLabel: 'control-weak-hit',
    category: 'control',
    expectedOutcome: 'miss',
    query: '분산 추론',
    targetDocs: [],
    collections: ['docs'],
    hybridRows: [],
    resolveSearchAssistRows: async () => [
      {
        displayPath: 'docs/noise-weak-hit.md',
        title: '추론 메모',
        body: '운영 점검 노트입니다.',
        context: 'docs',
        score: 0.58,
        docid: 'weak-hit-row',
      },
    ],
  }),
];

const LONG_QUERY_CASES: readonly BenchmarkCaseRuntime[] = [
  createCase({
    caseId: 'long-query-security-scan',
    syntheticLabel: 'long-query-security-scan',
    category: 'long-query',
    expectedOutcome: 'hit',
    query: '보안 취약점 스캔은 어떻게 동작해?',
    targetDocs: ['docs/security-scan-faq.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'long-query-dashboard-setup',
    syntheticLabel: 'long-query-dashboard-setup',
    category: 'long-query',
    expectedOutcome: 'hit',
    query: 'Grafana 대시보드 설정 방법을 정리한 문서',
    targetDocs: ['docs/observability-setup.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'long-query-test-env',
    syntheticLabel: 'long-query-test-env',
    category: 'long-query',
    expectedOutcome: 'hit',
    query: 'pytest 실행 환경은 어떻게 설정해줘?',
    targetDocs: ['docs/python-test-setup.md'],
    collections: ['docs'],
  }),
  createInjectedQuestionCase({
    caseId: 'diagnostic-long-query-adaptive-showcase',
    syntheticLabel: 'diagnostic-long-query-adaptive-showcase',
    category: 'long-query',
    expectedOutcome: 'hit',
    query: '보안 취약점 질문',
    targetDocs: ['docs/security-sandbox.md'],
    collections: ['docs'],
    hybridRows: [
      createHybridRow({
        displayPath: 'docs/noise-001.md',
        title: '보안 감사 결과',
        body: '보안 정책을 검토하고 감사 로그를 확인했습니다.',
        bestChunk: '보안 정책을 검토하고 감사 로그를 확인했습니다.',
        score: 0.78,
        docid: 'noise-001',
      }),
      createHybridRow({
        displayPath: 'docs/security-sandbox.md',
        title: '샌드박싱 보안 아키텍처',
        body: '보안취약점 스캔 결과를 감사 로그에 기록합니다.',
        bestChunk: '보안취약점 스캔 결과를 감사 로그에 기록합니다.',
        score: 0.74,
        docid: 'security-sandbox',
      }),
    ],
  }),
];

function createCase(caseDefinition: QueryRecallCase): BenchmarkCaseRuntime {
  return {
    caseDefinition,
    input: createInput(caseDefinition.query, caseDefinition.collections),
    runtimeMode: 'native',
  };
}

function createInjectedControlCase(args: {
  readonly caseId: string;
  readonly syntheticLabel: string;
  readonly category: 'control';
  readonly expectedOutcome: 'miss';
  readonly query: string;
  readonly targetDocs: readonly string[];
  readonly collections: readonly string[];
  readonly hybridRows: readonly HybridQueryResult[];
  readonly resolveSearchAssistRows: NonNullable<QueryBenchmarkDependencies['resolveSearchAssistRows']>;
}): BenchmarkCaseRuntime {
  return {
    caseDefinition: {
      caseId: args.caseId,
      syntheticLabel: args.syntheticLabel,
      category: args.category,
      expectedOutcome: args.expectedOutcome,
      query: args.query,
      targetDocs: args.targetDocs,
      collections: [...args.collections],
    },
    input: createInput(args.query, args.collections, 20),
    runtimeMode: 'injected-control',
    dependencies: {
      hybridQuery: async () => [...args.hybridRows],
      resolveSearchAssistRows: args.resolveSearchAssistRows,
    },
  };
}

function createInjectedQuestionCase(args: {
  readonly caseId: string;
  readonly syntheticLabel: string;
  readonly category: 'long-query';
  readonly expectedOutcome: 'hit';
  readonly query: string;
  readonly targetDocs: readonly string[];
  readonly collections: readonly string[];
  readonly hybridRows: readonly HybridQueryResult[];
}): BenchmarkCaseRuntime {
  return {
    caseDefinition: {
      caseId: args.caseId,
      syntheticLabel: args.syntheticLabel,
      category: args.category,
      expectedOutcome: args.expectedOutcome,
      query: args.query,
      targetDocs: args.targetDocs,
      collections: [...args.collections],
    },
    input: createInput(args.query, args.collections, 20),
    runtimeMode: 'injected-control',
    dependencies: {
      hybridQuery: async () => [...args.hybridRows],
      resolveSearchAssistRows: async () => [],
    },
  };
}

function createInput(
  query: string,
  collections?: readonly string[],
  candidateLimit?: number,
): QueryCommandInput {
  return {
    query,
    displayQuery: query,
    format: 'json',
    limit: 5,
    minScore: 0,
    all: false,
    full: false,
    lineNumbers: false,
    collections: collections ? [...collections] : undefined,
    explain: false,
    queryMode: 'plain',
    candidateLimit,
  };
}

function resolveAggregateScope(runtime: BenchmarkCaseRuntime): QueryRecallAggregateScope {
  if (runtime.caseDefinition.category === 'control') {
    return 'excluded';
  }

  if (runtime.runtimeMode === 'injected-control') {
    return 'excluded';
  }

  return runtime.caseDefinition.category === 'long-query' ? 'core' : 'core';
}

function assertSafeFixtureCorpus(): void {
  for (const runtime of [...CORE_CASES, ...CONTROL_CASES, ...LONG_QUERY_CASES]) {
    assertSafeSyntheticLabel(runtime.caseDefinition.syntheticLabel);
    for (const targetDoc of runtime.caseDefinition.targetDocs) {
      assertSafeSyntheticPath(targetDoc);
    }
    for (const acceptableTarget of runtime.caseDefinition.acceptableTargets ?? []) {
      assertSafeSyntheticPath(acceptableTarget);
    }
  }

  const entries = [
    ...Object.entries(TARGET_DOCS).map(([filename, text]) => ({
      label: `target-doc:${filename}`,
      text,
    })),
    ...Object.keys(TARGET_DOCS).map((filename) => ({
      label: `target-doc-path:${filename}`,
      text: `docs/${filename}`,
    })),
    ...DOC_NOISE.map((text, index) => ({
      label: `doc-noise:${index}`,
      text,
    })),
    ...DOC_NOISE.map((_, index) => ({
      label: `doc-noise-path:${index}`,
      text: `docs/noise-${index.toString().padStart(3, '0')}.md`,
    })),
    ...Object.entries(NOTES_DOCS).map(([filename, text]) => ({
      label: `notes-doc:${filename}`,
      text,
    })),
    ...Object.keys(NOTES_DOCS).map((filename) => ({
      label: `notes-doc-path:${filename}`,
      text: `notes/${filename}`,
    })),
    ...[...CORE_CASES, ...CONTROL_CASES, ...LONG_QUERY_CASES].map((runtime) => ({
      label: `case:${runtime.caseDefinition.syntheticLabel}`,
      text: runtime.caseDefinition.query,
    })),
    ...CONTROL_CASES.flatMap((runtime) =>
      runtime.dependencies?.resolveSearchAssistRows
        ? [
            {
              label: `injected-resolve-path:${runtime.caseDefinition.syntheticLabel}`,
              text: 'docs/noise-weak-hit.md',
            },
          ]
        : [],
    ),
    ...LONG_QUERY_CASES.flatMap((runtime) =>
      runtime.dependencies?.hybridQuery
        ? [
            {
              label: `injected-hybrid-path:${runtime.caseDefinition.syntheticLabel}`,
              text: 'docs/noise-001.md',
            },
            {
              label: `injected-hybrid-path-target:${runtime.caseDefinition.syntheticLabel}`,
              text: 'docs/security-sandbox.md',
            },
          ]
        : [],
    ),
  ];

  assertSafeSyntheticTexts(entries);
}

function createHybridRow(args: {
  readonly displayPath: string;
  readonly title: string;
  readonly body: string;
  readonly bestChunk: string;
  readonly score: number;
  readonly docid: string;
}): HybridQueryResult {
  return {
    file: args.displayPath,
    displayPath: args.displayPath,
    title: args.title,
    body: args.body,
    bestChunk: args.bestChunk,
    bestChunkPos: 0,
    context: 'docs',
    score: args.score,
    docid: args.docid,
  };
}

function extractDeterministicTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_./:-]+|[가-힣]+/g) ?? []).filter(
    (token) => token.length > 0,
  );
}

function hashToken(token: string): number {
  let hash = 2166136261;

  for (const char of token) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createDeterministicVector(text: string): number[] {
  const dimensions = 8;
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = extractDeterministicTokens(text);

  if (tokens.length === 0) {
    return [1, 0, 0, 0, 0, 0, 0, 0];
  }

  for (const token of tokens) {
    const hash = hashToken(token);
    vector[hash % dimensions] += 1;
    vector[(hash >>> 8) % dimensions] += 0.5;
  }

  const magnitude = Math.hypot(...vector);
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

function scoreDocumentMatch(query: string, documentText: string): number {
  const queryTokens = [...new Set(extractDeterministicTokens(query))];
  const normalizedDocument = documentText.toLowerCase();
  const documentTokens = new Set(extractDeterministicTokens(documentText));
  const matchedTokens = queryTokens.filter((token) => documentTokens.has(token)).length;
  const coverage = queryTokens.length === 0 ? 0 : matchedTokens / queryTokens.length;
  const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLowerCase();
  const exactPhraseBonus =
    normalizedQuery.length > 0 && normalizedDocument.includes(normalizedQuery) ? 0.15 : 0;
  const allTokensPresentBonus =
    queryTokens.length > 1 && queryTokens.every((token) => normalizedDocument.includes(token))
      ? 0.1
      : 0;

  return Number(
    Math.max(0.2, Math.min(0.99, 0.3 + coverage * 0.45 + exactPhraseBonus + allTokensPresentBonus))
      .toFixed(2),
  );
}

function installDeterministicLlmStub(store: Awaited<ReturnType<typeof createStore>>): void {
  store.internal.llm = {
    expandQuery: async () => [],
    embedBatch: async (texts: readonly string[]) =>
      texts.map((text) => ({
        embedding: createDeterministicVector(text),
      })),
    rerank: async (query: string, documents: readonly { file: string; text: string }[]) => ({
      results: documents.map((document) => ({
        file: document.file,
        score: scoreDocumentMatch(query, `${document.file}\n${document.text}`),
      })),
    }),
  } as never;
}

function createFixtureWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'kqmd-query-recall-'));
  const docsDir = join(root, 'docs');
  const notesDir = join(root, 'notes');
  mkdirSync(docsDir, { recursive: true });
  mkdirSync(notesDir, { recursive: true });
  return {
    root,
    docsDir,
    notesDir,
    dbPath: join(root, 'index.sqlite'),
  };
}

function writeFixtureDocs(docsDir: string, notesDir: string): void {
  for (const [filename, content] of Object.entries(TARGET_DOCS)) {
    writeFileSync(join(docsDir, filename), content, 'utf8');
  }

  DOC_NOISE.forEach((content, index) => {
    writeFileSync(join(docsDir, `noise-${index.toString().padStart(3, '0')}.md`), content, 'utf8');
  });

  writeFileSync(
    join(docsDir, 'noise-weak-hit.md'),
    ['# 약한 제어 메모', '', '운영 관련 짧은 메모입니다.', '분산과 추론이라는 단어는 포함하지 않습니다.'].join(
      '\n',
    ),
    'utf8',
  );

  for (const [filename, content] of Object.entries(NOTES_DOCS)) {
    writeFileSync(join(notesDir, filename), content, 'utf8');
  }
}

function createBenchmarkEnv(root: string, dbPath: string): NodeJS.ProcessEnv {
  const homeDir = join(root, 'home');
  const cacheDir = join(root, 'xdg-cache');
  const configHome = join(root, 'xdg-config');
  const qmdConfigDir = join(root, 'qmd-config');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(configHome, { recursive: true });
  mkdirSync(qmdConfigDir, { recursive: true });

  return {
    ...process.env,
    HOME: homeDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_CONFIG_HOME: configHome,
    QMD_CONFIG_DIR: qmdConfigDir,
    INDEX_PATH: dbPath,
  };
}

async function deterministicTokenize(text: string): Promise<string> {
  let projection = text;
  for (const [whole, decomposed] of DECOMPOSITION_MAP) {
    if (text.includes(whole)) {
      projection = `${projection} ${decomposed}`;
    }
  }
  return projection;
}

async function resolveCollectionSnapshots(store: QMDStore): Promise<CollectionSnapshots> {
  const [availableCollectionNames, defaultCollectionNames] = await Promise.all([
    store.listCollections().then((collections) => collections.map((collection) => collection.name)),
    store.getDefaultCollectionNames(),
  ]);

  return {
    availableCollectionNames,
    defaultCollectionNames,
  };
}

function resolveSelectedCollections(
  input: QueryCommandInput,
  snapshots: CollectionSnapshots,
): readonly string[] {
  if (input.collections && input.collections.length > 0) {
    return [...input.collections];
  }

  return [...snapshots.defaultCollectionNames];
}

function resolveEffectiveBaseInput(input: QueryCommandInput) {
  const traits = classifyQuery(input);
  return {
    traits,
    effectiveBaseInput: {
      ...input,
      disableRerank: shouldDisableRerankForQuery(traits),
      fetchLimit: resolveFetchLimitForQuery(input.limit, traits, input.candidateLimit),
    } satisfies QueryCommandInput,
  };
}

async function resolveBenchmarkContext(
  store: QMDStore,
  runtime: BenchmarkCaseRuntime,
  env: NodeJS.ProcessEnv,
  snapshots: CollectionSnapshots,
): Promise<BenchmarkContext> {
  const selectedCollections = resolveSelectedCollections(runtime.input, snapshots);
  const { traits, effectiveBaseInput } = resolveEffectiveBaseInput(runtime.input);

  return {
    input: runtime.input,
    traits,
    selectedCollections,
    availableCollectionNames: snapshots.availableCollectionNames,
    defaultCollectionNames: snapshots.defaultCollectionNames,
    effectiveBaseInput,
    env,
    runtimeMode: runtime.runtimeMode,
  };
}

async function runBaseQueryCase(
  store: QMDStore,
  context: BenchmarkContext,
  dependencies: QueryBenchmarkDependencies = {},
): Promise<SearchOutputRow[]> {
  const rows = await executeOwnedQuerySearch(
    store,
    context.effectiveBaseInput,
    [...context.selectedCollections],
    dependencies,
  );

  return normalizeHybridQueryResults(rows);
}

function runAdaptiveOnlyCase(baseRows: readonly SearchOutputRow[], context: BenchmarkContext) {
  return rankQueryRows(baseRows, context.traits);
}

async function runCurrentQueryCase(
  store: QMDStore,
  context: BenchmarkContext,
  dependencies: QueryBenchmarkDependencies = {},
) {
  const result = await executeQueryCore(
    store,
    context.effectiveBaseInput,
    context.env,
    dependencies,
    {
      availableCollectionNames: context.availableCollectionNames,
      defaultCollectionNames: context.defaultCollectionNames,
    },
  );

  if ('kind' in result) {
    throw new Error(`Benchmark query failed for "${context.input.query}": ${result.stderr}`);
  }

  if (result.advisories.length > 0) {
    throw new Error(`Benchmark query emitted advisory for "${context.input.query}".`);
  }

  return result;
}

async function evaluateCase(
  store: QMDStore,
  snapshots: CollectionSnapshots,
  env: NodeJS.ProcessEnv,
  runtime: BenchmarkCaseRuntime,
) {
  const context = await resolveBenchmarkContext(store, runtime, env, snapshots);
  const baseRows = await runBaseQueryCase(store, context, runtime.dependencies);
  const adaptiveRows = runAdaptiveOnlyCase(baseRows, context);
  const currentResult = await runCurrentQueryCase(store, context, runtime.dependencies);
  const acceptableTargets =
    runtime.caseDefinition.acceptableTargets ?? runtime.caseDefinition.targetDocs;
  const baseSummary = summarizeLayer(baseRows, runtime.caseDefinition.targetDocs, acceptableTargets);
  const adaptiveSummary = summarizeLayer(
    adaptiveRows,
    runtime.caseDefinition.targetDocs,
    acceptableTargets,
  );
  const currentSummary = summarizeLayer(
    currentResult.rows,
    runtime.caseDefinition.targetDocs,
    acceptableTargets,
  );

  return {
    caseId: runtime.caseDefinition.caseId,
    syntheticLabel: runtime.caseDefinition.syntheticLabel,
    category: runtime.caseDefinition.category,
    aggregateScope: resolveAggregateScope(runtime),
    expectedOutcome: runtime.caseDefinition.expectedOutcome,
    targetDocs: [...runtime.caseDefinition.targetDocs],
    acceptableTargets: [...acceptableTargets],
    selectedCollections: [...context.selectedCollections],
    queryClass: context.traits.queryClass,
    fetchLimit: context.effectiveBaseInput.fetchLimit ?? context.effectiveBaseInput.limit,
    runtimeMode: context.runtimeMode,
    normalizationApplied: currentResult.query.normalization.applied,
    normalizationReason: currentResult.query.normalization.reason,
    normalizationAddedCandidates: currentResult.query.normalization.addedCandidates,
    assistApplied: currentResult.searchAssist?.applied ?? false,
    assistReason: currentResult.searchAssist?.reason ?? 'ineligible',
    addedCandidates: currentResult.searchAssist?.addedCandidates ?? 0,
    base: baseSummary,
    adaptive: adaptiveSummary,
    current: currentSummary,
    winningLayer: determineWinningLayer({
      base: baseSummary,
      adaptive: adaptiveSummary,
      current: currentSummary,
      assistApplied: currentResult.searchAssist?.applied ?? false,
    }),
  };
}

async function main() {
  assertSafeFixtureCorpus();
  const { root, docsDir, notesDir, dbPath } = createFixtureWorkspace();
  writeFixtureDocs(docsDir, notesDir);
  const env = createBenchmarkEnv(root, dbPath);

  const store = await createStore({
    dbPath,
    config: {
      collections: {
        docs: {
          path: docsDir,
          pattern: '**/*.md',
        },
        notes: {
          path: notesDir,
          pattern: '**/*.md',
        },
      },
    },
  });

  try {
    installDeterministicLlmStub(store);
    await store.update();
    await rebuildSearchShadowIndex(store.internal.db, describeEffectiveSearchPolicy(), {
      tokenize: deterministicTokenize,
    });

    const snapshots = await resolveCollectionSnapshots(store);
    const runtimeCases = [...CORE_CASES, ...CONTROL_CASES, ...LONG_QUERY_CASES];
    const rows = [];

    for (const runtime of runtimeCases) {
      rows.push(await evaluateCase(store, snapshots, env, runtime));
    }

    const report = createReport(rows);

    const hints: DisplayHints = {
      queries: new Map(
        runtimeCases.map((r) => [r.caseDefinition.caseId, r.caseDefinition.query]),
      ),
      docContents: new Map(
        Object.entries(TARGET_DOCS).map(([k, v]) => [`docs/${k}`, v]),
      ),
    };
    const markdown = toMarkdown(report, hints);
    const expectedJsonKeys = [
      'aggregate',
      'aggregate[].hits',
      'aggregate[].recall',
      'aggregate[].scope',
      'aggregate[].side',
      'aggregate[].total',
      'datasetId',
      'derivedSignals',
      'derivedSignals.adaptiveOnlyGainCount',
      'derivedSignals.assistRescueGainCount',
      'derivedSignals.coreRecallUpliftPct',
      'derivedSignals.diagnosticLongQueryCount',
      'derivedSignals.longQueryRecallUpliftPct',
      'derivedSignals.nativeLongQueryCount',
      'derivedSignals.negativeControlEmptyTop5Rate',
      'derivedSignals.negativeControlPassRate',
      'derivedSignals.normalizationAppliedCount',
      'derivedSignals.unresolvedCoreMissCount',
      'fixtureVersion',
      'rows',
      'rows[].acceptableTargets',
      'rows[].addedCandidates',
      'rows[].adaptive',
      'rows[].adaptive.firstHitRank',
      'rows[].adaptive.hitStatus',
      'rows[].adaptive.targetInTop5',
      'rows[].adaptive.targetPresentAnyRank',
      'rows[].adaptive.top5Paths',
      'rows[].adaptive.unexpectedTop5Count',
      'rows[].aggregateScope',
      'rows[].assistApplied',
      'rows[].assistReason',
      'rows[].base',
      'rows[].base.firstHitRank',
      'rows[].base.hitStatus',
      'rows[].base.targetInTop5',
      'rows[].base.targetPresentAnyRank',
      'rows[].base.top5Paths',
      'rows[].base.unexpectedTop5Count',
      'rows[].caseId',
      'rows[].category',
      'rows[].current',
      'rows[].current.firstHitRank',
      'rows[].current.hitStatus',
      'rows[].current.targetInTop5',
      'rows[].current.targetPresentAnyRank',
      'rows[].current.top5Paths',
      'rows[].current.unexpectedTop5Count',
      'rows[].expectedOutcome',
      'rows[].fetchLimit',
      'rows[].normalizationAddedCandidates',
      'rows[].normalizationApplied',
      'rows[].normalizationReason',
      'rows[].queryClass',
      'rows[].runtimeMode',
      'rows[].selectedCollections',
      'rows[].syntheticLabel',
      'rows[].targetDocs',
      'rows[].winningLayer',
      'schemaVersion',
    ].sort();

    const actualJsonKeys = collectJsonKeyPaths(report).sort();
    if (JSON.stringify(actualJsonKeys) !== JSON.stringify(expectedJsonKeys)) {
      throw new Error(
        `Unexpected query recall JSON keys.\nExpected: ${expectedJsonKeys.join(', ')}\nActual: ${actualJsonKeys.join(', ')}`,
      );
    }

    console.log(markdown);
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
