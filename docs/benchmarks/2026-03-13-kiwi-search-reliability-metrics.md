# Kiwi Search Reliability Proxy Metrics

Date: 2026-03-13
Command: `bun run measure:kiwi-reliability`

이 문서는 Kiwi search reliability contract 작업에서 small / medium / large fixture 기준으로 측정한 로컬 internal proxy benchmark 기록이다. `bun run measure:kiwi-reliability`는 end-to-end `qmd update` / `qmd status` / `qmd search` command latency를 재지 않는다. 대신 synthetic fixture에서 `store.update()`, `rebuildSearchShadowIndex()`, `readSearchIndexHealth()`, `searchShadowIndex()`, `store.searchLex()`, 그리고 idle `BEGIN IMMEDIATE` probe를 측정한다. 수치는 developer laptop 기준 참고값이며, 절대 기준보다는 회귀 비교 기준으로 사용한다.

## Method

- fixture 규모:
  - `small`: 10 docs
  - `medium`: 100 docs
  - `large`: 500 docs
- 측정 항목:
  - upstream `store.update()` 시간
  - `rebuildSearchShadowIndex()` 전체 / projection / write 시간
  - `readSearchIndexHealth()` proxy cold / hot 시간
  - `searchShadowIndex()` helper proxy p50 / p95
  - stale 상태 proxy로 `store.searchLex()` p50 / p95
  - primary connection이 idle `BEGIN IMMEDIATE`를 잡고 있을 때 secondary helper probe 시간
- tokenizer:
  - benchmark에서는 shadow projection/write 경향을 보기 위해 lightweight deterministic tokenize stub를 사용했다
- 제외 범위:
  - `handleUpdateCommand()` / `handleStatusCommand()` / `handleSearchCommand()` 전체 경로
  - store open/close, collection resolution, output formatting, stderr advisory, embedding health read
  - 실제 rebuild write profile과 겹치는 contention scenario

## Results

| Scale | Docs | store.update() (ms) | Rebuild (ms) | Projection (ms) | Write (ms) | Health-read proxy cold/hot (ms) | Shadow helper proxy p50/p95 (ms) | Legacy searchLex proxy p50/p95 (ms) | Idle-writer health/shadow probe (ms) | Probe error |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| small | 10 | 113.73 | 1 | 0 | 1 | 0.07 / 0.04 | 0.34 / 0.49 | 0.33 / 0.6 | 0.12 / 0.26 | none |
| medium | 100 | 95.44 | 1 | 0 | 1 | 0.59 / 0.08 | 0.43 / 1.27 | 0.4 / 0.85 | 0.16 / 0.36 | none |
| large | 500 | 316.7 | 4 | 0 | 3 | 0.2 / 0.13 | 1.34 / 2.06 | 0.85 / 1.09 | 0.23 / 0.78 | none |

## Notes

- 이 측정에서는 500-doc 규모까지 shadow rebuild의 write phase와 internal helper timings만 기록했다.
- `readSearchIndexHealth()` helper proxy는 cold / hot 모두 매우 가볍게 유지됐다.
- idle `BEGIN IMMEDIATE` probe에서는 secondary helper read/query에서 `SQLITE_BUSY`가 관찰되지 않았지만, 이는 실제 rebuild contention보다 가벼운 시나리오다.
- fixture와 tokenize stub가 단순하므로, 실제 repo 데이터에서는 절대값보다 추세 비교가 더 중요하다.
- 이 문서는 internal regression signal이다. user-facing `qmd status` / `qmd search` hot path 근거는 command-level tests와 manual CLI proof를 함께 본다.
