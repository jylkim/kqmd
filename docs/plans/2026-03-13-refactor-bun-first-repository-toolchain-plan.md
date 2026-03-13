---
title: refactor: Convert repository toolchain to Bun-first
type: refactor
status: completed
date: 2026-03-13
origin: docs/brainstorms/2026-03-13-bun-first-upstream-alignment-brainstorm.md
---

# refactor: Convert repository toolchain to Bun-first

## Enhancement Summary

**Deepened on:** 2026-03-13  
**Sections enhanced:** 8  
**Research agents used:** framework-docs-researcher, architecture-strategist, security-sentinel, code-simplicity-reviewer, performance-oracle, spec-flow-analyzer

### Key Improvements
1. Bun migration path를 `delete package-lock + reinstall` 수준이 아니라 `bun pm migrate` + `bun pm untrusted`/`bun pm trust` audit 흐름으로 구체화했다.
2. routine artifact verification(`bun pm pack --dry-run`)와 release rehearsal(`bun publish --dry-run`)를 분리해 검증 비용과 목적을 명확히 했다.
3. Bun 실행 시 `process.execPath`가 Bun으로 바뀌는 문제를 반영해, build runtime과 published-bin runtime을 명시적으로 분리하는 smoke harness 방향을 더 구체화했다.

### New Considerations Discovered
- Bun은 dependency lifecycle scripts를 기본적으로 실행하지 않으므로 native dependency trust audit이 migration의 필수 선행 조건이다.
- `bun run <script>`와 `bun test`는 의미가 다르므로, 살아 있는 문서와 quality gate는 모두 `bun run <script>` 문법으로 통일해야 한다.
- `bun ci` 또는 `bun install --frozen-lockfile`를 추가해야 lockfile commit 이후의 재현 가능 검증이 닫힌다.

## Overview

K-QMD 저장소의 개발, 테스트, 빌드, parity 검증, publish 검증 흐름을 Bun-first로 전환한다. 선택된 방향은 브레인스토밍의 `Approach A: Full Bun-first repo conversion`이며, 저장소 운영 기준을 하나로 줄여 upstream alignment 비용을 낮추는 것이 목표다 (see brainstorm: `docs/brainstorms/2026-03-13-bun-first-upstream-alignment-brainstorm.md`).

이번 작업은 레포 운영 기준을 바꾸는 refactor이지, 사용자에게 노출되는 제품 계약을 다시 정의하는 작업은 아니다. 패키지 이름 `kqmd`, 실행 명령 `qmd`, owned/passthrough command boundary, upstream compatibility 철학은 유지한다.

## Problem Statement

현재 저장소는 제품 framing은 upstream-compatible replacement distribution인데, 실제 개발 도구 표면은 여전히 npm-first다.

- [`package.json`](../../package.json) 은 `prepack`과 `check`를 `npm run ...`으로 연결하고 있다.
- [`docs/development.md`](../../docs/development.md) 전체가 `npm install`, `npm run ...`, `npm pack --dry-run`을 기준으로 쓰여 있다.
- [`docs/architecture/upstream-compatibility-policy.md`](../../docs/architecture/upstream-compatibility-policy.md) 도 parity/publish drift 대응 절차를 npm 용어로 고정하고 있다.
- [`test/bin-smoke.test.ts`](../../test/bin-smoke.test.ts) 는 빌드를 위해 `execFileSync('npm', ['run', 'build'])`를 직접 호출한다.
- Bun으로 테스트를 실행하면 `process.execPath`가 Node가 아니라 Bun을 가리키므로, published bin smoke가 무엇을 검증하는지 흐려질 수 있다.
- direct/transitive dependency에는 `better-sqlite3`, `node-llama-cpp`, `esbuild`처럼 install/postinstall에 의존하는 패키지가 있어, `bun install` 전환 시 lifecycle/trust 정책을 명시해야 한다.

요약하면, 현재 상태는 “레포 운영은 npm-first, 제품 계약은 qmd-compatible”라는 혼합 모델이다. 이 혼합 상태가 개발자 경험, 검증 루틴, 런타임 smoke의 기준을 동시에 흐리고 있다.

### Research Insights

**Best Practices:**
- Bun migration의 첫 단계는 수동 lockfile 삭제보다 `bun pm migrate`로 기존 dependency graph를 먼저 Bun lockfile로 옮긴 뒤, clean install로 검증하는 편이 안전하다.
- dependency lifecycle scripts는 opt-in trust 모델이므로, `trustedDependencies`를 막연히 채우기보다 `bun pm untrusted`로 후보를 보고 `bun pm trust <pkg>` 또는 명시적 `package.json` 갱신으로 닫는 편이 재현 가능하다.
- repository script 문맥에서는 `bun test`, `bun build` 같은 built-in command와 혼동되지 않도록 `bun run <script>`를 canonical 형태로 문서화해야 한다.

