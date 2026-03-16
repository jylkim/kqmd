---
title: fix: Define owned help upstream reuse boundary
type: fix
status: completed
date: 2026-03-16
origin: docs/brainstorms/2026-03-13-owned-cli-release-readiness-brainstorm.md
---

# fix: Define owned help upstream reuse boundary

## Enhancement Summary

**Deepened on:** 2026-03-16  
**Sections enhanced:** 10  
**Research agents used:** `repo-research-analyst`, `learnings-researcher`, `architecture-strategist`, `spec-flow-analyzer`, `code-simplicity-reviewer`, `security-sentinel`

### Key Improvements

1. help ownership을 `manifest command set`과 `help-entrypoint routing override`로 분리해 더 정확하게 정의했다.
2. `runtime passthrough`를 기각하는 것에서 한 단계 더 나아가, 첫 슬라이스는 `local help + selective manual copy`로 scope를 줄였다.
3. refresh/diff 관리 방식을 새 별도 workflow가 아니라 기존 upstream version bump checklist와 drift guard에 연결하도록 구체화했다.

### New Considerations Discovered

- actual help boundary는 `qmd <owned> --help`뿐 아니라 `qmd -h <owned>`, `qmd --help <owned>`, `qmd help <owned>`까지 포함한다.
- `query`는 selective reuse 후보지만 `update`와 `mcp`는 local-only divergence가 커서 더 보수적으로 다뤄야 한다.
- recovery-oriented help copy는 `query`, `embed`, `mcp`까지 포함해야 실제 safe-usage guidance가 된다.
- refresh를 자동화하더라도 입력원 provenance, private upstream file coupling 금지, dynamic path leakage 방지가 함께 명시돼야 한다.

## Overview

이 계획의 목표는 owned command help를 더 풍부하게 만드는 과정에서 "upstream help를 그대로 재사용할 수 있는가"를 계약 관점에서 정리하는 것이다. 사용자는 동작이 upstream과 거의 같다면 같은 설명을 보길 기대할 수 있다. 반면 K-QMD는 owned help를 별도 route로 소유한다고 README와 routing에서 명시하고 있으며, help surface는 de-surfaced option leak를 막는 release contract의 일부다 (see brainstorm: `docs/brainstorms/2026-03-13-owned-cli-release-readiness-brainstorm.md`).

## Problem Statement / Motivation

현재 local help는 짧고 일부 중요한 제약을 빠뜨린다. upstream wording에는 query syntax, examples, global option 설명처럼 재사용 가치가 높은 내용이 이미 있다. 그대로 가져오면 중복을 줄이고 상세도를 올릴 수 있다.

하지만 installed upstream `qmd <command> --help`는 command-local help가 아니라 사실상 같은 top-level help를 출력한다. 따라서 naive passthrough는 아래 문제를 만든다.

- `qmd <owned-command> --help`가 현재의 command-specific UX를 잃는다.
- `update --pull` 같은 de-surfaced option이 다시 노출될 수 있다.
- README와 현재 routing이 약속한 "owned command help는 local contract"라는 의미가 흐려진다.

즉 문제는 "upstream text를 활용할 수 있는가" 자체보다, "어떤 형태의 reuse가 owned help contract와 충돌하지 않는가"를 먼저 닫는 것이다.

## Local Research Findings

