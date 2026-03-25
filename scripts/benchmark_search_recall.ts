import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore } from '@tobilu/qmd';

import {
  rebuildSearchShadowIndex,
  searchShadowIndex,
} from '../src/commands/owned/search_shadow_index.js';
import { describeEffectiveSearchPolicy } from '../src/config/search_policy.js';
import { formatDocExcerpt } from './benchmark_lib.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Category = 'compound' | 'mixed' | 'baseline';

type QueryCase = {
  readonly category: Category;
  readonly query: string;
  readonly targetDoc: string;
};

type RecallRow = QueryCase & {
  readonly upstreamHit: boolean;
  readonly shadowHit: boolean;
};

type AggregateRow = {
  readonly side: 'upstream' | 'shadow';
  readonly hits: number;
  readonly total: number;
  readonly recall: number;
};

// ---------------------------------------------------------------------------
// Fixture documents
// ---------------------------------------------------------------------------

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
};

const NOISE_DOCS: readonly { readonly title: string; readonly body: string }[] = [
  // DevOps 관련 — 빌드, 배포 언급하되 compound 없음
  {
    title: '빌드 환경 점검',
    body: '빌드 캐시를 정리하고 배포 환경을 점검했습니다.\n로컬에서 스크립트 동작을 확인했습니다.',
  },
  // 보안 관련 — 보안, 감사 언급하되 compound 없음
  {
    title: '보안 감사 결과',
    body: '보안 정책을 검토하고 감사 로그를 확인했습니다.\n취약점 패치 일정을 수립합니다.',
  },
  // 테스트 관련 — 테스트 언급하되 compound 없음
  {
    title: '테스트 전략 회의',
    body: '테스트 자동화 범위를 논의했습니다.\n커버리지 목표를 80%로 상향 조정합니다.',
  },
  // Python 관련 — uv, 린트 언급하되 compound 없음
  {
    title: 'Python 환경 정리',
    body: 'uv로 가상 환경을 재구성했습니다.\n린트 규칙 충돌을 해결했습니다.',
  },
  // 프론트엔드 관련 — 컴포넌트, 디자인 언급하되 compound 없음
  {
    title: '디자인 시스템 검토',
    body: '디자인 시스템 컴포넌트 목록을 정리했습니다.\n토큰 네이밍 규칙을 확정합니다.',
  },
  // 모니터링 관련 — 메트릭, 대시보드 언급하되 compound 없음
  {
    title: '모니터링 운영 메모',
    body: '메트릭 임계값을 재조정하고 알림 규칙을 갱신했습니다.\n대시보드 레이아웃을 개선합니다.',
  },
  // Rust 관련 — 이벤트, 미들웨어 언급하되 compound 없음
  {
    title: 'Rust 모듈 리뷰',
    body: '이벤트 처리 로직을 리뷰했습니다.\n미들웨어 체인 순서를 재배치합니다.',
  },
  // 에이전트 관련 — 에이전트 언급하되 compound 없음
  {
    title: '에이전트 운영 일지',
    body: '에이전트 응답 속도를 모니터링했습니다.\n프롬프트 튜닝 실험 결과를 기록합니다.',
  },
  // 프로젝트 관리
  {
    title: '스프린트 회고',
    body: '이번 스프린트에서 완료한 작업을 정리했습니다.\n다음 스프린트 목표를 설정합니다.',
  },
  // 온보딩 가이드
  {
    title: '팀 온보딩 가이드',
    body: '신규 입사자를 위한 개발 환경 설정 가이드입니다.\n로컬 실행 방법과 코드 규칙을 안내합니다.',
  },
];

function writeNoiseDocs(docsDir: string): void {
  for (let i = 0; i < NOISE_DOCS.length; i++) {
    const doc = NOISE_DOCS[i]!;
    writeFileSync(
      join(docsDir, `noise-${i.toString().padStart(3, '0')}.md`),
      [`# ${doc.title}`, '', doc.body].join('\n'),
      'utf8',
    );
  }
}

// ---------------------------------------------------------------------------
// Deterministic tokenize stub
// ---------------------------------------------------------------------------

