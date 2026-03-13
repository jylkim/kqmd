---
status: complete
priority: p1
issue_id: "029"
tags: [cli, release, parity, qmd, typescript, bun]
dependencies: []
---

# Close owned CLI release-readiness gaps

## Problem Statement

K-QMD의 owned CLI는 Kiwi reliability, parity baseline, trusted dependency guardrail, pack/bin smoke까지는 갖췄지만, 첫 릴리즈 기준으로 보면 아직 command surface가 완전히 닫히지 않았다. 특히 `query --candidate-limit`는 typed seam만 있고 실제 실행에 연결되지 않았고, `update --pull`는 validation-only half-support 상태로 남아 있다. 또한 releaser가 한 번에 `Go / No-Go`를 재판단할 canonical local release gate도 없다.

## Findings

- `query --candidate-limit`는 parser와 `QueryCommandInput`에 이미 존재하지만, `session.store.search(...)` 호출로 전달되지 않는다.
- `update --pull`는 owned path에 pre-update runner seam이 없어 안전한 semantics를 짧게 닫기 어렵다.
- `qmd <owned-command> --help`는 현재 upstream help로 passthrough 되므로, option de-surface를 truly 닫으려면 help surface ownership도 같이 봐야 한다.
- `docs/development.md`에는 focused suites, pack/bin smoke, go / no-go 문서가 있으나, canonical release script는 없다.

## Proposed Solutions

### Option 1: Implement `candidate-limit`, de-surface `--pull`, add local release scripts

**Approach:** `candidate-limit`는 owned query execution에 연결하고, `update --pull`는 parser/help/docs/tests/examples에서 제거한다. 동시에 `release:verify`와 `release:artifact` 같은 로컬 스크립트로 existing verification commands를 얇게 묶는다.

**Pros:**
- release plan과 가장 정확히 맞는다
- 기능 신뢰성과 public contract를 함께 닫을 수 있다
- `--pull`의 위험한 scope expansion을 피한다

**Cons:**
- owned help surface까지 일부 소유해야 할 수 있다
- 관련 테스트와 문서를 함께 정리해야 한다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Option 1로 진행한다. 이번 릴리즈에서는 `candidate-limit`를 구현하고, `update --pull`는 owned release surface에서 제거한다. release gate는 existing tests/pack/smoke를 재조합하는 얇은 local script로 추가한다.

## Acceptance Criteria

- [x] `query --candidate-limit`가 plain/structured query path 모두에서 실제 execution semantics를 가진다
- [x] invalid `candidate-limit` 입력이 deterministic validation contract를 가진다
- [x] `update --pull`가 parser/help/docs/examples/tests/snapshots 어디에도 supported path처럼 남지 않는다
- [x] `qmd <owned-command> --help`가 owned release surface와 같은 support model을 보여 준다
- [x] local release verification scripts가 추가되고 기존 verification commands를 canonical 순서로 orchestration 한다
- [x] docs와 release plan progress가 구현 결과를 반영한다

## Work Log

### 2026-03-13 - Execution Start

**By:** Codex

**Actions:**
- Read the approved release-readiness plan and deepening notes
- Confirmed user approval to proceed directly on `main`
- Identified likely hidden scope around owned command help surface

**Learnings:**
- `candidate-limit` and `update --pull` must be treated asymmetrically
- de-surfacing `--pull` fully likely requires touching help routing, not just parser validation

### 2026-03-13 - Execution Complete

**By:** Codex

**Actions:**
- Added local owned command help handling and routed `qmd <owned-command> --help` through K-QMD-owned help text
- Implemented `query --candidate-limit` execution via a local query runtime adapter and added bounded validation (`1..100`)
- De-surfaced `update --pull` from parser/help/tests/docs-facing contract
- Added `test/query-runtime.test.ts`, `test/owned-command-parity/help-output.test.ts`, and updated routing/parity tests
- Added `scripts/verify_release_artifact.ts` plus `test:release-contract`, `release:artifact`, and `release:verify` scripts
- Updated `README.md` and `docs/development.md` to reflect support matrix and release gate flow
- Ran `bun run check` and `bun run release:verify`

**Learnings:**
- `candidate-limit` required a lower-level query adapter because public `store.search()` does not currently expose the candidate limit seam
- de-surfacing an option honestly requires touching help, parse, tests, and docs together
- a thin local release gate is practical if it reuses existing tests and keeps artifact verification separate