- [`src/commands/owned/help.ts`](../../src/commands/owned/help.ts)는 현재 owned subcommand help의 단일 source of truth다.
- [`README.md`](../../README.md)는 `qmd --help`는 upstream help이고, `qmd <owned-command> --help`는 K-QMD-owned help라고 명시한다.
- [`docs/architecture/kqmd-command-boundary.md`](../../docs/architecture/kqmd-command-boundary.md)는 owned command I/O contract가 upstream CLI semantics를 기준선으로 삼더라도, owned boundary 자체는 local authority임을 전제로 둔다.
- help ownership은 manifest만으로 닫히지 않는다. bare `help`는 passthrough지만, owned-target help alias와 `--help <owned>` 라우팅은 [`src/cli.ts`](../../src/cli.ts) 가 별도로 override 한다.
- [`todos/031-complete-p2-help-alias-still-advertises-desurfaced-pull.md`](../../todos/031-complete-p2-help-alias-still-advertises-desurfaced-pull.md)는 help alias 하나만 upstream으로 새어도 contract bug로 취급했다. 이 학습은 help reuse가 단순 copy 문제가 아니라 routing/contract 문제임을 보여 준다.
- installed upstream CLI의 [`node_modules/@tobilu/qmd/dist/cli/qmd.js`](../../node_modules/@tobilu/qmd/dist/cli/qmd.js) `showHelp()`는 하나의 monolithic top-level help block만 출력한다. 실제로 `query --help`, `search --help`, `update --help`, `status --help`를 실행해도 같은 global help가 나온다.
- local runtime semantics는 아직 upstream와 완전히 같지 않다.
  - `query --candidate-limit`는 positive integer / max 100 제약이 있고, plain query + multiple `-c`는 명시적으로 막는다.
  - `update --pull`는 owned surface에서 제거됐다.
  - `embed`는 model mismatch 시 `--force`가 중요하다.
  - `mcp`는 `--daemon` requires `--http`, `--port` range 등 local validation이 있다.
- 저장소의 drift guard 관례는 dynamic comparison보다 `checked-in fixture + version guard + focused contract test` 쪽이다. help도 이 관례에 맞춰야 한다.
- version bump checklist와 parity baseline은 이미 [`docs/development.md`](../../docs/development.md) 및 [`test/fixtures/owned-command-parity/baseline.json`](../../test/fixtures/owned-command-parity/baseline.json) 에 존재한다. help refresh가 필요해도 새 병렬 체계를 만들기보다 이 기존 흐름에 붙는 편이 자연스럽다.
- `docs/solutions/patterns/critical-patterns.md`는 현재 저장소에 없다. 따라서 이번 판단은 help contract 관련 local docs와 tests를 직접 source of truth로 삼아야 한다.

## Research Decision

외부 연구는 생략한다. 이 이슈는 framework best practice보다 현재 저장소의 owned boundary, help routing, de-surfaced option policy를 정확히 읽는 것이 더 중요하다. 이미 local docs, todos, solution notes, installed upstream package evidence로 판단 근거가 충분하다.

## Chosen Approach

추천안은 `local authority, upstream-informed copy` 모델이다.

1. ownership model은 유지한다.
   - `qmd --help`는 upstream passthrough를 유지한다.
   - `qmd <owned-command> --help`, `qmd <owned-command> -h`, `qmd help <owned-command>`, `qmd --help <owned-command>`, `qmd -h <owned-command>`는 local help를 유지한다.
2. upstream text는 wholesale passthrough가 아니라 selective reuse만 허용한다.
   - 실제로 identical하거나 거의 identical한 문구만 local help에 수동 반영한다.
   - query syntax grammar/examples처럼 upstream가 더 풍부한 section은 source material로 활용할 수 있다.
3. local delta는 반드시 분리해 남긴다.
   - de-surfaced option 제거
   - local validation / bounded support / mode 설명
   - command-specific UX 유지
4. reuse는 deterministic해야 한다.
   - runtime에 upstream binary 출력을 그대로 붙이지 않는다.
   - 첫 슬라이스에서는 별도 fragment 저장소나 새 sync 메커니즘을 만들지 않는다.
   - reviewed wording은 계속 local [`src/commands/owned/help.ts`](../../src/commands/owned/help.ts) 에 직접 반영한다.
   - refresh review가 필요하면 기존 upstream version bump checklist에 붙이고, 안전하게 분류되지 않으면 기존 local copy를 유지하는 fail-closed 원칙을 택한다.
