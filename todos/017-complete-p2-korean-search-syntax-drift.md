---
status: complete
priority: p2
issue_id: "017"
tags: [code-review, search, kiwi, query-syntax, typescript]
dependencies: []
---

# Preserve Korean query syntax semantics on clean shadow search path

## Problem Statement

현재 구현은 Hangul이 포함된 query이고 shadow index health가 clean이면, quoted phrase와 negation을 포함한 query도 모두 `buildKoreanAwareLexQuery()`로 재작성한 뒤 shadow FTS로 보냅니다. 이 때문에 `search`가 브레인스토밍과 plan에서 약속한 “quoted/negated edge case는 보수적으로 current syntax semantics를 우선한다”는 규칙을 실제로 지키지 못합니다.

## Findings

- [`src/commands/owned/search.ts:86`](../src/commands/owned/search.ts) 부근은 Hangul query + clean health 조건만으로 shadow path를 선택합니다.
- [`src/commands/owned/search.ts:95`](../src/commands/owned/search.ts) 는 query syntax 종류와 무관하게 `buildKoreanAwareLexQuery()` 결과를 사용합니다.
- [`src/commands/owned/kiwi_tokenizer.ts:170`](../src/commands/owned/kiwi_tokenizer.ts) 은 raw query 뒤에 analyzed tokens를 단순 append 합니다.
- 이 조합이면 `"형태소 분석"` 같은 exact phrase query나 `-모델` 같은 negation query가 upstream와 다른 MATCH expression으로 바뀔 수 있습니다.
- 현재 테스트는 plain-term compound recall과 stale fallback만 고정하고 있어 quoted/negated Hangul drift를 막지 못합니다.

## Proposed Solutions

### Option 1: Conservative bypass for quoted/negated Hangul queries

**Approach:** query에 quote 또는 negation이 있으면 shadow clean 상태여도 expansion을 건너뛰고 current legacy syntax semantics를 우선합니다.

**Pros:**
- 구현이 가장 작고 위험이 낮습니다
- 현재 plan의 “보수적 fallback” 원칙과 맞습니다

**Cons:**
- quoted/negated Hangul query에서는 recall 개선이 제한됩니다

**Effort:** Small

**Risk:** Low

### Option 2: Token-aware lex query builder

**Approach:** quoted phrase와 negation을 구문 단위로 파싱한 뒤, 각 term/phrase에 대해 Korean-aware expansion을 적용하되 원래 논리 연산을 보존합니다.

**Pros:**
- syntax semantics와 recall 개선을 둘 다 노릴 수 있습니다

**Cons:**
- 구현과 테스트가 더 복잡합니다
- upstream lexical grammar drift를 더 적극적으로 추적해야 합니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Triage 필요. v1 범위에서는 Option 1이 가장 현실적입니다.

## Technical Details

**Affected files:**
- `src/commands/owned/search.ts`
- `src/commands/owned/kiwi_tokenizer.ts`
- `src/commands/owned/search_shadow_index.ts`
- `test/owned-search-behavior.test.ts`
- 신규 query-syntax edge case tests

## Acceptance Criteria

- [x] quoted Hangul query가 current syntax semantics를 유지하거나, 명시된 보수적 fallback path를 탑니다
- [x] negated Hangul query가 self-negating MATCH expression으로 붕괴하지 않습니다
- [x] quoted/negated Hangul query regression tests가 추가됩니다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- Reviewed commit `62728ef`
- Traced clean shadow search path and Korean query expansion branch
- Confirmed tests do not cover quoted/negated Hangul syntax

**Learnings:**
- Korean recall 개선이 query syntax parity보다 먼저 적용되면 user-visible semantic drift가 생길 수 있습니다

### 2026-03-13 - Resolved

**By:** Codex

**Actions:**
- changed clean shadow search path to preserve raw query semantics
- added conservative fallback for quoted/negated Hangul queries
- added command-level regression coverage for quoted Hangul fallback

**Learnings:**
- shadow index quality와 lexical grammar parity는 분리해서 다뤄야 안전합니다
