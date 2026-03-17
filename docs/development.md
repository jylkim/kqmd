# 개발자 문서

이 문서는 K-QMD 저장소를 직접 수정하거나 스캐폴딩을 확장하려는 개발자를 위한 문서입니다.
사용자 개요는 [README.md](../README.md)를 기준으로 봅니다.

## 개발 환경

- Bun `1.3.10`
- Node.js `>=24`
- TypeScript
- Vitest
- Biome

## 시작하기

```bash
bun install
bun run build
bun run check
```

## 주요 스크립트

- `bun run lint`
- `bun run format`
- `bun run typecheck`
- `bun run test`
- `bun run test:parity`
- `bun run test:release-contract`
- `bun run test:watch`
- `bun run test:coverage`
- `bun run build`
- `bun run check`
- `bun run measure:query-adaptive`
- `bun run measure:query-adaptive-e2e`
- `bun run release:artifact`
- `bun run release:verify`

## 현재 구조

- [`bin/qmd.js`](../bin/qmd.js)
  published CLI entrypoint
- [`src/cli.ts`](../src/cli.ts)
  top-level routing과 실행 진입점
- [`src/commands/manifest.ts`](../src/commands/manifest.ts)
  owned/passthrough 명령 source of truth
- [`src/config/embedding_policy.ts`](../src/config/embedding_policy.ts)
  effective embedding model policy와 bootstrap helper
- [`src/config/search_policy.ts`](../src/config/search_policy.ts)
  Korean lexical search policy와 source snapshot metadata key
- [`src/passthrough/delegate.ts`](../src/passthrough/delegate.ts)
  upstream `qmd` 위임 실행
- [`src/commands/owned/embedding_health.ts`](../src/commands/owned/embedding_health.ts)
  stored vector model mismatch / missing health 계산
- [`src/commands/owned/search_index_health.ts`](../src/commands/owned/search_index_health.ts)
  Korean shadow FTS policy health 계산
- [`src/commands/owned/search_shadow_index.ts`](../src/commands/owned/search_shadow_index.ts)
  same-DB shadow FTS rebuild / query helper
- [`src/commands/owned/kiwi_tokenizer.ts`](../src/commands/owned/kiwi_tokenizer.ts)
  Kiwi wasm/model cache bootstrap과 Korean token augmentation helper
- [`src/commands/owned/status.ts`](../src/commands/owned/status.ts)
  owned status output과 embedding/search health surface
- [`src/commands/owned/mcp.ts`](../src/commands/owned/mcp.ts)
  owned MCP CLI entry, stdio/HTTP/daemon dispatch
- [`src/mcp/server.ts`](../src/mcp/server.ts)
  local MCP server, tool/resource registration, HTTP transport (`/mcp`, `/health`, `/query`, `/search`)
- [`src/mcp/daemon_state.ts`](../src/mcp/daemon_state.ts)
  daemon PID/log safety helpers and daemon state inspection
- [`src/commands/owned/io/`](../src/commands/owned/io)
  owned command parse/validation/output parity contract
- [`src/config/qmd_paths.ts`](../src/config/qmd_paths.ts)
  upstream-compatible path helpers
- [`test/`](../test)
  routing, passthrough, path compatibility, bin smoke tests

## 패키징 계약

- 패키지 이름: `kqmd`
- 실행 명령: `qmd`
- `package.json#bin`이 [`bin/qmd.js`](../bin/qmd.js)를 가리킨다
- `bin/qmd.js`는 빌드 산출물인 `dist/cli.js`를 실행한다

## 검증 방법

### 전체 품질 게이트

```bash
bun run check
```

### owned CLI release contract gate

릴리즈 후보를 한 번에 재판단할 때는 아래 두 스크립트를 기준으로 본다.

```bash
# Fast gate: lint/typecheck/contract tests/reliability signal
bun run release:verify

# Artifact gate only: actual pack + tarball inspect + temp install smoke
bun run release:artifact
```

`release:verify`는 새 로직을 만드는 bespoke tool이 아니라, 기존 검증 명령을 canonical 순서로 묶는 얇은 entrypoint다.
`measure:kiwi-reliability`는 supporting signal이며, end-to-end CLI proof를 대체하지 않는다.

### MCP contract checks

```bash
bun run test -- mcp-command mcp-server mcp-http mcp-stdio mcp-runtime mcp-daemon-state query-core status-core
```

이 suite는 `mcp` route ownership, local server tool/resource exposure, `query/status` semantics,
stdio contamination safety, HTTP invalid/concurrent handling, read-path open policy, daemon path/process guard,
그리고 thin retrieval wrappers를 고정한다.

### MCP protocol smoke

```bash
# Automated protocol/invalid-input/concurrency coverage
bun run test -- mcp-http mcp-stdio

# Manual Inspector smoke when needed
npx @modelcontextprotocol/inspector node ./bin/qmd.js mcp
```

