import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  type Kiwi,
  KiwiBuilder,
  type KiwiBuilder as KiwiBuilderType,
  Match,
  type TokenInfo,
} from 'kiwi-nlp';

import { getModelCacheDir } from '#src/config/qmd_paths.js';

const require = createRequire(import.meta.url);

const KQMD_KIWI_PACKAGE_VERSION = '0.22.1';
const KQMD_KIWI_GIT_TAG = `v${KQMD_KIWI_PACKAGE_VERSION}`;
const KQMD_KIWI_WASM_PATH = require.resolve('kiwi-nlp/dist/kiwi-wasm.wasm');
const KQMD_KIWI_MODEL_RAW_BASE_URL = `https://raw.githubusercontent.com/bab2min/Kiwi/${KQMD_KIWI_GIT_TAG}/models/cong/base`;
const KQMD_KIWI_MODEL_MEDIA_BASE_URL = `https://media.githubusercontent.com/media/bab2min/Kiwi/${KQMD_KIWI_GIT_TAG}/models/cong/base`;
const KQMD_KIWI_DOWNLOAD_TIMEOUT_MS = 15_000;
const SEARCHABLE_TOKEN_PREFIXES = ['N', 'XR', 'SL', 'SH', 'SN'] as const;
const KQMD_KIWI_MODEL_FILES = [
  'combiningRule.txt',
  'cong.mdl',
  'default.dict',
  'dialect.dict',
  'extract.mdl',
  'multi.dict',
  'sj.morph',
  'typo.dict',
] as const;
const KQMD_KIWI_MODEL_FILE_HASHES: Record<KiwiModelFile, string> = {
  'combiningRule.txt': 'ae618482b51a93fb60c100ec2a2ca031967ef2c58e3da75b0575261a131f7289',
  'cong.mdl': 'bd9ca89ee1b72e750c8e2166a17c80a0fe3fabd828c78b1f0928486a6b1833a7',
  'default.dict': 'd4293e44b2588d0c3aabbce607a0f41ad3534abd31b34139847b127254e01549',
  'dialect.dict': 'bb6f0ab37dbfcc0fd33dc679121218d24725ae438f31bb362f9b24703e93cda2',
  'extract.mdl': 'a0c92ffc051e43ae497845cdb8d4c8b9e2f359893cb55c67279c76d1d531ee17',
  'multi.dict': 'e9eff7712d163b214c750333a5d388ab77b50ec386ae55b360babcd24c0c3195',
  'sj.morph': '5e3dab2def6d2cc079e21d5477bd610a391c69045d08caf1e0bbeabda8db8d1b',
  'typo.dict': 'aa15e48fcd32886441fc1ff9719a3109d3192e91d4b67efbd64260610d68322d',
};
const KQMD_KIWI_MEDIA_MODEL_FILES = new Set<KiwiModelFile>(['cong.mdl', 'extract.mdl', 'sj.morph']);

type KiwiModelFile = (typeof KQMD_KIWI_MODEL_FILES)[number];

interface KiwiBuilderLike {
  build(buildArgs: Parameters<KiwiBuilderType['build']>[0]): Promise<Kiwi>;
}

export interface KiwiTokenizerDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly expectedHashes?: Partial<Record<KiwiModelFile, string>>;
  readonly loadModelFiles?: () => Promise<Record<string, Uint8Array>>;
  readonly fetch?: typeof fetch;
  readonly lstat?: typeof lstat;
  readonly mkdir?: typeof mkdir;
  readonly readFile?: typeof readFile;
  readonly rename?: typeof rename;
  readonly rm?: typeof rm;
  readonly stat?: typeof stat;
  readonly writeFile?: typeof writeFile;
  readonly createBuilder?: (wasmPath: string) => Promise<KiwiBuilderLike>;
}

let kiwiPromise: Promise<Kiwi> | undefined;

function getModelFilePath(file: KiwiModelFile, env: NodeJS.ProcessEnv): string {
  return join(getModelCacheDir(env), 'kiwi-nlp', KQMD_KIWI_PACKAGE_VERSION, 'cong', file);
}

