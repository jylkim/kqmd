---
title: fix: Close owned CLI release-readiness gaps
type: fix
status: active
date: 2026-03-13
origin: docs/brainstorms/2026-03-13-owned-cli-release-readiness-brainstorm.md
---

# fix: Close owned CLI release-readiness gaps

## Enhancement Summary

**Deepened on:** 2026-03-13  
**Sections enhanced:** 11  
**Research agents used:** `architecture-strategist`, `kieran-typescript-reviewer`, `security-sentinel`, `performance-oracle`, `code-simplicity-reviewer`, `deployment-verification-agent`, `repo-research-analyst`, `learnings-researcher`, `spec-flow-analyzer`, `framework-docs-researcher`, `best-practices-researcher`  
**Additional primary sources:** Bun official docs, npm package metadata docs, POSIX/GNU CLI conventions

### Key Improvements

1. 옵션 closure 규칙을 비대칭으로 고정했다.
   - `query --candidate-limit`: **implement-first**
   - `update --pull`: **de-surface-first**
2. release-readiness를 “기능 격차 closure”만이 아니라 `help -> parse -> execution -> output -> docs -> artifact` 전체 공개 계약으로 재정의했다.
3. 로컬 검증을 `fast gate`와 `artifact gate`로 나눠, 중복 테스트 실행과 build/pack 반복을 제한하는 방향으로 구체화했다.

### New Considerations Discovered

- 현재 저장소의 parity baseline은 `search/query/update/embed` 중심이며, `status`는 parity snapshot보다 zero-config/focused behavior contract로 다뤄야 한다.
- `measure:kiwi-reliability`는 release evidence에 유용하지만 end-to-end proof가 아니라 **보조 지표**다.
- `update --pull`는 단순 feature gap이 아니라 repo mutation, shell execution, stderr redaction, rollback story까지 포함한 **보안/운영 경계** 문제다.
- published tarball/install smoke는 `bun pm pack --dry-run`과 다른 축이며, 실제 release candidate에서는 설치 가능한 artifact 검증이 별도 필요하다.

## Overview

이번 계획의 목표는 K-QMD의 owned CLI 전체(`search/query/update/embed/status`)를 첫 릴리즈 후보로 판단할 수 있을 만큼 계약을 닫는 것이다. 브레인스토밍에서 합의한 기본 방향은 그대로 유지한다 (see brainstorm: `docs/brainstorms/2026-03-13-owned-cli-release-readiness-brainstorm.md`).

- 범위: owned surface 전체
- 우선순위: 기능 신뢰성
- 기본 원칙: explicit non-support는 릴리즈 전 제거
- 운영 방식: CI보다 local `package.json` scripts 중심의 release gate

이번 deepening의 핵심은 “무엇을 구현할지”보다 “무엇을 public contract로 주장할지”를 더 분명하게 닫는 것이다. 따라서 이 계획은 `candidate-limit`, `--pull`, `status` zero-config, machine-readable output purity, tarball/bin smoke, trusted dependency drift를 한 릴리즈 계약으로 묶는다.

## Problem Statement / Motivation

현재 저장소는 이미 상당한 기반을 갖추고 있다.

- Kiwi reliability hardening
- parity baseline
- trusted dependency drift guardrail
- pack/bin smoke
- release go / no-go 문서

그럼에도 “릴리즈 가능한 owned CLI”라는 기준으로 보면 아직 세 가지 구멍이 남아 있다.

1. **Capability closure gap**
   [`src/commands/owned/io/parse.ts`](../../src/commands/owned/io/parse.ts) 는 `query --candidate-limit`와 `update --pull`를 validation error로 막는다. silent no-op를 없앤 것은 맞지만, first release 기준으로는 여전히 half-support 상태다.
2. **Release evidence gap**
   [`docs/development.md`](../../docs/development.md) 는 focused suites, manual proof, pack/bin smoke를 잘 정리하지만, releaser가 한 번에 `Go / No-Go`를 재판단하는 canonical local command는 없다.
