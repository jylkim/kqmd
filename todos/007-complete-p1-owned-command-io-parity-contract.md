---
status: complete
priority: p1
issue_id: "007"
tags: [typescript, cli, parity, qmd, testing]
dependencies: []
---

# Add owned command I/O parity contract

## Problem Statement

`search`, `query`, `update`, `embed`가 현재 모두 scaffold stub라서, upstream `qmd`와 동일한 입력/출력 계약을 공유하지 못하고 있다. 이 상태로 실제 기능을 붙이면 command별 option parsing, validation, stdout/stderr, exit code가 쉽게 drift한다.

## Findings

- `src/cli.ts`는 많은 CLI 옵션을 알고 있지만 owned handler에는 `commandArgs`와 `indexName`만 전달한다.
- upstream `@tobilu/qmd@2.0.1` CLI는 `util.parseArgs({ strict: false })`, format precedence, usage errors, empty-result output을 이미 명확히 정의하고 있다.
- 기존 학습 문서상 CLI contract는 deterministic test로 고정해야 하고, private upstream path import는 피하는 편이 안전하다.

## Proposed Solutions

### Option 1: Full owned I/O parity contract

**Approach:** `search/query/update/embed` 전체에 공통 parse/validation/output contract를 만들고 실제 handler에 연결한다. `search/query`는 success snapshot까지, `update/embed`는 success shape까지만 우선 고정한다.

**Pros:**
- 네 command가 같은 CLI 계약 위에 올라간다
- 실제 handler 경로가 바로 표준화된다
- upstream version bump 검증 프로세스를 같이 만들 수 있다

**Cons:**
- 한 번에 다루는 범위가 작지 않다

**Effort:** 1-2 sessions

**Risk:** Medium

---

### Option 2: Parser-only foundation

**Approach:** parse/validation 모듈만 먼저 만들고 handler 연결은 나중에 한다.

**Pros:**
- 초기 구현량이 적다

**Cons:**
- 실제 drift를 막는 효과가 약하다
- 사용자-facing contract가 아직 고정되지 않는다

**Effort:** Short

**Risk:** Medium

## Recommended Action

Option 1로 진행한다. 공통 I/O contract를 실제 handler 경로에 연결하고, parity tests와 upstream version guard까지 같이 추가한다.

## Technical Details

**Affected areas:**
- `src/cli.ts`
- `src/commands/owned/io/*`
- `src/commands/owned/search.ts`
- `src/commands/owned/query.ts`
- `src/commands/owned/update.ts`
- `src/commands/owned/embed.ts`
- `test/owned-command-parity/*`
- `docs/development.md`
- `docs/architecture/upstream-compatibility-policy.md`

## Resources

- `docs/plans/2026-03-11-feat-owned-command-io-parity-contract-plan.md`
- `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`
- `docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`
- `docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md`

## Acceptance Criteria

- [x] `search/query/update/embed` typed parse contract가 추가된다
- [x] 공통 validation/error adapter가 추가된다
- [x] 네 owned handler가 공통 contract를 실제로 사용한다
- [x] `search/query` success snapshot 및 empty-result tests가 추가된다
- [x] `update/embed` success shape tests가 추가된다
- [x] upstream version guard와 `test:parity` script가 추가된다
- [x] 관련 plan 체크박스와 work log가 업데이트된다

## Work Log

### 2026-03-12 - Work Start

**By:** Codex

**Actions:**
- Re-read the plan, architecture docs, runtime module, and current owned command stubs
- Confirmed explicit user approval to continue on `main`
- Prepared implementation order around contract foundation, handler rewiring, parity tests, and version bump workflow

**Learnings:**
- The highest-value change is to move owned commands onto a shared I/O contract path, not to add product behavior first
- Upstream formatter semantics are useful reference material, but private `dist/cli/*` imports should stay out of the implementation

### 2026-03-12 - Contract Implemented

**By:** Codex

**Actions:**
- Added shared owned-command I/O modules for parse, validation, errors, and output formatting
- Rewired `search`, `query`, `update`, and `embed` to use the shared contract and runtime path
- Added parity tests for parse, validation, success snapshots, mutation summaries, and upstream version guard
- Added `npm run test:parity` and updated README/development/architecture docs to describe the new baseline
- Ran `npm run typecheck`, `npm run test:parity`, `npm run test`, and `npm run lint`

**Learnings:**
- `util.parseArgs()` plus local adapters is enough to mirror most upstream CLI semantics without importing private CLI internals
- File snapshots work well for CLI parity as long as newline and `NO_COLOR` behavior are fixed explicitly