**Performance Considerations:**
- native dependency가 많은 순간 install time variance가 커질 수 있으므로, 성능 문제 분석용 escape hatch로 `bun install --concurrent-scripts <n>`를 문서에 보조 팁으로 남겨 두는 것이 유용하다.
- install 경로가 안정화된 뒤에는 `bun ci` 또는 `bun install --frozen-lockfile`가 빠른 drift detection에 더 적합하다.

**References:**
- https://bun.sh/docs/pm/cli/pm
- https://bun.sh/docs/pm/cli/install
- https://bun.sh/docs/runtime

## Proposed Solution

저장소 운영 기준을 Bun으로 통일한다. 구체적으로는:

1. 패키지 매니저 기준을 `bun install` + `bun.lock`으로 옮긴다.
2. 개발/검증 명령의 기본 진입점을 `bun run ...`으로 통일한다.
3. publish 검증 기준을 `bun pm pack --dry-run`으로 옮긴다.
4. 테스트와 smoke harness에서 “Bun이 빌드/검증을 orchestration한다”는 사실과 “published `qmd` bin은 여전히 Node-compatible contract를 가진다”는 사실을 분리해서 검증한다.
5. Bun install 환경에서도 upstream locator, parity suite, path compatibility, packed artifact smoke가 유지되도록 regression coverage를 추가한다.

이 접근은 브레인스토밍에서 정한 “gap을 관리하지 말고 gap 자체를 없앤다”는 결정을 그대로 구현 수준으로 옮기는 것이다 (see brainstorm: `docs/brainstorms/2026-03-13-bun-first-upstream-alignment-brainstorm.md`).

## Technical Approach

### Architecture

이번 전환은 세 레이어를 분리해서 다룬다.

1. **Repo toolchain layer**
   `package.json`, lockfile, Bun 설정, 개발 문서, local verification 명령 표면을 Bun-first로 정렬한다.

2. **Test and packaging contract layer**
   bin smoke, parity, path compatibility, packed artifact 검증이 Bun 환경에서도 같은 의도를 유지하도록 테스트 harness를 고친다.

3. **Product runtime compatibility layer**
   [`bin/qmd.js`](../../bin/qmd.js) 의 Node shebang과 replacement distribution contract는 유지한다. 즉 “레포는 Bun-first”이지만 “published CLI는 당장 Bun-only runtime으로 강제하지 않는다”가 기본 원칙이다.

이 분리가 중요한 이유는, 현재 smoke와 문서가 “어떤 도구로 레포를 운영하느냐”와 “사용자-facing bin이 어떤 런타임 계약을 가지느냐”를 섞고 있기 때문이다.

### Research Insights

**Best Practices:**
- package-manager contract, test harness runtime contract, publish contract를 같은 용어로 묶지 말고 문서와 tests에서 각각 따로 이름 붙이는 편이 architectural drift를 줄인다.
- routine local artifact inspection은 `bun pm pack --dry-run`으로 충분하고, registry-facing rehearsal은 `bun publish --dry-run`으로 분리하는 편이 목적이 선명하다.
- replacement-distribution 구조를 유지하려면 passthrough subprocess는 계속 installed upstream binary를 직접 spawn 해야 한다. Bun은 repo toolchain의 기준일 뿐, delegated upstream command의 중간 shim이 되어서는 안 된다.

**Edge Cases:**
- Bun runtime을 package scripts 전체에 강제하는 `run.bun = true`는 architecture-safe default가 아니다. toolchain-specific compatibility를 확인한 뒤에만 활성화해야 한다.
- linker 전략을 여러 개 동시에 지원하려 하면 passthrough locator coverage가 과도하게 넓어진다. 계획에서는 “프로젝트의 canonical linker 하나”만 검증 대상으로 두는 편이 단순하다.

**References:**
- https://bun.sh/docs/runtime/bunfig#runbun
- https://bun.sh/docs/runtime
- https://bun.sh/docs/pm/cli/pm
- https://bun.sh/docs/pm/cli/publish

### Implementation Phases

#### Phase 1: Establish Bun as the Canonical Repo Toolchain

대상 파일:
- `package.json`
- `package-lock.json`
- `bun.lock`
- `bunfig.toml`
- `.gitignore`

작업:
- `package.json`에 Bun 기준 메타데이터를 추가한다.
  - `packageManager`에 검증한 Bun 버전을 명시한다.
  - 필요하면 `engines.bun`을 추가하되, existing `engines.node`는 published runtime contract 때문에 유지한다.
- `bun pm migrate`를 baseline migration step으로 사용한다.
  - 기존 `package-lock.json` 기반 dependency graph를 Bun lockfile로 옮긴다.
  - 이어서 clean reinstall로 실제 install-time behavior를 확인한다.
- npm self-recursion을 제거한다.
  - `prepack`과 `check` 같은 스크립트는 `npm run ...` 대신 Bun-first orchestration으로 바꾼다.
  - 표준 실행 예시는 권고가 아니라 정책으로 `bun run build`, `bun run test`, `bun run test:parity`로 통일한다. 이유는 Bun built-in subcommand와 script name 충돌을 피하기 위해서다.
