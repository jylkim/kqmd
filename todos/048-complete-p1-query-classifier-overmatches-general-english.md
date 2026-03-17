---
status: complete
priority: p1
issue_id: "048"
tags: [code-review, query, ranking, classifier, typescript]
dependencies: []
---

# Query classifier overmatches general English queries

`mixed-technical`와 lexical-first 전환 휴리스틱이 너무 넓어서 일반 영어 질의까지 adaptive Korean ranking 정책에 끌려 들어갑니다.

## Problem Statement

현재 분류기는 `hasLatin && (... || terms.length <= 5)` 조건으로 `mixed-technical`를 판정하고, explicit quote/path-like 감지도 꽤 넓습니다. 그 결과 `auth flow`, `what's new`, `self-hosted`, `pre-commit` 같은 일반 질의도 fetch window 확대나 rerank disable, `--candidate-limit <= 50` 제한을 받게 됩니다. 여기에 structured query도 punctuation/path heuristic에 걸리면 rerank-off로 내려갈 수 있어, compatibility path 약속과도 어긋납니다.

이건 원래 의도한 “short Korean phrase / mixed Hangul-Latin / actual path-like query” 범위를 넘어서며, false positive가 많아질수록 adaptive 정책의 장점보다 회귀 위험이 커집니다.

## Findings

- [`src/commands/owned/query_classifier.ts:53`](/Users/jylkim/projects/kqmd/src/commands/owned/query_classifier.ts#L53) 의 `mixed-technical` 판정은 일반 영어 2~5단어 질의 대부분을 흡수합니다.
- [`src/commands/owned/query_classifier.ts:39`](/Users/jylkim/projects/kqmd/src/commands/owned/query_classifier.ts#L39) 의 `containsPathLikeToken()`는 `-`, `.`, `_` 같은 일반 구두점도 path-like로 취급합니다.
- [`src/commands/owned/query_classifier.ts:80`](/Users/jylkim/projects/kqmd/src/commands/owned/query_classifier.ts#L80) 의 `shouldDisableRerankForQuery()`는 structured query도 예외 처리하지 않고 quoted/path-like면 일괄 rerank-off로 바꿉니다.
- [`src/commands/owned/query_core.ts:83`](/Users/jylkim/projects/kqmd/src/commands/owned/query_core.ts#L83) 의 mixed-technical `candidateLimit <= 50` validation은 rerank disable 판단보다 먼저 실행되어, 이미 rerank를 끄는 quoted/path-like plain query도 막습니다.

## Proposed Solutions

### Option 1: mixed-technical 판정을 Hangul-mixed / true path-like로 축소

**Approach:** `mixed-technical`는 Hangul+Latin 혼합 또는 실제 path/symbol 패턴(`/`, `::`, camelCase, extension`)일 때만 판정합니다.

**Pros:**
- false positive가 크게 줄어듭니다
- Korean-focused adaptive scope와 더 잘 맞습니다

**Cons:**
- pure English technical query 일부는 현재보다 덜 특화됩니다

**Effort:** Small

**Risk:** Low

---

### Option 2: 분류는 넓게 두고, 50-cap과 rerank-off만 좁게 적용

**Approach:** `mixed-technical` 분류는 유지하되, `candidateLimit <= 50`과 rerank-off는 실제 path-like / quoted / Hangul-mixed cases에만 적용합니다. structured query는 항상 compatibility path로 고정합니다.

**Pros:**
- ranking feature 범위는 넓게 유지됩니다
- 비용/behavior 회귀만 줄일 수 있습니다

**Cons:**
- 분류 의미와 실행 정책이 달라져 설명이 어려워집니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Option 1을 적용합니다. `mixed-technical` 판정을 Hangul+Latin 혼합 또는 실제 path-like 패턴으로 좁히고, structured query는 compatibility path를 유지하며, `--candidate-limit <= 50` 검증은 rerank가 실제로 유지되는 mixed-technical plain query에만 적용합니다.

## Technical Details

**Affected files:**
- `src/commands/owned/query_classifier.ts`
- `src/commands/owned/query_core.ts`
- `test/query-classifier.test.ts`
- `test/query-runtime.test.ts`

**Database changes (if any):**
- Migration needed? No

## Resources

- **Branch:** `feat/adaptive-korean-query-ranking`
- **Commit:** `99b4d2d`
- **Related files:** `src/commands/owned/query_classifier.ts`, `src/commands/owned/query_core.ts`

## Acceptance Criteria

- [x] general English 질의가 `mixed-technical`로 과도하게 분류되지 않는다
- [x] path-like / quoted / Hangul-mixed 판정 기준이 더 좁고 설명 가능해진다
- [x] structured query는 punctuation/path heuristic에 걸려도 compatibility path를 유지한다
- [x] `--candidate-limit <= 50` validation이 intended query class에만 적용된다
- [x] classifier tests가 false positive / true positive를 함께 고정한다

## Work Log

### 2026-03-17 - Initial Review Finding

**By:** Codex

**Actions:**
- `query_classifier.ts`와 `query_core.ts` runtime policy를 검토
- simplicity reviewer finding을 요약해 todo로 기록

**Learnings:**
- adaptive 정책 자체보다 “누가 adaptive로 분류되느냐”가 더 큰 회귀 축일 수 있다
- classifier와 validation 순서가 바뀌면, intended cost guard가 unrelated query까지 막을 수 있다

### 2026-03-17 - Resolution

**By:** Codex

**Actions:**
- `query_classifier.ts`에서 explicit phrase 감지를 outer quote로 한정하고, path-like 판정을 slash, namespace, camelCase, 확장자 패턴으로 축소
- `mixed-technical` 분류를 Hangul+Latin 혼합 또는 실제 path-like query로만 제한
- structured query는 `shouldDisableRerankForQuery()`에서 항상 compatibility path를 유지하도록 고정
- `query_core.ts`에서 `--candidate-limit <= 50` 검증을 rerank가 유지되는 mixed-technical plain query에만 적용
- classifier/core/command 테스트에 일반 영어 false positive, structured compatibility, oversized candidate-limit 허용/거부 케이스를 추가
- `bun vitest run test/query-classifier.test.ts test/query-core.test.ts test/query-runtime.test.ts test/query-command.test.ts`에 해당하는 최소 관련 스펙을 개별 실행해 통과 확인

**Learnings:**
- apostrophe와 hyphen은 일반 영어 query에서 흔하므로 phrase/path 신호로 쓰면 false positive가 빠르게 늘어난다
- structured compatibility는 분류뿐 아니라 rerank-disable, candidate-limit validation 같은 downstream policy에서도 명시적으로 보호해야 회귀가 줄어든다

## Notes

- 범위를 너무 넓게 잡으면 short Korean 개선의 장점이 일반 영어 query regression으로 상쇄될 수 있다.
