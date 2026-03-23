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
  'spacing-adaptive-target.md': [
    '# 지속 학습',
    '',
    '## 지속 학습',
    '지속 학습 워크플로우를 짧게 정리합니다.',
    '이 문서는 실험 메모만 남깁니다.',
  ].join('\n'),
  'spacing-rescue-upload.md': [
    '# 문서 업로드 파서',
    '',
    '문서업로드파서와 업로드파싱기 동작을 설명합니다.',
    '문서업로드파서 구현 세부사항을 정리합니다.',
  ].join('\n'),
  'compound-orchestration.md': [
    '# 플랫폼 운영',
    '',
    '컨테이너오케스트레이션 환경에서 shadow index를 운영합니다.',
    '운영팀은 플랫폼 상태를 모니터링합니다.',
  ].join('\n'),
  'compound-analysis.md': [
    '# 자연어 처리',
    '',
    '형태소분석기와 텍스트정규화기를 비교합니다.',
    '분석 결과의 품질과 처리 흐름을 다룹니다.',
  ].join('\n'),
  'mixed-schema.md': [
    '# Schema Migration Guide',
    '',
    'Schema마이그레이션 절차와 rollback 전략을 문서화합니다.',
    'schema migration checklist를 함께 정리합니다.',
  ].join('\n'),
  'mixed-auth.md': [
    '# Auth Flow Setup',
    '',
    'OAuth인증 flow와 callback 정책을 설명합니다.',
    'oauth auth flow examples for Korean docs.',
  ].join('\n'),
  'question-upload.md': [
    '# 문서 업로드 FAQ',
    '',
    '문서 업로드 파싱 단계와 indexing 흐름을 설명합니다.',
    'parser와 indexing 단계로 나뉘며 업로드 처리 순서를 정리합니다.',
  ].join('\n'),
  'long-query-upload-overview.md': [
    '# 문서 업로드 개요',
    '',
    '문서 업로드 파싱 동작 단계를 정리한 개요 문서입니다.',
    '문서 업로드 파싱 동작 단계와 구조를 차례대로 설명합니다.',
  ].join('\n'),
  'long-query-normalized-upload.md': [
    '# 문서 업로드 파싱 단계',
    '',
    '문서 업로드 파싱 단계와 parser 흐름을 설명합니다.',
    '업로드 파이프라인의 indexing 단계와 parsing 단계를 정리합니다.',
  ].join('\n'),
};

const DOC_NOISE: readonly string[] = [
  [
    '# 지속 운영 노트',
    '',
    '지속 운영 절차를 설명합니다.',
    '학습 계획은 별도로 적고, 지속 과제와 학습 순서를 번갈아 정리합니다.',
    '지속 항목, 학습 항목, 지속 기록, 학습 기록을 여러 줄로 남깁니다.',
    '지속 운영과 학습 운영을 반복해서 적고, 지속 이슈와 학습 이슈를 계속 기록합니다.',
    '지속 단계, 학습 단계, 지속 점검, 학습 점검, 지속 보고, 학습 보고를 나열합니다.',
  ].join('\n'),
  ['# 학습 체크리스트', '', '학습 목표와 학습 순서를 정리합니다.', '지속성 이야기는 없습니다.'].join('\n'),
  ['# 검색 운영 메모', '', '검색 품질과 색인 운영에 대한 일반 메모입니다.', '문서 파이프라인을 다룹니다.'].join('\n'),
  ['# 플랫폼 개요', '', '오케스트레이터와 스케줄러를 소개합니다.', '오케스트레이션이라는 완전한 단어는 쓰지 않습니다.'].join('\n'),
  ['# API Guide', '', 'API schema checklist와 migration timeline을 정리합니다.', '마이그레이션은 영어 문맥으로만 설명합니다.'].join('\n'),
  ['# Security Notes', '', '인증 토큰 회전과 세션 정책을 설명합니다.', 'flow 라는 단어는 쓰지 않습니다.'].join('\n'),
  ['# 문서 업로드 설명 1', '', '문서 업로드는 어떻게 설명해줘야 하는지 정리합니다.', '업로드 설명 문서입니다.'].join('\n'),
  ['# 문서 업로드 설명 2', '', '문서 업로드는 어떻게 설명해줘야 하는지 다시 적습니다.', '질문형 설명 문서입니다.'].join('\n'),
  ['# 업로드 동작 설명', '', '업로드 동작은 어떻게 설명해줘야 하는지 적습니다.', '파싱이라는 단어는 쓰지 않습니다.'].join('\n'),
  ['# 문서 업로드 질문', '', '문서 업로드 질문과 설명해줘 패턴을 모읍니다.', '질문 대응 메모입니다.'].join('\n'),
  ['# 업로드 안내', '', '문서 업로드는 어떻게 동작하는지 설명해줘 안내합니다.', '설명 안내 메모입니다.'].join('\n'),
];

const NOTES_DOCS: Record<string, string> = {
  'team-notes.md': ['# Team Notes', '', "what's new this week", 'release checklist and general updates'].join('\n'),
  'release-notes.md': ['# Release Notes', '', '이번 주 변경 사항을 요약합니다.', '운영 메모만 포함합니다.'].join('\n'),
};

