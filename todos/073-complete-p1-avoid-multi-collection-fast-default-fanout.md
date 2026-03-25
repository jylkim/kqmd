---
status: complete
priority: p1
issue_id: "073"
tags: [code-review, performance, query, collections]
dependencies: []
---

# Avoid multi-collection fanout on fast-default query path

## Problem Statement

fast-default는 explicit `--collection`이 없는 plain query에 적용되는데, 현재 구현은 “사용자가 명시적으로 collection을 넘겼는가”만 보고 판단합니다. 기본 collection이 여러 개인 환경에서는 resolved collection set이 여러 개인데도 fast-default가 그대로 선택되어, supposedly lighter path가 collection 수만큼 FTS/vector 검색을 fanout하게 됩니다.

## Findings

- [`src/commands/owned/query_execution_policy.ts:109`](../src/commands/owned/query_execution_policy.ts#L109) 은 explicit collection filter만 compatibility path로 보내고, resolved default collections count는 보지 않습니다.
- [`src/commands/owned/query_runtime.ts:245`](../src/commands/owned/query_runtime.ts#L245) 의 fast-default structured path는 `collections: selectedCollections`를 그대로 넘깁니다.
- upstream [`structuredSearch()`](../node_modules/@tobilu/qmd/dist/store.js#L3104) 는 lex/vec search를 collection별로 반복 실행합니다.
- 기존 hybrid path는 `collection`이 undefined일 때 single BM25 probe로 시작했기 때문에, multi-default 환경에서는 새 경로가 오히려 더 비싸질 수 있습니다.

## Proposed Solutions

### Option 1: Disable fast-default when resolved collections > 1

**Approach:** policy builder가 selected collections 길이를 받아 multi-collection default에서는 compatibility path로 내립니다.

**Pros:**
- 가장 작은 수정으로 fanout regression을 막을 수 있습니다.
- 계획 문서의 “explicit advanced surfaces는 compatibility” 가드레일과도 잘 맞습니다.

**Cons:**
- multi-collection 기본 환경에서는 fast-default 적용 범위가 줄어듭니다.

**Effort:** Small

**Risk:** Low

---

### Option 2: Add dedicated multi-collection fast path

**Approach:** multi-collection에서도 single-probe equivalent가 되도록 별도 fast path를 설계합니다.

**Pros:**
- 최적화 적용 범위를 유지할 수 있습니다.

**Cons:**
- 구현과 benchmark complexity가 크게 늘어납니다.
- 현재 upstream seam/local policy 범위를 넘길 가능성이 큽니다.

**Effort:** Large

**Risk:** High

## Recommended Action

resolved default collection 수가 여러 개인 경우 fast-default를 선택하지 않도록 policy를 수정하고, runtime에도 동일한 방어선을 추가해 fanout-heavy structured path 진입을 막았다.

## Technical Details

**Affected files:**
- [`src/commands/owned/query_execution_policy.ts`](../src/commands/owned/query_execution_policy.ts)
- [`src/commands/owned/query_runtime.ts`](../src/commands/owned/query_runtime.ts)
- [`node_modules/@tobilu/qmd/dist/store.js`](../node_modules/@tobilu/qmd/dist/store.js)

## Resources

- Review finding: performance-oracle
- Related plan: [`docs/plans/2026-03-25-fix-query-cold-start-latency-plan.md`](../docs/plans/2026-03-25-fix-query-cold-start-latency-plan.md)
- Related architecture: [`docs/architecture/upstream-compatibility-policy.md`](../docs/architecture/upstream-compatibility-policy.md)

## Acceptance Criteria

- [x] resolved default collections가 여러 개인 경우 fast-default가 fanout-heavy path로 진입하지 않는다
- [x] multi-collection 환경의 cold-start latency regression test 또는 benchmark coverage가 추가된다
- [x] single-collection default 환경에서는 현재 fast-default 동작이 유지된다

## Work Log

### 2026-03-25 - Code Review Finding

**By:** Codex

**Actions:**
- fast-default selection 조건과 runtime structured path를 검토했습니다.
- upstream `structuredSearch()`의 collection fanout 동작을 확인했습니다.
- 기본 collection이 여러 개인 환경에서 새 경로가 더 비싸질 수 있는지 비교했습니다.

**Learnings:**
- “explicit collection filter 없음”과 “실제로 단일 collection search”는 같은 조건이 아닙니다.

### 2026-03-25 - Resolved

**By:** Codex

**Actions:**
- `QueryExecutionPlan` builder에 `selectedCollectionsCount`를 전달해 multi-collection default를 `compatibility-public`으로 내리도록 바꿨습니다.
- fallback reason `compatibility-multi-collection-default`를 추가했습니다.
- runtime의 `preExpandedQueries` 경로에도 multi-collection public fallback 방어선을 추가했습니다.
- 정책/런타임 회귀 테스트를 보강하고 최종 `bun run release:verify`까지 통과시켰습니다.

**Learnings:**
- cold-start 최적화는 “사용자 입력”뿐 아니라 실제 resolved scope까지 반영해야 fanout regression을 피할 수 있습니다.

## Notes

- 목표가 cold-start latency cap이라면 multi-collection default는 별도 guardrail 없이는 merge blocker입니다.
