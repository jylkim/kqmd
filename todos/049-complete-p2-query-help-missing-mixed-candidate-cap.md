---
status: complete
priority: p2
issue_id: "049"
tags: [code-review, query, help, docs, parity]
dependencies: []
---

# Query help misses mixed candidate-limit cap

`query` runtime은 mixed-technical plain query에서 `--candidate-limit`를 50 이하로 제한하지만, help/fixture/README는 그 계약을 아직 설명하지 않습니다.

## Problem Statement

현재 runtime은 mixed-technical plain query에 대해 `--candidate-limit > 50`을 validation error로 막습니다. 하지만 [`src/commands/owned/help.ts`](../src/commands/owned/help.ts) 와 help snapshot, README는 여전히 `candidate-limit`를 일반 옵션처럼만 설명합니다. 도움말이 실제 runtime contract보다 좁거나 넓으면, 사용자 입장에서는 “왜 이 질의만 갑자기 실패하지?” 같은 surprise가 생깁니다.

## Findings

- [`src/commands/owned/query_core.ts:83`](../src/commands/owned/query_core.ts#L83) 에 mixed-technical plain query의 `candidateLimit <= 50` validation이 추가됐습니다.
- [`src/commands/owned/help.ts:36`](../src/commands/owned/help.ts#L36) 와 [`test/fixtures/owned-command-parity/help/query-help.output.txt`](../test/fixtures/owned-command-parity/help/query-help.output.txt) 는 이 제약을 설명하지 않습니다.
- README도 `query --candidate-limit`를 지원한다고만 말하고 query-class-specific cap은 말하지 않습니다.

## Proposed Solutions

### Option 1: help/docs에 runtime 제약을 간단히 반영

**Approach:** help/README에 “mixed technical plain query는 rerank cost를 bounded 하도록 `--candidate-limit <= 50`”라는 문장을 짧게 추가합니다.

**Pros:**
- 사용자가 runtime failure를 미리 이해할 수 있습니다
- docs와 behavior가 다시 맞습니다

**Cons:**
- help가 runtime 규칙을 일부 중복하게 됩니다

**Effort:** Small

**Risk:** Low

---

### Option 2: runtime cap을 제거하거나 다른 방식으로 노출

**Approach:** help를 바꾸기 싫다면 runtime contract를 다시 조정합니다.

**Pros:**
- help 복제면을 늘리지 않습니다

**Cons:**
- 비용 budget이나 current design rationale이 흐려질 수 있습니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

help/README/help snapshot에 mixed-technical plain query의 `--candidate-limit <= 50` 계약을 짧게 반영해 runtime과 user-facing surface를 다시 맞춘다.

## Technical Details

**Affected files:**
- `src/commands/owned/help.ts`
- `test/fixtures/owned-command-parity/help/query-help.output.txt`
- `README.md`
- `src/commands/owned/query_core.ts`

## Resources

- **Branch:** `feat/adaptive-korean-query-ranking`
- **Commit:** `99b4d2d`

## Acceptance Criteria

- [x] help/README/runtime 중 하나라도 다른 하나를 surprise 하게 만들지 않는다
- [x] mixed-technical `candidate-limit` cap이 user-facing contract에 반영된다
- [x] help snapshot이 갱신되고 tests가 green이다

## Work Log

### 2026-03-17 - Initial Review Finding

**By:** Codex

**Actions:**
- runtime validation과 help/README copy를 교차 검토
- docs/behavior mismatch를 todo로 기록

**Learnings:**
- help를 얇게 유지하더라도, 실제 실패를 유발하는 stable contract는 최소한 다른 문서 surface와 충돌하지 않아야 한다

### 2026-03-17 - Resolved

**By:** Codex

**Actions:**
- `query` help 텍스트와 parity fixture에 mixed plain query의 `--candidate-limit <= 50` 계약을 반영
- README의 owned query surface 설명에 같은 제약을 추가
- 관련 parity/query-core 테스트를 다시 실행해 help/runtime 계약이 맞는지 확인

**Learnings:**
- 한 줄짜리 help 문구만으로도 query-class-specific validation surprise를 충분히 줄일 수 있다
