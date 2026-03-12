---
status: complete
priority: p2
issue_id: "014"
tags: [code-review, performance, cli, query, embeddings, sqlite]
dependencies: []
---

# Reduce embedding-health scan cost on query/status hot paths

새 embedding-health helper는 `qmd query`와 `qmd status`에 추가 DB 작업을 넣습니다. `query`에서는 현재 SQL shape가 명령 실행마다 `content_vectors`를 스캔할 수 있고, `status`는 상태 정보를 중복으로 읽고 있습니다.

## Problem Statement

Mismatch correctness는 중요하지만, 모든 `qmd query`가 `content_vectors`에 대한 store-wide aggregation 비용을 내게 만들어서는 안 됩니다. 현재 helper는 호출마다 grouped embedding-model counts를 DB에서 읽고, `status`는 `store.getStatus()`도 두 번 호출합니다.

인덱스가 커지면 이 비용은 단순한 검색 범위가 아니라 vector table 크기에 묶여 버릴 수 있습니다.

## Findings

- `readStoredEmbeddingModels()`는 [`src/commands/owned/embedding_health.ts:33`](../src/commands/owned/embedding_health.ts)에서 `WHERE seq = 0 GROUP BY model` 집계를 수행합니다.
- `runQueryCommand()`는 [`src/commands/owned/query.ts:68`](../src/commands/owned/query.ts)에서 이 helper를 모든 query마다 실행합니다.
- `runUpdateCommand()`도 [`src/commands/owned/update.ts:62`](../src/commands/owned/update.ts)에서 update 뒤 같은 helper를 호출합니다.
- `runStatusCommand()`는 [`src/commands/owned/status.ts:40`](../src/commands/owned/status.ts)에서 먼저 `session.store.getStatus()`를 호출하고, 이어 [`src/commands/owned/embedding_health.ts:105`](../src/commands/owned/embedding_health.ts)에서 다시 `store.getStatus()`를 호출합니다.

## Proposed Solutions

### Option 1: Split DB model read from health classification and reuse existing status

**Approach:** `readEmbeddingHealth()`가 이미 읽어 온 `IndexStatus`를 받을 수 있게 바꿔서, `status`에서 중복 `getStatus()` 호출을 없앱니다.

**Pros:**
- `status`에서 쉽게 이득을 볼 수 있습니다
- 현재 동작을 크게 바꾸지 않아도 됩니다

**Cons:**
- broader query hot-path scan 문제까지는 해결하지 못합니다

**Effort:** Small

**Risk:** Low

---

### Option 2: Add cached or metadata-backed embedding health

**Approach:** model summary metadata를 저장하거나 health 결과를 캐시해서 `query`가 매 invocation마다 `content_vectors`를 집계하지 않게 합니다.

**Pros:**
- 장기적으로 query 성능에 가장 유리합니다
- mismatch correctness를 유지할 수 있습니다

**Cons:**
- 관리해야 할 상태가 늘어납니다
- invalidation 규칙이 정확해야 합니다

**Effort:** Medium to Large

**Risk:** Medium

---

### Option 3: Restrict full mismatch checks to `status`/`embed` and soften `query`

**Approach:** 정확한 health check는 `status`와 migration 성격 명령에 두고, query path에서는 값싼 summary가 없으면 더 무거운 check를 줄이거나 생략합니다.

**Pros:**
- hot path latency를 보호할 수 있습니다
- status surface는 계속 강하게 유지할 수 있습니다

**Cons:**
- query warning이 덜 즉각적이 됩니다
- 명령마다 UX semantics가 갈라집니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

triage 때 채웁니다.

## Technical Details

**Affected files:**
- [`src/commands/owned/embedding_health.ts`](../src/commands/owned/embedding_health.ts)
- [`src/commands/owned/query.ts`](../src/commands/owned/query.ts)
- [`src/commands/owned/status.ts`](../src/commands/owned/status.ts)
- [`src/commands/owned/update.ts`](../src/commands/owned/update.ts)

## Resources

- Review target commit: `31923a5`
- Health query: [`src/commands/owned/embedding_health.ts:33`](../src/commands/owned/embedding_health.ts)
- Query call site: [`src/commands/owned/query.ts:68`](../src/commands/owned/query.ts)
- Status duplicate call site: [`src/commands/owned/status.ts:40`](../src/commands/owned/status.ts)

## Acceptance Criteria

- [x] `status`가 더 이상 `store.getStatus()`를 중복 호출하지 않는다
- [x] query path가 명시적 정당화 없이 avoidable full-table-ish health work를 매 invocation마다 수행하지 않는다
- [x] 의도한 health-query 동작을 테스트로 확인한다

## Work Log

### 2026-03-12 - Code Review Finding

**By:** Codex

**Actions:**
- query/status/update의 health call site를 검토했습니다
- helper 구조를 실제 command hot path와 비교했습니다

**Learnings:**
- hot path에 들어가는 correctness check는 명시적인 latency budget이 필요합니다
- `status`는 이미 가진 정보만으로도 중복 `getStatus()` 호출 하나를 줄일 수 있습니다

### 2026-03-12 - Resolved

**By:** Codex

**Actions:**
- `readEmbeddingHealth()`가 이미 읽은 `IndexStatus`를 재사용할 수 있게 바꿨습니다
- `status`에서 중복 `getStatus()` 호출을 제거했습니다
- model 집계를 `documents -> content_vectors(seq=0)` 방향으로 바꿔 query hot path의 스캔 범위를 줄였습니다

**Learnings:**
- status/read path에서는 correctness와 함께 중복 쿼리 제거도 바로 체감되는 개선입니다
