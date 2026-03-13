---
status: complete
priority: p1
issue_id: "025"
tags: [code-review, reliability, search, health, collections, kiwi]
dependencies: []
---

# Fix collection-scoped search health scope mismatch

`qmd search -c <collection>`가 실제로는 선택된 컬렉션만 검색하면서도, health 판단은 전역 snapshot과 비교해 불필요하게 legacy fallback으로 떨어질 수 있습니다.

## Problem Statement

현재 `search`는 selected collection이 있을 때 `readSearchIndexHealth()`에 컬렉션 필터를 넘깁니다. 그런데 stored snapshot metadata는 전역 `kqmd_search_source_snapshot` 하나뿐이라, subset snapshot과 global snapshot이 항상 다를 수 있습니다. 그 결과 multi-collection index에서 collection-scoped Hangul search가 clean shadow path를 써야 할 상황에서도 `index-not-ready`로 오판될 수 있습니다.

이 문제는 검색 품질 저하를 넘어, 실제 실행 범위와 advisory 범위가 다시 어긋난다는 점에서 prior learning과 충돌합니다.

## Findings

- 관련 코드:
  - `src/commands/owned/search.ts`
  - `src/commands/owned/search_index_health.ts`
- 영향:
  - multi-collection index에서 `qmd search -c docs "형태소 분석"` 같은 명령이 shadow path를 못 타고 legacy fallback으로 강등될 수 있음
- Known Pattern:
  - `docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`
  - `docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md`

## Proposed Solutions

### Option 1: Keep search health global and make fallback policy global too

**Approach:** collection-scoped search도 전역 search health만 보고 clean 여부를 결정합니다.

**Pros:**
- 구현이 단순합니다
- global metadata 한 벌만 유지하면 됩니다

**Cons:**
- 실제 검색 범위보다 advisory 범위가 넓어집니다
- prior learning의 scope-aligned warning 원칙과 어긋납니다

**Effort:** Small

**Risk:** Medium

### Option 2: Add collection-aware snapshot semantics

**Approach:** search health가 subset scope에서도 의미를 갖도록, collection-filtered current snapshot과 비교 가능한 기준을 도입합니다.

**Pros:**
- advisory와 실제 실행 범위를 맞출 수 있습니다
- selected collection search가 shadow path를 더 정확히 사용합니다

**Cons:**
- snapshot/metadata 설계가 복잡해집니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Option 2를 우선 검토한다. collection-filtered search에서도 advisory scope가 실제 실행 범위와 같아야 한다는 기존 learnings를 유지하는 쪽이 제품적으로 더 안전하다.

## Acceptance Criteria

- [x] multi-collection index에서 `-c <collection>` Hangul search가 불필요하게 legacy fallback으로 떨어지지 않는다
- [x] search warning/advisory 범위가 실제 검색 범위와 다시 일치한다
- [x] 관련 regression test가 추가된다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- current diff에 대한 multi-agent review를 수행했다
- learnings-researcher와 agent-native-reviewer 결과를 바탕으로 collection-scoped health mismatch를 P1 finding으로 분류했다

**Learnings:**
- snapshot metadata를 전역 기준으로만 두면, selected collection search의 advisory scope가 쉽게 다시 틀어진다

### 2026-03-13 - Resolution Complete

**By:** Codex

**Actions:**
- `src/commands/owned/search_index_health.ts`에 collection-scoped stored snapshot aggregation을 추가했다
- `src/commands/owned/search_shadow_index.ts`가 rebuild 시 `kqmd_search_collection_snapshots` metadata를 함께 기록하게 했다
- `src/commands/owned/search.ts`가 실제 `selectedCollections` 범위로 search health를 읽도록 조정했다
- `test/search-shadow-index.test.ts`와 `test/owned-search-behavior.test.ts`에 multi-collection collection-scoped clean-path regression을 추가했다
- `bun run test -- search-shadow-index owned-search-behavior search-index-health search-policy update-command status-command owned-command-parity/search-output`와 `bun run typecheck`로 관련 경로를 검증했다

**Learnings:**
- scope-aligned advisory를 지키려면 stored snapshot도 subset aggregation이 가능해야 한다
