---
status: complete
priority: p2
issue_id: "043"
tags: [code-review, cli, help, routing, regression, typescript]
dependencies: []
---

# `help <owned-command> --help|-h`가 owned help contract를 우회함

## Problem Statement

이번 변경은 owned help entrypoint를 넓히고 de-surfaced option leak를 막는 것이 목표였지만, `qmd help <owned-command> --help` 와 `qmd help <owned-command> -h` 조합은 여전히 upstream help로 빠집니다. 그 결과 composite help entrypoint에서 `update [--pull]` 같은 de-surfaced option이 다시 보이고, 동일 명령의 help surface가 entrypoint에 따라 달라집니다.

## Findings

- [`src/cli.ts:42`](../src/cli.ts#L42) 의 `values.help` 분기가 [`src/cli.ts:48`](../src/cli.ts#L48) 의 `help <owned>` 분기보다 먼저 실행됩니다.
- 그래서 `parseCliInvocation(['help', 'update', '--help'])` 는 owned가 아니라 passthrough help route를 반환합니다.
- 실제로 `node ./bin/qmd.js help update --help` 는 upstream top-level help를 출력하며, 그 안에 `qmd update [--pull]` 가 다시 노출됩니다.
- 현재 테스트는 [`test/cli-routing.test.ts`](../test/cli-routing.test.ts) 와 [`test/owned-command-parity/help-output.test.ts`](../test/owned-command-parity/help-output.test.ts) 에서 `help <owned>` 와 `--help <owned>` 를 따로만 검증하고, 이 조합 경로는 비워 두고 있습니다.
- 관련 학습:
  - [`docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`](../docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md)
  - [`docs/solutions/logic-errors/owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md`](../docs/solutions/logic-errors/owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md)

## Proposed Solutions

### Option 1: `help <owned>` 우선순위를 `values.help` 분기보다 먼저 적용

**Approach:** `help` alias가 들어온 경우에는 뒤에 `--help` 나 `-h` 가 붙어도 먼저 owned target을 해석하도록 `parseCliInvocation()` precedence를 조정합니다.

**Pros:**
- 현재 계약을 가장 직접적으로 복구합니다
- de-surfaced option leak를 막습니다
- existing help wording/tests와 잘 맞습니다

**Cons:**
- top-level help routing precedence가 조금 더 복잡해집니다

**Effort:** Small

**Risk:** Low

---

### Option 2: `help <owned> --help|-h` 를 unsupported surface로 명시하고 문서/테스트에서 제외

**Approach:** composite entrypoint를 지원 범위 밖으로 두고 README, plan, tests에서 제거합니다.

**Pros:**
- routing 변경이 작습니다
- 구현량이 적습니다

**Cons:**
- 이미 넓힌 help matrix를 다시 좁혀야 합니다
- 사용자는 여전히 직관적으로 이 조합을 시도할 수 있습니다

**Effort:** Small

**Risk:** Medium

## Recommended Action

Option 1로 해결했다. `help <owned>` alias 경로가 `--help`/`-h`와 함께 들어와도 먼저 owned target을 해석하도록 precedence를 조정해, composite help entrypoint에서도 같은 local help contract를 유지한다.

## Technical Details

**Affected files:**
- `src/cli.ts`
- `test/cli-routing.test.ts`
- `test/owned-command-parity/help-output.test.ts`
- related help fixtures

## Resources

- Review source: current uncommitted diff on `main`
- Repro command: `node ./bin/qmd.js help update --help`

## Acceptance Criteria

- [x] `qmd help <owned-command> --help` 와 `qmd help <owned-command> -h` 가 owned help로 라우팅되거나, supported surface에서 명시적으로 제외된다
- [x] de-surfaced option이 composite help entrypoint에서도 다시 노출되지 않는다
- [x] routing test와 help output test가 composite entrypoint를 포함한다
- [x] same-command owned help entrypoints가 byte-identical output을 유지한다

## Work Log

### 2026-03-16 - Initial Discovery

**By:** Codex

**Actions:**
- Reviewed current help-boundary diff and CLI routing precedence
- Reproduced `node ./bin/qmd.js help update --help`
- Confirmed upstream top-level help leak through composite alias entrypoint
- Mapped the branch-order root cause in `src/cli.ts`

**Learnings:**
- help contract 회귀는 alternate entrypoint 조합에서 다시 숨어들기 쉽다
- `help <command>` 와 `--help <command>` 를 따로 고정해도 composite path는 별도 coverage가 필요하다

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Adjusted help precedence in [`src/cli.ts`](../src/cli.ts) so `help <owned-command>` is interpreted before the generic `values.help` passthrough branch
- Added composite entrypoint coverage in [`test/cli-routing.test.ts`](../test/cli-routing.test.ts)
- Added byte-identical help parity checks for `help <owned-command> --help|-h` in [`test/owned-command-parity/help-output.test.ts`](../test/owned-command-parity/help-output.test.ts)
- Ran `bun run test -- test/cli-routing.test.ts test/owned-command-parity/help-output.test.ts`

**Learnings:**
- help alias precedence is part of the contract, not just a convenience branch
- de-surfaced option leaks can reappear through composite entrypoints unless those combinations are explicitly tested
