---
status: complete
priority: p3
issue_id: "051"
tags: [code-review, benchmarks, performance, query]
dependencies: []
---

# Query benchmarks miss large-body and vector cases

새 benchmark harness는 useful하지만, 현재 구성만으로는 large-body/vector-heavy 회귀를 잡기 어렵습니다.

## Problem Statement

현재 synthetic benchmark는 작은 row 20개 위주이고, E2E benchmark는 vectors absent fixture만 측정합니다. 그래서 candidate window 40/50, full-body snippet cost, vector-enabled query path, peak heap/RSS 같은 이번 브랜치의 잠재 비용 축을 충분히 커버하지 못합니다.

## Findings

- `scripts/measure_query_adaptive_ranking.ts` 는 small synthetic row set 위주입니다.
- `scripts/measure_query_adaptive_e2e.ts` 는 vectors absent temp store만 다룹니다.
- 현재 generated metrics만으로는 “large body + vectors present + candidate window 40/50” 회귀를 증명하기 어렵습니다.

## Proposed Solutions

### Option 1: synthetic harness 확장

**Approach:** large-body fixtures, candidate-limit sweeps, peak heap/RSS 샘플링을 추가합니다.

**Pros:**
- 빠르게 regression coverage를 넓힐 수 있습니다
- local-only benchmark 유지가 쉽습니다

**Cons:**
- 실제 store/model path를 충분히 대체하지는 못합니다

**Effort:** Small

**Risk:** Low

---

### Option 2: E2E harness에 vector-enabled fixture 추가

**Approach:** temp store에 embeddings를 생성해 vectors-present baseline도 측정합니다.

**Pros:**
- mixed-technical 비용을 더 현실적으로 확인할 수 있습니다

**Cons:**
- local model availability와 benchmark 안정성이 더 까다롭습니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

synthetic/E2E benchmark를 large-body, vectors-present, `candidate-limit 40/50`, peak heap/RSS까지 포함하도록 확장하고 generated metrics 문서를 갱신한다.

## Technical Details

**Affected files:**
- `scripts/measure_query_adaptive_ranking.ts`
- `scripts/measure_query_adaptive_e2e.ts`
- `docs/benchmarks/2026-03-17-query-adaptive-ranking-metrics.md`
- `docs/benchmarks/2026-03-17-query-adaptive-e2e-metrics.md`

## Resources

- **Branch:** `feat/adaptive-korean-query-ranking`
- **Commit:** `99b4d2d`

## Acceptance Criteria

- [x] benchmark가 large-body / candidate-limit sweep / vector-enabled scenario를 적어도 하나 이상 포함한다
- [x] peak heap 또는 RSS를 관찰할 수 있다
- [x] regression 판단 기준이 문서에 더 명확히 남는다

## Work Log

### 2026-03-17 - Initial Review Finding

**By:** Codex

**Actions:**
- 새 benchmark harness 두 개와 generated metrics를 검토
- missing coverage cases를 P3 todo로 기록

**Learnings:**
- 성능 측정 자체는 추가됐지만, regression net은 아직 더 넓힐 수 있다

### 2026-03-17 - Resolved

**By:** Codex

**Actions:**
- synthetic ranking harness에 large-body/vector-heavy/candidate-limit `40/50` 시나리오와 heap/RSS peak 샘플링을 추가
- E2E harness에 seeded vectors-present fixture와 deterministic store-local LLM stub를 추가해 vector-enabled warm-cache path를 측정
- 개발 문서와 generated benchmark record를 새 coverage 축에 맞게 갱신

**Learnings:**
- 실제 모델을 띄우지 않고도 seeded vectors와 deterministic stub 조합으로 vector-path 회귀 신호를 꽤 안정적으로 남길 수 있다