- `package-lock.json`을 제거하고 `bun.lock`을 canonical lockfile로 추가한다.
- `bunfig.toml` 도입 여부를 검토한다.
  - `run.bun = true`는 baseline이 아니라 별도 compatibility gate로 둔다.
  - `tsc`, `vitest`, `biome` smoke가 모두 통과하기 전에는 global forcing을 켜지 않고, `bun run ...`만 canonical entrypoint로 둔다.
- Bun install 시 필요한 lifecycle/trust policy를 명시한다.
  - `bun pm untrusted`로 실제 trust 필요 패키지를 먼저 식별한다.
  - `trustedDependencies`는 exact allowlist와 각 항목의 rationale을 함께 관리한다.
  - allowlist 확장은 수동 검토를 통과한 뒤에만 허용한다.
  - trust 반영 후에는 `node_modules`와 `bun.lock`를 재생성하는 clean reinstall로 검증한다.
  - 최소 검토 대상은 `better-sqlite3`, `node-llama-cpp`, `esbuild`이며, 실제 allowlist는 audit 결과에 따라 최소화한다.

완료 기준:
- 깨끗한 checkout에서 `bun install`이 canonical setup path가 된다.
- 레포 루트에는 `bun.lock`만 남고 `package-lock.json`은 사라진다.
- repo-level script entrypoint 문맥에서 npm은 더 이상 source of truth가 아니며, package script 실행은 항상 `bun run <script>` 형태를 사용한다.
- `trustedDependencies` 또는 동등 trust policy는 exact allowlist, 각 항목의 근거, clean reinstall 검증 절차를 포함한다.

### Research Insights

**Implementation Details:**
```bash
bun pm migrate
bun pm untrusted
bun pm trust better-sqlite3 node-llama-cpp esbuild
rm -rf node_modules
bun install
```

**Best Practices:**
- 초기 전환은 `bun pm migrate`로 lockfile을 먼저 옮기고, 그다음 clean reinstall로 install-time behavior를 확인하는 순서가 안전하다.
- `trustedDependencies`는 direct dependency만이 아니라 실제 install/postinstall 경로를 가진 transitive native packages까지 audit 결과로 닫아야 한다.
- `run.bun = true`는 즉시 기본값으로 두지 말고, `tsc`, `vitest`, `biome` smoke가 모두 통과한 뒤에만 고려한다.
- `engines.bun`은 보조적 힌트일 뿐 canonical enforcement 수단이 아니다. 기본 계획은 `packageManager` pin과 문서화된 setup/check gate를 우선하고, `engines.bun`은 실제로 더 나은 failure message가 필요할 때만 추가한다.

**Performance Considerations:**
- native postinstall이 CPU를 과도하게 점유하면 troubleshooting 섹션에 `bun install --concurrent-scripts <n>`를 보조 옵션으로 남겨 두는 편이 좋다.

**Edge Cases:**
- Bun linker를 바꿔 가며 모두 지원하려 들기보다, repo에서 채택할 canonical linker를 정하고 그 설정만 regression 대상으로 삼아야 한다.
- `bun pm trust` 대상은 예시 패키지 목록을 그대로 고정하는 것이 아니라, 실제 `bun pm untrusted` 결과를 바탕으로 최소화해야 한다.

#### Phase 2: Harden the Test Harness Around Explicit Runtime Intent

대상 파일:
- `test/bin-smoke.test.ts`
- `test/passthrough-contract.test.ts`
- `test/path-compatibility.test.ts`
- `test/fixtures/upstream-fixture.mjs`
- `test/support/runtime-binaries.ts` 또는 동등 helper 파일

작업:
- [`test/bin-smoke.test.ts`](../../test/bin-smoke.test.ts) 에서 `execFileSync('npm', ['run', 'build'])`를 제거하고 Bun 기준 빌드 진입점으로 바꾼다.
- smoke harness에서 런타임 intent를 분리한다.
  - build orchestration은 Bun이 맡는다.
  - published bin smoke는 “Node-compatible published contract”를 검증해야 하므로, `process.execPath`에 기대지 말고 명시적인 Node binary를 사용한다.
  - Bun으로 테스트를 돌릴 때 `process.execPath === /Users/.../.bun/bin/bun` 이 되므로, 현재 방식은 smoke 의미를 바꿔 버린다.
- wrapper fixture도 명시적 runtime 선택을 따르게 정리한다.
  - upstream fixture wrapper가 “현재 테스트 프로세스 런타임”을 그대로 따르지 않도록 한다.
  - `KQMD_UPSTREAM_BIN`은 raw `.js`/`.mjs` script path가 아니라 OS별 wrapper path만 가리키게 한다.
  - published bin smoke와 Bun-installed layout smoke를 별도 시나리오로 분리한다.
- passthrough/path compatibility 쪽에는 Bun-installed dependency layout regression을 추가한다.
  - [`src/passthrough/upstream_locator.ts`](../../src/passthrough/upstream_locator.ts) 는 `node_modules/@tobilu/qmd/package.json` 경로를 직접 찾는다.
  - direct dependency under Bun install에서 이 해석이 계속 유효한지 테스트로 고정한다.
