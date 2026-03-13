---
module: K-QMD CLI
date: 2026-03-13
problem_type: logic_error
component: tooling
symptoms:
  - "`query --candidate-limit` support depended on `@tobilu/qmd` root exports plus a direct file import of `dist/store.js`"
  - "An upstream refactor of non-exported store internals could break candidate-limit support at runtime without a compile-time signal"
  - "There was no dedicated compatibility guard test to fail before release verification"
root_cause: wrong_api
resolution_type: tooling_addition
severity: medium
tags: [cli, qmd, candidate-limit, upstream, compatibility, guardrail, typescript]
---

# Troubleshooting: Guarding a non-exported upstream store surface in K-QMD CLI

## Problem

`query --candidate-limit`를 owned CLI에 다시 열기 위해 [`src/commands/owned/query_runtime.ts`](../../src/commands/owned/query_runtime.ts) 가 installed upstream package root를 찾아 `dist/store.js`를 dynamic import 하도록 바뀌었다. 이 경로는 `@tobilu/qmd`의 public `exports` 밖에 있으므로, upstream가 내부 파일 구조나 export 이름을 바꾸면 TypeScript compile 단계가 아니라 runtime에서 조용히 깨질 수 있는 compatibility seam이 생겼다.

핵심 문제는 “이 의존을 완전히 없애느냐”보다 “남겨 두더라도 drift를 얼마나 빨리, 얼마나 명확하게 잡느냐”였다. 릴리즈 직전 `candidate-limit`를 다시 de-surface 하는 대신, 현재 adapter를 유지하면서도 upstream drift를 test failure로 먼저 surface 하는 guardrail이 필요했다.

## Environment

- Module: K-QMD CLI
- Affected Component: query runtime adapter / release verification
- Date: 2026-03-13
- Relevant files:
  - `src/commands/owned/query_runtime.ts`
  - `test/query-runtime-adapter.test.ts`
  - `package.json`
  - `docs/plans/2026-03-13-fix-owned-cli-release-readiness-plan.md`
  - `todos/032-complete-p2-query-runtime-adapter-depends-on-nonexported-store-surface.md`

## Symptoms

- `query --candidate-limit` 구현이 upstream root export 밖의 `dist/store.js` export surface에 기대게 되었다.
- upstream version bump나 package layout change가 생기면, 일반 typecheck나 public API 사용만으로는 이 drift를 바로 못 잡을 수 있었다.
- dedicated guard가 없으면 releaser는 `candidate-limit` seam이 깨졌다는 사실을 runtime failure나 late-stage smoke에서야 알 가능성이 있었다.

## What Didn't Work

**Attempted approach 1:** public root `store.search()`만으로 `candidateLimit`를 닫는다.  
- **Why it failed:** upstream public root surface는 현재 `candidateLimit`를 노출하지 않는다. 실제 candidate-limit control은 `dist/store.js` helper 쪽에 있다.

**Attempted approach 2:** localized adapter tradeoff를 plan/todo에만 적어 둔다.  
- **Why it failed:** 문서화만으로는 version bump 때 누가 이 seam을 실제로 다시 검증할지 보장하지 못한다. 그대로 두면 runtime failure가 남는다.

**Attempted approach 3:** 일반 `check`와 parity suite면 충분하다고 본다.  
- **Why it failed:** 기존 suite는 “non-exported helper still exists”를 직접 확인하지 않는다. dedicated guard가 없으면 drift detection이 늦다.

## Solution

가장 작은 정직한 해결책으로 dedicated compatibility guard test를 추가했다.

1. [`test/query-runtime-adapter.test.ts`](../../test/query-runtime-adapter.test.ts)를 추가했다.
2. 이 test는 installed upstream package root를 찾고 `dist/store.js`를 직접 import 한 뒤, `hybridQuery`와 `structuredSearch` export가 여전히 함수인지 검증한다.
3. [`package.json`](../../package.json) 의 `test:release-contract`에 이 guard test를 포함시켜 routine verification path 안으로 끌어왔다.
4. [`docs/plans/2026-03-13-fix-owned-cli-release-readiness-plan.md`](../../docs/plans/2026-03-13-fix-owned-cli-release-readiness-plan.md) 와 work log에 이 seam이 intentional tradeoff라는 점을 남겼다.

**Code changes**:

