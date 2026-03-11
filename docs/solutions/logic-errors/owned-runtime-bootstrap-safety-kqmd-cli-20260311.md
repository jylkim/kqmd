---
module: K-QMD CLI
date: 2026-03-11
problem_type: logic_error
component: tooling
symptoms:
  - "`search`/`query` opened in config-file mode and could sync config into the shared SQLite store during read-path execution"
  - "`withOwnedStore()` exposed `close()` to callbacks while also auto-closing in the wrapper, creating double-close and error-masking risk"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [cli, runtime, qmd, config-sync, lifecycle, cleanup, typescript]
---

# Troubleshooting: Owned runtime bootstrap를 안전하게 고정하기

## Problem

K-QMD의 owned runtime bootstrap를 처음 도입한 뒤 code review에서 두 가지 correctness 문제가 드러났다.

1. `search`와 `query`는 config 파일이 존재하면 항상 `config-file` mode를 선택했다.
   그런데 upstream `createStore({ configPath })`는 open 시점에 `syncConfigToDb()`를 호출해
   `store_collections`와 관련 metadata를 갱신한다.
   결과적으로 read-only여야 할 command open이 shared upstream DB 상태를 조용히 변경할 수 있었다.

2. `withOwnedStore()`는 callback에 `session.close()`를 노출하면서 바깥 wrapper의 `finally`에서도
   무조건 다시 `close()`를 호출했다.
   이 구조에서는 callback이 먼저 close를 수행할 경우 double-close가 가능했고,
   callback failure와 cleanup failure가 동시에 발생하면 teardown error가 원래 실패 원인을 덮어쓸 수 있었다.

두 문제 모두 첫 consumer가 붙기 전에 잡아야 할 runtime contract 문제였다.

## Environment

- Module: K-QMD CLI
- Affected Component: owned runtime bootstrap
- Date: 2026-03-11
- Relevant files:
  - `src/commands/owned/runtime.ts`
  - `test/owned-runtime.test.ts`
  - `docs/architecture/kqmd-command-boundary.md`
  - `docs/architecture/upstream-compatibility-policy.md`

## Symptoms

- `search`/`query`가 기존 DB가 있어도 config-file mode를 택해 read path open만으로 shared DB metadata를 sync할 수 있었다
- architecture 문서의 “owned 명령은 shared upstream 상태를 바꾸지 않는다”는 guardrail과 구현이 어긋났다
- callback이 `close()`를 먼저 호출해도 wrapper가 다시 `close()`를 호출하는 API shape였다
- callback error와 close error가 같이 발생하면 cleanup error가 원래 callback failure를 덮어쓸 수 있었다

## What Didn't Work

**Attempted Solution 1:** `search`/`query`에서 config 파일이 있으면 항상 `config-file` mode를 우선한다.
- **Why it failed:** upstream `createStore({ configPath })`는 read-only open이 아니라 config sync를 동반한다. 따라서 “기존 index reopen” 의미가 흐려지고 shared DB에 write side effect가 생긴다.

**Attempted Solution 2:** `withOwnedStore()`가 callback에도 `close()`를 열어 두고, 바깥 wrapper도 `finally`에서 무조건 `close()`를 호출한다.
- **Why it failed:** lifecycle ownership이 불분명해지고, consumer misuse 가능성이 남는다. 또 callback failure와 cleanup failure가 동시에 발생할 때 primary failure를 안정적으로 보존하기 어렵다.

## Solution

runtime contract를 두 방향으로 hardening했다.

1. `search`/`query`는 config가 있어도 기존 DB가 존재하면 DB-only reopen을 우선하도록 바꿨다
2. `withOwnedStore()`는 callback에 `close()`가 없는 context만 전달하도록 바꿨다
3. cleanup은 wrapper가 전적으로 소유하고, callback failure가 있으면 close failure는 무시해 primary error를 보존하도록 했다
4. runtime test를 확장해 mode precedence, callback context shape, callback failure + close failure 조합을 검증했다
5. architecture 문서도 새 policy에 맞게 갱신했다