- helper 파일은 선택 사항으로 둔다.
  - `test/support/runtime-binaries.ts`가 필요하면 도입하되, `test/bin-smoke.test.ts` 내부 수정만으로 충분하면 새 파일은 만들지 않는다.

완료 기준:
- bin smoke는 “Bun으로 빌드한다”와 “Node-compatible bin을 검증한다”를 혼동하지 않는다.
- Bun 환경에서 `locateUpstreamBinary()` 와 path compatibility suite가 계속 green이다.
- `KQMD_UPSTREAM_BIN` fixture는 어느 플랫폼에서도 raw script가 아니라 wrapper path를 사용한다.

### Research Insights

**Best Practices:**
- runtime selection은 helper 한 곳에서만 결정해야 한다. `test/support/runtime-binaries.ts` 같은 단일 helper에서 Node path, Bun path, fixture wrapper runtime을 모두 해석하게 두는 편이 test semantics drift를 막는다.
- build smoke와 packaging smoke를 분리하면, full suite보다 빠른 targeted verification loop를 만들 수 있다.
- passthrough fixture smoke는 [`test/passthrough-contract.test.ts`](../../test/passthrough-contract.test.ts) 와 같은 직접 spawn 원칙을 유지해야 한다. runtime helper는 binary path만 고르고, subprocess invocation semantics(`shell: false`, inherited env)는 기존 contract를 그대로 따라야 한다.

**Implementation Details:**
```ts
// intent only: build with Bun, smoke published bin with explicit Node
const runtimes = resolveRuntimeBinaries();
execFileSync(runtimes.bun, ['run', 'build'], { cwd });
spawnSync(runtimes.node, [binPath, 'collection', 'list'], { cwd, env });
```

**Edge Cases:**
- `process.execPath`를 그대로 wrapper fixture에 넘기면 Bun-run test와 Node-run test가 서로 다른 계약을 검증하게 된다.
- packed tarball smoke와 source-tree smoke를 분리하지 않으면 `files` allowlist 누락을 늦게 발견할 수 있다.
- top-level bin만 explicit Node로 고정하고 delegated fixture wrapper를 그대로 두면 portability 문제가 delegation 경로에서 다시 살아난다.

#### Phase 3: Normalize Living Documentation and Version-Bump Workflow

대상 파일:
- `docs/development.md`
- `docs/architecture/upstream-compatibility-policy.md`
- `README.md` (필요한 경우만)

작업:
- [`docs/development.md`](../../docs/development.md) 를 Bun-first로 갱신한다.
  - 개발 환경: `Bun >= validated version`, `Node >=24`
  - 시작하기: `bun install`, `bun run build`, `bun run check`
  - parity, targeted test, coverage, pack, smoke, version bump checklist 전부 Bun 기준으로 바꾼다.
- [`docs/architecture/upstream-compatibility-policy.md`](../../docs/architecture/upstream-compatibility-policy.md) 에서 drift 대응 문구를 Bun 기준으로 옮긴다.
  - `npm pack --dry-run` -> `bun pm pack --dry-run`
  - `npm run test:parity` -> `bun run test:parity`
  - 단, policy 문서에는 “published `bin/qmd.js`는 Node-compatible contract를 유지한다”는 guardrail을 명시해 둔다.
- README는 사용자-facing 문서이므로 최소 변경만 한다.
  - 개발자 진입이 README를 통과해야 하는 문장이 있으면 Bun 기준으로 정리한다.
  - 그렇지 않으면 README는 product framing 위주로 유지한다.
- historical artifact는 rewrites 대상이 아니다.
  - `docs/solutions/*`, 기존 `docs/plans/*` 안의 `npm run ...` 명령은 당시 세션의 역사적 맥락이므로 일괄 수정하지 않는다.

완료 기준:
- 살아 있는 운영 문서에서 npm-first 안내가 사라진다.
- version bump와 publish 검증 절차가 Bun 기준으로 읽혀도 현재 guardrail을 잃지 않는다.

### Research Insights

**Best Practices:**
- 문서에는 routine verification과 release-only verification을 구분해 두는 편이 좋다.
  - routine: `bun run build`, `bun run test:parity`, `bun pm pack --dry-run`
  - release rehearsal: `bun publish --dry-run`
- historical artifact를 유지한다는 원칙은 explicit하게 적어 두는 편이 좋다. 그렇지 않으면 implementation 단계에서 불필요한 docs rewrite가 scope를 키운다.

**Implementation Details:**
- version bump checklist에는 `bun ci` 또는 `bun install --frozen-lockfile`를 넣어 lockfile drift를 빠르게 잡는 단계를 추가한다.

#### Phase 4: Verify the New Baseline End-to-End

대상 파일:
- `package.json`
- `docs/development.md`
- `test/bin-smoke.test.ts`
- `test/path-compatibility.test.ts`
- `test/passthrough-contract.test.ts`

작업:
- clean install verification
  - `bun install`