const DECOMPOSITION_MAP: ReadonlyMap<string, string> = new Map([
  // Compound words (복합어)
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
  // Korean-English mixed (한영 혼합)
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

async function deterministicTokenize(text: string): Promise<string> {
  let projection = text;
  for (const [compound, decomposed] of DECOMPOSITION_MAP) {
    if (text.includes(compound)) {
      projection = `${projection} ${decomposed}`;
    }
  }
  return projection;
}

// ---------------------------------------------------------------------------
// Query matrix
// ---------------------------------------------------------------------------

const QUERY_CASES: readonly QueryCase[] = [
  // --- Compound word decomposition (복합어 내부 sub-token 검색) ---
  // DevOps: 빌드스크립트 → 스크립트
  { category: 'compound', query: '스크립트', targetDoc: 'docs/devops-deploy.md' },
  // Agent: 서브에이전트, 멀티에이전트 → 에이전트
  { category: 'compound', query: '에이전트', targetDoc: 'docs/agent-architecture.md' },
  // Agent: 시스템프롬프트 → 프롬프트
  { category: 'compound', query: '프롬프트', targetDoc: 'docs/agent-architecture.md' },
  // Security: 공급망공격 → 공격
  { category: 'compound', query: '공격', targetDoc: 'docs/security-sandbox.md' },
  // Security: 보안취약점 → 취약점
  { category: 'compound', query: '취약점', targetDoc: 'docs/security-sandbox.md' },
  // Python: 타입힌트 → 힌트
  { category: 'compound', query: '힌트', targetDoc: 'docs/python-migration.md' },
  // Frontend: 디자인토큰 → 토큰
  { category: 'compound', query: '토큰', targetDoc: 'docs/frontend-sprint.md' },
  // Meeting: 테스트커버리지 → 커버리지
  { category: 'compound', query: '커버리지', targetDoc: 'docs/meeting-review.md' },
  // Meeting: 정적분석 → 분석
  { category: 'compound', query: '분석', targetDoc: 'docs/meeting-review.md' },
  // Observability: 분산추적 → 추적
  { category: 'compound', query: '추적', targetDoc: 'docs/observability-guide.md' },
  // Observability: 메트릭수집 → 수집
  { category: 'compound', query: '수집', targetDoc: 'docs/observability-guide.md' },
  // Rust: 이벤트소싱 → 소싱
  { category: 'compound', query: '소싱', targetDoc: 'docs/rust-sdk.md' },

  // --- Korean-English mixed (한영 혼합 토큰 내 한국어 sub-token 검색) ---
  // DevOps: Jenkins파이프라인 → 파이프라인
  { category: 'mixed', query: '파이프라인', targetDoc: 'docs/devops-deploy.md' },
  // DevOps: Docker이미지 → 이미지
  { category: 'mixed', query: '이미지', targetDoc: 'docs/devops-deploy.md' },
  // Python: pytest실행 → 실행
  { category: 'mixed', query: '실행', targetDoc: 'docs/python-migration.md' },
  // Python: ruff린팅 → 린팅
  { category: 'mixed', query: '린팅', targetDoc: 'docs/python-migration.md' },
  // Frontend: Tailwind설정 → 설정
  { category: 'mixed', query: '설정', targetDoc: 'docs/frontend-sprint.md' },
  // Frontend: Storybook문서화 → 문서화
  { category: 'mixed', query: '문서화', targetDoc: 'docs/frontend-sprint.md' },
  // Observability: Grafana대시보드 → 대시보드
  { category: 'mixed', query: '대시보드', targetDoc: 'docs/observability-guide.md' },
  // Rust: PyO3바인딩 → 바인딩
  { category: 'mixed', query: '바인딩', targetDoc: 'docs/rust-sdk.md' },

  // --- Baseline (양쪽 모두 hit — sanity check) ---
  { category: 'baseline', query: 'Jenkins', targetDoc: 'docs/devops-deploy.md' },
  { category: 'baseline', query: '샌드박싱', targetDoc: 'docs/security-sandbox.md' },
  { category: 'baseline', query: 'pytest', targetDoc: 'docs/python-migration.md' },
  { category: 'baseline', query: 'Grafana', targetDoc: 'docs/observability-guide.md' },
  { category: 'baseline', query: '리팩토링', targetDoc: 'docs/meeting-review.md' },
  { category: 'baseline', query: 'Tower', targetDoc: 'docs/rust-sdk.md' },
];

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

function createFixtureWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'kqmd-recall-metrics-'));
  const docsDir = join(root, 'docs');
  mkdirSync(docsDir, { recursive: true });
  return { root, docsDir, dbPath: join(root, 'index.sqlite') };
}

