---
status: complete
priority: p1
issue_id: "004"
tags: [typescript, cli, runtime, qmd]
dependencies: []
---

# Add owned command runtime bootstrap

## Problem Statement

`search`, `query`, `update`, `embed`가 모두 scaffold stub로만 남아 있어서, 이후 실제 기능을 붙일 때마다 path, config, DB, store lifecycle, error policy를 다시 구현해야 한다.

특히 upstream `@tobilu/qmd`의 `createStore()`는 DB open과 schema initialization을 즉시 수행하므로, K-QMD가 DB-only reopen을 잘못 해석하면 기존 index 재오픈이 아니라 빈 DB 생성으로 흘러갈 수 있다.

## Findings

- `src/config/qmd_paths.ts`가 upstream-compatible config / DB 경로 규칙을 이미 제공한다.
- `src/types/command.ts`의 `CommandExecutionContext`는 `indexName`을 이미 담고 있어 runtime seam에 필요한 최소 정보는 있다.
- owned command는 현재 전부 fixed stderr stub이다: `src/commands/owned/search.ts`, `src/commands/owned/query.ts`, `src/commands/owned/update.ts`, `src/commands/owned/embed.ts`.
- upstream `createStore()`는 `configPath` 또는 DB-only mode를 지원하지만, 내부 구현상 store open 전에 preflight가 필요하다.

## Proposed Solutions

### Option 1: Runtime module + direct tests

**Approach:** `src/commands/owned/runtime.ts`를 추가해 policy resolution, store bootstrap, common error classification을 담당하게 하고, `test/owned-runtime.test.ts`로 직접 검증한다.

**Pros:**
- 네 command가 공유할 기반이 생긴다
- future handler 구현 전에 policy drift를 테스트로 고정할 수 있다
- current stub를 건드리지 않아 scope가 작다

**Cons:**
- 지금 당장은 사용자-visible behavior 변화가 없다

**Effort:** 1 session

**Risk:** Low

---

### Option 2: Search handler까지 바로 연결

**Approach:** runtime을 만들면서 `search`도 즉시 그 runtime을 사용하게 바꾼다.

**Pros:**
- 바로 runtime 소비자가 생긴다

**Cons:**
- 아직 실제 결과 UX가 없는데 DB IO만 추가된다
- current stub behavior가 흐려진다

**Effort:** 1-2 sessions

**Risk:** Medium

## Recommended Action

Option 1로 진행한다. runtime module, direct tests, architecture docs를 먼저 추가하고, current stub handler는 그대로 유지한다.

## Technical Details

**Affected files:**
- `src/commands/owned/runtime.ts`
- `test/owned-runtime.test.ts`
- `docs/architecture/kqmd-command-boundary.md`
- `docs/architecture/upstream-compatibility-policy.md`
- `docs/plans/2026-03-11-feat-owned-command-runtime-bootstrap-plan.md`

## Resources

- `docs/plans/2026-03-11-feat-owned-command-runtime-bootstrap-plan.md`
- `docs/brainstorms/2026-03-11-owned-command-runtime-brainstorm.md`
- `node_modules/@tobilu/qmd/dist/index.js`
- `node_modules/@tobilu/qmd/dist/index.d.ts`

## Acceptance Criteria

- [x] Shared owned runtime module is added
- [x] Runtime policy covers `search`, `query`, `update`, `embed`
- [x] DB-only reopen only happens when DB exists
- [x] Common runtime failures are limited to `config-missing` and `store-open-failed`
- [x] Direct runtime tests cover policy, failure wrapping, and store close behavior
- [x] Architecture docs are updated
- [x] Plan checkboxes are updated as work completes

## Work Log

### 2026-03-11 - Work Start

**By:** Codex

**Actions:**
- Read the plan and deepen-plan output
- Created feature branch `feat/owned-runtime-bootstrap`
- Chose runtime-only implementation scope without wiring current stubs

**Learnings:**
- Existing repo already has path compatibility primitives, so this slice can stay focused on runtime policy and lifecycle

### 2026-03-11 - Runtime Implemented

**By:** Codex

**Actions:**
- Added `src/commands/owned/runtime.ts` with policy resolution, preflight path checks, store session opening, and lifecycle wrapper
- Added `test/owned-runtime.test.ts` covering config-file mode, DB-only reopen, `config-missing`, `store-open-failed`, and guaranteed close behavior
- Updated `docs/architecture/kqmd-command-boundary.md` and `docs/architecture/upstream-compatibility-policy.md` with owned runtime and DB-only reopen guardrails
- Updated the plan status and acceptance criteria after implementation
- Ran `npm run check`

**Learnings:**
- `resolveOwnedRuntimePlan()` should return only preflight outcomes; `store-open-failed` belongs to the open phase, not the resolver phase
- Using injected dependencies keeps runtime tests deterministic and avoids coupling tests to real store/model initialization
