import type { TokenInfo } from 'kiwi-nlp';
import { describe, expect, test, vi } from 'vitest';

import {
  buildLexicalSearchText,
  containsHangul,
  ensureKiwiReady,
  normalizeKiwiTokens,
  resetKiwiForTests,
} from '../src/commands/owned/kiwi_tokenizer.js';

describe('kiwi tokenizer helpers', () => {
  test('detects Hangul text', () => {
    expect(containsHangul('형태소 분석')).toBe(true);
    expect(containsHangul('model search')).toBe(false);
  });

  test('normalizes searchable Kiwi tokens', () => {
    const tokens: TokenInfo[] = [
      {
        str: '형태소',
        tag: 'NNG',
      },
      {
        str: '분석',
        tag: 'NNG',
      },
      {
        str: '은',
        tag: 'JX',
      },
      {
        str: '기',
        tag: 'NNG',
      },
      {
        str: 'LLM',
        tag: 'SL',
      },
    ].map((token) => ({
      position: 0,
      wordPosition: 0,
      sentPosition: 0,
      lineNumber: 0,
      length: token.str.length,
      score: 0,
      typoCost: 0,
      typoFormId: 0,
      pairedToken: -1,
      subSentPosition: 0,
      morphId: -1,
      ...token,
    }));

    expect(normalizeKiwiTokens(tokens)).toEqual(['형태소', '분석', 'llm']);
  });

  test('builds lexical search text from raw query and analyzed tokens', () => {
    expect(buildLexicalSearchText('형태소 분석', ['형태소', '분석'])).toBe(
      '형태소 분석 형태소 분석',
    );
  });

  test('clears rejected bootstrap promise so a later call can retry', async () => {
    resetKiwiForTests();

    const createBuilder = vi
      .fn()
      .mockRejectedValueOnce(new Error('bootstrap failed'))
      .mockResolvedValue({
        build: vi.fn(async () => ({
          ready: () => true,
          tokenize: () => [],
        })),
      });

    await expect(
      ensureKiwiReady({
        createBuilder,
        loadModelFiles: async () => ({}),
      }),
    ).rejects.toThrow('bootstrap failed');

    await expect(
      ensureKiwiReady({
        createBuilder,
        loadModelFiles: async () => ({}),
      }),
    ).resolves.toBeUndefined();

    expect(createBuilder).toHaveBeenCalledTimes(2);

    resetKiwiForTests();
  });

  test('redownloads a cached model file when checksum validation fails', async () => {
    resetKiwiForTests();

    const goodData = new Uint8Array([1, 2, 3, 4]);
    const badData = new Uint8Array([9, 9, 9]);
    const hash = await crypto.subtle.digest('SHA-256', goodData);
    const expectedHash = Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const files = new Map<string, Uint8Array>([
      ['combiningRule.txt', badData],
      ['cong.mdl', goodData],
      ['default.dict', goodData],
      ['dialect.dict', goodData],
      ['extract.mdl', goodData],
      ['multi.dict', goodData],
      ['sj.morph', goodData],
      ['typo.dict', goodData],
    ]);
    const fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => goodData.buffer,
    })) as unknown as typeof globalThis.fetch;

    await expect(
      ensureKiwiReady({
        expectedHashes: {
          'combiningRule.txt': expectedHash,
          'cong.mdl': expectedHash,
          'default.dict': expectedHash,
          'dialect.dict': expectedHash,
          'extract.mdl': expectedHash,
          'multi.dict': expectedHash,
          'sj.morph': expectedHash,
          'typo.dict': expectedHash,
        },
        stat: (async () => ({})) as unknown as typeof import('node:fs/promises').stat,
        readFile: (async (filePath) => {
          const name = String(filePath).split('/').pop();
          return files.get(name ?? '') ?? goodData;
        }) as typeof import('node:fs/promises').readFile,
        writeFile: (async (filePath, data) => {
          files.set(String(filePath).split('/').pop() ?? '', new Uint8Array(data as Uint8Array));
        }) as typeof import('node:fs/promises').writeFile,
        rename: (async (from, to) => {
          const data = files.get(String(from).split('/').pop() ?? '');
          if (data) {
            files.set(String(to).split('/').pop() ?? '', data);
          }
        }) as typeof import('node:fs/promises').rename,
        rm: (async (filePath) => {
          files.delete(String(filePath).split('/').pop() ?? '');
        }) as typeof import('node:fs/promises').rm,
        fetch,
        createBuilder: (async () => ({
          build: async () =>
            ({
              ready: () => true,
              isTypoTolerant: () => false,
              analyze: () => ({ tokens: [], score: 0 }),
              analyzeTopN: () => [],
              tokenize: () => [],
              tokenizeTopN: () => [],
              splitIntoSents: () => ({ spans: [], tokenResult: null }),
              joinSent: () => ({ str: '', ranges: null }),
              getCutOffThreshold: () => 0,
              setCutOffThreshold: () => {},
              getUnkScoreBias: () => 0,
              setUnkScoreBias: () => {},
              getUnkScoreScale: () => 0,
              setUnkScoreScale: () => {},
              getMaxUnkFormSize: () => 0,
              setMaxUnkFormSize: () => {},
              getSpaceTolerance: () => 0,
              setSpaceTolerance: () => {},
              getSpacePenalty: () => 0,
              setSpacePenalty: () => {},
              getTypoCostWeight: () => 0,
              setTypoCostWeight: () => {},
              getIntegrateAllomorphic: () => true,
              setIntegrateAllomorphic: () => {},
              createMorphemeSet: () => 0,
              destroyMorphemeSet: () => {},
            }) as never,
        })) as never,
      }),
    ).resolves.toBeUndefined();

    expect(fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    resetKiwiForTests();
  });

  test('downloads LFS-backed model files from media.githubusercontent.com', async () => {
    resetKiwiForTests();

    const goodData = new Uint8Array([1, 2, 3, 4]);
    const hash = await crypto.subtle.digest('SHA-256', goodData);
    const expectedHash = Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const files = new Map<string, Uint8Array>();
    const urls: string[] = [];
    const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      urls.push(String(input));
      return {
        ok: true,
        arrayBuffer: async () => goodData.buffer,
      };
    }) as unknown as typeof globalThis.fetch;

    await expect(
      ensureKiwiReady({
        expectedHashes: {
          'combiningRule.txt': expectedHash,
          'cong.mdl': expectedHash,
          'default.dict': expectedHash,
          'dialect.dict': expectedHash,
          'extract.mdl': expectedHash,
          'multi.dict': expectedHash,
          'sj.morph': expectedHash,
          'typo.dict': expectedHash,
        },
        stat: (async () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        }) as unknown as typeof import('node:fs/promises').stat,
        readFile: (async (filePath) => {
          const name = String(filePath).split('/').pop();
          const data = files.get(name ?? '');
          if (!data) {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
          }

          return data;
        }) as typeof import('node:fs/promises').readFile,
        writeFile: (async (filePath, data) => {
          files.set(String(filePath).split('/').pop() ?? '', new Uint8Array(data as Uint8Array));
        }) as typeof import('node:fs/promises').writeFile,
        rename: (async (from, to) => {
          const data = files.get(String(from).split('/').pop() ?? '');
          if (data) {
            files.set(String(to).split('/').pop() ?? '', data);
          }
        }) as typeof import('node:fs/promises').rename,
        rm: (async (filePath) => {
          files.delete(String(filePath).split('/').pop() ?? '');
        }) as typeof import('node:fs/promises').rm,
        fetch,
        createBuilder: (async () => ({
          build: async () =>
            ({
              ready: () => true,
              tokenize: () => [],
            }) as never,
        })) as never,
      }),
    ).resolves.toBeUndefined();

    expect(urls).toContain(
      'https://raw.githubusercontent.com/bab2min/Kiwi/v0.22.1/models/cong/base/combiningRule.txt',
    );
    expect(urls).toContain(
      'https://media.githubusercontent.com/media/bab2min/Kiwi/v0.22.1/models/cong/base/cong.mdl',
    );
    expect(urls).toContain(
      'https://media.githubusercontent.com/media/bab2min/Kiwi/v0.22.1/models/cong/base/extract.mdl',
    );
    expect(urls).toContain(
      'https://media.githubusercontent.com/media/bab2min/Kiwi/v0.22.1/models/cong/base/sj.morph',
    );
    expect(fetch as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(8);
    resetKiwiForTests();
  });

  test('rejects symlinked Kiwi cache artifacts', async () => {
    resetKiwiForTests();

    await expect(
      ensureKiwiReady({
        stat: (async () => ({})) as unknown as typeof import('node:fs/promises').stat,
        lstat: (async (filePath: string) => ({
          isSymbolicLink: () => String(filePath).endsWith('combiningRule.txt'),
        })) as unknown as typeof import('node:fs/promises').lstat,
        createBuilder: (async () => ({
          build: async () =>
            ({
              ready: () => true,
              tokenize: () => [],
            }) as never,
        })) as never,
      }),
    ).rejects.toThrow('Kiwi model path must not be a symlink.');

    resetKiwiForTests();
  });
});
