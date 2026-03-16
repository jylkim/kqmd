---
status: complete
priority: p2
issue_id: "044"
tags: [code-review, cli, help, documentation, regression]
dependencies: []
---

# README가 동작하지 않는 `qmd help` entrypoint를 문서화함

## Problem Statement

README는 `qmd help` 가 upstream 전체 도움말 entrypoint라고 안내하지만, 실제 구현은 bare `help` 를 upstream에 그대로 위임하고 upstream `qmd` 는 `help` 서브커맨드를 지원하지 않습니다. 사용자는 문서를 따라 `qmd help` 를 실행했다가 즉시 `Unknown command: help` 를 보게 됩니다.

## Findings

- [`README.md:45`](../README.md#L45) 는 `qmd --help`, `qmd -h`, `qmd help` 를 모두 upstream 전체 도움말 entrypoint로 설명합니다.
- 실제 구현은 [`src/cli.ts`](../src/cli.ts#L42) 와 [`src/passthrough/delegate.ts`](../src/passthrough/delegate.ts#L26) 기준으로 bare `help` 를 upstream binary에 그대로 넘깁니다.
- `node ./bin/qmd.js help` 와 `node node_modules/@tobilu/qmd/dist/cli/qmd.js help` 를 실행하면 둘 다 `Unknown command: help` 로 종료합니다.
- 현재 테스트는 `qmd help` 단독 경로를 별도로 검증하지 않아, README 회귀를 잡지 못했습니다.

## Proposed Solutions

### Option 1: README에서 `qmd help` 문구를 제거하고 실제 동작하는 entrypoint만 문서화

**Approach:** public docs를 `qmd --help` 와 `qmd -h` 중심으로 줄이고, `qmd help <owned-command>` 처럼 local-owned alias만 별도로 설명합니다.

**Pros:**
- 현재 구현과 가장 빠르게 맞출 수 있습니다
- user-facing 회귀를 즉시 없앱니다

**Cons:**
- bare `help` entrypoint 자체는 여전히 비어 있습니다

**Effort:** Small

**Risk:** Low

---

### Option 2: bare `qmd help` 를 top-level help로 지원하도록 local routing을 추가

**Approach:** `help` 단독 진입 시 upstream full help output과 동등한 행동을 하도록 local shim 또는 passthrough translation을 추가합니다.

**Pros:**
- 문서와 구현이 더 직관적으로 맞습니다
- 사용자가 예상하는 `help` UX를 제공합니다

**Cons:**
- current passthrough boundary와 precedence를 다시 설계해야 할 수 있습니다
- 이번 diff의 범위를 넘어갑니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Option 1로 해결했다. README를 실제 동작에 맞춰 `qmd --help`/`qmd -h`만 top-level help entrypoint로 남기고, bare `qmd help`는 supported top-level alias가 아니라고 명시했다.

## Technical Details

**Affected files:**
- `README.md`
- `src/cli.ts`
- `src/passthrough/delegate.ts`
- optional smoke/help tests

## Resources

- Repro command: `node ./bin/qmd.js help`
- Upstream repro: `node node_modules/@tobilu/qmd/dist/cli/qmd.js help`

## Acceptance Criteria

- [x] public docs가 실제 지원되는 top-level help entrypoint만 설명한다
- [x] `qmd help` 단독 경로를 지원할지 여부가 문서와 테스트에 명확히 반영된다
- [x] help smoke or routing coverage가 bare `qmd help` 경로를 포함한다

## Work Log

### 2026-03-16 - Initial Discovery

**By:** Codex

**Actions:**
- Reviewed README help-behavior wording in the current diff
- Reproduced `node ./bin/qmd.js help`
- Compared local and installed upstream `help` behavior
- Confirmed docs currently promise a broken entrypoint

**Learnings:**
- help behavior는 small wording change로도 즉시 user-facing regression이 될 수 있다
- top-level help alias는 owned help alias와 별개로 smoke coverage가 필요하다

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Updated [`README.md`](../README.md) so top-level help documents only `qmd --help` and `qmd -h`
- Added an explicit note that bare `qmd help` is a passthrough path and not a supported top-level help alias
- Added published-bin smoke coverage for bare `help` passthrough in [`test/bin-smoke.test.ts`](../test/bin-smoke.test.ts)
- Verified `node ./bin/qmd.js help` still fails with upstream behavior and does not silently rewrite to `--help`
- Ran `bun run test -- test/bin-smoke.test.ts`

**Learnings:**
- documentation regressions around help entrypoints are easiest to prevent with a bin-level smoke test