- quality gate verification
  - `bun run build`
  - `bun run lint`
  - `bun run typecheck`
  - `bun run test`
  - `bun run test:parity`
  - `bun run check`
- packaging verification
  - `bun pm pack --dry-run`
- runtime smoke verification
  - explicit Node runtime으로 `bin/qmd.js` 및 passthrough fixture smoke
  - Bun-installed dependency layout에서 upstream locator/path compatibility smoke

완료 기준:
- Bun-first 문서와 실제 검증 명령이 일치한다.
- pack artifact, passthrough delegation, parity suite가 모두 새 기준에서 성공한다.

### Research Insights

**Best Practices:**
- clean setup 검증과 reproducible validation은 분리하는 편이 좋다.
  - first-time setup: `bun install`
  - locked verification: `bun ci` 또는 `bun install --frozen-lockfile`
- package contents 점검은 `bun pm pack --dry-run`, registry-facing dry-run은 `bun publish --dry-run`으로 분리하면 비용 대비 신호가 좋아진다.

**Performance Considerations:**
- routine 로컬 루프에서는 full publish rehearsal을 매번 돌리지 말고, release/bump 시점에만 `bun publish --dry-run`을 수행하는 편이 빠르다.
- native dependency install smoke는 issue triage용으로 분리해 두면 일반 lint/test loop를 불필요하게 무겁게 만들지 않는다.

**Edge Cases:**
- `bun pm pack --dry-run`만으로 registry metadata 문제를 모두 잡을 수는 없다. release 전용 checklist에는 `bun publish --dry-run`을 따로 두는 편이 안전하다.

## Developer Flow Coverage

### Flow 1: Fresh Clone Setup

1. 개발자가 레포를 clone 한다.
2. `bun install`을 실행한다.
3. native/transitive dependency install script가 성공해 runtime prerequisites가 갖춰진다.
4. `bun run build`, `bun run check`로 baseline health를 확인한다.

주요 edge cases:
- Bun 미설치 또는 version mismatch
- `trustedDependencies` 누락으로 `better-sqlite3`/`node-llama-cpp` bootstrap 실패
- `bun.lock`와 `package-lock.json` 동시 존재로 setup 기준이 갈라짐

### Flow 2: Daily Development Loop

1. 개발자가 `bun run format`, `bun run lint`, `bun run test`, `bun run test:watch`를 실행한다.
2. package script는 Bun-first entrypoint로 일관되게 동작한다.
3. individual CLI runtime forcing은 기본값이 아니며, 필요한 경우에만 별도 호환성 검증 뒤 opt-in 한다.

주요 edge cases:
- `bun test`와 `bun run test` 혼동
- built-in Bun subcommand와 script 이름 충돌
- `run.bun` 활성화 시 일부 CLI의 shebang/runtime 차이로 인한 오동작

### Flow 3: Upstream Version Bump

1. `package.json`에서 `@tobilu/qmd` 버전을 올린다.
2. `bun install`로 lockfile과 install state를 갱신한다.
3. `bun run test:parity`를 돌린다.
4. installed upstream CLI parse/default/usage/output drift를 점검한다.
5. `documents`, `content`, `store_config`, `QMDStore.internal` contract가 여전히 local helpers와 맞는지 확인한다.

주요 edge cases:
- Bun-installed dependency layout에서 `findUpstreamPackageRoot()` 해석 실패
- native dependency install failure가 version bump validation을 가로막음
- parity baseline 갱신이 문서화되지 않아 local drift가 축적됨

### Flow 4: Packaging and Smoke

1. `bun pm pack --dry-run`으로 publish artifact preview를 확인한다.
2. `bun pm pack --quiet` 또는 동등 절차로 실제 tarball을 얻는다.
3. packed/bin smoke는 explicit Node runtime으로 `qmd` entrypoint contract를 검증한다.
4. passthrough delegation은 `KQMD_UPSTREAM_BIN` override와 package-bin resolution 모두 유지한다.
5. 필요 시 fresh temp workspace에서 tarball install 또는 extracted artifact smoke로 packed `bin`/`dist`/shebang contract를 확인한다.

주요 edge cases:
- Bun으로 테스트를 돌리면서 `process.execPath`가 Bun이 되어 published bin smoke 의미가 바뀜
- top-level bin은 Node로 고정했지만 delegated fixture가 current process runtime을 따라가며 계약이 다시 흐려짐
- `files` allowlist 누락으로 tarball에 `dist` 또는 `bin`이 빠짐
- pack 결과는 정상처럼 보이지만 실제 delegated upstream path resolution이 깨짐

## Alternative Approaches Considered

### Approach B: Keep Dual npm + Bun Support

브레인스토밍에서 이미 기각했다. 작은 저장소에서 이중 문서, 이중 lockfile, 이중 검증 문맥을 유지하는 비용이 더 크다 (see brainstorm: `docs/brainstorms/2026-03-13-bun-first-upstream-alignment-brainstorm.md`).

### Approach C: Keep Node-first and Only Add Bun Checks

