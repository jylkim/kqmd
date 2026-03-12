---
status: complete
priority: p2
issue_id: "013"
tags: [code-review, cli, query, embeddings, collections, correctness]
dependencies: []
---

# Scope query mismatch warnings to the selected collections

새 mismatch warning은 collection filter가 해석되기 전에 store 전체를 기준으로 계산됩니다. 그래서 한 컬렉션만 조회하는 query도 다른 컬렉션의 old-model vectors 때문에 경고를 띄울 수 있습니다.

## Problem Statement

`qmd query -c docs ...`는 ideally 검색 대상 컬렉션에 mismatch가 있을 때만 경고해야 합니다. 그런데 현재 구현은 먼저 store-wide embedding health를 계산하고 나서 `input.collections`를 해석하기 때문에, 실제 query와 무관한 컬렉션 때문에 경고가 뜰 수 있습니다.

이렇게 되면 경고의 신뢰도가 떨어지고, 사용자에게 불필요한 `qmd embed --force`를 유도할 수 있습니다.

## Findings

- `runQueryCommand()`는 [`src/commands/owned/query.ts:68`](../src/commands/owned/query.ts)에서 selected collections를 해석하기 전에 embedding health를 읽습니다.
- `readEmbeddingHealth()`는 [`src/commands/owned/embedding_health.ts:101`](../src/commands/owned/embedding_health.ts)에서 DB 전체 `content_vectors`를 집계합니다.
- collection selection은 그 다음 [`src/commands/owned/query.ts:70`](../src/commands/owned/query.ts)에서 일어납니다.
- 결과적으로 실제 search execution은 explicit collection으로 좁혀져도 warning은 store-wide semantics를 가집니다.

## Proposed Solutions

### Option 1: Add collection-aware health queries

**Approach:** embedding health 계산이 selected collections를 받을 수 있게 바꾸고, `documents`를 join해서 mismatch 집계가 실제 query scope와 맞게 합니다.

**Pros:**
- 사용자 입장에서 가장 정확한 warning이 됩니다
- warning scope와 실제 query scope가 일치합니다

**Cons:**
- SQL이 조금 더 복잡해집니다
- health helper API가 넓어집니다

**Effort:** Medium

**Risk:** Medium

---

### Option 2: Only warn on store-wide mismatch when no collection filter exists

**Approach:** 사용자가 explicit collection을 넘긴 경우에는 warning을 당장 생략하거나, “store-wide mismatch exists”처럼 더 약한 메시지로 바꿉니다.

**Pros:**
- 변경이 작습니다
- 정확한 것처럼 보이는 오해를 줄일 수 있습니다

**Cons:**
- 일부 유용한 warning을 잃습니다
- collection-scoped query의 의미가 여전히 모호하게 남습니다

**Effort:** Small

**Risk:** Low

## Recommended Action

triage 때 채웁니다.

## Technical Details

**Affected files:**
- [`src/commands/owned/query.ts`](../src/commands/owned/query.ts)
- [`src/commands/owned/embedding_health.ts`](../src/commands/owned/embedding_health.ts)
- [`test/owned-embedding-behavior.test.ts`](../test/owned-embedding-behavior.test.ts)

**Relevant tables:**
- `documents`
- `content_vectors`

## Resources

- Review target commit: `31923a5`
- Query warning path: [`src/commands/owned/query.ts:68`](../src/commands/owned/query.ts)
- Health helper: [`src/commands/owned/embedding_health.ts:101`](../src/commands/owned/embedding_health.ts)

## Acceptance Criteria

- [x] `qmd query -c <collection>`가 selected collection scope에 영향을 주는 mismatch에 대해서만 warning을 내거나, 의도적인 store-wide fallback을 명확히 문서화한다
- [x] collection-scoped mismatch와 unrelated-collection mismatch를 테스트가 구분해서 다룬다
- [x] warning copy가 stderr-only로 유지되고 formatted stdout을 오염시키지 않는다

## Work Log

### 2026-03-12 - Code Review Finding

**By:** Codex

**Actions:**
- health read부터 collection resolution까지 `query` 실행 경로를 추적했습니다
- 현재 warning이 collection filtering 전에 계산된다는 점을 확인했습니다

**Learnings:**
- mismatch advisory는 사용자가 그 범위를 신뢰할 수 있을 때만 유의미합니다
- store-wide health와 collection-scoped search는 같은 warning semantics를 조용히 공유하면 안 됩니다

### 2026-03-12 - Resolved

**By:** Codex

**Actions:**
- health helper가 selected collections를 받을 수 있게 바꿨습니다
- `query`에서 collection resolution 이후에 scope-aware health를 읽도록 수정했습니다
- unrelated collection mismatch에서는 warning이 뜨지 않는 테스트를 추가했습니다

**Learnings:**
- warning은 실제 검색 범위와 맞아야 신뢰할 수 있습니다