3. **Public contract gap**
   README, help surface, parser, formatter, published artifact, installed bin이 같은 계약을 말하고 있다고 장담하기 어렵다. 특히 `status` zero-config, `query --candidate-limit`, `update --pull`, machine-readable output purity는 한 레이어만 맞춰서는 릴리즈가 닫히지 않는다.

## Local Research Findings

이번 계획을 강화하는 데 직접 영향을 준 로컬 근거는 아래와 같다.

- [`src/commands/owned/query.ts`](../../src/commands/owned/query.ts)
  `candidateLimit` typed seam은 이미 있고, plain/structured 양쪽 `session.store.search(...)` 호출만 실제 execution semantics에 연결하면 된다.
- [`src/commands/owned/update.ts`](../../src/commands/owned/update.ts)
  `update --pull`는 owned path에 pre-update runner seam이 전혀 없고, 현재 구조에서는 `session.store.update()` 앞뒤로 git mutation contract를 넣기 어렵다.
- [`docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`](../../docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md)
  happy path만 맞추면 parity가 끝나는 것이 아니라, `--explain`, `--json`, empty output, parse-only flags까지 함께 닫아야 한다는 학습을 준다.
- [`docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`](../../docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md)
  `status`는 일반 read command가 아니라 zero-config entrypoint 계약이라는 점을 보여 준다. 릴리즈 증거에도 `status`, `status --json`, advisory scope 정합성이 포함돼야 한다.
