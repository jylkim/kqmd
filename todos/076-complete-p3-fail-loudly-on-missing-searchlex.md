---
status: complete
priority: p3
issue_id: "076"
tags: [code-review, compatibility, query, search]
dependencies: []
---

# Fail loudly when lexical probe cannot access searchLex

## Problem Statement

현재 lexical probe는 `searchLex`가 없으면 빈 결과(`[]`)를 성공처럼 반환합니다. 테스트 더블에서는 편하지만, 실제 compatibility seam이 깨졌을 때도 “조용한 no results”로 보일 수 있어 원인 파악을 어렵게 만듭니다.

## Findings

- [`src/commands/owned/query_lexical_candidates.ts:127`](../src/commands/owned/query_lexical_candidates.ts#L127) 에서 `typeof store.searchLex === 'function'`이 아니면 그대로 `[]`를 반환합니다.
- 이 값은 `query`에서는 lexical signal `'none'`으로 이어져 execution planning까지 바꿀 수 있습니다.
- `search` command도 같은 helper를 공유하므로 broken seam이 silent success로 보일 수 있습니다.

## Proposed Solutions

### Option 1: Throw explicit runtime error

**Approach:** production helper에서는 `searchLex`가 없으면 명시적으로 실패하고, 테스트가 필요하면 별도 mock helper/dependency를 주입합니다.

**Pros:**
- compatibility seam breakage를 빨리 발견할 수 있습니다.
- user-visible no-results와 runtime failure를 구분할 수 있습니다.

**Cons:**
- 현재 lightweight test doubles를 일부 손봐야 합니다.

**Effort:** Small

**Risk:** Low

---

### Option 2: Keep fallback but mark it as diagnostic-only

**Approach:** 빈 결과 대신 warning/advisory를 남겨 silent success를 피합니다.

**Pros:**
- 테스트는 유지하면서도 실패를 숨기지 않습니다.

**Cons:**
- production path에서 여전히 degraded mode가 남습니다.

**Effort:** Small

**Risk:** Medium

## Recommended Action

`searchLex`가 없는 lexical fallback path는 silent empty success 대신 명시적 failure를 발생시키고, `search` command가 이를 owned execution failure로 surface하도록 정리했다.

## Technical Details

**Affected files:**
- [`src/commands/owned/query_lexical_candidates.ts`](../src/commands/owned/query_lexical_candidates.ts)
- [`src/commands/owned/search.ts`](../src/commands/owned/search.ts)
- 관련 test doubles in [`test/query-core.test.ts`](../test/query-core.test.ts)

## Resources

- Review finding: kieran-typescript-reviewer
- Related architecture: [`docs/architecture/upstream-compatibility-policy.md`](../docs/architecture/upstream-compatibility-policy.md)

## Acceptance Criteria

- [x] `searchLex` seam이 깨지면 silent empty success 대신 명시적 failure 또는 진단 신호가 발생한다
- [x] query planning이 broken seam 때문에 조용히 `'none'` signal로 내려가지 않는다
- [x] 관련 tests가 failure mode를 고정한다

## Work Log

### 2026-03-25 - Code Review Finding

**By:** Codex

**Actions:**
- lexical probe helper의 `searchLex` fallback 분기를 검토했습니다.
- helper 공유 범위가 `search`와 `query` 모두에 걸치는지 확인했습니다.

**Learnings:**
- compatibility seam은 테스트 편의를 위해 묵살하기보다 명시적으로 실패시키는 편이 이후 drift를 빨리 드러냅니다.

### 2026-03-25 - Resolved

**By:** Codex

**Actions:**
- lexical probe helper가 `searchLex` 부재 시 명시적 예외를 던지도록 변경했습니다.
- `search` command는 이를 owned execution failure로 변환하도록 보강했습니다.
- lexical probe/search behavior 회귀 테스트를 추가하고 최종 `bun run release:verify`까지 통과시켰습니다.

**Learnings:**
- compatibility seam failure를 숨기지 않도록 바꾸면 테스트 더블도 더 실제 runtime contract에 가까워집니다.

## Notes

- low-priority이지만 upstream compatibility 원칙에는 맞지 않는 동작입니다.
