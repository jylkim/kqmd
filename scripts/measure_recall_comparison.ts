import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore } from '@tobilu/qmd';

import {
  rebuildSearchShadowIndex,
  searchShadowIndex,
} from '../src/commands/owned/search_shadow_index.js';
import { describeEffectiveSearchPolicy } from '../src/config/search_policy.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Category = 'compound' | 'particle' | 'mixed' | 'baseline';

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
  // --- Compound words (복합어) ---
  'compound-nlp.md': [
    '# 자연어처리 개요',
    '',
    '형태소분석기와 거대언어모델을 비교하는 실험 문서입니다.',
    '자연어처리 파이프라인 설계를 다룹니다.',
  ].join('\n'),

  'compound-arch.md': [
    '# 아키텍처 설계',
    '',
    '서브에이전트 패턴으로 마이크로서비스를 구성합니다.',
    '데이터베이스 스키마와 메시지브로커 설정을 포함합니다.',
  ].join('\n'),

  'compound-infra.md': [
    '# 인프라 구성',
    '',
    '로드밸런서 뒤에 오토스케일링 그룹을 배치합니다.',
    '컨테이너오케스트레이션 플랫폼으로 운영합니다.',
  ].join('\n'),

  // --- Particles (조사 붙여쓰기) ---
  'particle-agent.md': [
    '# 에이전트 운영',
    '',
    '에이전트가 필요합니다. 프레임워크를 선택해야 합니다.',
    '오케스트레이터는 에이전트를 관리합니다.',
  ].join('\n'),

  'particle-middleware.md': [
    '# 미들웨어 구성',
    '',
    '미들웨어를 구성하고 샌드박스는 격리하며 운영합니다.',
    '파이프라인의 가드레일을 설정합니다.',
  ].join('\n'),

  'particle-review.md': [
    '# 코드 리뷰 가이드',
    '',
    '리팩토링이 완료되면 커버리지를 확인합니다.',
    '테스트케이스에 엣지케이스를 포함합니다.',
  ].join('\n'),

  // --- Korean-English mixed (한영 혼합 붙여쓰기) ---
  'mixed-api.md': [
    '# API 통합',
    '',
    'API연동 가이드와 OAuth인증 설정을 정리합니다.',
    'REST엔드포인트와 GraphQL스키마를 비교합니다.',
  ].join('\n'),

  'mixed-devops.md': [
    '# DevOps 가이드',
    '',
    'CI파이프라인 구축과 Docker컨테이너 배포를 다룹니다.',
    'Kubernetes클러스터 운영 노하우를 공유합니다.',
  ].join('\n'),
};

function writeNoiseDocs(docsDir: string, count: number): void {
  const topics = [
    '프로젝트 일정 관리 방법론을 소개합니다.',
    '클라우드 인프라 비용 최적화 전략입니다.',
    '코드 리뷰 프로세스 개선 방안을 제안합니다.',
    '모니터링 대시보드 구축 경험을 공유합니다.',
    '배포 파이프라인 자동화 설계 문서입니다.',
    '팀 온보딩 체크리스트를 정리했습니다.',
    '장애 대응 플레이북 초안입니다.',
    '기술 부채 관리 프레임워크를 소개합니다.',
    '성능 테스트 시나리오 설계 가이드입니다.',
    '보안 감사 결과 리포트 요약입니다.',
    '스프린트 회고 템플릿을 공유합니다.',
    '아키텍처 결정 기록 작성 가이드입니다.',
  ];

  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length]!;
    writeFileSync(
      join(docsDir, `noise-${i.toString().padStart(3, '0')}.md`),
      [`# 노이즈 문서 ${i}`, '', topic, '', `문서 번호 ${i}입니다.`].join('\n'),
      'utf8',
    );
  }
}

// ---------------------------------------------------------------------------
// Deterministic tokenize stub
// ---------------------------------------------------------------------------