- [`docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`](../../docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
  read path는 open만으로 state를 mutate하면 안 되며, runtime reopen policy와 cleanup ownership 자체가 릴리즈 계약의 일부라는 점을 남겼다.
- [`docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md`](../../docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md)
  preflight-before-mutation, clean health meaning, quoted/negated fallback, bootstrap retry, checksum/timeout/atomic write 등 Kiwi reliability의 핵심 가드레일이 이미 정의돼 있다.
- [`docs/solutions/security-issues/trusted-dependencies-drift-kqmd-cli-20260313.md`](../../docs/solutions/security-issues/trusted-dependencies-drift-kqmd-cli-20260313.md)
  trust surface는 체크리스트가 아니라 test에 의해 실패해야 한다.
- [`docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md`](../../docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md)
  pack dry-run만으로는 부족하고, published bin은 `process.execPath` 기반 cross-platform smoke로 검증돼야 한다.
- [`docs/development.md`](../../docs/development.md)
  `test:parity`, focused suites, `measure:kiwi-reliability`, pack smoke, bin smoke, version bump checklist가 이미 canonical guidance로 존재한다.
- `docs/solutions/patterns/critical-patterns.md`
  learnings-researcher 흐름상 확인했지만 현재 저장소에는 없다.

installed upstream evidence도 판단에 중요하다.

- installed `@tobilu/qmd` CLI는 `query`에서 `candidateLimit`를 runtime에 전달한다.
- 반면 `qmd update [--pull]` help와 parser는 존재하지만, 실제 update dispatch는 `pull` semantics를 분명히 연결하지 않는다.

즉, `candidate-limit`와 `--pull`는 같은 종류의 gap이 아니다.

## Research Decision

광범위한 외부 연구는 생략하되, **공식 인터페이스와 배포 규약**은 한정 조사한다.

- Bun docs: `bun run`, `bun pm pack`, `bun publish --dry-run`, lifecycle scripts
- npm docs: `bin`, `files`, `engines`, package metadata
- POSIX/GNU CLI conventions: help/usage, stdout/stderr, diagnostic channel rules

이 계획은 로컬 구현 계획이면서 동시에 공개 인터페이스 계약 계획이므로, “외부 연구 없음”보다 “공식 계약 문서만 한정 참고”가 더 정확하다.

## Chosen Approach

브레인스토밍의 `Approach A: 계약 폐쇄 + 릴리즈 게이트`를 유지하되, 다음 다섯 원칙으로 더 좁힌다 (see brainstorm: `docs/brainstorms/2026-03-13-owned-cli-release-readiness-brainstorm.md`).

1. **Support-or-desurface**
   노출된 command/flag는 구현되거나 제거되어야 한다. “문서상 비지원” 상태로 릴리즈하지 않는다.
2. **Command ownership ≠ Option ownership**
   `query`라는 명령을 owned로 둔다고 해서 `query`의 모든 옵션을 즉시 같은 방식으로 소유해야 하는 것은 아니다. 옵션별 closure strategy를 분리한다.
3. **Asymmetric closure**
   - `query --candidate-limit`: implement-first
   - `update --pull`: de-surface-first
4. **Thin release gate**
   새 bespoke tool을 만들지 않고, existing scripts/tests/smoke를 얇게 orchestration 한다.
5. **Public contract first**
   help, parse, execution, output, docs, tarball, installed bin이 같은 support model을 보여야 한다.

## SpecFlow Analysis

### User Flow Overview

1. **Owned CLI happy-path flow**
   사용자는 `qmd update -> qmd status -> qmd search -> qmd query -> qmd embed` 흐름을 실행한다. health vocabulary, follow-up guidance, stdout purity가 서로 충돌하지 않아야 한다.
2. **Zero-config status flow**
   clean environment에서도 `qmd status`와 `qmd status --json`가 entrypoint로 동작해야 한다.
3. **`query --candidate-limit` flow**
   plain query, structured query, explain path, machine-readable path에서 같은 option contract를 가져야 한다.
4. **`update --pull` de-surfaced flow**
   이번 릴리즈 기준에서는 parse/help/docs/tests/examples 어디에도 supported path처럼 남지 않아야 한다.
5. **Releaser preflight / no-go / rerun flow**
   releaser는 canonical script 하나로 `Go / No-Go`를 판단하고, 실패를 capability regression, packaging failure, dependency drift, doc drift로 분류할 수 있어야 한다.
6. **Artifact install smoke flow**
   tarball이 실제 temp install 경로에서 실행 가능해야 한다. 로컬 repo checkout에만 의존해서는 안 된다.

### Hidden Branches & Failure Paths

- `query --candidate-limit`
  - plain vs structured
  - human vs `--json` vs explain branch
  - invalid/zero/negative/oversized input
- `update --pull`
  - 이번 릴리즈에서는 지원하지 않으므로, “generic parse failure”가 아니라 **surface 전체 비노출**로 닫아야 한다
- cross-command reliability
  - `update` failure/partial failure 후 `status` vocabulary와 `search/query` 허용 범위
- machine-readable output
  - advisory는 `stderr`, data는 `stdout`
  - raw stack/absolute path/remote URL leakage 금지

### Candidate-Limit vs `update --pull` Divergence

- `candidate-limit`
  - typed seam이 이미 존재한다
  - runtime 연결점도 분명하다
  - 성능 hot-path 옵션이므로 bounded support가 유리하다
- `update --pull`
  - pre-update runner seam이 없다
  - repo mutation, rollback, shell/git policy, stderr redaction, network failure가 같이 열린다
  - first release hardening 범위에서는 제거가 더 정직하다

## Technical Approach

### Architecture

이번 작업은 새 명령을 추가하는 것이 아니라, 이미 있는 release surface의 authority chain을 명확하게 만드는 일이다.

#### Boundary Authority Layer

source of truth는 아래 순서로 고정한다.

1. `manifest` / owned boundary
2. parser / help / usage
3. execution seam
4. formatter / output channel policy
5. docs / examples / tests
6. tarball / installed bin / smoke

이 중 한 레이어만 바뀌면 다시 contract drift가 생긴다.

#### Support Matrix

Phase 1 산출물로 command/flag support matrix를 만든다. 최소 컬럼은 아래와 같다.

- `surface`
- `ownership` (`owned`, `passthrough-only`, `de-surfaced`, `not claimed`)
- `support evidence`
- `implementation owner`
- `test coverage`
- `release gate coverage`
- `doc/help status`

이 매트릭스는 옵션별 closure를 문서와 테스트에 동시에 반영하는 기준점이다.

#### Option-Level Closure Rules

- `query --candidate-limit`
  - 이번 릴리즈에서 **구현**
  - plain/structured query 모두 execution path로 전달
  - parse는 `positive integer`만 허용
  - 기본값은 upstream과 같은 `40`
  - 상한은 `100` 이하로 clamp
- `update --pull`
  - 이번 릴리즈에서 **de-surface**
  - parser, help, usage, docs, examples, tests, snapshots에서 동시 제거
  - future support는 별도 follow-up plan에서 `PreUpdateRunner` 같은 seam과 rollback contract를 먼저 설계한 뒤 다룬다

#### Release Gate Shape

- `fast gate`
  - 기능/계약 검증
  - 중복 테스트 실행 금지
  - 네트워크/git mutation 금지
- `artifact gate`
  - actual tarball 1회 생성
  - tarball contents
  - temp install smoke
  - published bin / passthrough smoke
- `release rehearsal`
  - `bun publish --dry-run`
  - canonical fast gate에는 포함하지 않고 release-only supporting step으로 둔다

### Implementation Phases

#### Phase 1: Build the support matrix and lock closure decisions

대상:
- `src/commands/owned/io/parse.ts`
- `src/commands/owned/query.ts`
- `src/commands/owned/update.ts`
- `src/commands/owned/io/format.ts`
- `README.md`
- `docs/development.md`
- relevant tests/snapshots

작업:
- `search/query/update/embed/status`와 주요 options를 support matrix로 정리한다
- `candidate-limit = implement`, `update --pull = de-surface`를 명시적으로 못 박는다
- `status`는 parity snapshot baseline이 아니라 zero-config/focused behavior contract임을 분리해서 적는다
- `measure:kiwi-reliability`는 supporting evidence, not end-to-end proof로 위치를 고정한다
- `update --pull` upstream evidence mismatch를 문서에 직접 인용한다

완료 기준:
- support matrix가 존재하고, 각 surface가 `implemented`, `de-surfaced`, `passthrough-only`, `not claimed` 중 하나로 분류된다
- `update --pull`의 default decision이 de-surface임을 문서로 명시한다
- `candidate-limit`의 default decision이 implement임을 문서로 명시한다

#### Phase 2: Close the capability gaps and harden contract tests

대상:
- `src/commands/owned/io/parse.ts`
- `src/commands/owned/query.ts`
- `src/commands/owned/update.ts`
- `src/commands/owned/io/types.ts`
- `src/commands/owned/io/format.ts`
- parity/focused tests

작업:
- `query --candidate-limit`
  - parse validation을 `undefined | positive integer`로 바꾼다
  - `0`, negative, NaN, oversized input의 failure shape를 고정한다
  - plain/structured 양쪽 `session.store.search(...)`에 동일하게 전달한다
  - default `40`, max `100`, same behavior across human/json/explain branches
- `update --pull`
  - parser/help/usage/tests/snapshots/docs/examples에서 제거한다
  - “validation-only half-support”가 남지 않도록 전체 surface를 같이 바꾼다
- contract-focused tests를 추가/보강한다
  - `query --candidate-limit` plain/structured payload test
  - invalid candidate-limit validation test
  - `query --json` stdout purity test
  - `query --explain` conditional snapshot
  - `status --json` zero-config test
  - `update --pull` de-surfaced regression test
  - Kiwi preflight-before-mutation 유지 + retry recovery 유지

완료 기준:
- owned release surface에 `does not yet support`가 남지 않는다
- `query --candidate-limit`는 실행까지 닫히고, `update --pull`는 surface 전체에서 사라진다
- help/parse/output/docs/tests가 같은 support model을 보여 준다

Implementation note:
- current `candidate-limit` support is implemented through a localized adapter around upstream `dist/store.js` helpers because the public root `store.search()` surface still does not expose the candidate limit seam.

#### Phase 3: Add canonical local release gates

대상:
- `package.json`
- `docs/development.md`
- smoke/test entrypoints

작업:
- canonical script를 `bun run <script>`로 노출한다
  - 예: `bun run release:verify`
  - 예: `bun run release:artifact`
- `release:verify`
  - `bun run check`
  - one cross-command proof on a single seeded store
  - trusted dependency drift evidence
  - `bun run measure:kiwi-reliability` record
  - `bun run release:artifact`
- `release:artifact`
  - actual `bun pm pack --quiet` 1회
  - tarball file set inspection
  - temp install smoke
  - published bin / passthrough smoke
- `bun pm pack --dry-run`
  - quick inclusion preview or docs/checklist step
  - canonical artifact gate의 actual pack을 대체하지 않는다
- `bun publish --dry-run`
  - publish simulation
  - release-only rehearsal step
  - canonical fast gate와는 분리

완료 기준:
- one `Go / No-Go` command로 release candidate를 재판단할 수 있다
- 같은 automated gate 안에서 동일 테스트 파일을 2회 이상 실행하지 않는다
- automated gate는 network git mutation에 의존하지 않는다
- build는 gate당 최대 1회, tarball 생성도 최대 1회로 제한된다

#### Phase 4: Align docs, support matrix, and package metadata

대상:
- `README.md`
- `docs/development.md`
- 필요 시 `docs/architecture/upstream-compatibility-policy.md`
- 필요 시 `docs/architecture/kqmd-command-boundary.md`
- `package.json`

작업:
- README에 first release support matrix를 추가한다
  - Node
  - OS
  - install channel
  - support tier
- de-surfaced option은 README/examples/help/docs 어디에도 supported처럼 남지 않게 한다
- `docs/development.md`에는 fast gate vs artifact gate, `pack --dry-run` vs `publish --dry-run`, `measure:kiwi-reliability`의 supporting role을 분리해 적는다
- boundary authority 또는 support-or-desurface 정책 문구가 stale 해지는 경우에만 architecture docs를 맞춘다
- publish metadata(`repository`, `homepage`, `bugs`) 필요 여부를 점검한다
- unscoped package의 publish/access assumptions도 릴리즈 노트나 문서에 맞춰 정리한다

완료 기준:
- README와 development docs가 실제 release surface와 같은 말을 한다
- support matrix와 help surface가 어긋나지 않는다
- package metadata에서 기본 operator context가 빠져 있지 않다

## Release Verification Addendum

### Release Invariants

- owned surface에 explicit non-support 문구가 남지 않는다
- `query --candidate-limit`는 실제 semantics를 가진다
- `update --pull`는 owned release surface에서 제거된다
- `qmd update -> qmd status -> qmd search -> qmd query` 흐름에서 health vocabulary와 follow-up guidance가 충돌하지 않는다
- `status` zero-config와 `status --json` 계약이 유지된다
- machine-readable output은 advisory로 오염되지 않는다
- published tarball에는 `bin/`, `dist/`, `README.md`, `LICENSE`가 포함된다
- published `bin/qmd.js`는 passthrough argv/exit code를 보존한다
- trusted dependency surface에 새 lifecycle-script package가 생기지 않는다

### Gate Structure

- **Fast gate**
  - contract correctness 중심
  - one canonical `bun run release:verify`
  - no duplicate test execution
  - no network mutation
- **Artifact gate**
  - actual pack once
  - tarball inspect
  - temp install smoke
  - bin/passthrough smoke
- **Release-only rehearsal**
  - `bun publish --dry-run`
  - optional supporting step

### Immediate No-Go Conditions

- help와 실제 behavior가 다르다
- parse는 통과하지만 execution이 option을 무시한다
- `status`가 clean인데 `search`/`query`는 다른 의미를 보인다
- `--json`/machine-readable stdout이 advisory로 오염된다
- `bun pm untrusted` 또는 trusted dependency guard가 실패한다
- tarball contents/install/bin smoke가 실패한다
- docs/support matrix/help/examples가 실제 release surface와 다르다

### Rollback Guidance

이번 저장소의 롤백 핵심은 “bad artifact 회수 + 이전 안정 commit/tarball 재검증 + local index 재점검”이다.

1. 직전 안정 commit 또는 tag로 되돌린다
2. `bun install --frozen-lockfile`
3. `bun run check`
4. artifact gate 재실행
5. 필요 시 아래 흐름으로 local index 재검증

```bash
qmd update
qmd status
qmd search "형태소 분석"
qmd query "형태소 분석"
```

## Acceptance Criteria

### Functional Requirements

- [x] support matrix가 존재하고, 주요 command/flag가 `implemented`, `de-surfaced`, `passthrough-only`, `not claimed` 중 하나로 분류된다
- [x] `query --candidate-limit`는 이번 릴리즈에서 지원되며 plain/structured execution path 모두에 동일하게 전달된다
- [x] `query --candidate-limit`는 positive integer만 허용하고, default `40`, max `100` 이하의 bounded contract를 가진다
- [x] `update --pull`는 이번 릴리즈에서 owned release surface에서 제거된다
- [x] `update --pull`는 parser/help/docs/examples/tests/snapshots 어디에도 supported path처럼 남지 않는다
- [x] `status`는 zero-config entrypoint와 machine-readable path를 릴리즈 evidence에 포함한다
- [x] releaser는 canonical local release gate만 실행해도 `Go / No-Go`를 판단할 수 있다
- [ ] release gate 실패는 capability regression / packaging failure / dependency drift / documentation contract mismatch 중 어느 축인지 구분 가능하다

### Non-Functional Requirements

- [x] machine-readable stdout purity가 유지되고, diagnostics는 `stderr`로만 흐른다
- [ ] raw stack, absolute path, remote URL, token/password-like 문자열이 failure path에 그대로 새지 않는다
- [x] canonical automated gate는 network git mutation에 의존하지 않는다
- [x] canonical automated gate는 동일 테스트 파일을 중복 실행하지 않는다
- [ ] full fast gate는 warm run 기준 `<= 15s`, cold run 기준 `<= 30s` 목표를 가진다
- [x] artifact gate는 build 최대 1회, tarball 생성 최대 1회로 유지된다
- [x] `measure:kiwi-reliability`는 supporting signal로만 쓰이고, end-to-end proof를 대체하지 않는다
- [ ] 새로운 semi-private upstream seam 의존은 추가하지 않는다

### Quality Gates

- [x] `bun run check`가 green이다
- [x] `query --candidate-limit` plain/structured payload test가 존재한다
- [x] invalid `candidate-limit` validation test가 존재한다
- [x] `query --explain` conditional snapshot이 유지된다
- [x] `status` zero-config / `status --json` regression test가 존재한다
- [x] `update --pull` de-surfaced regression test가 존재한다
- [ ] one seeded-store cross-command proof가 존재한다
- [x] trusted dependency drift verification이 green이다
- [x] actual tarball install smoke와 published bin / passthrough smoke가 green이다
- [x] help surface, parse failure contract, machine-readable purity가 tests/docs/examples와 일치한다

### Release Blocking Rules

- [ ] supported option contract drift가 있으면 `No-Go`다
- [ ] packaging/bin smoke failure가 있으면 `No-Go`다
- [ ] trusted dependency drift가 있으면 `No-Go`다
- [ ] cross-command reliability regression이 있으면 `No-Go`다
- [ ] documentation/help/support matrix mismatch는 cosmetic이 아니라 release contract mismatch로 취급한다

## Success Metrics

- 릴리즈 후보에서 owned CLI validation failure 중 “아직 지원하지 않음”류 메시지가 사라진다
- one canonical `Go / No-Go` command로 capability, reliability, dependency, artifact를 재판단할 수 있다
- `candidate-limit` 지원이 medium fixture 기준 query p95 latency를 의미 있게 낮추고, default path 회귀는 `<= 5%`로 유지된다
- README, docs, help, parser, output, tarball install smoke가 같은 support matrix를 가리킨다
- 새 drift가 생기면 tests, gate, docs assertion 중 하나가 먼저 실패한다

## Dependencies & Risks

### Dependencies

- installed `@tobilu/qmd` baseline behavior
- existing focused suites and parity suite
- current README / development / architecture docs
- tarball/bin smoke harness

### Risks

- `candidateLimit` closure가 long-term `search/query` divergence를 키울 수 있다
- option-level parity chase가 명령 경계를 침식시킬 수 있다
- `update --pull`를 무리하게 살리면 git/shell semantics가 릴리즈 범위를 폭발시킬 수 있다
- parity baseline과 `status` contract를 같은 층위로 취급하면 gate scope가 흐려질 수 있다
- automated gate에서 `check`와 targeted suites를 둘 다 돌리면 중복 비용이 커진다
- artifact smoke 없이 pack dry-run만 믿으면 shipped artifact failure를 놓칠 수 있다

### Mitigations

- `candidateLimit`는 기존 typed/runtime seam만 사용하고 범위를 엄격히 제한한다
- `update --pull`는 이번 릴리즈에서 de-surface를 기본값으로 둔다
- `status`는 parity snapshot이 아니라 zero-config/focused behavior contract로 분리해 본다
- fast gate와 artifact gate를 분리해 중복 실행을 막는다
- actual tarball install smoke를 canonical artifact gate에 넣는다
- docs/support matrix/help/examples를 함께 갱신해 public contract drift를 줄인다

## Documentation Plan

- `README.md`
  - first release support matrix
  - owned command contract
  - known non-goals
  - de-surfaced options not claimed
- `docs/development.md`
  - fast gate vs artifact gate
  - `bun pm pack --dry-run` vs actual pack vs `bun publish --dry-run`
  - `measure:kiwi-reliability`의 supporting role
  - manual proof and rollback expectations
- 필요 시 `docs/architecture/upstream-compatibility-policy.md`
  - support-or-desurface, boundary authority text가 stale 해질 때만 갱신
- 필요 시 `docs/architecture/kqmd-command-boundary.md`
  - owned/passthrough boundary wording이 release support matrix와 어긋날 때만 갱신
- `package.json`
  - release scripts
  - metadata(`repository`, `homepage`, `bugs`) 점검

## Sources & References

### Origin

- **Brainstorm document:** [`docs/brainstorms/2026-03-13-owned-cli-release-readiness-brainstorm.md`](../../docs/brainstorms/2026-03-13-owned-cli-release-readiness-brainstorm.md)

### Internal References

- [`src/commands/owned/io/parse.ts`](../../src/commands/owned/io/parse.ts)
- [`src/commands/owned/query.ts`](../../src/commands/owned/query.ts)
- [`src/commands/owned/update.ts`](../../src/commands/owned/update.ts)
- [`docs/development.md`](../../docs/development.md)
- [`docs/architecture/upstream-compatibility-policy.md`](../../docs/architecture/upstream-compatibility-policy.md)
- [`docs/architecture/kqmd-command-boundary.md`](../../docs/architecture/kqmd-command-boundary.md)
- [`docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`](../../docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md)
- [`docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`](../../docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md)
- [`docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`](../../docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
- [`docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md`](../../docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md)
- [`docs/solutions/security-issues/trusted-dependencies-drift-kqmd-cli-20260313.md`](../../docs/solutions/security-issues/trusted-dependencies-drift-kqmd-cli-20260313.md)
- [`docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md`](../../docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md)
- [`docs/plans/2026-03-11-feat-owned-command-io-parity-contract-plan.md`](../../docs/plans/2026-03-11-feat-owned-command-io-parity-contract-plan.md)
- [`docs/plans/2026-03-13-fix-harden-kiwi-search-reliability-contract-plan.md`](../../docs/plans/2026-03-13-fix-harden-kiwi-search-reliability-contract-plan.md)
- [`docs/plans/2026-03-13-refactor-bun-first-repository-toolchain-plan.md`](../../docs/plans/2026-03-13-refactor-bun-first-repository-toolchain-plan.md)

### External References

- [Bun runtime and `bun run`](https://bun.sh/docs/runtime)
- [Bun `bun pm pack`](https://bun.sh/docs/pm/cli/pm)
- [Bun `bun publish`](https://bun.sh/docs/pm/cli/publish)
- [Bun lifecycle scripts](https://bun.sh/docs/pm/lifecycle)
- [npm package.json metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
- [npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack)
- [POSIX Utility Conventions](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap12.html)
- [GNU Coding Standards: `--help` and `--version`](https://www.gnu.org/prep/standards/html_node/_002d_002dhelp.html)