**Code changes**:

```ts
// Before: search/query preferred config-file mode
case 'search':
case 'query':
  if (configExists) {
    return { kind: 'config-file', command, indexName, dbPath, configPath };
  }
  if (dbExists) {
    return { kind: 'db-only', command, indexName, dbPath };
  }
```

```ts
// After: prefer existing DB reopen for read commands
case 'search':
case 'query':
  if (dbExists) {
    return { kind: 'db-only', command, indexName, dbPath };
  }
  if (configExists) {
    return { kind: 'config-file', command, indexName, dbPath, configPath };
  }
```

```ts
// Before: callback could see close(), wrapper also closed in finally
export async function withOwnedStore<T>(
  command: OwnedCommand,
  context: CommandExecutionContext,
  run: (session: OwnedStoreSession) => Promise<T>,
): Promise<T | OwnedRuntimeFailure> {
  const session = await openOwnedStoreSession(command, context, dependencies);
  try {
    return await run(session);
  } finally {
    await session.close();
  }
}
```

```ts
// After: callback gets close-free context, wrapper owns cleanup
export type OwnedStoreContext = Omit<OwnedStoreSession, 'close'>;

export async function withOwnedStore<T>(
  command: OwnedCommand,
  context: CommandExecutionContext,
  run: (session: OwnedStoreContext) => Promise<T>,
): Promise<T | OwnedRuntimeFailure> {
  const session = await openOwnedStoreSession(command, context, dependencies);
  const { close, ...sessionContext } = session;

  try {
    const result = await run(sessionContext);
    await close();
    return result;
  } catch (error) {
    try {
      await close();
    } catch {
      // Preserve the primary callback failure.
    }
    throw error;
  }
}
```

**Commands run**:

```bash
npm run check
```

## Why This Works

문제의 핵심은 runtime이 “편의상 자연스러워 보이는 기본값”을 택하면서 실제 upstream side effect와 cleanup ownership을 충분히 모델링하지 않았다는 점이다.

1. **Read-path mode precedence**
   기존 DB가 있을 때 DB-only reopen을 우선하면 “이미 존재하는 index를 다시 여는” 의미가 보존된다.
   반대로 config-file mode는 DB bootstrap이 필요한 상황에서만 사용되므로,
   read command open이 shared metadata sync를 일으킬 가능성을 줄일 수 있다.

2. **Lifecycle ownership clarity**
   callback이 `close()`를 직접 볼 수 없게 만들면 lifecycle 책임이 wrapper 한 곳에만 남는다.
   이 구조는 double-close 위험을 없애고, consumer API도 더 단순하게 만든다.

3. **Primary failure preservation**
   callback에서 이미 실패한 경우 cleanup error는 secondary concern이다.
   catch 경로에서 close failure를 삼키면 디버깅 시 원래 business failure를 그대로 볼 수 있다.

4. **Contract-level tests**
   runtime test가 mode precedence와 cleanup semantics를 직접 고정하므로,
   future consumer가 붙어도 핵심 guardrail이 drift하기 어렵다.

## Prevention

- upstream helper를 wrapper로 감쌀 때는 “이 API가 open 시점에 실제로 무엇을 mutate하는가”를 먼저 확인한다
- read command와 write command의 mode precedence를 같은 방식으로 처리하지 않는다
- callback-based resource wrapper는 cleanup ownership을 한 레이어에만 둔다
- callback에 lifecycle method를 노출해야 한다면 idempotency와 primary-error preservation 정책을 먼저 정의한다
- runtime contract는 consumer 구현 전에 직접 테스트로 고정한다
- architecture 문서의 guardrail과 실제 mode precedence가 계속 일치하는지 code review에서 같이 본다

## Related Issues

- Related code review follow-up: `todos/005-complete-p2-read-command-config-sync-side-effect.md`
- Related code review follow-up: `todos/006-complete-p2-runtime-close-double-close-risk.md`
