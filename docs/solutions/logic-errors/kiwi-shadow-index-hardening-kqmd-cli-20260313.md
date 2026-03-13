---
module: K-QMD CLI
date: 2026-03-13
problem_type: logic_error
component: tooling
symptoms:
  - "`qmd update`가 Kiwi/bootstrap failure 이후 실패로 끝나지만 upstream 문서 DB는 이미 갱신되고 `kqmd_documents_fts`만 stale 상태로 남을 수 있었다"
  - "`status`가 search policy를 clean으로 보여 줘도 Hangul `qmd search`가 query-time Kiwi bootstrap failure로 깨질 수 있었다"
  - "quoted/negated Hangul query가 clean shadow search path에서 upstream와 다른 MATCH semantics로 해석될 수 있었다"
  - "첫 Kiwi bootstrap/download 실패가 같은 process 안의 이후 Hangul search/update를 계속 실패시키거나, 손상된 cache를 그대로 재사용할 수 있었다"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [cli, qmd, kiwi, search, shadow-fts, sqlite, typescript, reliability]
---

# Troubleshooting: Kiwi shadow index hardening in K-QMD CLI

## Problem

K-QMD에 Kiwi 기반 Korean shadow FTS를 처음 붙인 뒤, `qmd search`와 `qmd update`가 사용자에게 약속한 runtime contract와 실제 동작이 어긋나는 문제가 드러났다. 구체적으로는 `update`가 upstream DB를 먼저 바꾼 뒤 Kiwi/bootstrap과 shadow rebuild를 수행해 partial state를 남길 수 있었고, `search`는 shadow index가 이미 clean이어도 Hangul query마다 live Kiwi runtime에 다시 의존했으며, quoted/negated Hangul query는 syntax semantics가 drift 할 수 있었다.

이 문제는 단순 성능 이슈가 아니라, `status`가 말하는 health와 실제 search/update availability가 어긋나고, first-run failure가 long-lived process 전체를 오염시킬 수 있다는 점에서 correctness 문제였다. 따라서 이번 수정의 목표는 “Kiwi가 붙어 있다”를 넘어서, shadow index hardening을 통해 partial state, runtime bootstrap, query semantics, download integrity를 함께 바로잡는 것이었다.

## Environment

- Module: K-QMD CLI
- Affected Component: owned `search` / `update` / `status`, Kiwi bootstrap helper, same-DB shadow FTS
- Date: 2026-03-13
- Relevant files:
  - `src/commands/owned/kiwi_tokenizer.ts`
  - `src/commands/owned/search.ts`
  - `src/commands/owned/search_shadow_index.ts`
  - `src/commands/owned/update.ts`
  - `test/kiwi-tokenizer.test.ts`
  - `test/owned-search-behavior.test.ts`
  - `test/owned-embedding-behavior.test.ts`

## Symptoms

- `qmd update`가 Kiwi bootstrap 실패 시 실패로 끝나지만, upstream 문서 DB는 이미 새 상태로 바뀌고 shadow index만 stale로 남을 수 있었다.
- `status`가 search policy를 `clean`으로 보여 줘도, clean Hangul search가 live Kiwi bootstrap/network 상태에 다시 의존해 실제로는 실패할 수 있었다.
- `"형태소 분석"`이나 `-모델` 같은 query가 clean shadow path에서 raw query 뒤에 분석 토큰이 붙으면서 upstream와 다른 lexical semantics를 가질 수 있었다.
- first-run Kiwi model download/cache failure가 같은 process 안의 이후 Hangul search/update를 재시도 없이 계속 실패시키거나, 손상된 model file을 그대로 사용할 수 있었다.

## What Didn't Work

**Attempted approach 1:** `update` 뒤에 shadow rebuild만 transaction으로 감싸면 충분하다고 봤다.  
- **Why it failed:** `rebuildSearchShadowIndex()` transaction은 `kqmd_documents_fts`와 metadata만 보호할 뿐, 이미 끝난 upstream `store.update()`까지 되돌릴 수 없었다. Kiwi/bootstrap failure가 update 이후에 터지면 문서 DB와 shadow index가 다른 세대에 머무는 partial state가 남았다.

