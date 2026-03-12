---
status: complete
priority: p2
issue_id: "018"
tags: [code-review, performance, sqlite, search, locking, typescript]
dependencies: []
---

# Reduce shadow index rebuild lock duration

## Problem Statement

`rebuildSearchShadowIndex()`는 `BEGIN IMMEDIATE`로 SQLite write lock을 연 뒤, 그 안에서 문서별 token projection 계산을 `await`하며 진행합니다. Kiwi 초기화, 모델 다운로드, 형태소 분석, projection 생성이 모두 열린 write transaction 안에서 일어나므로, 큰 index나 첫 실행에서 lock이 불필요하게 오래 유지될 수 있습니다.

## Findings

- [`src/commands/owned/search_shadow_index.ts:214`](../src/commands/owned/search_shadow_index.ts) 에서 transaction을 먼저 시작합니다.
- 같은 함수의 [`src/commands/owned/search_shadow_index.ts:230`](../src/commands/owned/search_shadow_index.ts) 이후 loop는 각 문서마다 `await buildShadowProjection(...)`를 호출합니다.
- `buildShadowProjection()`은 [`src/commands/owned/search_shadow_index.ts:151`](../src/commands/owned/search_shadow_index.ts) 에서 tokenizer async path를 거칩니다.
- tokenizer path는 Kiwi lazy init과 모델 파일 다운로드를 포함할 수 있습니다 ([`src/commands/owned/kiwi_tokenizer.ts:74`](../src/commands/owned/kiwi_tokenizer.ts), [`src/commands/owned/kiwi_tokenizer.ts:92`](../src/commands/owned/kiwi_tokenizer.ts)).
- 결과적으로 first-run `qmd update`가 네트워크 지연이나 corpus 크기만큼 SQLite write lock을 잡고 있게 됩니다.

## Proposed Solutions

### Option 1: Precompute projections before opening the write transaction

**Approach:** active docs를 읽은 뒤 Kiwi init/tokenization/projection 생성은 transaction 밖에서 끝내고, 실제 `DELETE + INSERT + metadata upsert`만 짧은 transaction 안에서 수행합니다.

**Pros:**
- lock duration이 크게 줄어듭니다
- first-run network/init latency가 DB write contention으로 번지지 않습니다

**Cons:**
- projection payload를 메모리에 잠시 보관해야 합니다

**Effort:** Medium

**Risk:** Low

### Option 2: Two-phase rebuild with temp table

**Approach:** temp table에 projection을 먼저 적재하고, 마지막 swap만 짧은 transaction으로 수행합니다.

**Pros:**
- correctness와 atomicity를 모두 유지하기 쉽습니다

**Cons:**
- 구현이 더 큽니다
- temp table lifecycle까지 관리해야 합니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Triage 필요. 현재 구조라면 Option 1이 가장 비용 대비 효과가 좋습니다.

## Technical Details

**Affected files:**
- `src/commands/owned/search_shadow_index.ts`
- `src/commands/owned/kiwi_tokenizer.ts`
- `src/commands/owned/update.ts`
- shadow rebuild integration tests

## Acceptance Criteria

- [x] SQLite write transaction 안에는 projection 계산이나 네트워크 다운로드가 남아 있지 않습니다
- [x] first-run shadow rebuild가 큰 corpus에서도 write lock을 불필요하게 길게 잡지 않습니다
- [x] rebuild atomicity는 유지됩니다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- Reviewed commit `62728ef`
- Traced rebuild transaction boundaries and tokenizer async path
- Identified lock-holding work happening inside `BEGIN IMMEDIATE`

**Learnings:**
- correctness-first shadow rebuild이라도, async tokenization을 write lock 안에 두면 운영 리스크가 급격히 커집니다

### 2026-03-13 - Resolved

**By:** Codex

**Actions:**
- moved shadow projection precomputation ahead of `BEGIN IMMEDIATE`
- kept only delete/insert/metadata upsert inside the write transaction
- verified shadow rebuild tests and full suite after the refactor

**Learnings:**
- precompute-then-swap is enough here; a temp table was not required for the first fix
