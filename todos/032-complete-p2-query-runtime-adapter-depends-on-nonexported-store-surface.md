---
status: complete
priority: p2
issue_id: "032"
tags: [code-review, cli, architecture, upstream, compatibility, typescript]
dependencies: []
---

# `candidate-limit` now depends on a non-exported upstream store surface

## Problem Statement

`query --candidate-limit`를 구현하기 위해 local adapter가 upstream package root를 직접 찾아 `dist/store.js`를 dynamic import 하도록 바뀌었습니다. 이 방식은 동작은 하지만, upstream가 root export 밖의 파일 구조를 바꾸면 runtime에서 조용히 깨질 수 있는 compatibility seam을 하나 더 늘립니다.

## Findings

- [`src/commands/owned/query_runtime.ts`](../src/commands/owned/query_runtime.ts) 는 [`findUpstreamPackageRoot()`](../src/passthrough/upstream_locator.ts) 로 installed package root를 찾은 뒤 `dist/store.js`를 file URL로 import 합니다.
- upstream `package.json`은 root entrypoint만 `exports`에 공개하고 있어, `dist/store.js`는 공식 public API가 아닙니다.
- plan 문서에도 이 사실이 “localized adapter” tradeoff로 기록됐지만, 현재 코드에는 version bump 시 실패를 빨리 감지할 dedicated test가 없습니다.

## Proposed Solutions

### Option 1: dedicated guard test for the query runtime adapter

**Approach:** `query_runtime.ts`가 기대하는 `hybridQuery` / `structuredSearch` export surface를 직접 검증하는 test를 추가합니다.

**Pros:**
- seam 추가를 최소화하면서 drift를 더 빨리 잡을 수 있습니다
- 현재 구현을 유지한 채 위험을 낮출 수 있습니다

**Cons:**
- root public API 밖 의존 자체는 남습니다

**Effort:** Small

**Risk:** Low

### Option 2: remove the adapter and de-surface `candidate-limit` again

**Approach:** public API 밖 의존을 없애기 위해 `candidate-limit` 지원을 철회합니다.

**Pros:**
- compatibility risk가 사라집니다

**Cons:**
- 이번 릴리즈에서 닫으려던 owned query contract가 다시 열립니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Triage needed.

## Technical Details

**Affected files:**
- `src/commands/owned/query_runtime.ts`
- `src/passthrough/upstream_locator.ts`
- version bump / compatibility tests

## Acceptance Criteria

- [x] `candidate-limit` adapter seam이 version bump 때 빠르게 실패하도록 guard test가 존재한다
- [x] documentation/work log가 이 seam을 intentional tradeoff로 명시한다
- [x] future upstream drift가 runtime production failure가 아니라 test failure로 먼저 surface 된다

## Work Log

### 2026-03-13 - Review Finding

**By:** Codex

**Actions:**
- Reviewed the runtime adapter introduced for `query --candidate-limit`
- Compared it with upstream `exports` and current compatibility policy
- Confirmed the new behavior relies on a non-exported `dist/store.js` surface

**Learnings:**
- a localized adapter is sometimes pragmatic, but it needs its own compatibility guardrail or it becomes hidden technical debt

### 2026-03-13 - Todo Resolved

**By:** Codex

**Actions:**
- Added `test/query-runtime-adapter.test.ts` to verify the upstream store module still exports `hybridQuery` and `structuredSearch`
- Wired the new guard test into `test:release-contract`
- Updated the release-readiness plan to record the new compatibility guardrail

**Learnings:**
- if we intentionally depend on a non-exported upstream seam, the smallest honest mitigation is a dedicated guard test that fails during routine verification
