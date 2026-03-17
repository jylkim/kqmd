# Adaptive Query Ranking Metrics

Date: 2026-03-17
Command: `bun run measure:query-adaptive`

이 문서는 adaptive query ranking의 local overhead 참고값이다.
실제 corpus / model latency 대신 local classification, ranking, row shaping, formatting 오버헤드를 비교하기 위한 synthetic harness다.

| Scenario | Iterations | Fetch limit | rerank=false calls | Rows | Max body (bytes) | p50 (ms) | p95 (ms) | Heap delta (KB) | RSS delta (KB) | Peak heap (KB) | Peak RSS (KB) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| short-korean-phrase | 100 | 20 | 100 | 20 | 70 | 1.03 | 1.87 | 3243.86 | 76480 | 8589.37 | 173472 |
| short-korean-phrase-candidate40 | 100 | 40 | 100 | 40 | 70 | 1.03 | 1.87 | 3243.86 | 76432 | 8589.37 | 173504 |
| mixed-technical | 100 | 15 | 0 | 20 | 82 | 1.03 | 1.86 | 3243.86 | 76432 | 8589.37 | 173504 |
| mixed-technical-explain | 100 | 15 | 0 | 20 | 82 | 1.03 | 1.85 | 3243.86 | 76432 | 8589.37 | 173520 |
| mixed-technical-candidate40-large-body-vectors | 60 | 15 | 0 | 40 | 6093 | 1.15 | 2.74 | 3243.86 | 74224 | 8589.37 | 171680 |
| mixed-technical-candidate50-large-body-vectors-full | 60 | 15 | 0 | 50 | 6093 | 1.18 | 2.75 | 3243.86 | 73792 | 8589.37 | 171696 |
| mixed-technical-candidate50-large-body-vectors-explain | 60 | 15 | 0 | 50 | 6093 | 1.18 | 2.76 | 3243.86 | 73408 | 8589.37 | 171728 |

## Derived Signals

- mixed-technical explain p95 overhead: -0.54%
- mixed-technical candidate50/full p95 regression vs candidate40/explain large-body vectors: 0.36%

JSON
[
  {
    "scenario": "short-korean-phrase",
    "iterations": 100,
    "fetchLimit": 20,
    "rerankDisabledCalls": 100,
    "rowCount": 20,
    "maxBodyBytes": 70,
    "p50Ms": 1.03,
    "p95Ms": 1.87,
    "heapDeltaKb": 3243.86,
    "rssDeltaKb": 76480,
    "peakHeapKb": 8589.37,
    "peakRssKb": 173472
  },
  {
    "scenario": "short-korean-phrase-candidate40",
    "iterations": 100,
    "fetchLimit": 40,
    "rerankDisabledCalls": 100,
    "rowCount": 40,
    "maxBodyBytes": 70,
    "p50Ms": 1.03,
    "p95Ms": 1.87,
    "heapDeltaKb": 3243.86,
    "rssDeltaKb": 76432,
    "peakHeapKb": 8589.37,
    "peakRssKb": 173504
  },
  {
    "scenario": "mixed-technical",
    "iterations": 100,
    "fetchLimit": 15,
    "rerankDisabledCalls": 0,
    "rowCount": 20,
    "maxBodyBytes": 82,
    "p50Ms": 1.03,
    "p95Ms": 1.86,
    "heapDeltaKb": 3243.86,
    "rssDeltaKb": 76432,
    "peakHeapKb": 8589.37,
    "peakRssKb": 173504
  },
  {
    "scenario": "mixed-technical-explain",
    "iterations": 100,
    "fetchLimit": 15,
    "rerankDisabledCalls": 0,
    "rowCount": 20,
    "maxBodyBytes": 82,
    "p50Ms": 1.03,
    "p95Ms": 1.85,
    "heapDeltaKb": 3243.86,
    "rssDeltaKb": 76432,
    "peakHeapKb": 8589.37,
    "peakRssKb": 173520
  },
  {
    "scenario": "mixed-technical-candidate40-large-body-vectors",
    "iterations": 60,
    "fetchLimit": 15,
    "rerankDisabledCalls": 0,
    "rowCount": 40,
    "maxBodyBytes": 6093,
    "p50Ms": 1.15,
    "p95Ms": 2.74,
    "heapDeltaKb": 3243.86,
    "rssDeltaKb": 74224,
    "peakHeapKb": 8589.37,
    "peakRssKb": 171680
  },
  {
    "scenario": "mixed-technical-candidate50-large-body-vectors-full",
    "iterations": 60,
    "fetchLimit": 15,
    "rerankDisabledCalls": 0,
    "rowCount": 50,
    "maxBodyBytes": 6093,
    "p50Ms": 1.18,
    "p95Ms": 2.75,
    "heapDeltaKb": 3243.86,
    "rssDeltaKb": 73792,
    "peakHeapKb": 8589.37,
    "peakRssKb": 171696
  },
  {
    "scenario": "mixed-technical-candidate50-large-body-vectors-explain",
    "iterations": 60,
    "fetchLimit": 15,
    "rerankDisabledCalls": 0,
    "rowCount": 50,
    "maxBodyBytes": 6093,
    "p50Ms": 1.18,
    "p95Ms": 2.76,
    "heapDeltaKb": 3243.86,
    "rssDeltaKb": 73408,
    "peakHeapKb": 8589.37,
    "peakRssKb": 171728
  }
]
