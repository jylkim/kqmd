import { describe, expect, test } from 'vitest';
import {
  assertSafeSyntheticLabel,
  assertSafeSyntheticPath,
  assertSafeSyntheticText,
  assertSafeSyntheticTexts,
} from '../scripts/query_recall_fixture_safety.js';

describe('query recall fixture safety', () => {
  test('accepts safe synthetic benchmark content', () => {
    expect(() =>
      assertSafeSyntheticTexts([
        {
          label: 'safe-case',
          text: '문서 업로드 파싱 동작 단계를 정리한 synthetic fixture 입니다.',
        },
        {
          label: 'safe-doc',
          text: '# 문서 업로드 개요\n문서 업로드 파싱 동작 단계를 설명합니다.',
        },
      ]),
    ).not.toThrow();
  });

  test.each([
    ['/Users/jylkim/projects/private.md', 'absolute path'],
    ['https://example.com/private-query', 'external url'],
    ['tester@example.com', 'email'],
    ['sk_live_secret_token_example', 'token'],
    ['AKIA1234567890ABCDEF', 'aws key'],
  ])('rejects unsafe synthetic content: %s', (value) => {
    expect(() => assertSafeSyntheticText(value, 'unsafe-case')).toThrow(
      /Unsafe synthetic fixture content detected/,
    );
  });

  test('rejects unsafe synthetic labels', () => {
    expect(() => assertSafeSyntheticLabel('문서 업로드 파싱은 어떻게 동작해?')).toThrow(
      /Unsafe synthetic label detected/,
    );
  });

  test('rejects unsafe persisted paths', () => {
    expect(() =>
      assertSafeSyntheticTexts([
        { label: 'unsafe-path', text: '/Users/jylkim/projects/private.md' },
      ]),
    ).toThrow(/Unsafe synthetic fixture content detected/);
  });

  test('rejects non-relative synthetic paths', () => {
    expect(() => assertSafeSyntheticPath('private.md')).toThrow(/Unsafe synthetic path detected/);
  });
});
