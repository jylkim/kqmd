---
status: complete
priority: p2
issue_id: "018"
tags: [code-review, search, kiwi, runtime, reliability]
dependencies: []
---

# Reduce clean search path dependence on live Kiwi bootstrap

## Problem Statement

현재 구현은 shadow index가 이미 clean 상태여도, Hangul query를 처리할 때마다 `buildKoreanAwareLexQuery()`를 통해 Kiwi runtime을 초기화하고 필요하면 모델 파일을 내려받습니다. 즉 index가 이미 준비된 상태에서도 search availability가 local model cache/network 상태에 묶여 있습니다.

결과적으로 "index는 clean인데 Hangul search가 실패한다"는 상태가 가능해집니다. 이는 status가 말하는 건강 상태와 실제 search 가능성이 어긋나는 UX입니다.

## Findings

- [`src/commands/owned/search.ts:91`](/Users/jylkim/kqmd/src/commands/owned/search.ts#L91)~[`src/commands/owned/search.ts:100`](/Users/jylkim/kqmd/src/commands/owned/search.ts#L100) 에서 clean shadow path는 항상 `buildKoreanAwareLexQuery()`를 거칩니다.
- [`src/commands/owned/kiwi_tokenizer.ts:92`](/Users/jylkim/kqmd/src/commands/owned/kiwi_tokenizer.ts#L92)~[`src/commands/owned/kiwi_tokenizer.ts:101`](/Users/jylkim/kqmd/src/commands/owned/kiwi_tokenizer.ts#L101) 에서 Kiwi build가 필요합니다.
- 모델 파일이 없으면 [`src/commands/owned/kiwi_tokenizer.ts:76`](/Users/jylkim/kqmd/src/commands/owned/kiwi_tokenizer.ts#L76) 부터 network fetch를 수행합니다.
- status/search health는 shadow table completeness만 보고 clean을 계산하므로, "query-time Kiwi unavailable"은 health model에 반영되지 않습니다.

## Proposed Solutions

### Option 1: Degrade gracefully on clean-path Kiwi failure

**Approach:** clean shadow path에서 query expansion만 실패한 경우 legacy lexical fallback + stderr warning으로 내려갑니다.

**Pros:**
- search availability를 높입니다
- status/search 간 의미 차이를 줄입니다

**Cons:**
- clean path semantics가 조금 덜 엄격해집니다

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Prewarm/persist query-time Kiwi requirement

**Approach:** update 시점에 Kiwi 준비 여부를 stronger contract로 두고, search는 clean 상태에서만 cached Kiwi runtime을 전제하도록 문서/health를 강화합니다.

**Pros:**
- 정책 의미가 더 분명합니다

**Cons:**
- search availability가 여전히 runtime bootstrap에 묶입니다

**Effort:** 2-3 hours

**Risk:** Medium

## Recommended Action

## Technical Details

**Affected files:**
- `src/commands/owned/search.ts`
- `src/commands/owned/kiwi_tokenizer.ts`
- `src/commands/owned/search_index_health.ts`
- `test/owned-search-behavior.test.ts`

## Resources

- Commit under review: `62728ef`

## Acceptance Criteria

- [x] clean shadow index가 있어도 Kiwi runtime bootstrap failure 때문에 Hangul search가 hard-fail 하는 경로가 제거되거나 명시적으로 재설계된다
- [x] status가 말하는 search health와 실제 search availability의 의미 차이가 줄어든다
- [x] command-level regression test가 추가된다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- Reviewed the clean Hangul search branch in `src/commands/owned/search.ts`
- Traced runtime dependency from query expansion to Kiwi wasm/model download
- Flagged reliability gap between clean health and actual search availability

**Learnings:**
- shadow index readiness와 query-time tokenizer readiness는 서로 다른 failure domain입니다

### 2026-03-13 - Resolved

**By:** Codex

**Actions:**
- removed live Kiwi query expansion from the clean shadow search path
- kept Korean search on the clean path dependent only on the shadow FTS state
- added command-level clean shadow path coverage

**Learnings:**
- query-time Kiwi dependency was unnecessary once the document-side shadow projection existed
