---
status: complete
priority: p1
issue_id: "072"
tags: [code-review, performance, query, latency]
dependencies: []
---

# Avoid unconditional lexical preflight on plain queries

## Problem Statement

이번 브랜치는 cold-start를 줄이기 위해 fast-default 경로를 도입했지만, 현재 구현은 plain query마다 먼저 lexical probe를 수행합니다. 그 결과 fast-default를 전혀 쓰지 않을 compatibility query(`intent`, explicit `candidate-limit`, explicit collection filter)도 hot path에서 추가 `searchLex`/shadow read 비용을 먼저 내고 시작합니다.

## Findings

- [`src/commands/owned/query_core.ts:128`](../src/commands/owned/query_core.ts) 에서 plain query면 항상 [`probeQueryLexicalCandidates()`](../src/commands/owned/query_lexical_candidates.ts#L100)를 호출합니다.
- [`src/commands/owned/query_execution_policy.ts:81`](../src/commands/owned/query_execution_policy.ts#L81) 이후 분기에서 `intent`, explicit `candidate-limit`, explicit collection filter는 probe 결과와 무관하게 compatibility path로 고정됩니다.
- 즉, cold-start를 줄이려는 대상이 아닌 query도 extra lexical round-trip을 먼저 수행하게 되어 이번 변경의 핵심 목표와 충돌합니다.

## Proposed Solutions

### Option 1: Lazy lexical probe

**Approach:** classification/explicit option check로 fast-default 후보인지 먼저 결정한 뒤, 그 경우에만 lexical probe를 실행합니다. search-assist가 필요한 한글 plain query도 별도 조건으로 probe를 허용합니다.

**Pros:**
- 불필요한 preflight를 제거해 hot path 목적과 맞습니다.
- 현재 구조를 크게 바꾸지 않고 비용만 줄일 수 있습니다.

**Cons:**
- policy builder에 “cheap pre-check”와 “expensive probe”를 분리해야 합니다.

**Effort:** Medium

**Risk:** Low

---

### Option 2: Carry lexical evidence from actual retrieval

**Approach:** 별도 lexical probe 대신 base retrieval 결과 또는 runtime hook에서 lexical strength를 계산해 policy/summary에 재사용합니다.

**Pros:**
- 이중 검색을 제거할 수 있습니다.
- summary truth source를 더 단순하게 만들 수 있습니다.

**Cons:**
- 현재 policy 결정 시점이 retrieval 이전이라 구조 변경 폭이 큽니다.

**Effort:** Large

**Risk:** Medium

## Recommended Action

lexical probe를 실제로 필요한 fast-default/search-assist 경로로만 제한하고, compatibility-only plain query 및 multi-collection default plain query에서는 preflight를 생략하도록 구현했다.

## Technical Details

**Affected files:**
- [`src/commands/owned/query_core.ts`](../src/commands/owned/query_core.ts)
- [`src/commands/owned/query_lexical_candidates.ts`](../src/commands/owned/query_lexical_candidates.ts)
- [`src/commands/owned/query_execution_policy.ts`](../src/commands/owned/query_execution_policy.ts)

## Resources

- Review finding: performance-oracle / code-simplicity-reviewer
- Related learning: [`docs/solutions/logic-errors/korean-query-search-assist-rescue-kqmd-cli-20260319.md`](../docs/solutions/logic-errors/korean-query-search-assist-rescue-kqmd-cli-20260319.md)
- Related plan: [`docs/plans/2026-03-25-fix-query-cold-start-latency-plan.md`](../docs/plans/2026-03-25-fix-query-cold-start-latency-plan.md)

## Acceptance Criteria

- [x] compatibility-only plain query는 별도 lexical preflight 없이 기존 retrieval로 바로 진행된다
- [x] fast-default 후보와 search-assist gating이 필요한 query에서만 lexical probe가 실행된다
- [x] `intent`, explicit `candidate-limit`, explicit collection filter query의 hot path 비용이 기존 대비 증가하지 않는다
- [x] 관련 tests가 policy split을 고정한다

## Work Log

### 2026-03-25 - Code Review Finding

**By:** Codex

**Actions:**
- `query_core`와 `query_execution_policy` 경로를 검토했습니다.
- plain query에서 lexical probe가 unconditional하게 실행되는지 확인했습니다.
- compatibility path가 probe 결과를 실제로 사용하지 않는 분기들을 추적했습니다.

**Learnings:**
- cold-start 최적화는 heavy stage를 줄이기 전에 preflight 자체가 hot path를 늘리지 않도록 설계해야 합니다.

### 2026-03-25 - Resolved

**By:** Codex

**Actions:**
- `query_core`에 lexical probe eligibility helper를 추가해 compatibility-only plain query는 probe를 생략하도록 변경했습니다.
- multi-collection default plain query도 unnecessary probe를 피하도록 guard를 강화했습니다.
- `test/query-core.test.ts`에 explicit intent, explicit collection, multi-collection default regression tests를 추가했습니다.
- `bun run test -- test/query-core.test.ts` 및 최종 `bun run release:verify`를 통과시켰습니다.

**Learnings:**
- fast-default guardrail을 policy에만 두면 preflight 비용이 남을 수 있으므로, probe 호출 시점 자체를 함께 통제해야 합니다.

## Notes

- 이 이슈는 cold-start 개선의 목표와 직접 충돌하므로 merge blocker로 분류합니다.