```ts
// src/commands/owned/query_runtime.ts
const storeUrl = pathToFileURL(`${findUpstreamPackageRoot()}/dist/store.js`).href;
queryRuntimePromise = import(storeUrl).then((module) => ({
  hybridQuery: module.hybridQuery as HybridQueryFn,
  structuredSearch: module.structuredSearch as StructuredSearchFn,
}));
```

```ts
// test/query-runtime-adapter.test.ts
const storeUrl = pathToFileURL(`${findUpstreamPackageRoot()}/dist/store.js`).href;
const module = (await import(storeUrl)) as {
  hybridQuery?: unknown;
  structuredSearch?: unknown;
};

expect(typeof module.hybridQuery).toBe('function');
expect(typeof module.structuredSearch).toBe('function');
```

```json
// package.json
"test:release-contract": "vitest run ... test/query-runtime-adapter.test.ts ..."
```

## Why This Works

이 수정은 root public API 밖 의존 자체를 없애지는 않는다. 대신 그 리스크를 “조용한 runtime breakage”에서 “빠른 test failure”로 바꾼다.

1. **Drift fails early**  
   upstream version bump나 package layout 변화가 생기면 `test/query-runtime-adapter.test.ts`가 가장 먼저 깨지고, `test:release-contract` / `release:verify`가 즉시 red가 된다.

2. **The seam stays localized**  
   non-exported import는 [`src/commands/owned/query_runtime.ts`](../../src/commands/owned/query_runtime.ts) 한 곳에만 남아 있다. drift surface가 작으므로 guardrail을 붙이기 쉽다.

3. **It preserves the feature without pretending the risk is gone**  
   `candidate-limit`를 다시 숨기지 않고도, “이건 public API가 아니라 intentional tradeoff”라는 사실을 문서와 test에 동시에 남길 수 있다.

## Prevention

- non-exported upstream seam을 쓸 때는 “임시 우회”가 아니라 **intentional tradeoff**로 문서화한다.
  - 왜 public API로는 안 되는지
  - 어떤 file/module에 의존하는지
  - 어떤 조건에서 follow-up refactor를 해야 하는지
- dynamic import가 필요하면 import 지점을 **단일 adapter 파일**로 고립시킨다.
- public contract와 private seam을 분리한다.
  - 사용자-facing 계약: `query --candidate-limit`
  - 내부 구현 tradeoff: upstream `dist/store.js` helper 의존
- version bump workflow에 exports 밖 경로 의존 검토를 넣는다.
- non-exported seam에 기대는 순간, **test failure가 runtime failure보다 먼저 나야 한다**는 원칙을 적용한다.

## Recommended Tests

- dedicated compatibility guard test
  - `findUpstreamPackageRoot()/dist/store.js` import가 성공하는지
  - `hybridQuery`, `structuredSearch` export가 함수로 존재하는지
- release gate inclusion
  - 위 guard test를 `test:release-contract` 같은 canonical gate에 포함한다
- candidate-limit runtime dispatch tests
  - plain query + `candidateLimit`가 adapter path로 가는지
  - structured query + `candidateLimit`가 `structuredSearch` path로 가는지
- version-bump regression test
  - `@tobilu/qmd` 버전이 바뀌었는데 guard test를 갱신하지 않으면 release verification이 실패하는지 확인한다

## Commands Run

```bash
bun run test -- test/query-runtime-adapter.test.ts
bun run test:release-contract
bun run check
bun run release:verify
```

## Related Issues

- See also: [query-explain-output-parity-kqmd-cli-20260312.md](./query-explain-output-parity-kqmd-cli-20260312.md)
- See also: [owned-runtime-bootstrap-safety-kqmd-cli-20260311.md](./owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
- See also: [kiwi-shadow-index-hardening-kqmd-cli-20260313.md](./kiwi-shadow-index-hardening-kqmd-cli-20260313.md)
- See also: [trusted-dependencies-drift-kqmd-cli-20260313.md](../security-issues/trusted-dependencies-drift-kqmd-cli-20260313.md)

Related planning context:
- `docs/plans/2026-03-13-fix-owned-cli-release-readiness-plan.md`
- `docs/plans/2026-03-11-feat-owned-command-io-parity-contract-plan.md`
- `docs/plans/2026-03-13-refactor-bun-first-repository-toolchain-plan.md`

Related guard pattern:
- `test/owned-command-parity/upstream-version-guard.test.ts`

Related work item:
- `todos/032-complete-p2-query-runtime-adapter-depends-on-nonexported-store-surface.md`
