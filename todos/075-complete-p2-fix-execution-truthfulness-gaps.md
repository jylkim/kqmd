---
status: complete
priority: p2
issue_id: "075"
tags: [code-review, query, mcp, truthfulness, explain]
dependencies: []
---

# Fix execution truthfulness gaps in query summaries

## Problem Statement

이번 변경은 `QueryExecutionSummary.execution`을 공통 truth source로 노출하는 것이 핵심이지만, 현재 일부 경로에서는 실제 stage 실행을 관측하지 못한 채 값을 추정하거나 일부 heavy stage를 summary에서 놓칩니다. 그 결과 `--explain`, MCP response, benchmark artifact가 authoritative-looking metadata를 제공하면서도 실제 실행과 어긋날 수 있습니다.

## Findings

- [`src/commands/owned/query_runtime.ts:318`](../src/commands/owned/query_runtime.ts#L318) public `store.search()` path는 실제 관측 없이 `embeddingApplied: true`, `expansionApplied: true`를 하드코딩합니다.
- [`src/commands/owned/query_core.ts:221`](../src/commands/owned/query_core.ts#L221) normalization supplement는 두 번째 `executeOwnedQuerySearch()`를 호출하지만, summary는 첫 번째 `runtimeTelemetry`만 사용합니다.
- [`src/mcp/query.ts:57`](../src/mcp/query.ts#L57) fallback summary도 `execution` 값을 직접 합성합니다.

## Proposed Solutions

### Option 1: Mark inferred telemetry explicitly

**Approach:** 관측 불가능한 경로는 `execution`을 만들지 않거나, inferred 여부를 별도 필드로 명시하고 benchmark/explain에서는 제외합니다.

**Pros:**
- truthfulness contract를 지킬 수 있습니다.
- surface별로 자신감 수준을 명확히 나눌 수 있습니다.

**Cons:**
- 응답 shape와 fixture를 한 번 더 손봐야 합니다.

**Effort:** Medium

**Risk:** Low

---

### Option 2: Capture telemetry for every executed stage

**Approach:** normalization supplement/public path/fallback path까지 모두 단일 telemetry collector 아래로 넣어 실제 실행값만 summary에 반영합니다.

**Pros:**
- execution truth source가 정말 단일화됩니다.

**Cons:**
- runtime/query_core 구조 변경 폭이 더 큽니다.

**Effort:** Medium-Large

**Risk:** Medium

## Recommended Action

관측하지 못한 public path heavy stage를 더 이상 `true`로 보고하지 않도록 summary를 보수적으로 조정하고, normalization supplement telemetry도 최종 execution summary에 합쳐 반영하도록 구현했다.

## Technical Details

**Affected files:**
- [`src/commands/owned/query_runtime.ts`](../src/commands/owned/query_runtime.ts)
- [`src/commands/owned/query_core.ts`](../src/commands/owned/query_core.ts)
- [`src/mcp/query.ts`](../src/mcp/query.ts)
- explain/parity fixtures under [`test/fixtures/owned-command-parity/query/`](../test/fixtures/owned-command-parity/query/)

## Resources

- Review findings: kieran-typescript-reviewer, security-sentinel
- Related learning: [`docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`](../docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md)

## Acceptance Criteria

- [x] public path summary가 관측하지 못한 stage를 단정적으로 보고하지 않는다
- [x] normalization supplement가 실제 heavy stage를 사용한 경우 summary/benchmark에 반영된다
- [x] MCP fallback summary가 core truth source와 드리프트하지 않는다
- [x] explain/MCP/benchmark fixture가 변경된 truthfulness contract를 검증한다

## Work Log

### 2026-03-25 - Code Review Finding

**By:** Codex

**Actions:**
- `query_runtime`, `query_core`, `mcp/query`의 execution summary 경로를 추적했습니다.
- public path hardcoded telemetry와 normalization supplement 누락을 확인했습니다.
- explain/MCP/benchmark surface가 모두 이 값을 재사용하는지 확인했습니다.

**Learnings:**
- “공통 truth source”는 값이 한 곳에 모여 있다는 뜻만이 아니라, 실제 실행을 정확히 반영한다는 뜻이어야 합니다.

### 2026-03-25 - Resolved

**By:** Codex

**Actions:**
- public `store.search()` fallback telemetry를 conservative defaults로 낮췄습니다.
- normalization supplement에도 별도 execution plan/telemetry 수집을 넣고 base telemetry와 합쳤습니다.
- MCP fallback summary도 conservative execution shape로 맞췄습니다.
- 관련 query/MCP/parity 테스트와 최종 `bun run release:verify`를 통과시켰습니다.

**Learnings:**
- execution summary는 설명용 메타데이터이지만, 실제 실행보다 더 많이 안다고 말하는 순간 바로 correctness surface가 됩니다.

## Notes

- merge blocker는 아니지만, 이번 변경의 핵심 약속을 흐릴 수 있는 중요한 follow-up입니다.