function getModelFileUrl(file: KiwiModelFile): string {
  const baseUrl = KQMD_KIWI_MEDIA_MODEL_FILES.has(file)
    ? KQMD_KIWI_MODEL_MEDIA_BASE_URL
    : KQMD_KIWI_MODEL_RAW_BASE_URL;
  return `${baseUrl}/${file}`;
}

async function pathExists(filePath: string, fileStat: typeof stat = stat): Promise<boolean> {
  try {
    await fileStat(filePath);
    return true;
  } catch {
    return false;
  }
}

function hashFileContents(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function getExpectedModelHash(
  file: KiwiModelFile,
  dependencies: KiwiTokenizerDependencies = {},
): string {
  return dependencies.expectedHashes?.[file] ?? KQMD_KIWI_MODEL_FILE_HASHES[file];
}

function isExpectedModelFile(
  file: KiwiModelFile,
  data: Uint8Array,
  dependencies: KiwiTokenizerDependencies = {},
): boolean {
  return hashFileContents(data) === getExpectedModelHash(file, dependencies);
}

async function assertPathIsNotSymlink(
  filePath: string,
  lstatImpl: typeof lstat = lstat,
): Promise<void> {
  try {
    const stats = await lstatImpl(filePath);
    if (stats.isSymbolicLink()) {
      throw new Error('Kiwi model path must not be a symlink.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

async function downloadModelFile(
  file: KiwiModelFile,
  filePath: string,
  dependencies: KiwiTokenizerDependencies,
): Promise<void> {
  const fetchImpl = dependencies.fetch ?? fetch;
  const writeFileImpl = dependencies.writeFile ?? writeFile;
  const renameImpl = dependencies.rename ?? rename;
  const rmImpl = dependencies.rm ?? rm;
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const signal = AbortSignal.timeout(KQMD_KIWI_DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetchImpl(getModelFileUrl(file), { signal });
    if (!response.ok) {
      throw new Error(`Failed to download Kiwi model file: ${file}`);
    }

    const data = new Uint8Array(await response.arrayBuffer());
    if (!isExpectedModelFile(file, data, dependencies)) {
      throw new Error(`Kiwi model file checksum mismatch: ${file}`);
    }

    await writeFileImpl(tempPath, data);
    await renameImpl(tempPath, filePath);
  } catch (error) {
    await rmImpl(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function ensureModelFiles(
  dependencies: KiwiTokenizerDependencies = {},
): Promise<Record<string, Uint8Array>> {
  if (dependencies.loadModelFiles) {
    return dependencies.loadModelFiles();
  }

  const env = dependencies.env ?? process.env;
  const lstatImpl = dependencies.lstat ?? lstat;
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  const readFileImpl = dependencies.readFile ?? readFile;
  const statImpl = dependencies.stat ?? stat;
  const modelDir = join(getModelCacheDir(env), 'kiwi-nlp', KQMD_KIWI_PACKAGE_VERSION, 'cong');

  await mkdirImpl(modelDir, { recursive: true });
  await assertPathIsNotSymlink(modelDir, lstatImpl);

  const modelFiles: Record<string, Uint8Array> = {};

  for (const file of KQMD_KIWI_MODEL_FILES) {
    const filePath = getModelFilePath(file, env);
    await assertPathIsNotSymlink(filePath, lstatImpl);
    if (!(await pathExists(filePath, statImpl))) {
      await downloadModelFile(file, filePath, dependencies);
    }

    let data = new Uint8Array(await readFileImpl(filePath));
    if (!isExpectedModelFile(file, data, dependencies)) {
      await downloadModelFile(file, filePath, dependencies);
      data = new Uint8Array(await readFileImpl(filePath));
      if (!isExpectedModelFile(file, data, dependencies)) {
        throw new Error(`Kiwi model file checksum mismatch: ${file}`);
      }
    }

    modelFiles[file] = data;
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
    kiwiPromise = createKiwi(dependencies).catch((error) => {
      kiwiPromise = undefined;
      throw error;
    });
  }

  return kiwiPromise;
}

export async function ensureKiwiReady(dependencies: KiwiTokenizerDependencies = {}): Promise<void> {
  await getKiwi(dependencies);
}

export function resetKiwiForTests(): void {
  kiwiPromise = undefined;
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

export const buildShadowProjectionText = buildKoreanAwareLexQuery;
