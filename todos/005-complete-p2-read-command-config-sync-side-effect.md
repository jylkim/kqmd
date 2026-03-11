---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, architecture, runtime, qmd]
dependencies: []
---

# Read commands sync config into shared DB state on open

## Problem Statement

현재 owned runtime은 `search`와 `query`에서 config 파일이 존재하면 항상 `config-file` mode를 선택한다. 그런데 upstream `createStore({ configPath })`는 open 시점에 `syncConfigToDb()`를 호출해 `store_collections`와 관련 metadata를 갱신한다.

그 결과 read-only여야 할 command open이 shared upstream DB 상태를 조용히 변경할 수 있다. 이는 현재 아키텍처 문서의 “owned 명령은 실제 구현 전까지 shared upstream 상태를 바꾸지 않는다”는 가드레일과도 충돌한다.

## Findings

- `src/commands/owned/runtime.ts:100-104`에서 `search/query`는 config가 있으면 무조건 `config-file` mode를 선택한다.
- upstream `node_modules/@tobilu/qmd/dist/index.js:65-70`은 `configPath`가 주어지면 `syncConfigToDb()`로 DB metadata를 갱신한다.
- `docs/architecture/kqmd-command-boundary.md:42`는 owned command가 shared upstream 상태를 바꾸지 않아야 한다는 가드레일을 적고 있다.
- 따라서 runtime의 현재 read-path open policy는 문서화된 경계와 실제 upstream side effect가 어긋나는 상태다.

## Proposed Solutions

### Option 1: Prefer DB-only reopen for read commands when DB exists

**Approach:** `search/query`는 DB가 이미 있으면 config 파일이 있어도 DB-only reopen을 우선한다. config는 DB가 아직 없을 때만 bootstrap 용도로 사용한다.

**Pros:**
- read path의 side effect를 줄일 수 있다
- “기존 index reopen” 의미가 더 명확해진다
- 현재 문서 가드레일과 더 잘 맞는다

**Cons:**
- config 변경 사항이 read command open 시점에는 자동 반영되지 않는다

**Effort:** Small

**Risk:** Low

---

### Option 2: Keep config-file mode but explicitly document read-path mutation

**Approach:** 현재 policy를 유지하되, read command open이 metadata sync를 수행할 수 있음을 문서와 plan에 명시한다.

**Pros:**
- 구현 변경이 없다
- upstream behavior와 더 직접적으로 맞춘다

**Cons:**
- read command가 사실상 write side effect를 갖게 된다
- K-QMD가 세운 command boundary 설명과 어긋난다

**Effort:** Small

**Risk:** Medium

## Recommended Action

`search/query`는 기존 DB가 있을 때 `config-file` mode보다 DB-only reopen을 우선하도록 바꾼다. config-file mode는 DB가 아직 없는 bootstrap 상황에서만 사용한다. 관련 architecture 문서도 같은 정책으로 갱신한다.

## Technical Details

**Affected files:**
- `src/commands/owned/runtime.ts:100-104`
- `node_modules/@tobilu/qmd/dist/index.js:65-70`
- `docs/architecture/kqmd-command-boundary.md:42`

**Related components:**
- owned runtime bootstrap policy
- upstream store metadata sync behavior
- search/query future consumers

## Resources

- Review target branch: `feat/owned-runtime-bootstrap`
- Review target commit: `b5c96a0`
- Plan: `docs/plans/2026-03-11-feat-owned-command-runtime-bootstrap-plan.md`

## Acceptance Criteria

- [x] A clear policy exists for whether read commands may sync config into DB state
- [x] Runtime implementation matches that policy
- [x] Architecture docs no longer contradict runtime behavior
- [x] Tests cover the chosen precedence between config-file mode and DB-only reopen for read commands

## Work Log

### 2026-03-11 - Code Review Finding

**By:** Codex

**Actions:**
- Reviewed owned runtime mode selection for `search/query`
- Cross-checked current policy against upstream `createStore()` side effects
- Compared behavior with local architecture guardrails

**Learnings:**
- Upstream config-file mode is not read-only; it synchronizes config into the SQLite store on open
- Read-path mode precedence needs an explicit product decision, not just a convenience default

### 2026-03-11 - Todo Resolved

**By:** Codex

**Actions:**
- Changed `src/commands/owned/runtime.ts` so `search/query` prefer DB-only reopen when an existing DB is present, even if config also exists
- Added regression coverage in `test/owned-runtime.test.ts` for the “config and DB both exist” case
- Updated `docs/architecture/kqmd-command-boundary.md` and `docs/architecture/upstream-compatibility-policy.md` to describe the new precedence rule
- Re-ran `npm run check`

**Learnings:**
- For read commands, “existing DB first” is the cleanest way to avoid unexpected metadata sync side effects without removing bootstrap capability entirely
