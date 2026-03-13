---
status: complete
priority: p1
issue_id: "024"
tags: [cli, kiwi, search, reliability, sqlite, typescript]
dependencies: []
---

# Harden Kiwi search reliability contract

`qmd update`, `qmd status`, `qmd search` 사이의 Kiwi health contract를 실제 런타임에서도 믿을 수 있게 고정한다.

## Problem Statement

현재 구현은 Kiwi preflight, shadow rebuild, stale fallback 같은 핵심 요소를 이미 갖고 있지만, shadow index freshness를 `policy id`와 `문서 수` 중심으로만 판단한다. 이 때문에 문서 내용이 바뀌었는데 row count는 같을 때 `status`와 `search`가 `clean`으로 오판할 가능성이 남아 있다.

## Findings

- 관련 코드:
  - `src/commands/owned/search_index_health.ts`
  - `src/commands/owned/search_shadow_index.ts`
  - `src/commands/owned/update.ts`
  - `src/commands/owned/search.ts`
  - `src/commands/owned/status.ts`
- 현재 테스트는 stale fallback, clean shadow path, quoted fallback, preflight-before-mutation을 이미 검증한다.
- 하지만 “문서 수는 같지만 shadow projection 세대가 뒤처진 상태”를 직접 잡는 health signal은 없다.

## Proposed Solutions

### Option 1: Add source snapshot metadata to the shadow index

`update`/shadow rebuild 시 현재 active documents의 source snapshot을 metadata로 저장하고, `status/search` health가 current snapshot과 stored snapshot을 비교한다.

**Pros:**
- 현 구조를 유지하면서 false clean 가능성을 줄인다
- `status`와 `search`가 같은 health contract를 공유하기 쉽다

**Cons:**
- metadata shape와 테스트를 함께 갱신해야 한다

**Effort:** Medium

**Risk:** Low

### Option 2: Keep count-based health and rely only on command failures

health는 그대로 두고, rebuild failure 시 command-level failure만 강화한다.

**Pros:**
- 구현이 더 작다

**Cons:**
- stale-but-clean 오판 가능성을 남긴다
- 계획의 핵심 계약을 제대로 닫지 못한다

**Effort:** Small

**Risk:** Medium

## Recommended Action

Option 1을 택한다. source snapshot metadata를 shadow index health contract에 추가하고, 관련 command behavior, tests, docs, plan progress를 함께 갱신한다.

## Acceptance Criteria

- [x] shadow index health가 source snapshot drift를 감지할 수 있다
- [x] `status clean`과 실제 plain Hangul search clean path 의미가 더 강하게 정렬된다
- [x] 기존 focused test suite에 regression이 추가된다
- [x] 관련 plan 체크박스와 work log가 갱신된다

## Work Log

### 2026-03-13 - Execution Started

**By:** Codex

**Actions:**
- execution plan과 현재 implementation/test 상태를 확인했다
- focused Kiwi/search/status/update test suite가 현재 green임을 확인했다
- 남은 핵심 공백으로 source snapshot 없는 false clean 가능성을 식별했다

**Learnings:**
- 현재 구현은 이미 강하지만, freshness signal이 policy id + document count 중심이라 “같은 count의 다른 세대”를 구분하는 장치가 필요하다

### 2026-03-13 - Source Snapshot Contract Implemented

**By:** Codex

**Actions:**
- `src/config/search_policy.ts`에 source snapshot metadata key를 추가했다
- `src/commands/owned/search_index_health.ts`에 current/stored source snapshot 비교를 넣어 same-count drift도 `stale-shadow-index`로 분류하게 했다
- `src/commands/owned/search_shadow_index.ts`가 rebuild 시 source snapshot metadata를 함께 기록하게 했다
- `src/commands/owned/search.ts`에 explicit execution path 분기를 추가해 snapshot drift 시 legacy fallback + stderr advisory가 유지되게 했다
- `src/commands/owned/kiwi_tokenizer.ts`에 symlinked Kiwi cache artifact 거부를 추가했다
- `test/search-index-health.test.ts`, `test/search-shadow-index.test.ts`, `test/owned-search-behavior.test.ts`, `test/owned-command-parity/search-output.test.ts`, `test/status-command.test.ts`, `test/kiwi-tokenizer.test.ts`, `test/search-policy.test.ts`를 갱신했다
- `docs/development.md`에 Kiwi search reliability proof 절차를 추가했다
- `bun run test -- kiwi-tokenizer search-policy search-index-health search-shadow-index owned-search-behavior status-command owned-embedding-behavior owned-command-parity/search-output`, `bun run typecheck`, `bun run lint`, `bun run check`, `bun run test:parity`를 실행해 모두 green을 확인했다

**Learnings:**
- `policy id + document count`만으로는 충분하지 않고, source snapshot metadata가 있어야 false clean을 줄일 수 있다
- focused `behavior`, `health`, `parity` suite를 확장하는 방식이 새 umbrella test보다 저장소 패턴에 더 잘 맞는다

### 2026-03-13 - Metadata-First Status Path and Contract Tests

**By:** Codex

**Actions:**
- `src/config/search_policy.ts`에 current snapshot metadata key를 추가했다
- `src/commands/owned/update.ts`가 upstream update 직후 current snapshot metadata를 먼저 기록하게 했다
- `src/commands/owned/search_index_health.ts`가 default path에서는 current docs snapshot을 읽고, `status` 전용 경로에서는 stored current snapshot metadata를 사용할 수 있게 정리했다
- `src/commands/owned/search.ts`의 execution path helper를 export하고, `test/search-execution-path.test.ts`를 추가해 health/status/path union 분기를 고정했다
- `test/status-command.test.ts`에 metadata-only health read 경로를 추가했다
- 다시 `bun run typecheck`, `bun run lint`, `bun run test -- search-policy search-index-health search-shadow-index search-execution-path owned-search-behavior status-command owned-embedding-behavior owned-command-parity/search-output`, `bun run check`를 실행해 green을 확인했다

**Learnings:**
- correctness와 hot-path 비용을 같이 가져가려면 default health read와 metadata-fast-path를 분리하는 편이 더 안전하다
- `SearchExecutionPath` 같은 작은 명시적 계약 타입을 내보내면 test와 implementation이 같은 vocabulary를 공유하기 쉬워진다

### 2026-03-13 - Parameterization and Benchmark Closure

**By:** Codex

**Actions:**
- `test/search-shadow-index.test.ts`에 FTS query와 collection filter가 SQL 문자열이 아니라 바인딩 파라미터로 전달되는지 검증하는 회귀 테스트를 추가했다
- `test/owned-runtime-security.test.ts`를 추가해 owned runtime 경로에 shell-based child process invocation이 없음을 고정했다
- `scripts/measure_kiwi_search_reliability.ts`와 `package.json#measure:kiwi-reliability`를 추가했다
- `bun run measure:kiwi-reliability`를 실행하고 결과를 `docs/benchmarks/2026-03-13-kiwi-search-reliability-metrics.md`에 기록했다
- `docs/development.md`와 reliability plan을 최신 검증 절차와 benchmark 결과에 맞게 갱신했다

**Learnings:**
- runtime security guardrail은 기능 코드가 아니라 메타 테스트와 sanitized stderr 테스트를 같이 둘 때 유지보수가 쉽다
- benchmark 결과를 문서로 남기면 “측정 가능해야 한다”가 실제 운영 기준으로 바뀐다