역시 기각했다. 이 방식은 drift를 줄이지 못하고, “무엇이 canonical인가”를 계속 흐리게 둔다.

### Approach D: Switch the Published CLI Shebang to Bun Immediately

이번 계획에서는 채택하지 않는다. [`bin/qmd.js`](../../bin/qmd.js) 는 현재 `#!/usr/bin/env node` shebang 위에서 product contract를 제공하고 있고, 브레인스토밍도 사용자-facing `qmd` semantics를 바꾸는 작업은 non-goal로 잡았다. repo toolchain Bun-first 전환과 end-user runtime Bun-only 전환은 분리해서 다뤄야 한다.

### Approach E: Replace Vitest With Bun Test in the Same Change

이번 계획에서는 채택하지 않는다. 현재 이 저장소가 풀어야 할 핵심은 test framework 교체가 아니라 package-manager/script-runner 기준 정렬이다. `Vitest`를 유지한 채 Bun-first orchestration을 만들면 scope를 훨씬 덜 키우면서도 핵심 gap을 줄일 수 있다.

## System-Wide Impact

### Interaction Graph

- [`package.json`](../../package.json) 의 script surface가 바뀌면 [`docs/development.md`](../../docs/development.md) 의 setup/checklist와 [`test/bin-smoke.test.ts`](../../test/bin-smoke.test.ts) 의 build bootstrap이 함께 바뀐다.
- `bun install` 결과는 [`src/passthrough/upstream_locator.ts`](../../src/passthrough/upstream_locator.ts) 가 해석하는 installed package layout에 직접 영향을 준다.
- `bun run test` 경로는 test process runtime을 Bun으로 바꿀 수 있으므로, smoke harness가 기대하는 explicit Node runtime 검증과 분리해서 다뤄야 한다.
- `bun pm pack --dry-run`으로 publish verification 기준이 바뀌면 [`docs/architecture/upstream-compatibility-policy.md`](../../docs/architecture/upstream-compatibility-policy.md) 의 drift 대응 문장도 함께 바뀌어야 한다.

### Error & Failure Propagation

- install-time lifecycle script가 차단되면 failure가 즉시 드러나지 않고, 이후 `build`, `test`, `status`, delegated upstream open 시점에 지연 폭발할 수 있다.
- smoke harness가 `process.execPath`를 그대로 재사용하면, Bun 도입 뒤 failure가 “bin contract failure”인지 “runtime selection bug”인지 구분되지 않는다.
- `bun run` / `bun test` 혼동은 test runner 자체를 바꿔 버릴 수 있어, parity failure를 도구 선택 실수로 오해하게 만든다.

### State Lifecycle Risks

- migration 중 `package-lock.json`과 `bun.lock`가 동시에 남으면 의도치 않은 reinstall drift가 생긴다.
- trusted dependency 설정이 일부만 반영되면 개발자마다 native artifact 상태가 달라질 수 있다.
- generated `dist/`를 pack 전에 다시 빌드하지 않으면 publish artifact가 stale build를 포함할 수 있다.

### API Surface Parity

- 개발자-facing API surface는 `package.json` scripts, `docs/development.md` commands, version bump checklist다.
- runtime-facing API surface는 `bin/qmd.js`, packed tarball, passthrough delegation이다.
- 이 둘은 같은 change에 묶이지만 검증 방법이 달라야 한다. 전자는 Bun-first, 후자는 Node-compatible contract를 유지한다.

### Integration Test Scenarios

1. clean checkout에서 `bun install && bun run check` 가 통과한다.
2. `bun run test:parity` 가 current upstream baseline과 함께 통과한다.
3. `bun pm pack --dry-run` 후 explicit Node runtime smoke가 bin contract를 유지한다.
4. Bun-installed dependency layout에서 `findUpstreamPackageRoot()` 와 `locateUpstreamBinary()` 가 기대한 path를 해석한다.
5. `KQMD_UPSTREAM_BIN` override와 package-bin resolution이 Bun-first 전환 후에도 모두 살아 있다.
6. `KQMD_UPSTREAM_BIN` fixture는 raw script가 아니라 wrapper path만 사용한다.
7. 실제 tarball smoke가 packed `bin`/`dist`/shebang contract를 검증한다.

### Research Insights

**Missing Elements Resolved:**
- lockfile commit 이후의 재현 가능 검증이 빠져 있었는데, `bun ci` 또는 `bun install --frozen-lockfile`를 추가하는 쪽으로 보강한다.
- release 직전 검증과 평상시 검증이 같은 비용 구조로 섞여 있었는데, `pack`과 `publish --dry-run`을 분리해 해결한다.

## Acceptance Criteria

### Functional Requirements

