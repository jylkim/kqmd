import type { TokenInfo } from 'kiwi-nlp';
import { describe, expect, test } from 'vitest';

import {
  buildLexicalSearchText,
  containsHangul,
  normalizeKiwiTokens,
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
});