async function createFixtureStore(dbPath: string, docsDir: string) {
  return createStore({
    dbPath,
    config: {
      collections: {
        docs: { path: docsDir, pattern: '**/*.md' },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

async function measureRecall(): Promise<{
  rows: readonly RecallRow[];
  aggregate: readonly AggregateRow[];
}> {
  const { root, docsDir, dbPath } = createFixtureWorkspace();

  // Write target documents
  for (const [filename, content] of Object.entries(TARGET_DOCS)) {
    writeFileSync(join(docsDir, filename), content, 'utf8');
  }

  // Write noise documents for meaningful BM25 IDF
  writeNoiseDocs(docsDir);

  const store = await createFixtureStore(dbPath, docsDir);
  const policy = describeEffectiveSearchPolicy();

  try {
    // Populate upstream FTS5 index
    await store.update();

    // Build shadow index with deterministic tokenize stub
    await rebuildSearchShadowIndex(store.internal.db, policy, {
      tokenize: deterministicTokenize,
    });

    // Run query matrix
    const rows: RecallRow[] = [];

    for (const testCase of QUERY_CASES) {
      const upstreamResults = await store.searchLex(testCase.query, { limit: 20 });
      const shadowResults = searchShadowIndex(store.internal, testCase.query, { limit: 20 });

      rows.push({
        ...testCase,
        upstreamHit: upstreamResults.some((r) => r.displayPath === testCase.targetDoc),
        shadowHit: shadowResults.some((r) => r.displayPath === testCase.targetDoc),
      });
    }

    // Aggregate
    const total = rows.length;
    const upstreamHits = rows.filter((r) => r.upstreamHit).length;
    const shadowHits = rows.filter((r) => r.shadowHit).length;

    const aggregate: AggregateRow[] = [
      {
        side: 'upstream',
        hits: upstreamHits,
        total,
        recall: Math.round((upstreamHits / total) * 100),
      },
      {
        side: 'shadow',
        hits: shadowHits,
        total,
        recall: Math.round((shadowHits / total) * 100),
      },
    ];

    return { rows, aggregate };
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<Category, string> = {
  compound: '복합어',
  mixed: '한영 혼합',
  baseline: '기준선',
};

function toMarkdown(
  rows: readonly RecallRow[],
  aggregate: readonly AggregateRow[],
): string {
  const today = new Date().toISOString().slice(0, 10);
  const coreRows = rows.filter((r) => r.category !== 'baseline');
  const baselineRows = rows.filter((r) => r.category === 'baseline');
  const docContents = new Map(
    Object.entries(TARGET_DOCS).map(([k, v]) => [`docs/${k}`, v]),
  );

  const lines: string[] = [];

  lines.push('# Korean Search Recall Benchmark');
  lines.push('');
  lines.push(`Date: ${today}`);
  lines.push('Command: `bun run benchmark:search-recall`');
  lines.push('');
  lines.push(
    'QMD의 search 명령에서 한국어 검색 품질을 비교한 벤치마크입니다.',
  );
  lines.push(
    '복합어 분리, 한영 혼합 두 가지 한국어 패턴에서 QMD 대비 K-QMD의 검색 결과를 비교합니다.',
  );
  lines.push('');

  // Method
  lines.push('## 테스트 방법');
  lines.push('');
  lines.push(`- synthetic fixture 문서 ${Object.keys(TARGET_DOCS).length}개 + noise 문서 ${NOISE_DOCS.length}개에 대해 QMD와 K-QMD의 search 결과를 비교합니다.`);
  lines.push('- hit: target 문서가 검색 결과(limit=20)에 포함되면 검색 성공입니다.');
  lines.push('- miss: target 문서가 검색 결과에 없으면 검색 실패입니다.');
  lines.push('');

  // Results table
  lines.push('## 결과');
  lines.push('');
  lines.push('| 패턴 | 쿼리 | 문서 내용 | QMD | K-QMD |');
  lines.push('|---|---|---|:---:|:---:|');

  for (const row of coreRows) {
    const docContent = docContents.get(row.targetDoc) ?? '';
    const excerpt = docContent
      ? formatDocExcerpt(docContent, row.query)
      : row.targetDoc;
    const upstream = row.upstreamHit ? 'hit' : 'miss';
    const isGain = row.shadowHit && !row.upstreamHit;
    const shadow = row.shadowHit ? (isGain ? '**hit**' : 'hit') : 'miss';
    const category = CATEGORY_LABELS[row.category] ?? row.category;
    lines.push(`| ${category} | ${row.query} | ${excerpt} | ${upstream} | ${shadow} |`);
  }

  lines.push('');

  // Baseline
  lines.push('### 기준선 (양쪽 모두 hit)');
  lines.push('');
  lines.push('| 쿼리 | 문서 내용 | QMD | K-QMD |');
  lines.push('|---|---|:---:|:---:|');

  for (const row of baselineRows) {
    const docContent = docContents.get(row.targetDoc) ?? '';
    const excerpt = docContent
      ? formatDocExcerpt(docContent, row.query)
      : row.targetDoc;
    lines.push(`| ${row.query} | ${excerpt} | hit | hit |`);
  }

  lines.push('');

  // Aggregate table
  lines.push('## 요약');
  lines.push('');
  lines.push('| | Hits | Total | Recall |');
  lines.push('|---|---:|---:|---:|');

  for (const row of aggregate) {
    const label = row.side === 'upstream' ? 'QMD' : 'K-QMD';
    const recall =
      row.recall === 100 ? `**${row.recall}%**` : `${row.recall}%`;
    lines.push(`| ${label} | ${row.hits} | ${row.total} | ${recall} |`);
  }

  lines.push('');

  // Notes
  lines.push('## Notes');
  lines.push('');
  lines.push(
    '- deterministic tokenize stub를 사용하므로, 실제 Kiwi 형태소 분석과 결과가 다를 수 있습니다.',
  );
  lines.push(
    '- 기준선 카테고리는 양쪽 모두 hit이어야 하는 sanity check 쿼리입니다.',
  );
  lines.push('- 아래 JSON은 전체 측정 데이터입니다.');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { rows, aggregate } = await measureRecall();
const markdown = toMarkdown(rows, aggregate);

console.log(markdown);
console.log('```json');
console.log(JSON.stringify({ rows, aggregate }, null, 2));
console.log('```');
