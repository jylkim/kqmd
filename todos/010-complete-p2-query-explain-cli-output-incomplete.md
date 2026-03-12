---
status: complete
priority: p2
issue_id: "010"
tags: [code-review, cli, parity, query, formatting]
dependencies: []
---

# CLI `--explain` output is only partially implemented

## Problem Statement

`query --explain`의 CLI 출력이 upstream보다 축약되어 있다. 현재 구현은 첫 `Explain:` 줄만 출력하고, 이어지는 `RRF`, `Blend`, `Top RRF contributions` 줄을 생략한다. strict parity를 목표로 하는 슬라이스에서 이 차이는 디버깅과 결과 해석 경험을 바꾼다.

## Findings

- local formatter는 `src/commands/owned/io/format.ts:305-308`에서 `Explain:` 한 줄만 추가한다.
- upstream CLI는 `node_modules/@tobilu/qmd/dist/cli/qmd.js:1583-1601`에서 `Explain`, `RRF`, `Blend`, `Top RRF contributions`를 모두 출력한다.
- 현재 parity tests는 explain-enabled CLI snapshots를 포함하지 않아 이 drift가 감지되지 않는다.

## Proposed Solutions

### Option 1: Implement full upstream explain block

**Approach:** local CLI formatter에 upstream와 같은 multi-line explain block을 추가한다.

**Pros:**
- strict parity 목표와 가장 잘 맞는다
- explain users의 디버깅 정보가 복원된다

**Cons:**
- formatter 코드가 조금 더 길어진다

**Effort:** Small

**Risk:** Low

---

### Option 2: Downgrade strict parity claim for explain output

**Approach:** explain output은 partial parity만 보장한다고 문서와 테스트 범위를 줄인다.

**Pros:**
- 구현량이 적다

**Cons:**
- 이미 선언한 strict parity 목표와 어긋난다
- 디버깅 기능이 upstream보다 약해진다

**Effort:** Small

**Risk:** Medium

## Recommended Action

Option 1이 맞다. explain block은 이미 upstream shape가 명확하므로 local formatter에 그대로 반영하고 snapshot으로 고정하는 편이 가장 단순하다.

## Technical Details

**Affected files:**
- `src/commands/owned/io/format.ts`
- `test/owned-command-parity/query-output.test.ts`
- `test/fixtures/owned-command-parity/query/*`

## Acceptance Criteria

- [x] CLI `--explain` output이 upstream와 같은 multi-line block을 포함한다
- [x] explain-enabled snapshot tests가 추가된다
- [x] 문서의 strict parity claim과 실제 formatter behavior가 다시 일치한다

## Work Log

### 2026-03-12 - Review Finding

**By:** Codex

**Actions:**
- Compared local CLI formatter output against upstream `query --explain` output path
- Verified the current implementation only preserves the first explain line
- Checked parity tests and confirmed there is no explain-specific snapshot coverage

**Learnings:**
- formatter parity needs dedicated snapshot coverage for debug-only flags like `--explain`, or drift will hide in otherwise-green tests

### 2026-03-12 - Todo Resolved

**By:** Codex

**Actions:**
- Expanded CLI explain formatting to include `RRF`, `Blend`, and top contribution lines
- Added explain-enabled parity snapshot coverage in `test/owned-command-parity/query-output.test.ts`
- Updated the snapshot fixture to match the full explain block
- Re-ran `npm run typecheck`, `npm run test:parity`, `npm run test`, and `npm run lint`

**Learnings:**
- Explain/debug output needs its own snapshot coverage because it is easy for formatter parity to drift there first
