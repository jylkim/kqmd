---
status: complete
priority: p2
issue_id: "050"
tags: [code-review, query, performance, snippets]
dependencies: []
---

# Query snippet shaping rescans full document bodies

adaptive ranking은 scoring window를 12KB로 제한하지만, 최종 응답 shaping 단계에서 `sourceBody`를 다시 전체 스캔할 수 있습니다.

## Problem Statement

`sourceBody`를 internal-only로 유지한 것은 좋지만, snippet 생성 단계가 다시 full body를 훑으면 adaptive ranking에서 줄인 비용이 응답 직전 다시 살아납니다. 특히 `bestChunkPos`가 0이거나 없는 문서에서는 upstream `extractSnippet()`가 full-body line split을 하게 되어 큰 문서에서 CPU/메모리 비용이 커질 수 있습니다.

## Findings

- [`src/commands/owned/io/query_rows.ts:24`](../src/commands/owned/io/query_rows.ts#L24) 는 `sourceBody ?? body` 전체를 `extractSnippet()`에 넘깁니다.
- adaptive ranking은 [`src/commands/owned/query_ranking.ts:12`](../src/commands/owned/query_ranking.ts#L12) 에서 12KB scoring window를 두지만, snippet shaping에는 같은 cap이 없습니다.
- `buildRowSnippet()`는 CLI와 MCP 모두의 공용 helper라서, 여기의 body-scan 비용은 두 surface에 함께 퍼집니다.

## Proposed Solutions

### Option 1: snippet 전용 bounded window 추가

**Approach:** `sourceChunkPos` 주변이나 lexical match anchor 주변만 잘라서 snippet helper에 넘깁니다.

**Pros:**
- scoring window와 출력 window가 비슷한 비용 모델을 가집니다
- 큰 문서 payload 비용을 줄일 수 있습니다

**Cons:**
- line number / context header 계산이 조금 더 복잡해집니다

**Effort:** Medium

**Risk:** Low

---

### Option 2: final top-N rows에 대해서만 lazy body fetch

**Approach:** `sourceBody`를 row에 붙이지 않고, 최종 top-N에 대해서만 필요 시 full body를 다시 읽습니다.

**Pros:**
- memory footprint를 줄일 수 있습니다
- ranking 단계와 output 단계 경계를 더 분명히 할 수 있습니다

**Cons:**
- read path가 조금 복잡해집니다
- store access를 다시 설계해야 할 수 있습니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Bound snippet shaping to a local window around `sourceChunkPos` or the first lexical anchor, keep CLI/MCP parity through the shared helper, and verify it with large-body regression tests.

## Technical Details

**Affected files:**
- `src/commands/owned/io/query_rows.ts`
- `src/commands/owned/io/format.ts`
- `src/mcp/server.ts`
- `test/query-output-security.test.ts`
- `test/query-row-parity.test.ts`

## Resources

- **Branch:** `feat/adaptive-korean-query-ranking`
- **Commit:** `99b4d2d`
- **Benchmark references:** `docs/benchmarks/2026-03-17-query-adaptive-ranking-metrics.md`

## Acceptance Criteria

- [x] final response shaping이 large-body full scan을 기본값으로 하지 않는다
- [x] CLI/MCP snippet parity는 유지된다
- [x] 큰 문서 fixture에서 snippet shaping 비용이 bounded 됨을 검증한다

## Work Log

### 2026-03-17 - Initial Review Finding

**By:** Codex

**Actions:**
- adaptive ranking과 query row shaping을 검토
- performance reviewer finding을 todo로 정리

**Learnings:**
- ranking window를 줄여도 output window를 그대로 두면 실제 비용 절감이 반쯤 사라질 수 있다

### 2026-03-17 - Resolution

**By:** Codex

**Actions:**
- `buildRowSnippet()`에서 large `sourceBody`를 bounded snippet window로 잘라 `extractSnippet()`에 전달하도록 수정
- lexical anchor 또는 `sourceChunkPos` 기준으로 absolute line/header를 다시 보정
- `test/query-output-security.test.ts`, `test/query-row-parity.test.ts`에 large-body regression을 추가
- `bun run test -- query-output-security query-row-parity mcp-http` 및 `bun run check` 통과 확인

**Learnings:**
- shared snippet helper 한 곳에서만 bounded shaping을 적용해도 CLI/MCP parity와 비용 절감을 동시에 가져갈 수 있다