- [x] `package.json` 이 Bun-first repo metadata를 갖고, repo-level canonical commands가 `bun install` / `bun run ...` / `bun pm pack --dry-run` 으로 정리된다.
- [x] package script 실행은 항상 `bun run <script>` 형태를 canonical form으로 사용한다.
- [x] `package-lock.json` 이 제거되고 `bun.lock` 이 canonical lockfile로 commit 된다.
- [x] `docs/development.md` 와 `docs/architecture/upstream-compatibility-policy.md` 가 Bun-first 문서로 갱신된다.
- [x] `test/bin-smoke.test.ts` 가 더 이상 `npm` 을 직접 호출하지 않고, top-level bin과 delegated fixture 모두에서 explicit runtime selection으로 smoke intent를 고정한다.
- [x] Bun install 환경에서 [`src/passthrough/upstream_locator.ts`](../../src/passthrough/upstream_locator.ts) 의 package root/bin resolution이 계속 통한다.
- [x] version bump checklist가 `bun install` + `bun run test:parity` + upstream contract review 흐름으로 다시 문서화된다.
- [x] `bun pm untrusted` / `trustedDependencies` audit 결과가 문서와 설정에 반영되고, exact allowlist와 rationale이 함께 기록된다.
- [x] lockfile commit 이후 검증 경로로 `bun ci` 또는 `bun install --frozen-lockfile` 가 추가된다.
- [x] actual tarball smoke가 quality gate에 포함되고 packed artifact의 `bin`/`dist`/shebang contract를 검증한다.

### Non-Functional Requirements

- [x] published `bin/qmd.js` 의 Node-compatible shebang contract는 유지된다.
- [x] user-facing command semantics와 owned/passthrough boundary는 바뀌지 않는다.
- [x] 역사적 산출물인 `docs/solutions/*`, 기존 `docs/plans/*` 는 일괄 rewrite 하지 않는다.
- [x] `run.bun` 또는 Bun runtime forcing은 baseline이 아니라 호환성 검증 뒤 opt-in 으로만 다룬다.

### Quality Gates

- [x] `bun install`
- [x] `bun run build`
- [x] `bun run lint`
- [x] `bun run typecheck`
- [x] `bun run test`
- [x] `bun run test:parity`
- [x] `bun run check`
- [x] `bun pm pack --dry-run`
- [x] actual tarball smoke

### Research Insights

**Best Practices:**
- everyday gate와 release rehearsal gate를 구분한다.
  - everyday gate: 위 checklist
  - release rehearsal: `bun publish --dry-run`

**Performance Considerations:**
- 전체 loop를 무겁게 만들지 않으려면 `bun publish --dry-run`은 항상-required quality gate가 아니라 version bump 또는 release candidate 단계의 추가 gate로 두는 편이 낫다.

## Success Metrics

- 살아 있는 운영 문서와 테스트 harness에서 `npm install`, `npm run`, `npm pack --dry-run`이 사라진다.
- 새 개발자는 `bun install` 하나로 baseline setup을 끝내고, 추가적인 manual rebuild 없이 quality gate를 돌릴 수 있다.
- Bun으로 전체 test suite를 실행해도 published bin smoke의 의미가 바뀌지 않는다.
- upstream version bump 절차가 Bun 기준으로도 현재 parity guardrail을 유지한다.

## Dependencies & Prerequisites

- Bun `1.3.10` 이상으로 검증한다.
- Node `>=24` 는 published runtime/explicit Node smoke 때문에 계속 필요하다.
- dependency install lifecycle audit이 선행되어야 한다.
  - `better-sqlite3`
  - `node-llama-cpp`
  - `esbuild`
- target platform optional/native package inventory를 기록해야 한다.
- `bun pm migrate`, `bun pm untrusted`, `bun pm trust`, `bun ci` 를 사용할 수 있는 Bun CLI가 필요하다.
- lockfile migration은 working tree cleanliness와 별개로 한 번에 처리하는 편이 안전하다.

## Risk Analysis & Mitigation

- **Risk:** Bun install이 native dependency lifecycle script를 실행하지 않아 local runtime이 깨질 수 있다.  
  **Mitigation:** install/postinstall 의존 패키지를 `bun pm untrusted`로 식별하고, `bun pm trust` 또는 명시적 `trustedDependencies` 설정으로 닫는다. exact allowlist와 근거 표를 유지하고, clean install smoke를 acceptance criteria에 포함한다.

- **Risk:** `process.execPath` 가 Bun으로 바뀌어 bin smoke가 더 이상 Node-compatible contract를 검증하지 못한다.  
  **Mitigation:** smoke harness에서 build runner와 published runtime을 분리하고, wrapper generation까지 포함해 explicit Node binary를 사용한다.

- **Risk:** `bun test` 와 `bun run test` 혼동으로 Bun test runner와 Vitest script가 섞인다.  
  **Mitigation:** 살아 있는 문서와 checklist는 모두 `bun run <script>` 형태로 통일한다.

- **Risk:** `run.bun = true` 를 성급하게 켜면 일부 CLI 도구가 Bun runtime에서 예상과 다르게 동작할 수 있다.  
  **Mitigation:** `tsc`, `vitest`, `biome` 검증 후 채택하고, 실패 시 Bun-first entrypoint만 유지한 채 tool runtime forcing은 예외 처리한다.