권장 manual checks:

- `tools/list`
- `resources/list` / `resources/read`
- invalid `query` input
- repeated `status`
- parallel `query` + `status`

Inspector smoke는 local protocol debugging 도구고, canonical gate는 계속 Vitest contract suite다.

### MCP performance metrics

```bash
bun run measure:mcp-contract
```

latest benchmark record:

- [docs/benchmarks/2026-03-16-mcp-contract-metrics.md](benchmarks/2026-03-16-mcp-contract-metrics.md)

### Adaptive query ranking metrics

```bash
bun run measure:query-adaptive
```

이 harness는 synthetic result set 위에서 adaptive query ranking의 local overhead를 기록한다.
실제 corpus/model latency가 아니라 아래 항목의 regression 신호로 본다.

- query class별 fetch window
- mixed-technical `candidate-limit` sweep (`40`, `50`)
- large-body row shaping / formatting cost
- vector explain signal이 섞인 row set에서의 local ranking cost
- `rerank: false` 적용 여부
- local classification/ranking/row shaping/formatting p50/p95
- process heap/RSS delta와 peak heap/RSS

latest benchmark record:

- [docs/benchmarks/2026-03-17-query-adaptive-ranking-metrics.md](benchmarks/2026-03-17-query-adaptive-ranking-metrics.md)

### Adaptive query ranking E2E metrics

```bash
bun run measure:query-adaptive-e2e
```

이 harness는 temp fixture store에서 `createStore() + update()` 이후 warm-cache query를 재는 end-to-end benchmark다.
vectors absent fixture와 deterministic vector-signaled hybrid fixture를 모두 사용한다.
mixed-technical 경로는 large-body 문서, `candidate-limit 40/50`, explain/full output 조합을 포함해 baseline/adaptive 회귀를 비교한다.
vector-signaled 케이스는 sqlite-vec availability와 무관하게 돌 수 있도록 deterministic store-local helper/LLM stub로 비용 축을 고정한다.

latest benchmark record:

- [docs/benchmarks/2026-03-17-query-adaptive-e2e-metrics.md](benchmarks/2026-03-17-query-adaptive-e2e-metrics.md)

### owned command parity suite

```bash
bun run test:parity
```

이 suite는 `search/query/update/embed`의 parse/validation/output contract를 고정한다.
특히 `search/query` success snapshot, `update/embed` success shape, upstream version guard를 포함한다.

### embedding policy / mismatch checks

```bash
bun run test -- embedding-policy embedding-health owned-embedding-behavior status-command
```

이 suite는 default embed policy precedence, stored vector mismatch detection, owned `status`,
그리고 `query/embed/update`의 mismatch-aware UX를 고정한다.

### Korean search policy / shadow index checks

```bash
bun run test -- search-policy search-index-health kiwi-tokenizer search-shadow-index owned-search-behavior status-command
```

이 suite는 canonical search policy, shadow index health classification, Kiwi token normalization,
same-DB shadow FTS rebuild/query, `status` health surface, 그리고 stale policy warning + legacy fallback UX를 고정한다.
freshness는 stored `source snapshot`과 live document snapshot만으로 계산한다.

### Kiwi search reliability proof

기능 테스트가 green이어도, 실제 런타임 계약은 아래 흐름으로 한 번 더 확인한다.

```bash
# 1. Reliability-focused suites
bun run test -- kiwi-tokenizer search-policy search-index-health search-shadow-index owned-search-behavior status-command owned-embedding-behavior owned-command-parity/search-output

# 1b. Record internal proxy metrics
bun run measure:kiwi-reliability

# 2. Manual CLI proof on a fixture collection
qmd update
qmd status
qmd search "형태소 분석"
qmd search '"형태소 분석"'
```

`measure:kiwi-reliability`는 synthetic fixture에서 `store.update()`, `rebuildSearchShadowIndex()`,
`readSearchIndexHealth()`, `searchShadowIndex()`, `store.searchLex()`, 그리고 `BEGIN IMMEDIATE`
contention probe를 재는 internal harness다. end-to-end `qmd update` / `qmd status` /
`qmd search` command latency benchmark는 아니므로, 아래 manual CLI proof와 focused test를
user-facing 근거로 함께 본다.

기대 결과:

- `qmd update`가 성공하면 Kiwi shadow index 동기화까지 끝난 상태여야 한다
- `qmd status`가 `clean`이면 plain Hangul `qmd search`는 warning 없이 shadow path를 사용해야 한다
- quoted/negated Hangul query는 보수적으로 legacy path를 유지할 수 있다
- stale/policy mismatch 상태에서는 `qmd search --json`도 stdout은 유지하고 stderr advisory만 추가해야 한다

성능/운영 메모:

- write-lock 보유 시간과 `store.update()`, search health metadata read, shadow/legacy helper search proxy latency는 small / medium / large fixture에서 비교 기록한다
- update 중 concurrent `status/search` 정책은 focused test + manual CLI proof로 확인하고, benchmark의 `BEGIN IMMEDIATE` probe는 보조 신호로만 사용한다
- latest benchmark record: [docs/benchmarks/2026-03-13-kiwi-search-reliability-metrics.md](benchmarks/2026-03-13-kiwi-search-reliability-metrics.md)

### Kiwi search release go / no-go

배포 또는 publish 후보에서는 아래 조건이 모두 맞아야 `Go`로 본다.

- `bun run release:verify`가 green이다
- 핵심 suite가 green이다
- `qmd update` ordering regression이 green이다
- `qmd status clean`과 plain Hangul `qmd search`의 의미가 실제로 일치한다
- `search --json` stdout이 advisory 때문에 오염되지 않는다
- stale 또는 policy mismatch 상태에서 false clean path를 타지 않는다
- `measure:kiwi-reliability` 수치는 internal helper regression 참고값으로만 쓰고, user-facing `qmd status/search` hot-path latency 근거로 과장하지 않는다

즉시 중단 조건:

- `qmd update`가 성공처럼 끝났는데 shadow index freshness를 설명할 수 없다
- `qmd status`가 clean인데 실제 `qmd search`는 fallback 또는 failure로 흐른다
- machine-readable stdout이 warning/advisory 때문에 깨진다

롤백/복구 기본 절차:

```bash
# 1. 이전 안정 커밋으로 되돌린다
# 2. 영향 받은 fixture 또는 실제 index에서 다시 동기화한다
qmd update
qmd status
qmd search "형태소 분석"
```

코드 롤백만으로 shadow metadata/state mismatch가 사라지지 않으면, 해당 index는 rebuild 기준으로 다시 검증한다.

### publish 산출물 확인

```bash
bun pm pack --dry-run
```

`bun pm pack --dry-run`은 포함 파일 preview 용도다. canonical artifact 검증은 actual pack과 temp install smoke까지 포함한
`bun run release:artifact`를 기준으로 본다.

```bash
bun run release:artifact

TARBALL=$(bun pm pack --quiet)
tar -tf "$TARBALL" | rg '^(package/(bin|dist)/|package/README.md|package/LICENSE)'
```

release 직전 publish path 자체를 시뮬레이션하려면 별도로 아래를 사용한다.

```bash
bun publish --dry-run
```

`bun pm pack --dry-run`은 artifact inclusion preview이고, `bun publish --dry-run`은 publish simulation이다. 둘은 같은 검증이 아니다.

### bin smoke 경로 확인

```bash
bun run build
node ./bin/qmd.js collection list
```

### upstream qmd version bump checklist

1. `package.json`에서 `@tobilu/qmd` 버전을 변경한다
2. `bun install`
3. `bun install --frozen-lockfile`
4. `bun pm untrusted`로 install/lifecycle trust surface가 달라졌는지 확인한다
5. `bun run test:parity`
6. `node_modules/@tobilu/qmd/dist/cli/qmd.js`의 parse/default/usage/output 변경 사항을 검토한다
7. owned help entrypoint(`qmd <owned> --help`, `qmd help <owned>`, `qmd --help <owned>`)와 de-surfaced option leak를 함께 검토한다
8. intentional drift가 있으면 `test/fixtures/owned-command-parity/baseline.json`과 help/output snapshot fixtures를 갱신한다
9. `documents`, `content`, `store_config`, `QMDStore.internal` contract가 shadow FTS helper와 여전히 맞는지 확인한다
10. `node_modules/@tobilu/qmd/dist/mcp/server.js`의 tool/resource names, `/mcp`/`/health`/`/query`/`/search` route shape, daemon lifecycle semantics를 검토한다
11. `bun run test -- mcp-upstream-guard mcp-http mcp-stdio`로 MCP guard와 protocol suite를 다시 확인한다
12. [`docs/architecture/mcp-divergence-registry.md`](architecture/mcp-divergence-registry.md) 의 intentional divergence를 재검토한다
13. `bun run release:artifact`와 `bun publish --dry-run`을 다시 확인한다
14. 관련 문서와 plan/work log를 함께 갱신한다

## 관련 문서

- [docs/architecture/kqmd-command-boundary.md](architecture/kqmd-command-boundary.md)
- [docs/architecture/upstream-compatibility-policy.md](architecture/upstream-compatibility-policy.md)
- [docs/architecture/mcp-divergence-registry.md](architecture/mcp-divergence-registry.md)
- [docs/plans/2026-03-11-feat-kqmd-replacement-distribution-scaffold-plan.md](plans/2026-03-11-feat-kqmd-replacement-distribution-scaffold-plan.md)
