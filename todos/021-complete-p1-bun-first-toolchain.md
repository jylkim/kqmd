---
status: complete
priority: p1
issue_id: "021"
tags: [tooling, bun, cli, testing, documentation]
dependencies: []
---

# Convert K-QMD Repository Toolchain to Bun-First

레포 운영 기준을 `npm`에서 `Bun`으로 옮기고, published `qmd` bin의 Node-compatible 계약은 유지한다.

## Problem Statement

현재 K-QMD는 제품 계약은 upstream-compatible replacement distribution인데, 개발/검증 흐름은 여전히 npm-first다. 이로 인해 package manager 기준, smoke test runtime intent, publish verification 문맥이 섞여 있다.

## Findings

- `package.json`의 `prepack`과 `check`는 아직 `npm run ...`을 사용한다.
- `docs/development.md`와 `docs/architecture/upstream-compatibility-policy.md`가 npm-first 명령을 기준으로 문서화되어 있다.
- `test/bin-smoke.test.ts`는 `npm run build`와 `process.execPath`에 의존해 Bun test 환경에서 smoke intent가 흐려질 수 있다.
- clean Bun install 기준 lifecycle trust가 필요한 패키지는 `node-llama-cpp`, `better-sqlite3`, `esbuild`였다.

## Proposed Solutions

### Option 1: Full Bun-first migration with explicit runtime smoke

**Approach:** `package.json`, lockfile, docs, smoke harness를 함께 전환하고 explicit Node runtime smoke를 유지한다.

**Pros:**
- 레포 운영 기준이 하나로 정리된다
- smoke/test/publish intent가 선명해진다

**Cons:**
- lockfile과 문서를 함께 바꿔야 한다
- install/test verification이 다소 길다

**Effort:** 3-5 hours

**Risk:** Medium

## Recommended Action

1. `package.json`과 lockfile을 Bun-first로 전환한다.
2. `test/bin-smoke.test.ts`에서 Bun build runtime과 explicit Node smoke runtime을 분리한다.
3. 개발/호환 정책 문서를 Bun-first 기준으로 갱신한다.
4. Bun install, parity, smoke, pack을 실제로 검증한다.

## Technical Details

**Affected files:**
- `package.json`
- `package-lock.json`
- `bun.lock`
- `docs/development.md`
- `docs/architecture/upstream-compatibility-policy.md`
- `test/bin-smoke.test.ts`
- `todos/021-complete-p1-bun-first-toolchain.md`
- `docs/plans/2026-03-13-refactor-bun-first-repository-toolchain-plan.md`

## Acceptance Criteria

- [x] `package.json`이 Bun-first metadata와 scripts를 사용한다
- [x] `package-lock.json`이 제거되고 `bun.lock`이 추가된다
- [x] bin smoke가 explicit Node runtime과 wrapper path를 사용한다
- [x] 개발/호환 정책 문서가 Bun-first 기준으로 갱신된다
- [x] `bun install`, `bun run build`, `bun run test`, `bun run test:parity`, `bun pm pack --dry-run` 검증이 통과한다

## Work Log

### 2026-03-13 - Execution Start

**By:** Codex

**Actions:**
- 계획과 심화 문서를 읽고 구현 범위를 확정했다
- `package.json`, `docs/development.md`, `test/bin-smoke.test.ts`, `src/passthrough/upstream_locator.ts`를 검토했다
- `bun pm untrusted`로 initial trust surface를 확인했다

**Learnings:**
- 실제 Bun install 이후 trust surface는 `node-llama-cpp`, `better-sqlite3`, `esbuild`까지 포함됐다
- smoke harness에서 `process.execPath` 의존을 제거하는 것이 핵심이다

### 2026-03-13 - Implementation Complete

**By:** Codex

**Actions:**
- `package.json`에 `packageManager`, Bun-first scripts, `trustedDependencies` allowlist를 반영했다
- `bun pm migrate`, `bun install --force`, `bun pm trust better-sqlite3 esbuild`로 Bun install surface를 정리했다
- `test/bin-smoke.test.ts`에서 Bun build runtime과 explicit Node smoke runtime을 분리했다
- `docs/development.md`, `docs/architecture/upstream-compatibility-policy.md`를 Bun-first 기준으로 갱신했다
- `package-lock.json`을 제거하고 `bun.lock`을 추가했다
- `bun install --frozen-lockfile`, `bun run build`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:parity`, `bun run check`, `bun pm pack --dry-run`, actual tarball smoke를 검증했다

**Learnings:**
- 초기 `bun pm untrusted`만으로는 trust surface를 과소평가할 수 있어서 실제 install 이후 재확인이 필요했다
- packed tarball smoke에서도 explicit Node runtime과 wrapper path를 강제해야 source-tree smoke와 같은 계약을 검증할 수 있다
