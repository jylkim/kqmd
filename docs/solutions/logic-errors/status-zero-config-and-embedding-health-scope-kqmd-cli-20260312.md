---
module: K-QMD CLI
date: 2026-03-12
problem_type: logic_error
component: tooling
symptoms:
  - "`qmd status`가 clean environment에서 zero-config 대시보드 대신 `config-missing`으로 실패했다"
  - "`qmd status --json`이 owned 전환 후 hard-fail 했다"
  - "`qmd query -c <collection>`가 실제 검색 대상과 무관한 컬렉션 때문에 embedding-mismatch warning을 띄웠다"
  - "embedding-health helper가 `query/status` 경로에 불필요한 DB read 비용을 추가했다"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [cli, status, query, embeddings, qwen3, compatibility, performance, typescript]
---

# Troubleshooting: Owned status zero-config regression and embedding health scope in K-QMD CLI

## Problem

Qwen3 기본 임베딩 정책을 K-QMD에 붙인 뒤, `status` zero-config 동작과 `query` mismatch advisory 범위가 함께 흔들렸다. `status`는 깨끗한 환경에서 실패했고, `query -c <collection>`는 실제 검색 대상과 관계없는 컬렉션 때문에 경고를 띄울 수 있었으며, health helper는 hot path 비용까지 키우고 있었다.

## Environment

- Module: K-QMD CLI
- Affected Component: owned `status` / `query` / embedding health helper
- Date: 2026-03-12
- Relevant files:
  - `src/commands/owned/runtime.ts`
  - `src/commands/owned/io/parse.ts`
  - `src/commands/owned/embedding_health.ts`
  - `src/commands/owned/query.ts`
  - `src/commands/owned/status.ts`
  - `src/commands/owned/update.ts`

## Symptoms

- `qmd status`가 깨끗한 환경에서 zero-config 상태 화면을 보여 주지 못하고 exit `1`로 실패했다
- `status`가 owned로 옮겨진 뒤 `--json` 같은 기존 passthrough-era flag도 hard-fail 했다
- `qmd query -c docs ...`가 실제로는 `docs`만 조회하면서 다른 컬렉션의 old-model vectors 때문에 mismatch warning을 띄울 수 있었다
- `status`는 이미 읽은 `getStatus()`를 다시 읽었고, `query`는 hot path에서 embedding model 집계를 매번 수행했다

## What Didn't Work

**Attempted approach 1:** `status`를 `search/query`와 같은 runtime branch로 취급했다.
- **Why it failed:** `status`는 단순 read command가 아니라 zero-config entrypoint 성격이 강하다. DB/config가 없어도 상태 화면을 보여 줘야 하는데, 기존 정책을 재사용하면서 `config-missing` regression이 생겼다.

**Attempted approach 2:** mismatch health를 store 전체 기준으로 먼저 읽고, 나중에 collection filter를 해석했다.
- **Why it failed:** warning 범위가 실제 query 범위보다 넓어져 신뢰도가 떨어졌고, 불필요한 `qmd embed --force`를 유도할 수 있었다.

**Attempted approach 3:** helper가 필요한 정보를 스스로 다 읽게 뒀다.
- **Why it failed:** `status`는 이미 `store.getStatus()`를 호출했는데, `readEmbeddingHealth()`가 다시 같은 정보를 읽어 중복 비용이 생겼다.

**Attempted approach 4:** 테스트 stub 호환을 위해 `query/update` success shape를 둘 다 허용했다.
- **Why it failed:** production path에 불필요한 type guard와 재포장이 남아 코드가 더 복잡해졌다.

## Solution

해결은 네 축으로 정리했다.

1. `status`에 zero-config 전용 runtime semantics를 부여했다.
2. `status` parser를 최소화해 기존 passthrough-era flag를 hard-fail 하지 않도록 바꿨다.
3. embedding health를 collection-aware / status-reusable helper로 재설계했다.
4. `query/update/status` handler를 단순화해 success shape와 context type을 정리했다.

**Code changes**:

```ts
// Before: status reused search/query policy and failed with no DB/config
case 'search':
case 'query':
case 'status':
  if (dbExists) {
    return { kind: 'db-only', command, indexName, dbPath };
  }

  if (configExists) {
    return { kind: 'config-file', command, indexName, dbPath, configPath };
  }

  return {
    kind: 'config-missing',
    command,
    indexName,
    dbPath,
    configPath,
    reason: 'no-config-or-db',
  };
```

```ts
// After: status gets its own zero-config branch
case 'status':
  if (dbExists) {
    return { kind: 'db-only', command, indexName, dbPath };
  }

  if (configExists) {
    return { kind: 'config-file', command, indexName, dbPath, configPath };
  }

  return { kind: 'db-only', command, indexName, dbPath };
```

