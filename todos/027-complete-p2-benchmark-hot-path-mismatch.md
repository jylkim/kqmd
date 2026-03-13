---
status: complete
priority: p2
issue_id: "027"
tags: [code-review, performance, benchmark, docs, reliability]
dependencies: []
---

# Align reliability benchmarks with the real hot path

현재 benchmark 스크립트와 기록 문서는 실제 `qmd search` / rebuild contention hot path보다 더 좁은 경로를 측정해, 결과가 과도하게 낙관적으로 보일 수 있습니다.

## Problem Statement

`scripts/measure_kiwi_search_reliability.ts`는:

- clean search에서 `handleSearchCommand()` 전체가 아니라 `searchShadowIndex()`를 직접 측정하고
- contention probe에서 실제 rebuild write profile 대신 idle `BEGIN IMMEDIATE` 상태만 측정합니다

이 때문에 문서에 기록된 p50/p95와 contention 결과가 “실제 사용자-facing hot path”의 근거처럼 읽히기 어렵습니다.

## Findings

- 관련 코드/문서:
  - `scripts/measure_kiwi_search_reliability.ts`
  - `docs/benchmarks/2026-03-13-kiwi-search-reliability-metrics.md`
  - `docs/development.md`
- 영향:
  - release go/no-go 판단에서 overly-optimistic benchmark를 참고할 수 있음

## Proposed Solutions

### Option 1: Narrow the benchmark claims

**Approach:** 현재 스크립트가 측정하는 것이 “internal shadow FTS proxy metrics”임을 명확히 문서화합니다.

**Pros:**
- 구현 변경이 작습니다
- 현재 숫자를 덜 오해하게 만듭니다

**Cons:**
- 실제 hot path benchmark는 여전히 비어 있습니다

**Effort:** Small

**Risk:** Low

### Option 2: Measure the real command path

**Approach:** `handleSearchCommand()` / `handleStatusCommand()` 또는 실제 CLI invocation을 포함하는 benchmark로 확장합니다.

**Pros:**
- user-facing latency 근거가 더 정확해집니다
- release gate와 직접 연결하기 쉽습니다

**Cons:**
- harness가 더 느리고 복잡해집니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Option 1로 문서 claim을 먼저 좁히고, 필요하면 Option 2를 별도 follow-up으로 진행한다.

## Acceptance Criteria

- [x] benchmark 문서가 실제로 측정한 범위와 한계를 명시한다
- [x] hot path benchmark가 아니라면 release evidence로 과장해 쓰지 않는다
- [x] 필요 시 real command-path benchmark follow-up이 분리된다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- performance-oracle 결과를 바탕으로 benchmark harness와 recorded metrics의 해석 범위를 검토했다
- 측정 경로와 user-facing hot path 사이의 차이를 P2 finding으로 기록했다

**Learnings:**
- benchmark는 숫자 자체보다 “무엇을 측정했는지”를 정확히 적는 것이 더 중요하다

### 2026-03-13 - Scope Narrowed

**By:** Codex

**Actions:**
- `scripts/measure_kiwi_search_reliability.ts`의 metric field와 markdown header를 internal helper/proxy 기준으로 다시 이름 붙였다
- `docs/benchmarks/2026-03-13-kiwi-search-reliability-metrics.md`에 측정 범위, 제외 범위, contention probe 한계를 명시했다
- `docs/development.md`와 reliability plan에서 benchmark를 internal regression signal로만 쓰고, 실제 `qmd update/status/search` 근거는 manual CLI proof와 focused tests로 분리한다고 정리했다

**Learnings:**
- benchmark harness가 helper 레이어를 직접 재면 결과 문서와 metric 이름도 같은 abstraction level에 맞춰 써야 오해가 줄어든다