**Attempted approach 2:** clean shadow search path에서도 Hangul query는 항상 live Kiwi expansion을 거치게 뒀다.  
- **Why it failed:** shadow index가 clean이어도 local model cache/network/bootstrap 상태에 따라 Hangul search가 hard-fail 할 수 있었다. health model이 말하는 “clean”과 실제 search availability가 어긋났다.

**Attempted approach 3:** raw query 뒤에 analyzed tokens를 단순 append 해도 syntax semantics는 유지된다고 봤다.  
- **Why it failed:** `"형태소 분석"` 같은 quoted phrase와 `-모델` 같은 negation이 upstream와 다른 MATCH 식으로 바뀔 수 있었다. Hangul recall 개선이 lexical grammar parity를 깨는 방향으로 작동했다.

**Attempted approach 4:** runtime model download는 tag pinning만으로 충분하다고 봤다.  
- **Why it failed:** raw GitHub download에는 checksum 검증, atomic write, timeout, corrupted cache recovery가 없어서 공급망/운영 리스크가 남았다. 또한 rejected bootstrap promise가 캐시되면 같은 process에서 이후 search/update가 영구 실패할 수 있었다.

## Solution

해결은 네 축으로 정리했다.

1. `update`에 Kiwi preflight를 추가해, bootstrap failure를 upstream `store.update()` 이전으로 앞당겼다.
2. shadow rebuild는 projection 계산을 transaction 밖에서 끝내고, 실제 `DELETE + INSERT + metadata upsert`만 짧은 SQLite write transaction 안에 남겼다.
3. clean shadow search path에서는 live Kiwi query expansion을 제거하고 raw query를 그대로 shadow FTS에 보낸다. 대신 quoted/negated Hangul query는 conservative fallback으로 legacy lexical path를 타게 했다.
4. Kiwi 모델 다운로드에는 pinned SHA-256 manifest, timeout, atomic temp-file rename, corrupted cache redownload, rejected promise reset을 추가했다.

**Code changes**:

```ts
// Before: upstream update happened before Kiwi/bootstrap safety checks
const result = await executeUpdate(session, input);
await rebuildSearchShadowIndex(session.store.internal.db, searchPolicy, ...);
```

```ts
// After: fail before mutating the upstream document DB
await ensureKiwiReady(searchIndexDependencies?.kiwiDependencies);
const result = await executeUpdate(session, input);
await rebuildSearchShadowIndex(session.store.internal.db, searchPolicy, ...);
```

```ts
// Before: projection work ran under an open SQLite write transaction
beginTransaction(db);
for (const row of rows) {
  const projection = await buildShadowProjection(...);
  insert.run(...);
}
commitTransaction(db);
```

```ts
// After: precompute first, then keep the write lock short
const projections = await Promise.all(rows.map(async (row) => ({
  rowId: row.id,
  projection: await buildShadowProjection(...),
})));

beginTransaction(db);
for (const { rowId, projection } of projections) {
  insert.run(rowId, projection.filepath, projection.title, projection.body);
}
commitTransaction(db);
```

```ts
// After: clean Hangul search no longer depends on live Kiwi query bootstrap
const conservativeSyntax = hasConservativeLexSyntax(input.query);

const results =
  koreanQuery && !conservativeSyntax && shouldUseShadowSearchIndex(searchHealth)
    ? searchShadowIndex(session.store.internal, input.query, {
        limit: fetchLimit,
        collections: selectedCollections,
      })
    : await session.store.searchLex(input.query, {
        limit: fetchLimit,
        collection: singleCollection,
      });
```

```ts
// After: runtime model downloads are verified and failures do not poison the process forever
if (!isExpectedModelFile(file, data, dependencies)) {
  await downloadModelFile(file, filePath, dependencies);
}

if (!kiwiPromise) {
  kiwiPromise = createKiwi(dependencies).catch((error) => {
    kiwiPromise = undefined;
    throw error;
  });
}
```

