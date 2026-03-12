import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { type Kiwi, KiwiBuilder, Match, type TokenInfo } from 'kiwi-nlp';

import { getModelCacheDir } from '../../config/qmd_paths.js';

const require = createRequire(import.meta.url);

const KQMD_KIWI_PACKAGE_VERSION = '0.22.1';
const KQMD_KIWI_GIT_TAG = `v${KQMD_KIWI_PACKAGE_VERSION}`;
const KQMD_KIWI_WASM_PATH = require.resolve('kiwi-nlp/dist/kiwi-wasm.wasm');
const KQMD_KIWI_MODEL_BASE_URL = `https://raw.githubusercontent.com/bab2min/Kiwi/${KQMD_KIWI_GIT_TAG}/models/cong/base`;
const SEARCHABLE_TOKEN_PREFIXES = ['N', 'XR', 'SL', 'SH', 'SN'] as const;
const KQMD_KIWI_MODEL_FILES = [
  'combiningRule.txt',
  'cong.mdl',
  'default.dict',
  'dialect.dict',
  'extract.mdl',
  'multi.dict',
  'nounchr.mdl',
  'sj.morph',
  'typo.dict',
] as const;

type KiwiModelFile = (typeof KQMD_KIWI_MODEL_FILES)[number];

export interface KiwiTokenizerDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: typeof fetch;
  readonly mkdir?: typeof mkdir;
  readonly readFile?: typeof readFile;
  readonly stat?: typeof stat;
  readonly writeFile?: typeof writeFile;
  readonly createBuilder?: typeof KiwiBuilder.create;
}

let kiwiPromise: Promise<Kiwi> | undefined;

function getModelFilePath(file: KiwiModelFile, env: NodeJS.ProcessEnv): string {
  return join(getModelCacheDir(env), 'kiwi-nlp', KQMD_KIWI_PACKAGE_VERSION, 'cong', file);
}

function getModelFileUrl(file: KiwiModelFile): string {
  return `${KQMD_KIWI_MODEL_BASE_URL}/${file}`;
}

async function pathExists(filePath: string, fileStat: typeof stat = stat): Promise<boolean> {
  try {
    await fileStat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureModelFiles(
  dependencies: KiwiTokenizerDependencies = {},
): Promise<Record<string, Uint8Array>> {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetch ?? fetch;
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  const readFileImpl = dependencies.readFile ?? readFile;
  const statImpl = dependencies.stat ?? stat;
  const writeFileImpl = dependencies.writeFile ?? writeFile;
  const modelDir = join(getModelCacheDir(env), 'kiwi-nlp', KQMD_KIWI_PACKAGE_VERSION, 'cong');

  await mkdirImpl(modelDir, { recursive: true });

  const modelFiles: Record<string, Uint8Array> = {};

  for (const file of KQMD_KIWI_MODEL_FILES) {
    const filePath = getModelFilePath(file, env);
    if (!(await pathExists(filePath, statImpl))) {
      const response = await fetchImpl(getModelFileUrl(file));
      if (!response.ok) {
        throw new Error(`Failed to download Kiwi model file: ${file}`);
      }

      const data = new Uint8Array(await response.arrayBuffer());
      await writeFileImpl(filePath, data);
    }

    modelFiles[file] = new Uint8Array(await readFileImpl(filePath));
  }

  return modelFiles;
}

async function createKiwi(dependencies: KiwiTokenizerDependencies = {}): Promise<Kiwi> {
  const createBuilder = dependencies.createBuilder ?? KiwiBuilder.create;
  const builder = await createBuilder(KQMD_KIWI_WASM_PATH);
  const modelFiles = await ensureModelFiles(dependencies);

  return builder.build({
    modelFiles,
    modelType: 'cong',
    integrateAllomorph: true,
  });
}

export function containsHangul(text: string): boolean {
  return /[가-힣]/.test(text);
}

function isSearchableToken(token: TokenInfo): boolean {
  return SEARCHABLE_TOKEN_PREFIXES.some((prefix) => token.tag.startsWith(prefix));
}

function normalizeTokenText(token: TokenInfo): string | null {
  const normalized = token.str.trim().toLowerCase();
  if (!normalized || !/[\p{L}\p{N}]/u.test(normalized)) {
    return null;
  }

  if (normalized.length === 1 && /[가-힣]/.test(normalized)) {
    return null;
  }

  return normalized;
}

export function normalizeKiwiTokens(tokens: TokenInfo[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const token of tokens) {
    if (!isSearchableToken(token)) {
      continue;
    }

    const text = normalizeTokenText(token);
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    normalized.push(text);
  }

  return normalized;
}

async function getKiwi(dependencies: KiwiTokenizerDependencies = {}): Promise<Kiwi> {
  if (!kiwiPromise) {
    kiwiPromise = createKiwi(dependencies);
  }

  return kiwiPromise;
}

export async function extractKoreanSearchTokens(
  text: string,
  dependencies: KiwiTokenizerDependencies = {},
): Promise<string[]> {
  if (!containsHangul(text)) {
    return [];
  }

  const kiwi = await getKiwi(dependencies);
  return normalizeKiwiTokens(kiwi.tokenize(text, Match.allWithNormalizing));
}

export function buildLexicalSearchText(raw: string, analyzedTokens: readonly string[]): string {
  return [raw, ...analyzedTokens].filter(Boolean).join(' ');
}

export async function buildKoreanAwareLexQuery(
  raw: string,
  dependencies: KiwiTokenizerDependencies = {},
): Promise<string> {
  const analyzedTokens = await extractKoreanSearchTokens(raw, dependencies);
  return analyzedTokens.length > 0 ? buildLexicalSearchText(raw, analyzedTokens) : raw;
}

export async function buildShadowProjectionText(
  raw: string,
  dependencies: KiwiTokenizerDependencies = {},
): Promise<string> {
  const analyzedTokens = await extractKoreanSearchTokens(raw, dependencies);
  return analyzedTokens.length > 0 ? buildLexicalSearchText(raw, analyzedTokens) : raw;
}
