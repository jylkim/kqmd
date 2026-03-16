---
status: complete
priority: p2
issue_id: "045"
tags: [code-review, cli, help, maintainability, parity, typescript]
dependencies: []
---

# static help copy가 런타임 규칙과 복구 가이드를 다시 복제함

## Problem Statement

이번 변경은 help boundary를 정리하는 작업이었지만, 실제 구현은 `query` 문법/제약, `embed` recovery, `mcp` validation 규칙을 static help 문자열 안에 다시 써 넣었습니다. 이 규칙들은 이미 parser/runtime/execution layer가 소유하고 있어서, 앞으로는 규칙 변경 시 help 문구, fixtures, docs, checklist를 동시에 맞춰야 하는 drift surface가 커집니다.

## Findings

- [`src/commands/owned/help.ts`](../src/commands/owned/help.ts) 에 `Query syntax`, `Constraints`, `Recovery` 가 새로 추가됐습니다.
- 이 문구들은 이미 아래 로직이 canonical source입니다.
  - [`src/commands/owned/io/validate.ts`](../src/commands/owned/io/validate.ts)
  - [`src/commands/owned/io/parse.ts`](../src/commands/owned/io/parse.ts)
  - [`src/commands/owned/query_core.ts`](../src/commands/owned/query_core.ts)
  - [`src/commands/owned/embed.ts`](../src/commands/owned/embed.ts)
  - [`src/commands/owned/mcp.ts`](../src/commands/owned/mcp.ts)
- query example은 `$'...'` quoting 을 사용해 shell-specific detail까지 help text에 새로 도입합니다.
- help alias/output snapshots와 version-bump checklist도 함께 늘어나서, boundary change 하나가 장기적으로 더 넓은 maintenance surface로 번집니다.

## Proposed Solutions

### Option 1: help를 다시 최소화하고, 제약/복구 안내는 canonical runtime output에 맡기기

**Approach:** owned help는 usage + supported flags 중심으로 유지하고, 세부 제약은 validation/runtime error message가 소유하도록 되돌립니다.

**Pros:**
- 중복 source of truth를 줄입니다
- help/snapshot drift 가능성을 낮춥니다
- 현재 저장소의 minimal help 스타일과 더 가깝습니다

**Cons:**
- `query` help의 상세도 향상은 일부 포기하게 됩니다

**Effort:** Small

**Risk:** Low

---

### Option 2: 상세 help는 유지하되, help generation source를 더 구조화한다

**Approach:** strings-only copy 대신 shared descriptors or helpers로 canonical metadata를 모으고, help text는 그 metadata에서 조립합니다.

**Pros:**
- 상세도와 consistency를 둘 다 얻을 여지가 있습니다
- future drift를 줄일 수 있습니다

**Cons:**
- 현재 diff 범위를 넘어서는 구조 변경입니다
- 새로운 abstraction이 과할 수 있습니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Option 1로 해결했다. owned help는 usage와 supported flags만 유지하고, `query`/`embed`/`mcp`의 구체 제약과 복구 안내는 기존 parser/runtime validation output이 계속 소유하도록 되돌렸다.

## Technical Details

**Affected files:**
- `src/commands/owned/help.ts`
- `test/fixtures/owned-command-parity/help/query-help.output.txt`
- `test/owned-command-parity/help-output.test.ts`
- `docs/development.md`

## Resources

- Related learning: [`docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`](../docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md)
- Related learning: [`docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md`](../docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md)

## Acceptance Criteria

- [x] help가 소유해야 하는 정보와 runtime/validation이 소유해야 하는 정보를 다시 구분한다
- [x] 동일한 규칙이 help 문구와 runtime validation에 중복으로 남지 않도록 정리한다
- [x] help output and fixture maintenance cost가 현재보다 줄어든다
- [x] shell-specific example syntax 도입 여부가 의도적으로 결정되고 문서화된다

## Work Log

### 2026-03-16 - Initial Discovery

**By:** Codex

**Actions:**
- Reviewed the current help-boundary diff with simplicity and performance reviewers
- Compared new help text against existing parser/runtime ownership
- Identified copied constraints and recovery guidance now duplicated across layers
- Noted the new shell-specific structured-query example

**Learnings:**
- help 상세화는 쉽게 “문자열로 다시 쓰는 mini spec” 으로 번지기 쉽다
- boundary change는 correctness 뿐 아니라 drift surface 증가도 함께 리뷰해야 한다

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Removed duplicated `query` syntax/constraint copy from [`src/commands/owned/help.ts`](../src/commands/owned/help.ts)
- Removed duplicated `embed` recovery guidance and `mcp` constraint copy from [`src/commands/owned/help.ts`](../src/commands/owned/help.ts)
- Slimmed the canonical query help fixture in [`test/fixtures/owned-command-parity/help/query-help.output.txt`](../test/fixtures/owned-command-parity/help/query-help.output.txt)
- Reworked [`test/owned-command-parity/help-output.test.ts`](../test/owned-command-parity/help-output.test.ts) so only canonical query/update help use snapshots while alias paths assert byte-identical output directly
- Removed standalone `embed`/`mcp` help fixtures because they were no longer needed for the slimmer contract
- Kept the version-bump checklist update in [`docs/development.md`](../docs/development.md) while avoiding new rule text in static help

**Learnings:**
- owned help remains easier to maintain when it advertises entrypoints and flags, while parser/runtime layers explain invalid combinations and recovery paths