- **Risk:** routine local verification에 release-grade publish simulation을 항상 섞으면 개발 루프가 불필요하게 느려진다.  
  **Mitigation:** `bun pm pack --dry-run`은 일상 gate로 유지하고, `bun publish --dry-run`은 release rehearsal 단계로 분리한다.

- **Risk:** `bun pm pack --dry-run`만 믿고 실제 tarball 실행 경로를 검증하지 않으면 stale build, 누락 파일, packed artifact bin failure를 놓칠 수 있다.  
  **Mitigation:** actual tarball smoke를 quality gate로 승격하고, fresh temp workspace에서 packed artifact contract를 확인한다.

- **Risk:** product runtime까지 Bun-only로 오해하고 shebang을 바꾸면 현재 distribution contract가 깨질 수 있다.  
  **Mitigation:** 이번 계획의 non-goal에 명시하고, `bin/qmd.js` Node shebang 유지 테스트를 함께 둔다.

- **Risk:** [`src/passthrough/upstream_locator.ts`](../../src/passthrough/upstream_locator.ts) 의 `node_modules` path assumption이 Bun linker/layout 선택에 따라 깨질 수 있다.  
  **Mitigation:** canonical linker 하나만 문서화하고, Bun-installed dependency-layout regression test로 이 가정을 지속 검증한다. 실제 breakage가 생기기 전에는 locator를 과도하게 일반화하지 않는다.

- **Risk:** `engines.bun`, `run.bun = true`, Bun test runner 전환을 한 번에 묶으면 refactor scope가 커지고 실패 원인 분리가 어려워진다.  
  **Mitigation:** package manager 전환, explicit runtime smoke, optional Bun runtime forcing을 별도 decision gate로 나눠 적용한다.

## Resource Requirements

- 구현자 1명
- repo-wide lockfile regeneration 1회
- clean install smoke를 위한 임시 작업 디렉터리
- 필요 시 Bun install lifecycle 설정 검증용 macOS/Linux 재실행

## Future Considerations

- upstream `qmd` 가 이후 Bun runtime 또는 Bun test runner를 더 강하게 표준화하면, 그때 `Vitest -> bun test` 전환 여부를 별도 계획으로 검토한다.
- `bin/qmd.js` 를 Bun shebang으로 바꾸는 문제는 distribution contract 변화가 수반되므로, 별도 brainstorm 없이 이번 refactor에 섞지 않는다.
- CI를 나중에 도입하면 `bun run check` 와 `bun run test:parity` 를 그대로 mirrored gate로 옮기면 된다.

## Documentation Plan

- [`docs/development.md`](../../docs/development.md): setup, script catalog, targeted verification, version bump checklist 갱신
- [`docs/architecture/upstream-compatibility-policy.md`](../../docs/architecture/upstream-compatibility-policy.md): drift 대응과 publish verification 문구 갱신
- [`README.md`](../../README.md): 필요 시 개발자 안내 링크/문장만 최소 수정
- `docs/solutions/*`: historical artifact이므로 수정하지 않음

## Sources & References

### Origin

- **Brainstorm document:** `docs/brainstorms/2026-03-13-bun-first-upstream-alignment-brainstorm.md`
  - carried-forward decisions:
    - repo operating mode를 Bun-first로 전환한다
    - npm/Bun 장기 병행 지원은 목표로 두지 않는다
    - product identity와 compatibility boundary는 유지한다

### Internal References

- `docs/brainstorms/2026-03-13-bun-first-upstream-alignment-brainstorm.md`
- `package.json`
  - current npm-first scripts: `prepack`, `check`
- `docs/development.md`
  - current npm-first setup, quality gates, version bump checklist
- `docs/architecture/upstream-compatibility-policy.md`
  - current npm-first parity/publish drift wording
- `test/bin-smoke.test.ts`
  - hardcoded `npm` build bootstrap and `process.execPath`-based smoke
- `src/passthrough/upstream_locator.ts`
  - installed package root lookup assumptions
- `bin/qmd.js`
  - current Node shebang entrypoint contract
- `README.md`
  - current replacement distribution framing and user-facing scope
- `docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md`
  - smoke intent must stay explicit across platforms
- `docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`
  - wrapper/runtime contracts should be explicit, not convenience-driven
- `docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`
  - parity drift must be covered by targeted tests, not assumed
- `docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`
  - warnings and checks must match real execution scope
- `docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md`
  - health/readiness signals must match real command availability

### External References

- Bun lockfile docs: https://bun.sh/docs/pm/lockfile
- Bun install docs, including dependency lifecycle/trust behavior: https://bun.sh/docs/pm/cli/install
- Bun package manager utilities (`migrate`, `trust`, `pack`): https://bun.sh/docs/pm/cli/pm
- Bun run docs and script execution behavior: https://bun.sh/docs/cli/run
- Bun runtime script forcing via bunfig `run.bun`: https://bun.sh/docs/runtime/bunfig#runbun
- Bun publish dry-run docs: https://bun.sh/docs/pm/cli/publish
- Upstream repository: https://github.com/tobi/qmd