```ts
// After: collection-aware model summary + reusable status input
export function readStoredEmbeddingModels(
  db: MinimalDatabase,
  collections?: readonly string[],
): StoredEmbeddingModel[] {
  const filters = collections && collections.length > 0 ? collections : undefined;
  const placeholders = filters?.map(() => '?').join(', ');
  const sql = [
    'SELECT cv.model as model, COUNT(DISTINCT d.hash) AS documents',
    'FROM documents d',
    'JOIN content_vectors cv ON cv.hash = d.hash AND cv.seq = 0',
    'WHERE d.active = 1',
    filters ? `AND d.collection IN (${placeholders})` : undefined,
    'GROUP BY cv.model',
    'ORDER BY documents DESC, cv.model ASC',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  return db
    .prepare(sql)
    .all(...(filters ?? []))
    .map((row) => row as { model: string; documents: number });
}

export async function readEmbeddingHealth(
  store: StoreLike,
  expectedModel: string,
  options: {
    readonly status?: Pick<IndexStatus, 'totalDocuments' | 'needsEmbedding'>;
    readonly collections?: readonly string[];
  } = {},
): Promise<EmbeddingHealth> {
  const status = options.status ?? (await store.getStatus());
  const storedModels = readStoredEmbeddingModels(store.internal.db, options.collections);
  return classifyEmbeddingHealth(status, expectedModel, storedModels);
}
```

```ts
// After: query warns only for the selected collection scope
const selectedCollections = resolveSelectedCollections(
  input.collections,
  availableCollections.map((collection) => collection.name),
  defaultCollections,
);

const health = await readEmbeddingHealth(session.store, effectiveModel.uri, {
  collections: selectedCollections,
});

return {
  rows: normalizeHybridQueryResults(results),
  stderr: hasEmbeddingMismatch(health)
    ? buildQueryMismatchWarning(effectiveModel.uri, summarizeStoredEmbeddingModels(health))
    : undefined,
};
```

**Commands run**:

```bash
# Reproduced the zero-config status regression
tmpdir=$(mktemp -d /tmp/kqmd-review-XXXXXX)
mkdir -p "$tmpdir/.cache/qmd" "$tmpdir/.config/qmd"

HOME="$tmpdir" XDG_CACHE_HOME="$tmpdir/.cache" XDG_CONFIG_HOME="$tmpdir/.config" \
  node node_modules/@tobilu/qmd/dist/cli/qmd.js status

HOME="$tmpdir" XDG_CACHE_HOME="$tmpdir/.cache" XDG_CONFIG_HOME="$tmpdir/.config" \
  node ./bin/qmd.js status

# Verification
npm run typecheck
npm run test
npm run lint
npm run check
npm run test:parity
```

## Why This Works

이번 수정이 맞는 이유는 문제를 “Qwen default feature의 일부”로만 보지 않고, 실제로는 세 가지 contract를 다시 분리했기 때문이다.

1. **`status` contract 복구**
   `status`는 zero-config에서도 유용해야 한다. runtime policy를 분리하면서 upstream-compatible한 entrypoint 성격을 되찾았다.

2. **warning scope 정합성 확보**
   advisory는 실제 query scope와 같아야 의미가 있다. collection-aware health로 바꾸면서 warning의 신뢰도가 올라갔다.

3. **hot-path 비용 절감**
   `documents -> content_vectors(seq=0)` 경로와 status reuse 입력을 사용해 불필요한 중복 읽기를 줄였다.

4. **구조 단순화**
   success shape를 하나로 줄이고 `status` parser/context를 단순화하면서, fix 자체가 다음 fix를 더 쉽게 만드는 방향으로 정리됐다.

## Prevention

- `status`처럼 사용자에게 “지금 시스템 상태”를 보여 주는 명령은 일반 read command와 같은 reopen policy로 묶지 않는다
- advisory/warning은 항상 실제 실행 범위와 같은 scope에서 계산한다
- correctness check가 hot path에 들어가면 helper 단계에서부터 invocation당 호출 수를 같이 검토한다
- 새 command를 owned로 전환할 때는 parser, runtime policy, formatter를 각각 독립된 축으로 본다
- 테스트 stub 편의를 위해 production success shape를 여러 개로 늘리지 않는다. 테스트를 실제 계약에 맞춘다

## Related Issues

- See also: [owned-runtime-bootstrap-safety-kqmd-cli-20260311.md](./owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
- See also: [query-explain-output-parity-kqmd-cli-20260312.md](./query-explain-output-parity-kqmd-cli-20260312.md)
- See also: [bin-smoke-test-posix-shebang-kqmd-cli-20260311.md](../test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md)
- Related follow-up todos:
  - `todos/012-complete-p1-status-upstream-compat-regression.md`
  - `todos/013-complete-p2-query-health-scope-ignores-collection-filter.md`
  - `todos/014-complete-p2-query-health-hot-path-scan.md`
  - `todos/015-complete-p3-simplify-status-parser-and-success-shapes.md`
