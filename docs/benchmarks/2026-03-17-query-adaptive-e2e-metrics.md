# Adaptive Query Ranking E2E Metrics

Date: 2026-03-17
Command: `bun run measure:query-adaptive-e2e`

이 문서는 temp fixture store에서 `createStore() + update()` 이후 warm-cache query를 재는 end-to-end benchmark다.
vectors absent fixture와 deterministic vector-signaled hybrid fixture를 같이 측정한다.
vector-signaled 케이스는 sqlite-vec availability와 무관하게 deterministic helper/LLM stub로 비용 축을 고정한다.

| Scenario | p50 (ms) | p95 (ms) | Heap delta (KB) | RSS delta (KB) | Peak heap (KB) | Peak RSS (KB) |
|---|---:|---:|---:|---:|---:|---:|
| 지속 학습 (adaptive) | 0.25 | 0.41 | 0 | 17392 | 7726 | 121568 |
| agent orchestration (baseline) | 1.14 | 1.4 | 3619.79 | 30592 | 11345.79 | 153216 |
| agent orchestration (adaptive) | 1.36 | 1.94 | 3673.84 | 8432 | 15019.63 | 161648 |
| agent orchestration (adaptive explain) | 1.35 | 1.89 | 2595.14 | 1456 | 17614.77 | 163104 |
| agent orchestration (baseline, vectors present, candidate40) | 3.41 | 4.02 | 1427.95 | 7504 | 19042.72 | 170624 |
| agent orchestration (adaptive, vectors present, candidate40) | 3.66 | 4.24 | 751.53 | 1280 | 19794.25 | 171904 |
| agent orchestration (adaptive explain+full, vectors present, candidate50) | 4.46 | 5.24 | 930.78 | 1680 | 20725.03 | 173584 |

## Derived Signals

- mixed-technical adaptive p95 regression vs baseline: 38.57%
- mixed-technical explain p95 overhead vs adaptive: -2.58%
- vector+candidate40 adaptive p95 regression vs baseline: 5.47%
- vector+candidate50 explain/full p95 overhead vs vector+candidate40 adaptive: 23.58%
