---
status: complete
priority: p1
issue_id: "001"
tags: [typescript, cli, scaffolding, qmd]
dependencies: []
---

# Scaffold K-QMD replacement distribution

K-QMD replacement distribution의 첫 스프린트 스캐폴딩을 구현한다. 목표는 실제 한국어 기능이 아니라 배포 가능한 `qmd` wrapper CLI, routing boundary, passthrough delegate, path compatibility, test/tooling baseline을 세우는 것이다.

## Problem Statement

저장소에는 현재 브레인스토밍/계획 문서만 있고 실행 가능한 패키지, 테스트 프레임워크, lint/format 설정, CLI 진입점이 없다. 이 상태로는 다음 스프린트에서 `search/query/update/embed`의 owned behavior를 안전하게 구현하거나 upstream drift를 추적할 수 없다.

## Findings

- 현재 저장소는 사실상 빈 상태라 기존 구현 패턴을 재사용할 수 없다.
- `@tobilu/qmd@2.0.1`는 npm에서 `qmd` bin을 노출하고 ESM export를 제공한다.
- Node.js 24 / npm 11 환경에서 TypeScript, Vitest, Biome 최신 안정 버전을 설치해 scaffold를 바로 검증할 수 있다.

## Proposed Solutions

### Option 1: Full scaffold now

**Approach:** 패키지/빌드/도구/CLI 라우팅/테스트/문서를 이번 세션에서 모두 세운다.

**Pros:**
- 다음 스프린트 진입 장벽이 가장 낮다
- 계획 문서의 acceptance criteria를 실제 코드로 닫을 수 있다

**Cons:**
- 빈 저장소에서 생성 파일 수가 많다

**Effort:** 1 session

**Risk:** Medium

---

### Option 2: Tooling only

**Approach:** package/tool/test 설정만 두고 CLI 구조는 다음 스프린트로 미룬다.

**Pros:**
- 초기 작업량이 적다

**Cons:**
- 가장 중요한 routing/passthrough seam이 남는다
- 다음 스프린트에서 다시 bootstrap 작업이 필요하다

**Effort:** Short

**Risk:** High

## Recommended Action

Option 1로 진행한다. foundation, routing, compatibility, test, docs를 한 번에 세우고 계획 문서의 체크리스트를 작업 로그와 함께 갱신한다.

## Technical Details

**Affected areas:**
- package/tooling: `package.json`, `tsconfig*.json`, `biome.json`, `vitest.config.ts`
- executable surface: `bin/qmd.js`, `src/cli.ts`
- routing/delegation: `src/commands/*`, `src/passthrough/*`
- compatibility: `src/config/qmd_paths.ts`
- verification/docs: `test/*`, `README.md`, `docs/architecture/*`

## Resources

- `docs/plans/2026-03-11-feat-kqmd-replacement-distribution-scaffold-plan.md`
- `docs/brainstorms/2026-03-11-kqmd-brainstorm.md`

## Acceptance Criteria

- [x] Scaffold files are created and wired together
- [x] `qmd` bin entrypoint works against built output
- [x] Routing and passthrough tests pass
- [x] Path compatibility tests pass
- [x] Lint, typecheck, and tests all pass
- [x] Plan document checkboxes and status are updated

## Work Log

### 2026-03-11 - Work Start

**By:** Codex

**Actions:**
- Read the plan and deepened research notes
- Created a dedicated feature branch
- Confirmed npm package availability and current versions for scaffold dependencies

**Learnings:**
- `@tobilu/qmd` exists on npm and publishes a `qmd` binary
- The repository is effectively greenfield, so scaffold choices will define the initial project conventions

### 2026-03-11 - Scaffold Completed

**By:** Codex

**Actions:**
- Added package/build/lint/test foundation with `TypeScript`, `Vitest`, and `Biome`
- Implemented `qmd` bin entrypoint, command manifest, owned command stubs, passthrough delegate, and upstream locator
- Implemented path compatibility helpers and compared them against installed upstream package behavior
- Added routing, passthrough, path compatibility, unknown command, and bin smoke tests
- Ran `npm run check` and `npm pack --dry-run`
- Updated the plan document status and acceptance criteria

**Learnings:**
- `@tobilu/qmd` only exposes `import` conditions, so package root resolution is more reliable via upward filesystem search than `require.resolve('@tobilu/qmd')`
- build-time bin smoke tests are enough to verify stdio/exit-code delegation without depending on the real upstream runtime