**Commands run**:

```bash
npm run typecheck
npm run test
npm run check
```

## Why This Works

1. **Failure를 mutation 이전으로 이동했다.**  
   Kiwi/bootstrap failure를 `store.update()` 이전에 검증하면서, “문서 DB는 새 상태인데 shadow index는 구세대” 같은 avoidable partial state를 줄였다.

2. **Write lock 안에서 async work를 제거했다.**  
   tokenization, model load, projection 계산은 느리고 실패 가능성이 큰 작업이다. 이를 transaction 밖으로 빼면서 SQLite write lock은 짧고 예측 가능하게 유지됐다.

3. **Shadow index readiness와 query-time runtime readiness를 분리했다.**  
   clean shadow index가 이미 있으면 search는 그 index를 그대로 사용하면 된다. 더 이상 every Hangul query가 live Kiwi runtime availability에 묶일 필요가 없다.

4. **Korean recall과 lexical grammar parity를 함께 지켰다.**  
   plain Hangul query에서는 shadow projection이 recall을 개선하고, quoted/negated query에서는 conservative fallback으로 upstream semantics drift를 막았다.

5. **Runtime artifact provisioning을 실제 운영 환경 기준으로 harden 했다.**  
   checksum, atomic write, timeout, corrupted cache recovery, rejected promise reset을 넣으면서 first-run download와 long-lived process failure mode를 동시에 줄였다.

## Prevention

- mutation command가 외부 bootstrap이나 무거운 runtime dependency를 필요로 하면, 실제 state mutation 전에 preflight로 먼저 검증한다
- SQLite write transaction 안에는 네트워크, wasm init, tokenization 같은 async/slow path를 두지 않는다
- health helper가 `clean`을 말한다면, 해당 명령의 실제 availability도 같은 의미를 가져야 한다
- recall 개선이 lexical grammar semantics를 바꿀 수 있으면 plain term path와 quoted/negated path를 분리해서 본다
- runtime artifact download는 tag pinning만으로 끝내지 말고 checksum, timeout, atomic write, corrupted-cache recovery를 같이 둔다
- module-level singleton promise는 success path뿐 아니라 rejected state reset까지 설계해야 한다

### Recommended Tests

- `update` preflight failure 시 `store.update()`가 호출되지 않는 regression test
- clean shadow search path가 raw Hangul query로 성공하고 stderr warning이 없는 command-level test
- quoted Hangul query가 conservative fallback으로 legacy lexical path를 타는 test
- checksum mismatch cache file이 redownload 되는 unit test
- first bootstrap failure 후 second call recovery를 검증하는 singleton retry test

## Related Issues

- See also: [owned-runtime-bootstrap-safety-kqmd-cli-20260311.md](./owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
- See also: [status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md](./status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md)
- See also: [query-explain-output-parity-kqmd-cli-20260312.md](./query-explain-output-parity-kqmd-cli-20260312.md)
- See also: [bin-smoke-test-posix-shebang-kqmd-cli-20260311.md](../test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md)

Related planning context:
- `docs/brainstorms/2026-03-12-korean-search-recall-brainstorm.md`
- `docs/plans/2026-03-12-feat-kiwi-korean-search-recall-plan.md`
- `docs/plans/2026-03-12-feat-qwen-default-embedding-rollout-plan.md`

Related fix todos:
- `todos/017-complete-p1-update-can-leave-shadow-index-stale-on-kiwi-failure.md`
- `todos/017-complete-p2-korean-search-syntax-drift.md`
- `todos/018-complete-p2-clean-korean-search-still-depends-on-kiwi-runtime.md`
- `todos/018-complete-p2-shadow-rebuild-holds-write-lock-too-long.md`
- `todos/019-complete-p2-kiwi-model-download-integrity-gap.md`
- `todos/019-complete-p3-add-clean-shadow-command-path-test.md`
- `todos/020-complete-p2-kiwi-bootstrap-rejection-poisons-process.md`
