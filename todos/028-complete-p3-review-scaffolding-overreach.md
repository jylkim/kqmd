---
status: complete
priority: p3
issue_id: "028"
tags: [code-review, simplicity, tests, maintainability]
dependencies: []
---

# Trim review-only scaffolding that broadened the maintenance surface

일부 review 대응 코드가 기능 PR 범위를 넘어서는 유지보수 표면을 추가했습니다.

## Problem Statement

이번 diff에는 다음처럼 기능 자체보다 review scaffolding 성격이 강한 요소가 들어왔습니다.

- export된 `SearchExecutionPath` / `deriveSearchExecutionPath` + 별도 테스트 파일
- repo-wide regex 기반 `owned-runtime-security` meta test

이들은 지금 기능을 더 안전하게 만들기보다, 앞으로 유지해야 할 표면을 넓힐 수 있습니다.

## Findings

- 관련 코드:
  - `src/commands/owned/search.ts`
  - `test/search-execution-path.test.ts`
  - `test/owned-runtime-security.test.ts`
- 영향:
  - helper export와 meta test가 기능 로직보다 review rule enforcement 쪽으로 범위를 넓힘

## Proposed Solutions

### Option 1: Inline or privatize the helper and drop the meta test

**Approach:** `SearchExecutionPath` helper를 비공개 helper 또는 local function으로 유지하고, repo-wide security meta test는 별도 작업으로 뺍니다.

**Pros:**
- 기능 PR 범위를 줄일 수 있습니다
- 유지보수 표면이 작아집니다

**Cons:**
- 일부 review-driven guardrail이 사라집니다

**Effort:** Small

**Risk:** Low

### Option 2: Keep them but document why they belong here

**Approach:** helper export와 meta test의 필요성을 코드/문서에서 더 분명히 설명합니다.

**Pros:**
- 현재 guardrail을 유지합니다

**Cons:**
- 여전히 표면은 넓습니다

**Effort:** Small

**Risk:** Low

## Recommended Action

Option 1을 우선 검토한다. reliability core와 직접 연결되지 않는 review scaffolding은 별도 작업으로 분리하는 편이 단순하다.

## Acceptance Criteria

- [x] helper/test/export가 실제 제품 contract 보호에 필요한 최소 범위로 줄어든다
- [x] repo-wide policy 성격의 테스트는 별도 작업 또는 lint 규칙으로 분리된다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- code-simplicity-reviewer 결과를 바탕으로 helper export와 meta test가 기능 범위를 넓혔는지 검토했다
- P3 finding으로 분리해 추후 정리 가능하게 만들었다

**Learnings:**
- review 대응용 guardrail은 기능 correctness guardrail과 분리해서 판단하는 편이 YAGNI에 맞다

### 2026-03-13 - Resolution Complete

**By:** Codex

**Actions:**
- `src/commands/owned/search.ts`에서 테스트 전용 `SearchExecutionPath` export와 `deriveSearchExecutionPath` helper를 제거하고 command-local 분기로 단순화했다
- `test/search-execution-path.test.ts`와 `test/owned-runtime-security.test.ts`를 삭제했다
- `test/owned-search-behavior.test.ts`에 non-Hangul query가 legacy search로 가되 shadow health warning은 내지 않는 실제 command behavior 검증을 남겼다
- `bun run test -- owned-search-behavior search-index-health search-shadow-index owned-command-parity/search-output`와 `bunx @biomejs/biome check src/commands/owned/search.ts test/owned-search-behavior.test.ts todos/028-complete-p3-review-scaffolding-overreach.md`로 이번 정리 범위를 검증했다
- 전역 `bun run typecheck`와 `status-command`/`search-policy` suite는 현재 브랜치에 남아 있는 `current snapshot metadata` 작업 누락 때문에 별도로 실패함을 확인했다

**Learnings:**
- 내부 분기 vocabulary를 export해서 고정하기보다, command-level behavior를 검증하는 편이 유지보수 표면이 작고 제품 계약에도 더 가깝다