const DECOMPOSITION_MAP: ReadonlyMap<string, string> = new Map([
  ['문서업로드파서', '문서 업로드 파싱'],
  ['업로드파싱기', '업로드 파싱'],
  ['컨테이너오케스트레이션', '컨테이너 오케스트레이션'],
  ['형태소분석기', '형태소 분석'],
  ['텍스트정규화기', '텍스트 정규화'],
  ['Schema마이그레이션', 'Schema 마이그레이션'],
  ['OAuth인증', 'OAuth 인증'],
]);

const CORE_CASES: readonly BenchmarkCaseRuntime[] = [
  createCase({
    caseId: 'spacing-adaptive',
    syntheticLabel: 'spacing-adaptive',
    category: 'spacing',
    expectedOutcome: 'hit',
    query: '지속 학습',
    targetDocs: ['docs/spacing-adaptive-target.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'spacing-rescue-upload',
    syntheticLabel: 'spacing-rescue-upload',
    category: 'spacing',
    expectedOutcome: 'hit',
    query: '문서 업로드 파싱',
    targetDocs: ['docs/spacing-rescue-upload.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'compound-orchestration',
    syntheticLabel: 'compound-orchestration',
    category: 'compound',
    expectedOutcome: 'hit',
    query: '오케스트레이션',
    targetDocs: ['docs/compound-orchestration.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'compound-analysis',
    syntheticLabel: 'compound-analysis',
    category: 'compound',
    expectedOutcome: 'hit',
    query: '분석',
    targetDocs: ['docs/compound-analysis.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'mixed-schema',
    syntheticLabel: 'mixed-schema',
    category: 'mixed',
    expectedOutcome: 'hit',
    query: 'schema 마이그레이션',
    targetDocs: ['docs/mixed-schema.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'mixed-auth',
    syntheticLabel: 'mixed-auth',
    category: 'mixed',
    expectedOutcome: 'hit',
    query: 'oauth 인증',
    targetDocs: ['docs/mixed-auth.md'],
    collections: ['docs'],
  }),
];

const CONTROL_CASES: readonly BenchmarkCaseRuntime[] = [
  createCase({
    caseId: 'control-quoted',
    syntheticLabel: 'control-quoted',
    category: 'control',
    expectedOutcome: 'hit',
    query: '"지속 학습"',
    targetDocs: ['docs/spacing-adaptive-target.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'control-negated',
    syntheticLabel: 'control-negated',
    category: 'control',
    expectedOutcome: 'hit',
    query: '지속 학습 -파이프라인',
    targetDocs: ['docs/spacing-adaptive-target.md'],
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
    query: '오케스트레이션',
    targetDocs: ['docs/compound-orchestration.md'],
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
    caseId: 'long-query-question-upload',
    syntheticLabel: 'long-query-question-upload',
    category: 'long-query',
    expectedOutcome: 'hit',
    query: '문서 업로드 파싱은 어떻게 동작해?',
    targetDocs: ['docs/question-upload.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'long-query-descriptive-upload',
    syntheticLabel: 'long-query-descriptive-upload',
    category: 'long-query',
    expectedOutcome: 'hit',
    query: '문서 업로드 파싱 동작 단계를 정리한 문서',
    targetDocs: ['docs/long-query-upload-overview.md'],
    collections: ['docs'],
  }),
  createCase({
    caseId: 'long-query-normalization-rescue',
    syntheticLabel: 'long-query-normalization-rescue',
    category: 'long-query',
    expectedOutcome: 'hit',
    query: '문서 업로드 파싱은 어떻게 설명해줘?',
    targetDocs: ['docs/long-query-normalized-upload.md'],
    collections: ['docs'],
  }),
  createInjectedQuestionCase({
    caseId: 'diagnostic-long-query-adaptive-showcase',
    syntheticLabel: 'diagnostic-long-query-adaptive-showcase',
    category: 'long-query',
    expectedOutcome: 'hit',
    query: '지속 학습 질문',
    targetDocs: ['docs/spacing-adaptive-target.md'],
    collections: ['docs'],
    hybridRows: [
      createHybridRow({
        displayPath: 'docs/noise-000.md',
        title: '지속 운영 노트',
        body: '지속 운영과 학습 운영을 반복해서 적고, 지속 이슈와 학습 이슈를 계속 기록합니다.',
        bestChunk: '지속 운영과 학습 운영을 반복해서 적고, 지속 이슈와 학습 이슈를 계속 기록합니다.',
        score: 0.78,
        docid: 'noise-000',
      }),
      createHybridRow({
        displayPath: 'docs/spacing-adaptive-target.md',
        title: '지속 학습',
        body: '지속 학습 워크플로우를 짧게 정리합니다.',
        bestChunk: '지속 학습 워크플로우를 짧게 정리합니다.',
        score: 0.74,
        docid: 'spacing-adaptive-target',
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
              text: 'docs/noise-000.md',
            },
            {
              label: `injected-hybrid-path-target:${runtime.caseDefinition.syntheticLabel}`,
              text: 'docs/spacing-adaptive-target.md',
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
