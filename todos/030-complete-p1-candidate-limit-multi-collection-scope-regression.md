---
status: complete
priority: p1
issue_id: "030"
tags: [code-review, cli, query, collections, regression, typescript]
dependencies: []
---

# `query --candidate-limit` can ignore multi-collection filters

## Problem Statement

이번 변경으로 `query --candidate-limit`가 실제 실행에 연결됐지만, plain query에서 컬렉션 필터를 여러 개 지정한 경우 선택한 컬렉션 집합이 아니라 전체 컬렉션을 대상으로 검색할 수 있습니다. 사용자는 `-c docs -c notes`처럼 필터를 명시했는데 결과가 그 밖의 컬렉션까지 섞이면 query scope contract가 깨집니다.

## Findings

- [`src/commands/owned/query_runtime.ts:107`](../src/commands/owned/query_runtime.ts)~[`src/commands/owned/query_runtime.ts:110`](../src/commands/owned/query_runtime.ts) 는 `hybridQuery()`가 single collection만 받는다는 이유로 `selectedCollections.length > 1`일 때 `collection: undefined`를 넘깁니다.
- 그 결과 plain query + `--candidate-limit` + multiple `-c` 조합에서는 기존 `store.search({ collections })` 경로가 제공하던 collection scoping이 사라집니다.
- 코드 주석도 이 동작을 “upstream all collections behavior”로 정당화하지만, K-QMD의 현재 owned query는 [`src/commands/owned/query.ts`](../src/commands/owned/query.ts) 에서 multi-collection selection을 이미 해석하고 있었습니다.

## Proposed Solutions

### Option 1: candidate-limit + multi-collection plain query를 명시적으로 막기

**Approach:** `candidate-limit`가 지정된 plain query에서 selected collection이 2개 이상이면 validation error를 반환합니다.

**Pros:**
- 잘못된 결과 scope를 즉시 막을 수 있습니다
- 구현 범위가 작고 deterministic 합니다

**Cons:**
- 이미 릴리즈에서 구현했다고 주장한 `candidate-limit`의 적용 범위를 다시 좁히게 됩니다

**Effort:** Small

**Risk:** Low

### Option 2: multi-collection plain query에서도 scope를 유지하는 local adapter 추가

**Approach:** `candidate-limit` path에서 multi-collection filter를 유지할 수 있도록 local adapter를 확장하거나 결과를 후처리해 selected collections 밖의 rows를 제거합니다.

**Pros:**
- 현재 query surface contract를 유지합니다
- 사용자가 기대한 collection filter semantics를 보존합니다

**Cons:**
- current hybrid path와 local filtering 사이의 ranking/limit semantics를 더 면밀히 검토해야 합니다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Option 1로 해결했다. `--candidate-limit`가 지정된 plain query에서 collection filter가 2개 이상이면, 잘못된 전체-컬렉션 검색으로 흐르지 않도록 명시적 validation error를 반환한다.

## Technical Details

**Affected files:**
- `src/commands/owned/query_runtime.ts`
- `src/commands/owned/query.ts`
- `test/query-runtime.test.ts`
- related query behavior/integration tests

## Acceptance Criteria

- [x] plain query + `--candidate-limit` + multiple `-c` filters에서 selected collections 밖의 결과가 섞이지 않는다
- [x] chosen behavior(지원 또는 명시적 차단)가 help/docs/tests에 동일하게 반영된다
- [x] query scope regression test가 추가된다

## Work Log

### 2026-03-13 - Review Finding

**By:** Codex

**Actions:**
- Reviewed the latest `fix(cli): close owned release-readiness gaps` commit
- Traced the `candidate-limit` runtime path through `query_runtime.ts`
- Verified that multi-collection plain query currently drops the explicit collection filter

**Learnings:**
- a localized runtime adapter can accidentally regress higher-level selection semantics even when the primary feature works

### 2026-03-13 - Fix Applied

**By:** Codex

**Actions:**
- Added an explicit validation guard in `handleQueryCommand()` for plain query + multiple collection filters + `--candidate-limit`
- Added a matching guard in `executeOwnedQuerySearch()` so the helper itself cannot silently fall back to all collections
- Added focused regression coverage in `test/query-command.test.ts` and `test/query-runtime.test.ts`
- Ran `bun run test -- test/query-runtime.test.ts test/query-command.test.ts test/owned-embedding-behavior.test.ts test/owned-command-parity/parse.test.ts`
- Ran `bun run typecheck`

**Learnings:**
- preserving a narrower but honest contract is better than silently broadening search scope
