---
status: complete
priority: p1
issue_id: "012"
tags: [code-review, cli, status, compatibility, qmd, typescript]
dependencies: []
---

# Restore upstream-compatible zero-config behavior for `qmd status`

`qmd status`가 passthrough에서 owned execution으로 옮겨졌는데, 새 owned path는 기존 DB나 config가 전혀 없는 깨끗한 환경에서 실패합니다. upstream이 zero-config 상태 대시보드 진입점으로 쓰는 명령을 회귀시켰고, 이전 passthrough 호환 기대도 함께 깨졌습니다.

## Problem Statement

새 owned `status` path는 지금 `status`를 사실상 `search/query`처럼 취급합니다. 즉, 명령을 실행하기 전에 기존 DB 파일이나 config 파일이 있어야 한다고 가정합니다. 그 결과 깨끗한 환경에서는 유용한 상태 대시보드 대신 exit `1` 에러가 발생합니다.

이 변경은 merge-blocking 호환성 회귀로 봐야 합니다. 이유는 다음과 같습니다.

- upstream `qmd status`는 깨끗한 환경에서도 성공하고 빈 상태 대시보드를 출력합니다
- 새 owned `status` path는 `config-missing`을 반환합니다
- 새 parser는 이전에는 passthrough 되던 `--json` 같은 추가 플래그도 거부합니다

## Findings

- [`src/commands/owned/runtime.ts:101`](../src/commands/owned/runtime.ts)에서 `status`가 read-command 분기로 들어가며, DB와 config가 모두 없으면 `config-missing`을 반환합니다.
- owned `status`는 항상 [`src/commands/owned/status.ts:36`](../src/commands/owned/status.ts)을 거치므로 upstream 동작으로 fallback 하지 않습니다.
- 새 parser는 [`src/commands/owned/io/parse.ts:220`](../src/commands/owned/io/parse.ts)에서 `--index`를 제외한 truthy flag를 모두 거부합니다.
- upstream `showStatus()`는 [`node_modules/@tobilu/qmd/dist/cli/qmd.js:201`](../node_modules/@tobilu/qmd/dist/cli/qmd.js)에서 기본 DB 경로를 열고, indexed doc가 0개여도 상태 화면을 렌더링합니다.
- 리뷰 중 로컬 재현 결과:
  - upstream: clean temp env + `node node_modules/@tobilu/qmd/dist/cli/qmd.js status` → exit `0`
  - current implementation: clean temp env + `node ./bin/qmd.js status` → exit `1`

## Proposed Solutions

### Option 1: Keep `status` owned but add zero-config open semantics

**Approach:** `status`에 `search/query`와 다른 전용 runtime mode를 주고, 깨끗한 환경에서도 기본 DB 경로를 열거나 생성해서 상태 화면을 렌더링하게 합니다.

**Pros:**
- 새 embedding-health surface를 유지할 수 있습니다
- zero-config happy path를 복구할 수 있습니다
- command ownership을 일관되게 유지할 수 있습니다

**Cons:**
- 새로운 runtime policy 분기가 필요합니다
- 깨끗한 환경 동작을 위한 명시적 테스트가 필요합니다

**Effort:** Medium

**Risk:** Medium

---

### Option 2: Fall back to upstream `status` when no DB/config exists

**Approach:** 기존 인덱스가 있을 때만 owned `status`를 쓰고, DB와 config가 모두 없으면 upstream `qmd status`로 위임합니다.

**Pros:**
- 동작 변화가 가장 작습니다
- upstream compatibility를 빠르게 복구할 수 있습니다

**Cons:**
- 한 명령이 owned/passthrough로 갈라집니다
- embedding-health UX가 조건부가 되어 이해하기 어려워집니다

**Effort:** Small

**Risk:** Medium

---

### Option 3: Revert `status` to passthrough for now

**Approach:** owned `status` 전환을 되돌리고, status 레벨 mismatch health는 더 완성된 owned status 설계가 나올 때까지 미룹니다.

**Pros:**
- 가장 빠르게 호환성을 복구할 수 있습니다
- 회귀를 즉시 제거할 수 있습니다

**Cons:**
- 새 mismatch-health status surface를 잃습니다
- 현재 feature 방향과 충돌합니다

**Effort:** Small

**Risk:** Low

## Recommended Action

triage 때 채웁니다.

## Technical Details

**Affected files:**
- [`src/commands/owned/runtime.ts`](../src/commands/owned/runtime.ts)
- [`src/commands/owned/io/parse.ts`](../src/commands/owned/io/parse.ts)
- [`src/commands/owned/status.ts`](../src/commands/owned/status.ts)
- [`src/commands/manifest.ts`](../src/commands/manifest.ts)
- [`test/status-command.test.ts`](../test/status-command.test.ts)
- [`test/cli-routing.test.ts`](../test/cli-routing.test.ts)

**Behavioral comparison:**
- current owned status: DB/config가 없으면 실패
- upstream status: 깨끗한 환경에서도 대시보드를 렌더링

## Resources

- Review target commit: `31923a5`
- Upstream behavior reference: [`node_modules/@tobilu/qmd/dist/cli/qmd.js:201`](../node_modules/@tobilu/qmd/dist/cli/qmd.js)
- Runtime branch: [`src/commands/owned/runtime.ts:101`](../src/commands/owned/runtime.ts)

## Acceptance Criteria

- [x] `qmd status`가 기존 DB/config가 없는 깨끗한 환경에서도 성공한다
- [x] zero-config `status` 동작이 자동화 테스트로 고정된다
- [x] 필요한 경우 owned `status`가 embedding-health 정보를 계속 노출한다
- [x] 지원할 `status` 플래그/인자에 대한 호환성 결정이 명시된다
- [x] 현재 routing/help 동작에 회귀가 없다

## Work Log

### 2026-03-12 - Code Review Finding

**By:** Codex

**Actions:**
- 최신 커밋 `31923a5`와 upstream `qmd status`를 비교했습니다
- DB/config가 없을 때 현재 owned runtime이 `status`를 `config-missing`으로 보내는 것을 확인했습니다
- upstream과 현재 구현의 깨끗한 환경 동작을 로컬에서 각각 재현했습니다

**Learnings:**
- `status`는 단순한 read command가 아니라 `search/query`보다 더 강한 zero-config 호환성 기대를 가집니다
- `search/query`의 runtime policy를 `status`에 재사용하면 사용자에게 바로 보이는 회귀가 생깁니다

### 2026-03-12 - Resolved

**By:** Codex

**Actions:**
- `status`에 zero-config 전용 runtime semantics를 추가했습니다
- `status` parser가 `--json` 같은 기존 passthrough-era flag를 hard-fail 하지 않도록 정리했습니다
- clean environment에서 `qmd status`가 성공하는 테스트를 추가했습니다

**Learnings:**
- `status`는 단순 read path가 아니라 zero-config 진입점이라는 성격을 별도로 가져가야 합니다
