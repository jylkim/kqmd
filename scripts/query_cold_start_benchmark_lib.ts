import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { QMDStore } from '@tobilu/qmd';

export interface ColdStartFixture {
  readonly fixtureId: string;
  readonly query: string;
  readonly collections?: string[];
  readonly targetPath: string;
}

export function toAllowlistedBenchmarkPath(displayPath: string): string {
  const normalized = displayPath.startsWith('qmd://') ? displayPath.slice(6) : displayPath;

  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.startsWith('\\') ||
    normalized.startsWith('~') ||
    normalized.includes('..') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe benchmark display path detected: ${displayPath}`);
  }

  return `qmd://${normalized.replaceAll('\\', '/')}`;
}

export const COLD_START_FIXTURES: readonly ColdStartFixture[] = [
  {
    fixtureId: 'short-korean-phrase',
    query: '지속 학습',
    targetPath: 'qmd://docs/adaptive-korean-ranking.md',
  },
  {
    fixtureId: 'long-korean-question',
    query: '문서 업로드 파싱은 어떻게 동작해?',
    targetPath: 'qmd://docs/upload-parser.md',
  },
  {
    fixtureId: 'english-agent-orchestration',
    query: 'agent orchestration',
    targetPath: 'qmd://docs/agent-orchestration.md',
  },
];

export function createColdStartFixtureWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'kqmd-query-cold-start-'));
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

export function writeColdStartFixtureDocs(docsDir: string, notesDir: string): void {
  const docs: Record<string, string> = {
    'adaptive-korean-ranking.md': [
      '# 지속 학습 메모',
      '',
      '지속 학습은 문서 업로드 파싱과 연결됩니다.',
      '짧은 한국어 구 검색에서 literal hit가 강하면 rerank를 생략합니다.',
    ].join('\n'),
    'upload-parser.md': [
      '# 문서 업로드 파서',
      '',
      '문서 업로드 파싱 동작을 설명합니다.',
      '업로드 단계와 parsing 단계가 순서대로 이어집니다.',
      '문서 업로드 파싱은 query cold start benchmark fixture입니다.',
    ].join('\n'),
    'agent-orchestration.md': [
      '# Agent Orchestration',
      '',
      'agent orchestration keeps candidate windows and execution policy aligned.',
      'This is noise for the cold start benchmark.',
    ].join('\n'),
  };

  for (const [name, body] of Object.entries(docs)) {
    writeFileSync(join(docsDir, name), body, 'utf8');
  }

  for (let index = 0; index < 18; index += 1) {
    writeFileSync(
      join(docsDir, `noise-${index.toString().padStart(2, '0')}.md`),
      [
        `# Noise ${index}`,
        '',
        '이 문서는 synthetic cold start benchmark용 일반 노이즈 문서입니다.',
        index % 2 === 0 ? '지속 운영 메모를 다룹니다.' : '업로드 안내를 간단히 설명합니다.',
      ].join('\n'),
      'utf8',
    );
  }

  const notes: Record<string, string> = {
    'team-notes.md': [
      '# Team Notes',
      '',
      'release checklist and general updates',
      'what is new this week and which checks must pass before release',
    ].join('\n'),
    'release-notes.md': [
      '# Release Notes',
      '',
      'release summary and deployment notes',
    ].join('\n'),
  };

  for (const [name, body] of Object.entries(notes)) {
    writeFileSync(join(notesDir, name), body, 'utf8');
  }
}

function normalizeText(text: string): string {
  return text.toLowerCase();
}

function createDeterministicVector(text: string): number[] {
  const normalized = normalizeText(text);
  return [
    normalized.includes('지속') || normalized.includes('학습') ? 0.9 : 0.1,
    normalized.includes('문서') || normalized.includes('업로드') || normalized.includes('파싱')
      ? 0.9
      : 0.1,
    normalized.includes('release') || normalized.includes('checklist') ? 0.9 : 0.1,
    normalized.includes('agent') || normalized.includes('orchestration') ? 0.9 : 0.1,
  ];
}

function scoreDocument(query: string, text: string, index: number): number {
  const normalizedQuery = normalizeText(query);
  const normalizedText = normalizeText(text);
  const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 1);
  const overlap = terms.reduce(
    (count, term) => count + (normalizedText.includes(term) ? 1 : 0),
    0,
  );
  const wholeFormBonus = normalizedText.includes(normalizedQuery) ? 0.35 : 0;
  return Number((0.35 + overlap * 0.12 + wholeFormBonus - index * 0.01).toFixed(4));
}

export function installDeterministicLlmStub(store: QMDStore): void {
  store.internal.llm = {
    expandQuery: async () => [],
    embedBatch: async (texts: readonly string[]) =>
      texts.map((text) => ({
        embedding: createDeterministicVector(text),
      })),
    rerank: async (query: string, documents: readonly { file: string; text: string }[]) => ({
      results: documents.map((document, index) => ({
        file: document.file,
        score: scoreDocument(query, document.text, index),
      })),
    }),
  } as never;
}

export function findFixture(fixtureId: string): ColdStartFixture {
  const fixture = COLD_START_FIXTURES.find((item) => item.fixtureId === fixtureId);
  if (!fixture) {
    throw new Error(`Unknown cold-start fixture: ${fixtureId}`);
  }

  return fixture;
}
