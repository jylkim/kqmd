---
status: complete
priority: p2
issue_id: "009"
tags: [code-review, cli, parity, update, reliability]
dependencies: []
---

# `update --pull` reports success semantics without performing any pull

## Problem Statement

`update`는 `--pull` 플래그를 받아들이고, 성공 출력에도 "Pre-update pull requested."를 포함한다. 하지만 실제 실행 경로에서는 `pull` 값이 어떤 side effect에도 연결되지 않아, 사용자가 최신 원격 변경을 당겨 왔다고 오해할 수 있다.

## Findings

- `src/commands/owned/io/parse.ts:178-180`에서 `pull`을 typed input으로 파싱한다.
- `src/commands/owned/update.ts:28-32`의 `executeUpdate()`는 `_input`을 무시하고 `session.store.update()`만 호출한다.
- 그럼에도 `src/commands/owned/io/format.ts:321-337`는 `input.pull`이 true면 `Pre-update pull requested.`를 stdout에 추가한다.
- upstream help text는 `qmd update [--pull]`를 보여 주지만 (`node_modules/@tobilu/qmd/dist/cli/qmd.js:2188`), 현재 K-QMD는 실제 실행보다 더 강한 성공 신호를 출력하고 있다.

## Proposed Solutions

### Option 1: Remove the success message until pull is implemented

**Approach:** `--pull`를 파싱하더라도, 실제 behavior가 없으면 성공 출력에서 관련 문구를 제거한다.

**Pros:**
- misleading success signal을 즉시 제거한다
- 구현이 작다

**Cons:**
- 옵션은 여전히 no-op로 남는다

**Effort:** Small

**Risk:** Low

---

### Option 2: Implement pre-update pull semantics

**Approach:** collection update command나 별도 preflight hook을 통해 실제 pull 동작을 수행하고, 그 결과를 성공 출력에 반영한다.

**Pros:**
- 사용자 기대와 옵션 의미가 맞아진다
- strict parity에 더 가깝다

**Cons:**
- shell execution, repo state, failure handling까지 넓어진다
- runtime/contract scope보다 큰 작업이 된다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

우선 Option 1로 misleading message를 제거하는 것이 안전하다. 그다음 실제 pull semantics가 필요한지 별도 슬라이스로 다루는 편이 낫다.

## Technical Details

**Affected files:**
- `src/commands/owned/update.ts`
- `src/commands/owned/io/format.ts`
- `test/owned-command-parity/mutation-output.test.ts`

## Acceptance Criteria

- [x] `update --pull`이 실제로 무언가를 수행하지 않는다면, 성공 출력도 그 사실을 과장하지 않는다
- [x] `--pull` behavior가 구현되거나 unsupported/no-op임이 명확히 드러난다
- [x] mutation parity tests가 새 정책을 반영한다

## Work Log

### 2026-03-12 - Review Finding

**By:** Codex

**Actions:**
- Traced `pull` from parser to executor and formatter
- Confirmed `pull` is ignored by execution but still reflected in success output
- Compared local behavior with upstream help text and current contract claims

**Learnings:**
- CLI success text can introduce contract drift even when the underlying execution path is unchanged

### 2026-03-12 - Todo Resolved

**By:** Codex

**Actions:**
- Changed `update` parsing to reject unsupported `--pull` instead of accepting it and implying work occurred
- Removed the misleading success line from the update formatter snapshot path
- Added mutation parity coverage for the unsupported flag behavior
- Re-ran `npm run typecheck`, `npm run test:parity`, `npm run test`, and `npm run lint`

**Learnings:**
- For CLI contracts, an explicit unsupported error is safer than a successful no-op with misleading messaging
