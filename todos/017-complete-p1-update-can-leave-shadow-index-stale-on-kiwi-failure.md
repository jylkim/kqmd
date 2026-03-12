---
status: complete
priority: p1
issue_id: "017"
tags: [code-review, search, kiwi, sqlite, consistency, update]
dependencies: []
---

# Prevent partial update when Kiwi bootstrap fails

## Problem Statement

`qmd update`가 upstream 문서 스캔을 먼저 수행한 뒤 Kiwi shadow index rebuild를 실행합니다. 그래서 Kiwi wasm/model bootstrap이나 shadow rebuild가 그 다음 단계에서 실패하면, 문서 DB는 이미 갱신됐지만 `kqmd_documents_fts`는 stale 상태로 남을 수 있습니다.

이 경우 command는 실패로 끝나더라도 저장소는 이미 부분적으로 변한 상태가 됩니다. 첫 릴리스 계획이 명시적으로 피하려던 partial-state risk가 그대로 남아 있습니다.

## Findings

- [`src/commands/owned/update.ts:63`](/Users/jylkim/kqmd/src/commands/owned/update.ts#L63) 에서 `session.store.update()`가 먼저 실행됩니다.
- Kiwi/model bootstrap과 shadow rebuild는 그 다음 [`src/commands/owned/update.ts:66`](/Users/jylkim/kqmd/src/commands/owned/update.ts#L66) 부터 수행됩니다.
- [`src/commands/owned/kiwi_tokenizer.ts:74`](/Users/jylkim/kqmd/src/commands/owned/kiwi_tokenizer.ts#L74)~[`src/commands/owned/kiwi_tokenizer.ts:87`](/Users/jylkim/kqmd/src/commands/owned/kiwi_tokenizer.ts#L87) 는 네트워크 다운로드와 파일 write를 동반하므로, 여기서 실패하면 update 이후 단계에서 터질 수 있습니다.
- `rebuildSearchShadowIndex()` 내부 transaction은 shadow table + metadata만 묶고, 이미 끝난 upstream `store.update()`까지 되돌리지는 못합니다.

## Proposed Solutions

### Option 1: Preflight Kiwi bootstrap before `store.update()`

**Approach:** `update` 진입 시점에 Kiwi wasm/model bootstrap을 먼저 검증하고, 준비가 안 되면 `store.update()`를 호출하기 전에 실패시킵니다.

**Pros:**
- partial-state risk를 가장 작게 줄입니다
- plan의 "preflight로 failure를 최대한 앞당긴다" 방향과 맞습니다

**Cons:**
- 첫 update latency가 조금 늘 수 있습니다

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Post-failure remediation marker

**Approach:** 지금 구조를 유지하되, shadow rebuild 실패 시 `store_config`에 explicit failure marker를 남기고 `status/search`가 이를 강하게 surface 하도록 만듭니다.

**Pros:**
- 구조 변경이 작습니다

**Cons:**
- partial state 자체는 여전히 발생합니다
- 사용자가 recovery를 수동으로 해야 합니다

**Effort:** 2-3 hours

**Risk:** Medium

## Recommended Action

## Technical Details

**Affected files:**
- `src/commands/owned/update.ts`
- `src/commands/owned/kiwi_tokenizer.ts`
- `src/commands/owned/search_shadow_index.ts`
- `test/search-shadow-index.test.ts`

## Resources

- Commit under review: `62728ef`
- Plan: `docs/plans/2026-03-12-feat-kiwi-korean-search-recall-plan.md`

## Acceptance Criteria

- [x] `qmd update`는 Kiwi/model bootstrap failure를 `store.update()` 이전에 감지하거나, 같은 수준의 preflight guard를 가진다
- [x] Kiwi bootstrap failure 시 문서 DB와 shadow index가 서로 다른 세대에 머무는 partial state가 남지 않는다
- [x] 실패 시 recovery guidance가 user-visible하게 제공된다
- [x] regression test가 추가된다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- Reviewed commit `62728ef`
- Traced `update -> store.update() -> rebuildSearchShadowIndex()` ordering
- Flagged partial-state risk caused by post-update Kiwi/bootstrap failure

**Learnings:**
- shadow table transaction은 local table consistency만 보장하고, 이미 수행된 upstream update까지 롤백하지는 못합니다

### 2026-03-13 - Resolved

**By:** Codex

**Actions:**
- added Kiwi preflight in `update` before `session.store.update()`
- added regression coverage ensuring bootstrap failure prevents upstream update from running
- verified full quality gate with `npm run check`

**Learnings:**
- shadow rebuild correctness alone is not enough when upstream mutation can happen earlier
