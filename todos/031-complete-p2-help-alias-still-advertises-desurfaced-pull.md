---
status: complete
priority: p2
issue_id: "031"
tags: [code-review, cli, help, contract, routing, typescript]
dependencies: []
---

# `qmd help <owned-command>` still bypasses the local help contract

## Problem Statement

이번 변경은 `qmd <owned-command> --help`를 로컬 help로 바꿔 `update --pull`를 de-surface 했지만, `qmd help update` 같은 help alias 진입점은 여전히 upstream passthrough를 탑니다. 따라서 사용자는 alias 경로에서 de-surfaced option을 다시 보게 되고, help surface contract가 entrypoint에 따라 달라집니다.

## Findings

- [`src/cli.ts:40`](../src/cli.ts)~[`src/cli.ts:45`](../src/cli.ts) 는 `values.help`가 있는 경우에만 owned command help를 로컬 route로 바꿉니다.
- 반면 [`src/commands/manifest.ts:22`](../src/commands/manifest.ts)~[`src/commands/manifest.ts:38`](../src/commands/manifest.ts) 는 `help` alias를 unconditional passthrough로 처리합니다.
- 이 구조에서는 `qmd update --help`는 local help를 보지만, `qmd help update`는 upstream help를 보고 `--pull`를 다시 보게 됩니다.

## Proposed Solutions

### Option 1: help alias도 owned command에는 local help로 라우팅

**Approach:** `qmd help <owned-command>`를 `qmd <owned-command> --help`와 같은 local help contract로 보냅니다.

**Pros:**
- help surface가 entrypoint에 관계없이 일관됩니다
- de-surfaced option leak를 막을 수 있습니다

**Cons:**
- top-level help routing 규칙을 조금 더 복잡하게 만듭니다

**Effort:** Small

**Risk:** Low

### Option 2: help alias는 유지하되 README/dev docs에서 only `--help` path만 주장

**Approach:** `qmd help <owned-command>`는 supported surface로 보지 않고 문서에서 제외합니다.

**Pros:**
- routing 변경이 작습니다

**Cons:**
- 실제 사용자는 여전히 alias로 contract drift를 볼 수 있습니다
- release-readiness 기준상 덜 정직합니다

**Effort:** Small

**Risk:** Medium

## Recommended Action

Option 1로 해결했다. `qmd help <owned-command>`도 local owned help contract로 라우팅해, `qmd update --help`와 `qmd help update`가 같은 de-surfaced help surface를 보여 주도록 맞췄다.

## Technical Details

**Affected files:**
- `src/cli.ts`
- `src/commands/manifest.ts`
- help/routing tests
- docs that describe supported help entrypoints

## Acceptance Criteria

- [x] `qmd <owned-command> --help`와 `qmd help <owned-command>`가 같은 support surface를 보여 준다
- [x] de-surfaced options가 help alias 경로에서도 다시 노출되지 않는다
- [x] routing/help tests가 alias entrypoint까지 포함한다

## Work Log

### 2026-03-13 - Review Finding

**By:** Codex

**Actions:**
- Reviewed CLI routing changes in the latest release-readiness commit
- Compared `--help` flag handling against `help` alias routing
- Confirmed that the alias path still goes to upstream passthrough

**Learnings:**
- closing a CLI help contract requires auditing every help entrypoint, not only `--help`

### 2026-03-13 - Todo Resolved

**By:** Codex

**Actions:**
- Added `isHelpAlias()` helper in [`src/commands/manifest.ts`](../src/commands/manifest.ts)
- Routed `qmd help <owned-command>` to owned help in [`src/cli.ts`](../src/cli.ts)
- Added routing coverage for help alias in [`test/cli-routing.test.ts`](../test/cli-routing.test.ts)
- Added snapshot coverage for `qmd help update` in [`test/owned-command-parity/help-output.test.ts`](../test/owned-command-parity/help-output.test.ts)
- Ran `bun run test -- test/cli-routing.test.ts test/owned-command-parity/help-output.test.ts`
- Ran `bun run typecheck`

**Learnings:**
- local help ownership needs to cover both `--help` and `help <command>` entrypoints or de-surfaced options can leak back through aliases