5. docs/tests도 같이 닫는다.
   - help snapshot
   - alias entrypoint coverage
   - README/help ownership 문구
   - risky local-only command coverage(`mcp`, 이후 `embed`)

이 접근은 "upstream help를 활용하고 싶다"는 의도를 살리면서도, "owned help contract는 local authority여야 한다"는 기존 guardrail을 유지한다.

### Research Insights

**Best Practices**

- help authority는 command 단위보다 `usage`, `options`, `examples`, `constraints`, `recovery guidance` 단위로 보는 편이 실제 divergence와 더 잘 맞는다.
- 저장소가 이미 쓰는 drift-control 패턴은 runtime passthrough가 아니라 checked-in fixtures와 explicit guards다.
- help는 모든 validation을 적는 문서가 아니라, 사용자의 안전한 invocation을 바꾸는 제약을 드러내는 문서여야 한다.

**Simplicity Rules**

- 첫 슬라이스는 `query` 중심 보강이 핵심이다. `update`/`mcp`는 local-only 영역을 지키는 쪽이 더 중요하다.
- upstream-derived fragment 시스템, 별도 refresh automation, command-wide matrix tooling은 현재 범위에서는 YAGNI로 본다.
- production source of truth는 계속 [`src/commands/owned/help.ts`](../../src/commands/owned/help.ts) 하나로 유지한다.

## Alternative Approaches Considered

### Option 1: owned subcommand help를 runtime passthrough로 upstream output에 전부 위임

**Pros**

- copy를 거의 없앨 수 있다
- upstream wording drift를 자동으로 따라간다

**Cons**

- upstream subcommand help가 command-specific하지 않고 global help라서 UX가 바뀐다
- `update --pull` 같은 de-surfaced option leak가 재발할 수 있다
- installed package/version 상태에 따라 help output이 바뀌는 runtime coupling이 생긴다
- current README claim과 충돌한다

**Decision**

기각한다.

### Option 2: fully manual local help를 유지하고 upstream reuse는 하지 않는다

**Pros**

- 가장 단순하고 deterministic하다
- local contract를 가장 강하게 통제할 수 있다

**Cons**

- detail이 upstream보다 얕아지기 쉽다
- syntax/examples/common wording 중복이 계속 남는다
- "동작이 같은데 설명은 왜 더 빈약한가"라는 UX 문제가 지속된다

**Decision**

fallback으로는 가능하지만 추천하지 않는다.

### Option 3: local ownership을 유지하되 upstream-derived fragment를 선택적으로 흡수한다

**Pros**

- owned contract를 지키면서 상세도를 올릴 수 있다
- reusable wording 중복을 줄일 수 있다
- drift를 reviewed diff로 관리할 수 있다

**Cons**

- refresh/update policy를 정해야 한다
- 무엇이 truly identical한지 분류하는 작은 inventory 작업이 필요하다

**Decision**

추천한다.

## Technical Considerations

