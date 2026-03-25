---
status: complete
priority: p1
issue_id: "074"
tags: [code-review, performance, benchmark, security]
dependencies: []
---

# Harden cold-start benchmark trust and isolation

## Problem Statement

새 cold-start benchmark는 release gate에 들어갔지만, 현재 구현은 실제 fresh child-process end-to-end 비용을 재지 못하고 benchmark 실행 환경도 hermetic하지 않습니다. 이 상태에서는 release artifact가 남기는 숫자를 근거로 “cold-start가 개선됐다”고 주장하기 어렵습니다.

## Findings

- [`scripts/query_cold_start_probe.ts:26`](../scripts/query_cold_start_probe.ts#L26) 에서 `createStore()`와 stub 설치를 마친 뒤에야 timer를 시작하므로, process startup/module load/DB-open 비용이 `elapsedMs`에 포함되지 않습니다.
- [`scripts/measure_query_cold_start.ts:150`](../scripts/measure_query_cold_start.ts#L150) 은 child process에 `...process.env`를 그대로 넘겨 Bun runtime flags와 `.env` 영향이 benchmark에 스며들 수 있습니다.
- [`scripts/query_cold_start_probe.ts:49`](../scripts/query_cold_start_probe.ts#L49) 는 임의의 `displayPath`를 단순히 `qmd://` prefix로 감싸고, [`scripts/measure_query_cold_start.ts:42`](../scripts/measure_query_cold_start.ts#L42) 는 `qmd://` prefix만 있으면 안전하다고 간주해 artifact로 저장합니다.

## Proposed Solutions

### Option 1: Make the benchmark hermetic and truly end-to-end

**Approach:** child process timer를 process entrypoint 바로 앞/뒤로 옮기고, 허용된 env allowlist만 전달하며, persisted path는 relative/qmd allowlist를 별도 검증합니다.

**Pros:**
- release gate 숫자를 신뢰할 수 있습니다.
- benchmark artifact contract가 문서 주장과 일치합니다.

**Cons:**
- probe/parent script 구조를 조금 더 엄격하게 정리해야 합니다.

**Effort:** Medium

**Risk:** Low

---

### Option 2: Keep the current script but re-scope the claim

**Approach:** release gate에서 제거하고 “query core synthetic probe” 정도로만 문서화합니다.

**Pros:**
- 코드 변경이 적습니다.

**Cons:**
- 이번 작업의 핵심 acceptance criterion을 충족하지 못합니다.
- release gate 가치가 크게 떨어집니다.

**Effort:** Small

**Risk:** High

## Recommended Action

benchmark를 hermetic child-process wall-clock 측정으로 재구성했다. sample별 isolated DB snapshot/env를 만들고, persisted path는 allowlist 검증을 거친 `qmd://` relative path만 남기도록 강화했다.

## Technical Details

**Affected files:**
- [`scripts/measure_query_cold_start.ts`](../scripts/measure_query_cold_start.ts)
- [`scripts/query_cold_start_probe.ts`](../scripts/query_cold_start_probe.ts)
- [`scripts/query_cold_start_benchmark_lib.ts`](../scripts/query_cold_start_benchmark_lib.ts)
- [`package.json`](../package.json)

## Resources

- Review findings: performance-oracle, security-sentinel
- Related learning: [`docs/solutions/logic-errors/query-recall-benchmark-contract-drift-kqmd-cli-20260320.md`](../docs/solutions/logic-errors/query-recall-benchmark-contract-drift-kqmd-cli-20260320.md)
- Related release doc: [`docs/release.md`](../docs/release.md)

## Acceptance Criteria

- [x] `elapsedMs`가 child process bootstrap과 DB open을 포함한 실제 end-to-end wall-clock을 측정한다
- [x] benchmark child env는 allowlist 기반으로만 전달된다
- [x] persisted benchmark artifact는 relative/qmd allowlisted path만 저장한다
- [x] release gate 문구와 benchmark artifact contract가 일치한다

## Work Log

### 2026-03-25 - Code Review Finding

**By:** Codex

**Actions:**
- 새 cold-start benchmark parent/probe 스크립트를 검토했습니다.
- timer 시작 지점과 child env 전달 방식을 확인했습니다.
- artifact path sanitization이 실제 absolute path를 막는지 확인했습니다.

**Learnings:**
- 성능 benchmark는 숫자만 맞아도 충분하지 않고, 측정 범위와 hermeticity가 먼저 맞아야 release gate로 쓸 수 있습니다.

### 2026-03-25 - Resolved

**By:** Codex

**Actions:**
- child probe가 raw `displayPath`를 그대로 persist하지 않도록 allowlisted benchmark path helper를 추가했습니다.
- parent benchmark script가 sample별 isolated env와 DB snapshot copy를 사용하도록 바꿨습니다.
- `elapsedMs`를 parent에서 `execFile` 전체 wall-clock으로 측정하도록 변경했습니다.
- benchmark fixture를 default plain query semantics에 맞게 조정하고 `bun run measure:query-cold-start`, `bun run release:verify`를 통과시켰습니다.

**Learnings:**
- release benchmark는 “무엇을 잰다”고 문서에 쓰는 순간, timer boundary와 env boundary를 둘 다 코드로 고정해야 합니다.

## Notes

- release gate에 이미 들어간 benchmark이므로 merge blocker로 분류합니다.
