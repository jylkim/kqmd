---
status: complete
priority: p2
issue_id: "008"
tags: [code-review, cli, parity, query, performance]
dependencies: []
---

# `query --candidate-limit` is parsed but never affects execution

## Problem Statement

K-QMD의 `query` command는 `-C` / `--candidate-limit`를 typed input으로 받아들이지만, 실제 실행 경로에서는 이 값을 전혀 사용하지 않는다. 사용자는 rerank candidate 수를 줄여 성능과 결과 shape를 제어한다고 기대할 수 있지만, 현재 구현에서는 옵션이 조용히 no-op이 된다.

## Findings

- `src/commands/owned/io/parse.ts:157-158`에서 `candidateLimit`를 정상적으로 파싱해 `QueryCommandInput`에 저장한다.
- 하지만 `src/commands/owned/query.ts:47-64`는 최종 실행에 `session.store.search(...)`만 사용하고 있고, 이 public API는 `candidateLimit`를 받지 않는다.
- 실제 upstream CLI는 `node_modules/@tobilu/qmd/dist/cli/qmd.js:1892-1897`에서 `hybridQuery(..., { candidateLimit })`로 값을 전달한다.
- public `SearchOptions` surface에는 `candidateLimit`가 없다는 점도 이 문제를 뒷받침한다 (`node_modules/@tobilu/qmd/dist/index.d.ts:49-67`).

## Proposed Solutions

### Option 1: Call lower-level query APIs for `query`

**Approach:** `query` command만은 `store.search()` 대신 lower-level hybrid/structured query path를 직접 호출해 `candidateLimit`를 전달한다.

**Pros:**
- upstream CLI 의미와 가장 가깝다
- `candidateLimit`가 실제로 동작한다

**Cons:**
- public root export 밖의 API 경계를 다시 검토해야 한다
- query path가 search path보다 복잡해진다

**Effort:** Medium

**Risk:** Medium

---

### Option 2: Explicitly reject unsupported `candidate-limit`

**Approach:** 현재 실행 경로에서 지원할 수 없으면 parse/validation 단계에서 명시적으로 에러를 내고 숨은 no-op을 막는다.

**Pros:**
- silent drift를 즉시 없앨 수 있다
- 구현 범위가 작다

**Cons:**
- strict parity 목표는 달성하지 못한다
- 사용자에게 옵션 후퇴처럼 보일 수 있다

**Effort:** Small

**Risk:** Low

## Recommended Action

우선 silent no-op를 없애는 것이 먼저다. 가능하면 Option 1로 맞추고, 당장 어렵다면 최소한 Option 2로 unsupported 상태를 명시해야 한다.

## Technical Details

**Affected files:**
- `src/commands/owned/io/parse.ts`
- `src/commands/owned/query.ts`
- `test/owned-command-parity/parse.test.ts`
- `test/owned-command-parity/query-output.test.ts`

## Acceptance Criteria

- [x] `query --candidate-limit`가 실제 실행 경로에 반영되거나, 명시적으로 unsupported error를 반환한다
- [x] silent no-op 상태가 제거된다
- [x] parity tests에 `candidate-limit` behavior가 추가된다

## Work Log

### 2026-03-12 - Review Finding

**By:** Codex

**Actions:**
- Compared local `query` execution path against upstream CLI behavior
- Verified that `candidateLimit` is parsed into input state but dropped before execution
- Confirmed upstream public `SearchOptions` surface does not accept `candidateLimit`

**Learnings:**
- strict CLI parity can fail even when parsing and snapshots look correct, if execution flags are silently ignored

### 2026-03-12 - Todo Resolved

**By:** Codex

**Actions:**
- Changed `query` parsing to reject unsupported `--candidate-limit` explicitly instead of silently ignoring it
- Added parity coverage for the new validation behavior in `test/owned-command-parity/parse.test.ts`
- Re-ran `npm run typecheck`, `npm run test:parity`, `npm run test`, and `npm run lint`

**Learnings:**
- Removing a silent no-op is better than claiming parity when the execution path cannot honor a flag yet
