---
status: complete
priority: p3
issue_id: "019"
tags: [code-review, tests, search, typescript, quality]
dependencies: []
---

# Add command-level coverage for clean Hangul shadow search path

## Problem Statement

새 테스트는 helper 레벨 shadow rebuild/query와 stale fallback warning은 커버하지만, 실제 `handleSearchCommand()`가 clean shadow health + Hangul query + query expansion + shadow query helper branch를 끝까지 타는 케이스는 아직 없습니다.

그래서 command-level wiring regressions가 생겨도 helper 테스트와 fallback 테스트가 모두 녹색일 수 있습니다.

## Findings

- helper 통합 테스트는 [`test/search-shadow-index.test.ts`](/Users/jylkim/kqmd/test/search-shadow-index.test.ts#L41) 에서 shadow rebuild/query 자체만 검증합니다.
- fallback warning은 [`test/owned-search-behavior.test.ts`](/Users/jylkim/kqmd/test/owned-search-behavior.test.ts#L66) 에서 stale path만 검증합니다.
- 실제 clean branch는 [`src/commands/owned/search.ts:91`](/Users/jylkim/kqmd/src/commands/owned/search.ts#L91)~[`src/commands/owned/search.ts:100`](/Users/jylkim/kqmd/src/commands/owned/search.ts#L100) 에 있지만, 이 분기를 직접 고정하는 test는 없습니다.

## Proposed Solutions

### Option 1: Add a command-level clean-path test with fake Kiwi dependencies

**Approach:** `handleSearchCommand()`에 clean health를 주는 fake store와 fake Kiwi builder deps를 주입해, shadow query branch가 실제로 실행되는지 검증합니다.

**Pros:**
- wiring regression을 가장 직접적으로 잡습니다
- 네트워크/실제 wasm 없이도 deterministic 합니다

**Cons:**
- test harness가 조금 복잡해집니다

**Effort:** 1 hour

**Risk:** Low

## Recommended Action

## Technical Details

**Affected files:**
- `test/owned-search-behavior.test.ts`
- `src/commands/owned/search.ts`
- `src/commands/owned/kiwi_tokenizer.ts`

## Resources

- Commit under review: `62728ef`

## Acceptance Criteria

- [x] clean shadow health + Hangul query branch를 직접 실행하는 command-level test가 추가된다
- [x] 해당 test는 stdout shape와 no-warning expectation을 함께 검증한다
- [x] 네트워크와 실제 Kiwi model download 없이 deterministic 하게 실행된다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- Compared helper tests and command-level tests for the new shadow search flow
- Identified missing direct coverage for the clean Hangul branch in `handleSearchCommand()`

**Learnings:**
- helper coverage와 command wiring coverage는 이 feature에서 서로 대체되지 않습니다

### 2026-03-13 - Resolved

**By:** Codex

**Actions:**
- added command-level tests for clean Hangul shadow path and quoted Hangul fallback
- verified stdout/stderr expectations and legacy-vs-shadow routing without real network/bootstrap

**Learnings:**
- this feature needs both helper integration tests and command wiring tests