const DECOMPOSITION_MAP: ReadonlyMap<string, string> = new Map([
  // Compound words
  ['형태소분석기', '형태소 분석'],
  ['거대언어모델', '거대 언어 모델'],
  ['서브에이전트', '서브 에이전트'],
  ['데이터베이스', '데이터 베이스'],
  ['자연어처리', '자연어 처리'],
  ['마이크로서비스', '마이크로 서비스'],
  ['메시지브로커', '메시지 브로커'],
  ['로드밸런서', '로드 밸런서'],
  ['오토스케일링', '오토 스케일링'],
  ['컨테이너오케스트레이션', '컨테이너 오케스트레이션'],
  ['테스트케이스', '테스트 케이스'],
  ['엣지케이스', '엣지 케이스'],
  // Particle-attached words
  ['에이전트가', '에이전트'],
  ['에이전트를', '에이전트'],
  ['프레임워크를', '프레임워크'],
  ['오케스트레이터는', '오케스트레이터'],
  ['미들웨어를', '미들웨어'],
  ['샌드박스는', '샌드박스'],
  ['가드레일을', '가드레일'],
  ['리팩토링이', '리팩토링'],
  ['커버리지를', '커버리지'],
  // Korean-English mixed
  ['API연동', 'API 연동'],
  ['OAuth인증', 'OAuth 인증'],
  ['REST엔드포인트', 'REST 엔드포인트'],
  ['GraphQL스키마', 'GraphQL 스키마'],
  ['CI파이프라인', 'CI 파이프라인'],
  ['Docker컨테이너', 'Docker 컨테이너'],
  ['Kubernetes클러스터', 'Kubernetes 클러스터'],
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
  // --- Compound word decomposition ---
  // upstream cannot find sub-tokens inside compounds
  { category: 'compound', query: '분석', targetDoc: 'docs/compound-nlp.md' },
  { category: 'compound', query: '모델', targetDoc: 'docs/compound-nlp.md' },
  { category: 'compound', query: '형태소', targetDoc: 'docs/compound-nlp.md' },
  { category: 'compound', query: '처리', targetDoc: 'docs/compound-nlp.md' },
  { category: 'compound', query: '에이전트', targetDoc: 'docs/compound-arch.md' },
  { category: 'compound', query: '서비스', targetDoc: 'docs/compound-arch.md' },
  { category: 'compound', query: '브로커', targetDoc: 'docs/compound-arch.md' },
  { category: 'compound', query: '밸런서', targetDoc: 'docs/compound-infra.md' },
  { category: 'compound', query: '스케일링', targetDoc: 'docs/compound-infra.md' },
  { category: 'compound', query: '오케스트레이션', targetDoc: 'docs/compound-infra.md' },
  { category: 'compound', query: '케이스', targetDoc: 'docs/particle-review.md' },

  // --- Particle stripping ---
  // upstream cannot match stem inside particle-attached tokens
  { category: 'particle', query: '프레임워크', targetDoc: 'docs/particle-agent.md' },
  { category: 'particle', query: '오케스트레이터', targetDoc: 'docs/particle-agent.md' },
  { category: 'particle', query: '미들웨어', targetDoc: 'docs/particle-middleware.md' },
  { category: 'particle', query: '샌드박스', targetDoc: 'docs/particle-middleware.md' },
  { category: 'particle', query: '가드레일', targetDoc: 'docs/particle-middleware.md' },
  { category: 'particle', query: '리팩토링', targetDoc: 'docs/particle-review.md' },
  { category: 'particle', query: '커버리지', targetDoc: 'docs/particle-review.md' },

  // --- Korean-English mixed ---
  // upstream cannot find Korean sub-token inside mixed token
  { category: 'mixed', query: '연동', targetDoc: 'docs/mixed-api.md' },
  { category: 'mixed', query: '인증', targetDoc: 'docs/mixed-api.md' },
  { category: 'mixed', query: '엔드포인트', targetDoc: 'docs/mixed-api.md' },
  { category: 'mixed', query: '스키마', targetDoc: 'docs/mixed-api.md' },
  { category: 'mixed', query: '파이프라인', targetDoc: 'docs/mixed-devops.md' },
  { category: 'mixed', query: '컨테이너', targetDoc: 'docs/mixed-devops.md' },
  { category: 'mixed', query: '클러스터', targetDoc: 'docs/mixed-devops.md' },

  // --- Baseline (both sides should hit) ---
  { category: 'baseline', query: '형태소분석기', targetDoc: 'docs/compound-nlp.md' },
  { category: 'baseline', query: '데이터베이스', targetDoc: 'docs/compound-arch.md' },
  { category: 'baseline', query: '필요합니다', targetDoc: 'docs/particle-agent.md' },
  { category: 'baseline', query: 'API', targetDoc: 'docs/mixed-api.md' },
  { category: 'baseline', query: '설정', targetDoc: 'docs/particle-middleware.md' },
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
  writeNoiseDocs(docsDir, 10);

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

function toMarkdown(
  rows: readonly RecallRow[],
  aggregate: readonly AggregateRow[],
): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push('# Korean Recall Comparison Metrics');
  lines.push('');
  lines.push(`Date: ${today}`);
  lines.push('Command: `bun run measure:recall-comparison`');
  lines.push('');
  lines.push(
    '이 문서는 upstream qmd FTS5 대비 kqmd shadow index의 한국어 recall 비교 벤치마크다.',
  );
  lines.push(
    'synthetic fixture에서 복합어 분리, 조사 제거, 한영 혼합 세 가지 한국어 패턴의 hit/miss를 비교한다.',
  );
  lines.push('');

  // Method
  lines.push('## Method');
  lines.push('');
  lines.push(`- fixture 규모: target 문서 ${Object.keys(TARGET_DOCS).length}개 + noise 문서 10개`);
  lines.push('- 패턴 카테고리:');
  lines.push('  - `compound`: 복합어 분리 (형태소분석기 → 형태소+분석)');
  lines.push('  - `particle`: 조사 제거 (에이전트가 → 에이전트)');
  lines.push('  - `mixed`: 한영 혼합 (API연동 → API+연동)');
  lines.push('  - `baseline`: 양쪽 모두 매칭되는 기준 쿼리');
  lines.push('- hit 정의: target 문서의 displayPath가 결과 목록(limit=20)에 존재');
  lines.push(
    '- tokenizer: deterministic stub 사용 (Kiwi 모델 다운로드 불필요)',
  );
  lines.push(
    '- query 전달: 양쪽 모두 동일한 raw query string 사용 (index-side projection 효과만 격리 측정)',
  );
  lines.push('');

  // Results table
  lines.push('## Results');
  lines.push('');
  lines.push('| Category | Query | Target | upstream | shadow | Delta |');
  lines.push('|---|---|---|---|---|---|');

  for (const row of rows) {
    const upstream = row.upstreamHit ? 'hit' : 'miss';
    const shadow = row.shadowHit ? 'hit' : 'miss';
    const delta = row.shadowHit && !row.upstreamHit ? '+1' : row.upstreamHit && !row.shadowHit ? '-1' : '0';
    lines.push(
      `| ${row.category} | ${row.query} | ${row.targetDoc} | ${upstream} | ${shadow} | ${delta} |`,
    );
  }

  lines.push('');

  // Aggregate table
  lines.push('## Aggregate');
  lines.push('');
  lines.push('| Side | Hits | Total | Recall |');
  lines.push('|---|---:|---:|---:|');

  for (const row of aggregate) {
    lines.push(`| ${row.side} | ${row.hits} | ${row.total} | ${row.recall}% |`);
  }

  lines.push('');

  // Derived signals
  const upstreamRecall = aggregate.find((a) => a.side === 'upstream')!.recall;
  const shadowRecall = aggregate.find((a) => a.side === 'shadow')!.recall;

  lines.push('## Derived Signals');
  lines.push('');
  lines.push(`- Shadow recall uplift: +${shadowRecall - upstreamRecall}pp`);
  lines.push('');

  // Notes
  lines.push('## Notes');
  lines.push('');
  lines.push(
    "- shadow table은 `tokenize='porter unicode61'`, upstream은 `unicode61`을 사용한다. 영어 토큰에서 porter stemming이 shadow에 유리하게 작용할 수 있으나, 이 벤치마크의 핵심 비교 대상은 한국어 패턴이다.",
  );
  lines.push(
    '- deterministic tokenize stub를 사용하므로, 실제 Kiwi 형태소 분석과 결과가 다를 수 있다. 이 벤치마크는 shadow index projection 메커니즘의 recall 효과를 측정한다.',
  );
  lines.push(
    '- baseline 카테고리는 양쪽 모두 hit이어야 하는 sanity check 쿼리다.',
  );
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { rows, aggregate } = await measureRecall();
const markdown = toMarkdown(rows, aggregate);

console.log(markdown);
console.log('JSON');
console.log(JSON.stringify({ rows, aggregate }, null, 2));
