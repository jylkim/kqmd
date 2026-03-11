---
status: complete
priority: p2
issue_id: "006"
tags: [code-review, quality, runtime, reliability]
dependencies: []
---

# withOwnedStore can double-close and mask callback failures

## Problem Statement

`withOwnedStore()`는 callback에 `session.close()`가 노출된 session을 전달하면서, 바깥 `finally`에서도 무조건 `session.close()`를 다시 호출한다. 이 구조에서는 callback이 먼저 `session.close()`를 호출한 경우 double-close가 발생할 수 있고, callback error와 close error가 동시에 발생하면 close error가 원래 실패 원인을 덮어쓸 수 있다.

runtime의 첫 실제 consumer가 붙으면 이 문제는 flaky failure나 misleading error reporting으로 이어질 수 있다.

## Findings

- `src/commands/owned/runtime.ts:45-48`에서 `OwnedStoreSession`은 public `close()`를 노출한다.
- `src/commands/owned/runtime.ts:202-205`에서 `withOwnedStore()`는 callback 결과와 무관하게 `finally`에서 `session.close()`를 호출한다.
- upstream `node_modules/@tobilu/qmd/dist/index.js:220-225`의 `close()`는 LLM dispose, DB close, config source reset까지 수행하는 lifecycle operation이다.
- 현재 테스트는 callback throw 시 close가 호출되는 것은 검증하지만, callback 내부에서 먼저 close한 뒤 `finally`가 다시 close하는 케이스는 다루지 않는다.

## Proposed Solutions

### Option 1: Make `withOwnedStore()` own close exclusively

**Approach:** `withOwnedStore()` callback에 전달하는 session에서는 `close()`를 숨기거나, internal session과 public session을 분리한다.

**Pros:**
- lifecycle 책임이 하나의 레이어에만 남는다
- consumer misuse 가능성이 줄어든다

**Cons:**
- `openOwnedStoreSession()`과 `withOwnedStore()`가 서로 다른 session shape를 갖게 될 수 있다

**Effort:** Medium

**Risk:** Low

---

### Option 2: Keep `close()` public but make it idempotent

**Approach:** session close wrapper 안에 guard를 둬서 첫 호출 이후에는 no-op으로 처리한다. callback error가 있으면 close error가 원래 예외를 덮어쓰지 않도록 별도 처리한다.

**Pros:**
- API shape를 크게 바꾸지 않는다
- double-close를 방지할 수 있다

**Cons:**
- lifecycle wrapper가 조금 더 복잡해진다
- close failure 처리 정책을 추가로 정해야 한다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

`withOwnedStore()`가 lifecycle을 전적으로 소유하도록 바꾼다. callback에는 `close()`가 없는 context만 전달하고, callback 실패 후 close도 실패하는 경우에는 원래 callback error를 보존한다. 관련 테스트를 추가해 manual close ambiguity와 error masking 리스크를 막는다.

## Technical Details

**Affected files:**
- `src/commands/owned/runtime.ts:45-48`
- `src/commands/owned/runtime.ts:202-205`
- `test/owned-runtime.test.ts`
- `node_modules/@tobilu/qmd/dist/index.js:220-225`

**Related components:**
- owned runtime lifecycle wrapper
- future search/query consumers
- error reporting and cleanup behavior

## Resources

- Review target branch: `feat/owned-runtime-bootstrap`
- Review target commit: `b5c96a0`
- Plan: `docs/plans/2026-03-11-feat-owned-command-runtime-bootstrap-plan.md`

## Acceptance Criteria

- [x] `withOwnedStore()` lifecycle ownership is unambiguous
- [x] Callback code cannot accidentally trigger harmful double-close behavior
- [x] If callback logic throws, cleanup does not obscure the original failure cause
- [x] Tests cover manual close inside callback or explicitly prevent that usage

## Work Log

### 2026-03-11 - Code Review Finding

**By:** Codex

**Actions:**
- Reviewed runtime session shape and lifecycle wrapper behavior
- Traced cleanup flow through callback path and upstream `close()` implementation
- Checked existing tests for manual close / error masking coverage

**Learnings:**
- Exposing `close()` on a callback-owned object while also auto-closing in `finally` creates avoidable API ambiguity
- Cleanup code needs an explicit policy for preserving primary failures when both work and teardown fail

### 2026-03-11 - Todo Resolved

**By:** Codex

**Actions:**
- Added `OwnedStoreContext` and changed `withOwnedStore()` to pass a callback session without `close()`
- Changed cleanup flow so callback errors are preserved even if close also fails
- Added tests to verify callback context has no `close()` and that callback failures survive close failures
- Re-ran `npm run check`

**Learnings:**
- Hiding lifecycle methods from callback consumers is simpler than trying to make a shared public `close()` API safe in both manual and automatic modes