- upstream evidence:
  - [`node_modules/@tobilu/qmd/dist/cli/qmd.js:2165`](../../node_modules/@tobilu/qmd/dist/cli/qmd.js#L2165) 이하 `showHelp()`는 global help block 하나를 출력한다.
  - 따라서 "upstream help 그대로 사용"은 실질적으로 "subcommand-specific local help를 포기"와 거의 같은 의미다.
- local constraints currently hidden from help:
  - `query --candidate-limit`: positive integer, max 100, plain query + multiple collections 제한
  - `update --pull`: de-surfaced
  - `embed`: mismatch 시 `--force`가 실질적 recovery path
  - `mcp`: `--daemon` requires `--http`, `--port` bounded 1..65535
- runtime shell-out 방식은 help path에 subprocess/install/version failure mode를 추가한다. 지금 help path는 [`src/cli.ts`](../../src/cli.ts) + [`src/commands/owned/help.ts`](../../src/commands/owned/help.ts) 조합으로 매우 deterministic하다.
- [`docs/architecture/kqmd-command-boundary.md`](../../docs/architecture/kqmd-command-boundary.md)는 private upstream CLI formatter path를 직접 import하지 않는다는 guardrail도 남긴다. 따라서 reuse가 필요하더라도 runtime passthrough나 private formatter import는 피하는 편이 일관적이다.
- refresh provenance도 명시돼야 한다. passthrough runtime은 `KQMD_UPSTREAM_BIN` override와 installed package state를 읽기 때문에, help refresh가 있다면 입력원은 pinned `@tobilu/qmd` baseline 기준으로 고정돼야 한다.
- upstream `showHelp()`는 마지막에 환경 의존적인 `Index:` 경로를 출력한다. 따라서 local help에 가져올 수 있는 upstream text는 allowlist로 제한하고, 경로/동적 값이 섞인 라인은 정책적으로 금지하는 편이 안전하다.

### Research Insights

**Boundary Rules**

- installed upstream help text shape는 implementation dependency라기보다 `근거 자료`로 취급하는 편이 boundary를 덜 흐린다.
- runtime/build-time 모두 upstream private CLI file import 또는 AST parsing을 허용하지 않는다는 금지를 acceptance criteria에 적는 편이 안전하다.

**Testing Implications**

- 현재 help coverage는 `query`/`update` 중심이므로, `mcp`처럼 mode-heavy local command는 focused coverage를 추가하는 편이 좋다.
- `help` contract는 `snapshot + routing + drift guard` 3층으로 보는 편이 저장소 관례와 맞다.

## Help Entrypoint Matrix

| Entrypoint | Expected authority | Notes |
|---|---|---|
| `qmd --help`, `qmd -h`, `qmd help` | upstream | top-level global help |
| `qmd <owned> --help`, `qmd <owned> -h` | local | command-specific owned help |
| `qmd help <owned>` | local | must match direct owned help exactly |
| `qmd --help <owned>`, `qmd -h <owned>` | local | flag-first owned help entrypoint |
| `qmd help <passthrough>` | upstream | must not use owned formatter |
| `qmd help <unknown>` | passthrough/unknown | must not fall back to owned help |

All local owned help entrypoints for the same command must produce byte-identical output.

## Refresh And Drift Control

- help reuse는 새 별도 workflow가 아니라 기존 upstream version bump checklist와 baseline review flow에 묶는다.
- upstream wording을 검토해 반영할 때는 reviewed diff로 local [`src/commands/owned/help.ts`](../../src/commands/owned/help.ts) 를 갱신하고, 대응 snapshot/fixture를 함께 본다.
- refresh 입력원은 allowlist된 upstream source에 한정한다. runtime passthrough, `KQMD_UPSTREAM_BIN` override 결과, private upstream CLI formatter import는 authority로 삼지 않는다.
- dependency bump는 help wording/fixtures review가 끝나기 전까지 완료로 보지 않는다.
- upstream wording을 `reuse as-is` 또는 `reuse with local delta`로 안전하게 분류할 수 없으면, 기존 local help를 유지하는 fail-closed 원칙을 따른다.
- refresh review는 de-surfaced option leak, command-specific UX loss, mode/validation drift, dynamic path leakage를 반드시 점검한다.

## Failure And Recovery Copy Rules

- help는 로컬 divergence가 사용자의 failure recovery를 바꾸는 경우, 그 안내를 유지해야 한다.
- `query` help는 structured query grammar/examples를 보강하고, `--candidate-limit`의 bound/single-collection restriction을 숨기지 않는다.
- `embed` help는 `--force`를 stale or mismatched embeddings recovery path로 유지한다.
- `mcp` help는 `--daemon` requires `--http`, valid `--port` range, start/stop recovery path를 local semantics로 유지한다.
- `update` help는 `--pull`이 owned surface 밖이라는 사실을 어느 entrypoint에서도 다시 노출하지 않는다.

## System-Wide Impact

- **Interaction graph**
  - `runCli()` routing -> owned help dispatch -> local formatter -> stdout
  - top-level `qmd --help`만 passthrough로 남는다
- **Error propagation**
  - runtime passthrough를 택하면 upstream binary resolution, package version drift, subprocess exit handling이 help path에 새로 들어온다
- **State lifecycle risks**
  - 직접적인 persistent state risk는 없지만, 잘못된 help는 unsupported flag invocation을 유도해 user-visible contract failure로 이어진다
- **API surface parity**
  - `qmd <owned-command> --help`, `qmd <owned-command> -h`, `qmd help <owned-command>`, `qmd --help <owned-command>`는 반드시 같은 contract를 보여 줘야 한다
- **Integration test scenarios**
  - `query --help`는 syntax/examples를 보강하되 unsupported option을 노출하지 않는다
  - `update --help`와 `help update`는 어느 경로에서도 `--pull`를 노출하지 않는다
  - `qmd --help`는 계속 upstream full help를 보여 준다
  - `mcp --help`는 global help가 아니라 command-specific local modes/options를 유지한다
  - `qmd help <passthrough>`와 `qmd help <unknown>`는 owned formatter를 타지 않는다

## SpecFlow Analysis

### User Flow Overview

1. 사용자가 `qmd --help`, `qmd -h`, `qmd help`를 실행한다.
   - 기대: upstream full CLI surface
2. 사용자가 `qmd query --help`, `qmd query -h`, `qmd --help query`, `qmd help query`를 실행한다.
   - 기대: 같은 local owned query help
3. 사용자가 `qmd help update` 또는 `qmd update --help`를 실행한다.
   - 기대: 어느 경로에서도 `--pull`가 다시 보이지 않는다
4. 사용자가 `qmd help collection` 또는 `qmd help nope`를 실행한다.
   - 기대: local owned formatter가 개입하지 않는다
5. 사용자가 README/help를 보고 실패한 뒤 recovery를 찾는다.
   - 기대: `query`, `embed`, `mcp`는 local-only failure/retry guidance를 유지한다

### Missing Elements & Gaps

- query help는 structured syntax를 runtime이 실제로 지원하는 수준만큼 설명하지 않는다.
- help에 어떤 local validation을 넣어야 하는지 기준이 문서화돼 있지 않다.
- "upstream text를 재사용해도 되는 조건"이 아직 없어서, future edits가 manual copy와 passthrough 사이를 오가며 drift할 수 있다.
- help entrypoint matrix와 negative boundary가 문서상 비어 있다.
- refresh가 안전하게 분류되지 않을 때의 fail-closed 동작이 아직 충분히 명시적이지 않다.

### Critical Questions Requiring Clarification

1. command-specific help UX를 hard requirement로 볼 것인가?
   - **Why it matters:** yes라면 full upstream passthrough는 후보에서 제외된다.
   - **Default assumption:** yes. 현재 README와 routing contract가 이미 그렇게 주장하고 있다.
2. `qmd --help <owned-command>`와 `qmd -h <owned-command>`를 공식 owned-help contract에 포함할 것인가?
   - **Why it matters:** 실제 코드는 이미 이 경로를 라우팅하므로, 계획/테스트에서 빠지면 alternate entrypoint drift가 남는다.
   - **Default assumption:** 포함한다.
3. local help는 어떤 제약까지 문서화해야 하는가?
   - **Why it matters:** 모든 validation을 다 넣으면 장황해지고, 너무 적게 넣으면 hidden drift가 남는다.
   - **Default assumption:** user가 flag를 안전하게 쓸 수 있는지를 바꾸는 제약은 적는다.
4. upstream-derived text는 어떻게 refresh할 것인가?
   - **Why it matters:** runtime passthrough, build-time generation, checked-in review는 drift/리뷰 특성이 다르다.
   - **Default assumption:** 새 자동화보다 기존 version bump checklist 안에서 reviewed local update가 가장 안전하다.
5. refresh가 안전하게 분류되지 않을 때 기본 동작은 무엇인가?
   - **Why it matters:** 이 기본값이 없으면 구현 단계에서 convenience passthrough가 다시 들어올 수 있다.
   - **Default assumption:** fail closed to existing local help, no runtime passthrough.

## Acceptance Criteria

- [x] help ownership model이 문서에 한 문장으로 정리된다
- [x] `qmd --help`는 upstream passthrough로 유지된다
- [x] `qmd <owned-command> --help`, `qmd <owned-command> -h`, `qmd help <owned-command>`, `qmd --help <owned-command>`는 local authority를 유지한다
- [x] same-command owned help entrypoints는 byte-identical output을 낸다
- [x] `qmd help <passthrough-command>`와 `qmd help <unknown-command>`는 owned formatter를 타지 않는다
- [x] 어떤 help entrypoint에서도 de-surfaced option이 다시 노출되지 않는다
- [x] upstream text reuse가 도입되면 runtime passthrough가 아니라 reviewed local update로 관리된다
- [x] refresh는 기존 upstream version bump checklist와 baseline review flow에 연결된다
- [x] refresh가 안전하게 분류되지 않으면 기존 local help를 유지하고 runtime passthrough로 fallback 하지 않는다
- [x] runtime/build-time 모두 upstream private CLI file import 또는 AST parsing을 authority로 쓰지 않는다
- [x] `query` help는 structured query syntax/examples를 포함하거나, 동일한 수준의 대체 설명을 갖는다
- [x] `query` help는 `--candidate-limit` bound/single-collection restriction을 숨기지 않는다
- [x] recovery-oriented owned commands(`query`, `embed`, `mcp`)는 local guidance를 유지한다
- [x] README/dev docs가 help ownership 및 reuse policy를 명시한다
- [x] existing help coverage는 alternate entrypoint와 mode-heavy command(`mcp`)까지 확장된다
- [x] help fixtures/snapshots에는 절대경로나 dynamic path output이 섞이지 않는다

## Success Metrics

- touched command help의 상세도가 현재보다 올라간다
- copy/paste duplication이 줄어든다
- upstream version bump가 있을 때 help drift가 silent runtime change가 아니라 reviewed diff로 드러난다
- de-surfaced option leak 회귀가 다시 발생하지 않는다

## Dependencies & Risks

- **Evidence baseline:** installed upstream `@tobilu/qmd` help text shape
- **Risk:** 큰 upstream block을 그대로 가져오면 irrelevant section까지 local help에 섞일 수 있다
- **Risk:** runtime passthrough는 package version/install state에 help output을 종속시킨다
- **Risk:** refresh provenance를 잠그지 않으면 env override 또는 locally patched upstream output을 authority로 잘못 흡수할 수 있다
- **Risk:** allowlist 없는 extraction은 dynamic `Index:` path 같은 환경 의존 출력을 local fixtures에 섞을 수 있다
- **Risk:** help를 strings-only 블록으로만 계속 두면 parser/runtime constraint와 다시 drift할 수 있다
- **Risk:** 과도한 제약 문서화는 help scanability를 떨어뜨린다

## Implementation Suggestions

### Phase 1: Boundary inventory and scope reduction

- help entrypoint matrix를 먼저 문서화한다
- inventory는 command별보다 `usage`, `options`, `examples`, `constraints`, `recovery guidance` 단위로 만든다
- 첫 슬라이스는 `query` selective reuse, `update`/`mcp` fully local 유지로 scope를 줄인다

### Phase 2: Local help enrichment

- reviewed upstream wording을 현재 local help source에 수동 반영한다
- `query`에 syntax/examples와 critical local constraints를 더한다
- `update`, `mcp`, `embed`는 local-only divergence/recovery copy를 분명히 유지한다

### Phase 3: Contract hardening and drift control

- help snapshots/routing coverage를 alternate entrypoint와 `mcp`까지 넓힌다
- README/help ownership 문구를 정리한다
- version bump checklist에 help review step을 추가한다
- private upstream help authority 금지, dynamic path leakage 금지, fail-closed refresh policy를 테스트/문서로 고정한다

## Out Of Scope For The First Slice

- upstream-derived fragment 저장소 신설
- help sync 전용 별도 자동화 스크립트
- full `HelpSpec` descriptor 도입
- 모든 owned command를 한 번에 같은 수준으로 심화하는 작업

위 항목들은 실제 drift pain이 반복될 때 follow-up으로 검토한다. 이번 슬라이스의 목표는 mechanism invention이 아니라, local authority를 유지한 채 detail gap을 줄이고 guardrail을 더 분명히 하는 것이다.

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-13-owned-cli-release-readiness-brainstorm.md](../brainstorms/2026-03-13-owned-cli-release-readiness-brainstorm.md) — carried forward decisions: owned surface는 release contract이며, docs/help는 실제 support model을 말해야 하고, de-surfaced option leak는 다시 허용하지 않는다.
- **Internal references**
  - [src/commands/owned/help.ts](../../src/commands/owned/help.ts)
  - [src/cli.ts](../../src/cli.ts)
  - [src/commands/manifest.ts](../../src/commands/manifest.ts)
  - [src/commands/owned/io/parse.ts](../../src/commands/owned/io/parse.ts)
  - [src/commands/owned/io/validate.ts](../../src/commands/owned/io/validate.ts)
  - [src/commands/owned/query_core.ts](../../src/commands/owned/query_core.ts)
  - [src/commands/owned/mcp.ts](../../src/commands/owned/mcp.ts)
  - [src/passthrough/upstream_locator.ts](../../src/passthrough/upstream_locator.ts)
  - [src/passthrough/delegate.ts](../../src/passthrough/delegate.ts)
  - [README.md](../../README.md)
  - [docs/development.md](../../docs/development.md)
  - [docs/architecture/kqmd-command-boundary.md](../../docs/architecture/kqmd-command-boundary.md)
  - [docs/architecture/upstream-compatibility-policy.md](../../docs/architecture/upstream-compatibility-policy.md)
  - [todos/031-complete-p2-help-alias-still-advertises-desurfaced-pull.md](../../todos/031-complete-p2-help-alias-still-advertises-desurfaced-pull.md)
  - [docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md](../../docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md)
  - [docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md](../../docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md)
  - [docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md](../../docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md)
  - [docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md](../../docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
  - [docs/solutions/logic-errors/owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md](../../docs/solutions/logic-errors/owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md)
  - [docs/plans/2026-03-13-fix-owned-cli-release-readiness-plan.md](../../docs/plans/2026-03-13-fix-owned-cli-release-readiness-plan.md)
  - [test/cli-routing.test.ts](../../test/cli-routing.test.ts)
  - [test/owned-command-parity/help-output.test.ts](../../test/owned-command-parity/help-output.test.ts)
  - [test/owned-command-parity/upstream-version-guard.test.ts](../../test/owned-command-parity/upstream-version-guard.test.ts)
  - [test/mcp-command.test.ts](../../test/mcp-command.test.ts)
  - [test/fixtures/owned-command-parity/help/query-help.output.txt](../../test/fixtures/owned-command-parity/help/query-help.output.txt)
  - [test/fixtures/owned-command-parity/help/update-help.output.txt](../../test/fixtures/owned-command-parity/help/update-help.output.txt)
  - [test/fixtures/owned-command-parity/baseline.json](../../test/fixtures/owned-command-parity/baseline.json)
- **Upstream evidence**
  - [node_modules/@tobilu/qmd/dist/cli/qmd.js#L2165](../../node_modules/@tobilu/qmd/dist/cli/qmd.js#L2165)
  - 2026-03-16 local inspection of installed upstream `query --help`, `search --help`, `update --help`, `status --help`
