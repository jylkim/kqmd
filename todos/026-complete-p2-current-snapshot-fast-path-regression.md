---
status: complete
priority: p2
issue_id: "026"
tags: [code-review, reliability, performance, status, metadata, sqlite]
dependencies: []
---

# Revisit current snapshot metadata fast path

`kqmd_search_current_snapshot` fast-path은 `status` 비용을 줄이려는 의도였지만, 상태 모델을 넓히고 `update` no-op 경로에 추가 write를 만들어냈습니다.

## Problem Statement

현재 구현은 `source snapshot` 외에 `current snapshot` metadata를 별도로 저장하고, `status`가 이를 신뢰하도록 분기합니다. 이로 인해:

- `update`가 실제 변경이 없어도 metadata write를 하나 더 수행할 수 있고
- `current snapshot`이 누락되거나 stale하면 `status`와 `search`의 해석이 갈라질 수 있으며
- stale 판정 로직이 “단일 source of truth”에서 멀어집니다

즉, 상태 모델이 richer해진 대신 correctness와 hot-path simplicity가 함께 흔들렸습니다.

## Findings

- 관련 코드:
  - `src/commands/owned/update.ts`
  - `src/commands/owned/search_index_health.ts`
  - `src/commands/owned/status.ts`
  - `src/commands/owned/search_shadow_index.ts`
- 영향:
  - no-op `qmd update`에서도 extra SQLite write가 생길 수 있음
  - `status clean`과 실제 search readiness가 다시 갈라질 위험이 있음

## Proposed Solutions

### Option 1: Remove current snapshot metadata and compute live state only

**Approach:** `status`도 live snapshot을 계산하고, mutable metadata는 `source snapshot` 하나만 유지합니다.

**Pros:**
- 상태 모델이 단순해집니다
- single source of truth에 가깝습니다

**Cons:**
- `status` read 비용이 더 커질 수 있습니다

**Effort:** Medium

**Risk:** Low

### Option 2: Keep current snapshot metadata but only write on changed updates

**Approach:** `searchChanged` 또는 explicit mismatch일 때만 current snapshot metadata를 갱신합니다.

**Pros:**
- no-op update write를 줄입니다
- 현재 구현을 더 적게 흔듭니다

**Cons:**
- 두 snapshot metadata를 계속 유지해야 합니다
- parity bug 가능성을 완전히 없애지 못합니다

**Effort:** Small

**Risk:** Medium

## Recommended Action

Option 1을 우선 검토한다. 이 영역은 성능 최적화보다 correctness와 상태 모델 단순성이 더 중요하다.

## Acceptance Criteria

- [x] no-op `qmd update`가 불필요한 metadata write를 만들지 않는다
- [x] `status`와 `search`가 동일한 freshness 의미를 유지한다
- [x] current/source snapshot ownership이 문서와 코드 모두에서 단순해진다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- performance-oracle, code-simplicity-reviewer, agent-native-reviewer 결과를 종합했다
- current snapshot fast-path이 extra write와 parity drift를 만들 수 있음을 P2 finding으로 기록했다

**Learnings:**
- metadata fast-path은 읽기 비용을 줄이는 대신 상태 모델을 늘릴 수 있으므로, reliability 작업에서는 단순성 우선 판단이 중요하다

### 2026-03-13 - Resolution Complete

**By:** Codex

**Actions:**
- `kqmd_search_current_snapshot` fast-path을 제거하고, persisted freshness state를 `source snapshot` 중심으로 다시 단순화했다
- `src/commands/owned/update.ts`에서 no-op update 전에 추가 metadata write가 발생하지 않도록 정리했다
- `src/commands/owned/status.ts`가 live snapshot 기준 health를 다시 읽도록 조정했다
- `test/update-command.test.ts`에 no-op update metadata write 회귀 테스트를 추가했다
- 관련 suite와 `bun run check`를 통해 no-op update / status / search parity를 재검증했다

**Learnings:**
- fast path 최적화는 correctness와 상태 ownership을 넓히지 않는 범위에서만 도입해야 한다
