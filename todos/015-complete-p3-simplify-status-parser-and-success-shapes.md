---
status: complete
priority: p3
issue_id: "015"
tags: [code-review, simplicity, cli, typescript, status]
dependencies: []
---

# Simplify `status` parsing and owned-command success shapes

새 구현은 동작하지만, 몇몇 보조 구조가 현재 요구사항보다 더 일반적으로 잡혀 있습니다. 후속 단순화 작업으로 분기와 유지보수 비용을 줄일 수 있습니다.

## Problem Statement

리뷰에서 드러난 작은 복잡도 hotspot은 두 가지입니다.

- `status` parsing이 전체 shared CLI option table을 재사용한 뒤 `index`를 제외한 truthy option을 전부 거절합니다
- `query`와 `update`가 flexible test stubbing을 위해 두 가지 success-result shape를 함께 지원합니다

이것들은 지금 당장 correctness bug는 아니지만, avoidable branching을 늘리고 command surface를 이해하기 어렵게 만듭니다.

## Findings

- `parseOwnedStatusInput()`는 [`src/commands/owned/io/parse.ts:220`](../src/commands/owned/io/parse.ts)에서 사실상 positional 개수와 `--index`만 보면 되는 명령을 위해 모든 parsed option을 순회합니다.
- `runQueryCommand()`와 `handleQueryCommand()`는 [`src/commands/owned/query.ts:22`](../src/commands/owned/query.ts)에서 `SearchOutputRow[]`와 `{ rows, stderr }`를 모두 지원합니다.
- `runUpdateCommand()`와 `handleUpdateCommand()`는 [`src/commands/owned/update.ts:20`](../src/commands/owned/update.ts)에서 `UpdateResult`와 `{ result, followUp }`를 모두 지원합니다.
- `status.ts`는 [`src/commands/owned/status.ts:17`](../src/commands/owned/status.ts)에서 기존 `CommandExecutionContext`를 재사용하지 않고 inline context shape를 여러 번 반복합니다.

## Proposed Solutions

### Option 1: Keep runtime behavior, simplify internals

**Approach:** parser와 handler return shape를 정리해서 각 명령이 하나의 success-result contract만 갖도록 만들고, `status`는 가장 좁은 parser/context 타입만 사용하게 합니다.

**Pros:**
- branching과 type guard를 줄일 수 있습니다
- 읽기와 유지보수가 더 쉬워집니다

**Cons:**
- 이미 동작하는 코드에 작은 churn이 생깁니다

**Effort:** Small

**Risk:** Low

## Recommended Action

triage 때 채웁니다.

## Technical Details

**Affected files:**
- [`src/commands/owned/io/parse.ts`](../src/commands/owned/io/parse.ts)
- [`src/commands/owned/query.ts`](../src/commands/owned/query.ts)
- [`src/commands/owned/update.ts`](../src/commands/owned/update.ts)
- [`src/commands/owned/status.ts`](../src/commands/owned/status.ts)

## Resources

- Review target commit: `31923a5`
- Simplicity review findings from configured review agents

## Acceptance Criteria

- [x] `status` parsing이 가장 작은 viable validation surface로 구현된다
- [x] `query` success handling이 하나의 canonical success shape만 갖는다
- [x] `update` success handling이 하나의 canonical success shape만 갖는다
- [x] 가능한 범위에서 `status`가 기존 shared context type을 재사용한다

## Work Log

### 2026-03-12 - Code Review Finding

**By:** Codex

**Actions:**
- 단순성 관점의 리뷰 피드백을 하나의 follow-up cleanup 항목으로 묶었습니다

**Learnings:**
- 이 feature는 이미 테스트로 잘 고정되어 있어서, 후속 cleanup은 동작 변경보다 readability에 집중해도 됩니다

### 2026-03-12 - Resolved

**By:** Codex

**Actions:**
- `status` parser를 positional count만 보는 최소 surface로 줄였습니다
- `status`가 `CommandExecutionContext`를 직접 재사용하도록 바꿨습니다
- `query`와 `update`의 성공 결과 shape를 각각 하나로 고정하고 테스트 stub도 함께 정리했습니다

**Learnings:**
- 리뷰 기반 follow-up은 작은 단순화라도 실제 구현 직후에 정리하는 편이 가장 싸게 끝납니다
