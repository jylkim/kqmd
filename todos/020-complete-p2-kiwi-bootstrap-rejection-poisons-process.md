---
status: complete
priority: p2
issue_id: "020"
tags: [code-review, reliability, kiwi, runtime, mcp, typescript]
dependencies: []
---

# Clear rejected Kiwi bootstrap state after transient failures

## Problem Statement

현재 Kiwi bootstrap는 module-level `kiwiPromise` 하나에 첫 초기화 결과를 캐시합니다. 그런데 첫 초기화가 실패하면 rejected promise가 그대로 남아, 같은 process 안의 이후 Hangul `search/update`가 모두 재시도 없이 계속 실패합니다. CLI 한 번 실행에서는 덜 치명적이지만, 장시간 살아 있는 MCP/agent process에서는 durable failure가 됩니다.

## Findings

- [`src/commands/owned/kiwi_tokenizer.ts:40`](../src/commands/owned/kiwi_tokenizer.ts) 는 `kiwiPromise`를 module-level singleton으로 둡니다.
- [`src/commands/owned/kiwi_tokenizer.ts:146`](../src/commands/owned/kiwi_tokenizer.ts) 는 promise가 없을 때만 `createKiwi()`를 호출합니다.
- 첫 `createKiwi()`가 network/cache/bootstrap 문제로 reject 되면, 이후 호출도 같은 rejected promise를 그대로 await 합니다.
- 현재 테스트는 successful singleton reuse만 간접적으로 검증하고, first-run failure 후 retry recovery는 고정하지 않습니다.

## Proposed Solutions

### Option 1: Reset cached promise on failure

**Approach:** `createKiwi()`가 reject 되면 catch/finally에서 `kiwiPromise = undefined`로 되돌려 다음 호출이 재시도할 수 있게 만듭니다.

**Pros:**
- 수정 범위가 가장 작습니다
- transient network/cache failure에서 자동 회복 가능합니다

**Cons:**
- 반복 실패 시 매 호출마다 재시도할 수 있습니다

**Effort:** Small

**Risk:** Low

### Option 2: Cache success/failure separately with cooldown

**Approach:** 마지막 failure timestamp와 error를 저장해 일정 시간 내에는 동일 오류를 바로 재시도하지 않게 합니다.

**Pros:**
- failure storm를 줄일 수 있습니다

**Cons:**
- 구현 복잡도가 더 커집니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Triage 필요. 현재 구조에서는 Option 1이 우선입니다.

## Technical Details

**Affected files:**
- `src/commands/owned/kiwi_tokenizer.ts`
- Kiwi bootstrap tests

## Acceptance Criteria

- [x] first-run Kiwi bootstrap failure 후 같은 process에서 subsequent call이 재시도할 수 있습니다
- [x] repeated success path의 singleton behavior는 유지됩니다
- [x] failure then success recovery test가 추가됩니다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- Reviewed commit `62728ef`
- Traced the singleton bootstrap path around `kiwiPromise`
- Confirmed rejected promise caching is never cleared

**Learnings:**
- long-lived process에서는 “transient first-run failure”가 곧 durable feature outage가 될 수 있습니다

### 2026-03-13 - Resolved

**By:** Codex

**Actions:**
- changed Kiwi singleton bootstrap to clear rejected promise state on failure
- added retry-focused unit coverage to prove a later call can recover

**Learnings:**
- singleton caches need explicit rejected-state handling in any semi-persistent runtime
