---
title: feat: Add owned command runtime bootstrap
type: feat
status: completed
date: 2026-03-11
origin: docs/brainstorms/2026-03-11-owned-command-runtime-brainstorm.md
---

# feat: Add owned command runtime bootstrap

## Enhancement Summary

**Deepened on:** 2026-03-11
**Sections enhanced:** 5
**Research inputs:** `architecture-strategist`, `kieran-typescript-reviewer`, `performance-oracle`, `security-sentinel`, `code-simplicity-reviewer`, installed `@tobilu/qmd` source/docs, official Node.js file system docs, official TypeScript handbook

### Key Improvements

1. runtime를 pure policy resolution과 effectful store lifecycle로 더 분리하는 방향을 추가해 아키텍처 경계를 선명하게 했다.
2. DB-only reopen guardrail을 단순 설명이 아니라 typed outcome, injected dependency, deterministic test 기준으로 더 구체화했다.
3. TypeScript discriminated union과 exhaustiveness checking 관점을 반영해 runtime mode / error branching을 더 안전하게 설계하도록 보강했다.

### New Considerations Discovered

- upstream `createStore()`는 첫 호출부터 DB open과 schema initialization을 일으키므로, “reopen”을 의미 있게 만들려면 store 호출 전 preflight가 필수다.
- Node의 synchronous file-system API는 event loop를 block하므로, 존재 확인은 CLI bootstrap에서 작게 한 번만 수행하고 deeper command flow로 퍼뜨리지 않는 편이 낫다.
- Node file-system 경로는 `process.cwd()` 기준으로 해석될 수 있으므로, runtime은 raw argv 조합보다 기존 path helper가 이미 resolve한 경로를 계속 사용하는 편이 안전하다.

## Overview

K-QMD가 소유하는 `search`, `query`, `update`, `embed` 명령을 위해 공통 `runtime bootstrap` 레이어를 추가한다. 이번 슬라이스는 각 명령의 실제 결과 포맷이나 한국어 검색 동작을 구현하는 것이 아니라, upstream-compatible index 경로 해석, QMD store bootstrap, 공통 runtime 에러 분류를 먼저 도입하는 작업이다 (브레인스토밍 참고: `docs/brainstorms/2026-03-11-owned-command-runtime-brainstorm.md`).

목표는 현재의 “명령별 개별 stub” 상태를 끝내고, 이후 owned command 구현이 재사용할 수 있는 단일 기반을 만드는 것이다. 이 runtime은 K-QMD가 언제 YAML config 모드로 여는지, 언제 DB-only reopen을 허용하는지, `@tobilu/qmd`를 어떻게 여는지, 그리고 이번 슬라이스에서 다룰 두 가지 공통 실패인 `config missing`과 `store open failure`를 어떻게 보고할지를 캡슐화해야 한다 (브레인스토밍 참고: `docs/brainstorms/2026-03-11-owned-command-runtime-brainstorm.md`).

## Problem Statement / Motivation

현재 owned command는 모두 고정된 stderr만 반환하는 scaffold handler라서, 앞으로 실제 기능을 붙일 때마다 path, config, DB, error policy를 각 명령이 다시 정의하게 된다 (`src/commands/owned/search.ts:1`, `src/commands/owned/query.ts:1`, `src/commands/owned/update.ts:1`, `src/commands/owned/embed.ts:1`).

저장소에는 이미 호환성 기반이 일부 갖춰져 있지만, owned execution까지 이어지지는 않는다.

- 명령 소유 경계는 manifest에 이미 명시돼 있다 (`src/commands/manifest.ts:3`)
- CLI parsing은 이미 `--index`를 `CommandExecutionContext`로 전달한다 (`src/cli.ts:57`, `src/types/command.ts:18`)
- upstream-compatible config / DB path 규칙은 이미 테스트로 고정돼 있다 (`src/config/qmd_paths.ts:10`, `test/path-compatibility.test.ts:56`)

빠져 있는 것은 이 primitive를 실제 owned command 실행 계약으로 바꾸는 shared runtime layer다. 특히 upstream `createStore()`는 `configPath` 모드와 DB-only 모드를 모두 지원하지만, 구현상 SQLite DB를 즉시 열고 테이블도 초기화한다. 그래서 wrapper가 무심코 “DB-only reopen을 시도”하면 기존 index를 다시 여는 것이 아니라 빈 DB를 조용히 만들어 버릴 수 있다 (`node_modules/@tobilu/qmd/dist/index.js:53`, `node_modules/@tobilu/qmd/dist/store.js:985`). 따라서 이번 계획에는 단순 wrapper가 아니라 사전 존재 여부 확인 정책이 필요하다.

### Research Insights

**Best Practices:**
- architecture 관점에서는 pure decision layer와 side-effect layer를 분리하는 편이 이후 command consumer가 늘어도 boundary가 흐려지지 않는다.
- TypeScript 관점에서는 runtime mode와 failure를 discriminated union으로 표현하고 `never` 기반 exhaustiveness checking을 두는 편이 drift를 빨리 잡아낸다.
- simplicity 관점에서는 네 command의 공통 책임만 runtime으로 올리고, formatter나 option normalization까지 같이 올리지 않는 것이 맞다.

**Implementation Details:**

```ts
type OwnedRuntimePlan =
  | {
      kind: 'config-file';
      command: OwnedCommand;
      indexName: string;
      dbPath: string;
      configPath: string;
    }
  | {
      kind: 'db-only';
      command: OwnedCommand;
      indexName: string;
      dbPath: string;
    }
  | {
      kind: 'config-missing';
      command: OwnedCommand;
      indexName: string;
      dbPath: string;
      configPath: string;
      reason: 'config-required' | 'no-config-or-db';
    };
```

**Edge Cases:**
- config path가 존재하지만 YAML parsing 또는 load가 실패하면 `config-missing`이 아니라 `store-open-failed`로 다뤄야 한다.
- `INDEX_PATH` 또는 `QMD_CONFIG_DIR` override가 있을 때도 동일한 preflight policy를 적용해야 하고, override라는 이유로 auto-create를 허용하면 안 된다.
- file existence preflight와 actual open 사이에는 작은 TOCTOU window가 남지만, 로컬 CLI 문맥에서는 허용 가능하다. 대신 테스트는 “store 호출 전 policy”를 고정하는 데 집중하는 편이 맞다.

## Proposed Solution

### 1. Add a dedicated owned runtime module

`src/commands/owned/runtime.ts` 같은 집중된 helper 모듈을 추가하고, 책임은 아래 세 가지로 제한한다.

- 특정 owned command에 대한 runtime policy 결정
- 실제 `indexName`, `dbPath`, 선택적 `configPath` 계산
- QMD store를 열고 공통 실패를 정규화

이 레이어를 formatter, query construction, command-specific UX까지 확장하지 않는다. 브레인스토밍에서 이미 YAGNI 원칙에 따라 runtime bootstrap 먼저, command contract는 나중으로 정리했다 (브레인스토밍 참고: `docs/brainstorms/2026-03-11-owned-command-runtime-brainstorm.md`).

권장 shape는 아래와 같다.

```ts
// src/commands/owned/runtime.ts
import { createStore, type QMDStore } from '@tobilu/qmd';
import type { CommandExecutionContext, OwnedCommand } from '../../types/command.js';

export type OwnedRuntimeFailure =
  | { kind: 'config-missing'; command: OwnedCommand; indexName: string; dbPath: string; configPath: string; reason: 'config-required' | 'no-config-or-db' }
  | { kind: 'store-open-failed'; command: OwnedCommand; indexName: string; dbPath: string; configPath?: string; cause: Error };

export interface OwnedStoreSession {
  readonly command: OwnedCommand;
  readonly indexName: string;
  readonly dbPath: string;
  readonly configPath?: string;
  readonly mode: 'config-file' | 'db-only';
  readonly store: QMDStore;
  close(): Promise<void>;
}

export async function withOwnedStore<T>(
  command: OwnedCommand,
  context: CommandExecutionContext,
  run: (session: OwnedStoreSession) => Promise<T>,
): Promise<T> {
  // resolve policy -> preflight files -> createStore() -> finally close()
}
```

`command`는 일단 helper에 명시적으로 넘긴다. 아직 `CommandExecutionContext`를 넓혀 공통 command contract를 너무 일찍 고정하지 않겠다는 브레인스토밍 결정과 맞춘다.

### 2. Encode command policy explicitly

브레인스토밍에서 합의한 command policy를 그대로 코드에 반영한다.

- `search` / `query`
  config 파일이 있으면 `configPath`로 연다. config는 없지만 DB 파일이 이미 존재하면 DB-only reopen을 허용한다. 둘 다 없으면 `reason: 'no-config-or-db'`인 `config-missing`을 반환한다 (브레인스토밍 참고: `docs/brainstorms/2026-03-11-owned-command-runtime-brainstorm.md`).
- `update`
  config를 필수로 본다. DB가 이미 있더라도 config가 없으면 `reason: 'config-required'`인 `config-missing`으로 즉시 실패한다. `update`는 filesystem을 다시 스캔하기 위한 collection 정의가 필요하기 때문이다 (브레인스토밍 참고: `docs/brainstorms/2026-03-11-owned-command-runtime-brainstorm.md`; upstream `update`는 store state 또는 synced config에서 collection을 읽는다: `node_modules/@tobilu/qmd/dist/index.js:180`).
- `embed`
  config가 있으면 우선 사용하되, config가 없고 기존 DB가 있으면 DB-only reopen을 허용한다. 이 부분은 브레인스토밍의 “config가 꼭 필요한 mutation command만 strict하게 막는다”는 방향과 upstream API shape를 함께 해석한 결과다. `embed()`는 filesystem을 다시 스캔하기보다 이미 인덱싱된 콘텐츠를 기준으로 동작한다 (`node_modules/@tobilu/qmd/dist/index.js:209`).

### 3. Add file-existence preflight before `createStore()`

runtime은 DB-only reopen을 위해 `createStore()`를 무조건 호출하면 안 된다. upstream 구현은 DB를 열고 스키마를 바로 초기화하므로 (`node_modules/@tobilu/qmd/dist/index.js:60`, `node_modules/@tobilu/qmd/dist/store.js:987`), mode 선택 전에 아래 확인이 먼저 필요하다.

- `config-file` mode를 고르기 전에 config 파일 존재 여부 확인
- `db-only` mode를 고르기 전에 DB 파일 존재 여부 확인
- mode가 확정된 뒤에만 `createStore()` 호출

이 preflight가 이번 슬라이스의 핵심 가드레일이다. “DB-only reopen”이 실제로 기존 DB 재오픈을 뜻하게 만들고, read path가 부수효과로 빈 store를 만들어 버리는 일을 막는다.

### 4. Normalize only the shared failures for this slice

에러 taxonomy는 의도적으로 작게 유지한다.

- `config-missing`
  “이 명령은 config가 필요함”과 “read / reopen 명령인데 config도 없고 기존 DB도 없음”을 함께 표현한다
- `store-open-failed`
  preflight 이후의 `createStore()` 실패나 config load 실패를 감싼다

`sqlite-vec`, embedding model, 기타 vector/runtime 의존성 실패는 아직 공통 레이어로 흡수하지 않는다. 브레인스토밍에서 이 영역은 command-specific concern으로 뒤로 미루기로 했다 (브레인스토밍 참고: `docs/brainstorms/2026-03-11-owned-command-runtime-brainstorm.md`).

### 5. Keep current command stubs intact

이번 슬라이스는 reusable runtime infrastructure와 테스트까지만 도입한다. 지금 stub handler가 단지 “still scaffold-only” 메시지를 출력하기 위해 store를 실제로 열게 만들지는 않는다. 그렇게 하면 아직 아무 기능도 없는 시점에 불필요한 DB IO만 생기고 사용자 관점의 동작도 흐려진다.

다음 feature slice가 `withOwnedStore()`의 첫 소비자가 되는 것이 맞고, 우선순위는 `search` 또는 `query`가 자연스럽다.

### 6. Add direct tests for the runtime contract

`test/owned-runtime.test.ts`를 만들고 policy edge를 dependency injection으로 직접 검증한다.

- `search`는 config가 있으면 `config-file` mode를 선택한다
- `search`는 config가 없고 DB가 있으면 `db-only` mode를 선택한다
- `search`는 config와 DB가 모두 없으면 `config-missing`을 반환한다
- `update`는 DB가 있어도 config가 없으면 `config-missing`을 반환한다
- `embed`는 config가 없더라도 DB가 있으면 DB-only reopen을 허용한다
- `store-open-failed`는 `createStore()` 실패를 metadata와 함께 감싼다
- `withOwnedStore()`는 `finally`에서 store를 닫는다

테스트는 `existsSync`, `createStore`, `env`를 주입받는 형태로 만들면 실제 사용자 index나 model loading에 의존하지 않고 빠르게 유지할 수 있다.

### 7. Update architecture docs to reflect the new layer

runtime이 들어오면 `docs/architecture/kqmd-command-boundary.md`도 갱신해서 owned execution이 더 이상 “stub only”가 아니라 “runtime bootstrap + future command logic” 구조라는 점을 반영한다. `docs/architecture/upstream-compatibility-policy.md`에도 DB-only reopen은 기존 DB가 실제로 있을 때만 허용한다는 규칙을 맞춰 적는다.

### Research Insights

**Best Practices:**
- runtime public API는 두 단계로 나누는 편이 가장 읽기 쉽다: `resolveOwnedRuntimePlan()` 같은 pure resolver와 `withOwnedStore()` 같은 lifecycle wrapper.
- dependency access는 module-global 호출보다 injected dependency object로 모으는 편이 테스트와 drift 대응에 유리하다.
- command policy는 handler 내부 분기보다 data-driven mapping으로 유지하는 편이 manifest와도 패턴이 맞는다.

**Performance Considerations:**
- config existence check와 DB existence check는 invocation당 한 번씩만 수행하고, 현재 stub handler에서는 아예 runtime을 호출하지 않아야 한다.
- store open 이후에는 같은 path / mode 판단을 다시 하지 않게 해서 filesystem I/O와 conditional branching을 줄이는 편이 낫다.

**Implementation Details:**

```ts
import { createStore } from '@tobilu/qmd';

interface OwnedRuntimeDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly existsSync: (path: string) => boolean;
  readonly createStore: typeof createStore;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled runtime branch: ${String(value)}`);
}
```

```ts
export async function withOwnedStore<T>(
  command: OwnedCommand,
  context: CommandExecutionContext,
  deps: OwnedRuntimeDependencies,
  run: (session: OwnedStoreSession) => Promise<T>,
): Promise<T> {
  const plan = resolveOwnedRuntimePlan(command, context, deps);

  if (plan.kind === 'config-missing') {
    throw plan;
  }

  const store = await deps.createStore(
    plan.kind === 'config-file'
      ? { dbPath: plan.dbPath, configPath: plan.configPath }
      : { dbPath: plan.dbPath },
  );

  try {
    return await run({ ...plan, store, close: () => store.close() });
  } finally {
    await store.close();
  }
}
```

**Edge Cases:**
- callback 내부 예외가 발생해도 `store.close()`는 항상 실행돼야 한다.
- `createStore()`가 reject되면 session object를 만들지 말고 즉시 `store-open-failed`로 감싸야 한다.
- future command가 runtime을 소비하기 시작한 뒤에도 `update`의 strict config rule을 optional flag로 우회할 수 없어야 한다.

## Suggested Implementation Order

### Phase 1: Runtime policy shape

- `OwnedRuntimePlan`, `OwnedRuntimeFailure`, `OwnedStoreSession` 타입을 추가한다
- `resolveOwnedRuntimePlan()` 같은 pure function으로 command별 policy와 preflight 결과를 계산한다
- existing `CommandExecutionContext`는 그대로 두고 `command`를 helper 인자로 명시적으로 전달한다

### Phase 2: Store lifecycle wrapper

- injected dependency interface를 추가한다
- `withOwnedStore()` 또는 동등한 wrapper를 구현한다
- `createStore()` 성공 이후 `finally`에서 `close()`를 보장한다

### Phase 3: Direct runtime tests

- mode selection과 failure wrapping을 `test/owned-runtime.test.ts`에 고정한다
- real filesystem / env / model loading 없이 injected dependency로만 검증한다
- `search`, `query`, `update`, `embed`의 policy 차이를 독립 케이스로 분리한다

### Phase 4: Documentation sync

- architecture 문서를 새 runtime layer 기준으로 갱신한다
- upstream compatibility policy에 DB-only reopen guardrail을 명시한다

## Alternative Approaches Considered

### Rejected: bootstrap-only helper with raw upstream errors

이 접근은 브레인스토밍에서 이미 기각했다. 각 future command가 같은 runtime failure를 다시 해석해야 해서, 첫 슬라이스로는 너무 얇고 실제 중복 제거 효과도 작다 (브레인스토밍 참고: `docs/brainstorms/2026-03-11-owned-command-runtime-brainstorm.md`).

### Rejected: expand full owned command contract now

이 역시 브레인스토밍에서 기각했다. formatter, option parsing, command UX까지 계획이 번져서 runtime seam이 검증되기 전에 계약을 너무 빨리 굳히게 된다. 아직 저장소에는 실제 owned-command behavior가 충분하지 않다 (브레인스토밍 참고: `docs/brainstorms/2026-03-11-owned-command-runtime-brainstorm.md`).

## Technical Considerations

- 아키텍처 영향
  네 개 command handler에 path / config / store logic를 복제하지 않고, 하나의 owned runtime 모듈로 모은다. passthrough delegation에는 손대지 않는다.
- 성능 영향
  현재 stub에서 store를 여는 동작은 넣지 않는다. runtime은 첫 실제 consumer가 생길 때까지 library 형태로 존재하는 것이 맞다.
- 데이터 안전성
  DB-only reopen 전에 DB 존재 여부를 반드시 확인해서 빈 DB가 조용히 생성되는 일을 막는다.
- 호환성
  runtime 내부에서 경로를 다시 계산하지 말고, 이미 parity test로 고정된 path helper를 재사용한다 (`src/config/qmd_paths.ts:10`, `test/path-compatibility.test.ts:56`).
- upstream drift
  설치된 패키지의 문서화된 SDK 계약에만 의존한다. 즉 `createStore({ dbPath, configPath? })`, `update()`, `embed()`를 기준으로 본다 (`node_modules/@tobilu/qmd/dist/index.d.ts:90`, `node_modules/@tobilu/qmd/README.md:170`).

### Research Insights

**Best Practices:**
- Node 공식 문서 기준으로 synchronous fs API는 event loop를 block하므로, 존재 확인은 bounded bootstrap path에만 두는 편이 적절하다.
- Node 공식 문서 기준으로 relative file path는 `process.cwd()` 기준으로 해석되므로, runtime은 helper가 resolve한 경로를 그대로 쓰는 쪽이 더 예측 가능하다.
- TypeScript handbook 기준으로 discriminated union과 `never` 기반 exhaustiveness checking은 branching drift를 줄이는 데 적합하다.

**Performance Considerations:**
- CLI 한 번 실행당 `existsSync()` 1~2회는 충분히 감당 가능하지만, 같은 검사를 formatter / result shaping까지 재사용하면 작은 비용이 누적될 수 있다.
- store를 열면 DB initialization과 이후 LLM/session wiring까지 연결될 수 있으므로, 현재 stub에서는 runtime 미사용 원칙을 유지하는 편이 좋다.

**Security & Failure Considerations:**
- command type에서 mode를 결정해야지, optional flag나 missing config fallback이 `update`의 strict rule을 우회하게 두면 안 된다.
- preflight는 “존재 여부 확인”까지만 해야 하고, directory creation이나 config guessing 같은 추가 side effect를 넣지 않는 것이 안전하다.

**References:**
- [Node.js File system docs](https://nodejs.org/docs/latest/api/fs.html)
- [TypeScript Handbook: Union Exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html)

## System-Wide Impact

- **Interaction graph**: `runCli()`가 argv를 `CommandExecutionContext`로 파싱하고, owned command는 manifest를 통해 계속 선택되며, 이후 실제 owned handler가 runtime helper를 호출하면 그 helper가 경로를 해석하고 upstream `createStore()`를 호출하게 된다 (`src/cli.ts:123`, `src/commands/manifest.ts:16`, `node_modules/@tobilu/qmd/dist/index.js:53`).
- **Error propagation**: runtime preflight failure는 DB를 열기 전에 typed `config-missing`으로 surface되어야 하고, preflight 이후 store open failure는 typed `store-open-failed`로 surface되어야 한다. raw upstream exception이 owned command의 주 계약이 되어서는 안 된다.
- **State lifecycle risks**: 가장 큰 리스크는 read / reopen path가 빈 DB를 새로 만드는 것이다. preflight existence check가 이를 막는 핵심 장치다. 이번 슬라이스는 새로운 persistent state를 추가하지 않는다.
- **API surface parity**: 네 개 owned command는 같은 runtime policy source를 사용해야 하고, 각 handler 안에 제각각 store-open rule을 숨기면 안 된다.
- **Integration test scenarios**:
  1. named index에 config가 있으면 `config-file` mode로 열리고 정확한 `configPath`가 전달된다
  2. named index에 config는 없지만 DB가 있으면 `search`는 `db-only` mode로 열린다
  3. named index에 config와 DB가 모두 없으면 새 DB를 만들지 않고 `config-missing`을 반환한다
  4. `update`는 DB가 있어도 config가 없으면 즉시 실패한다
  5. 주입한 `createStore()`가 실패하면 `store-open-failed`로 감싸고, 가능하면 partially opened session도 정리한다

## Acceptance Criteria

- [x] policy resolution과 store lifecycle을 담당하는 작은 public API의 owned runtime 모듈이 존재한다
- [x] runtime branching은 discriminated union과 동등한 typed outcome으로 표현되고, 새 branch 추가 시 compile-time drift를 잡을 수 있다
- [x] runtime은 config / DB path를 새로 계산하지 않고 기존 upstream-compatible path helper를 사용한다
- [x] `search`와 `query`는 실제 DB 파일이 있을 때만 DB-only reopen을 허용한다
- [x] `update`는 config를 필수로 보고, config가 없으면 typed `config-missing`을 반환한다
- [x] `embed`는 config가 없더라도 기존 DB가 있으면 DB-only reopen을 허용한다
- [x] 공통 runtime failure는 `config-missing`과 `store-open-failed` 두 가지로 제한된다
- [x] vector / model dependency failure는 이 공통 레이어 밖에 남는다
- [x] preflight logic은 injected dependency를 통해 real filesystem / env 없이 테스트 가능하다
- [x] runtime 테스트는 mode selection, file-existence preflight, store-open failure wrapping, `finally` 기반 close를 모두 다룬다
- [x] architecture 문서는 owned runtime layer와 DB-only reopen guardrail을 설명하도록 갱신된다

## Success Metrics

- 이후 owned-command slice는 path / config / store logic를 다시 쓰지 않고 하나의 helper를 호출할 수 있다
- read-oriented owned command path가 “reopen” 과정에서 빈 DB를 새로 만들지 않는다
- runtime contract는 실제 사용자 index state에 의존하지 않는 deterministic test로 커버된다
- 계획 범위가 formatter나 UX까지 번지지 않고 브레인스토밍에서 정한 runtime-first 경계를 유지한다

## Dependencies & Risks

- **Dependency**: 설치된 `@tobilu/qmd` SDK 계약이 `createStore()`, `update()`, `embed()` 수준에서는 안정적으로 유지돼야 한다
- **Risk**: `embed` policy는 사용자의 현재 의도와 upstream API shape를 함께 해석한 결과이지, 저장소에 이미 명시된 규칙은 아니다
- **Risk**: 나중에 현재 stub handler가 runtime을 즉시 소비해야 한다고 판단되면, 사용자-facing behavior를 따로 다시 검토해야 할 수 있다
- **Risk**: upstream 내부의 DB initialization 방식이 바뀔 수 있으므로, K-QMD의 preflight rule은 테스트로 고정해야 한다
- **Risk**: file existence preflight와 actual store open 사이에는 작은 race window가 남는다. 로컬 CLI에서는 허용 가능하지만, 테스트는 atomicity가 아니라 K-QMD policy 보장에 초점을 둬야 한다
- **Risk**: synchronous existence check를 bootstrap 밖으로 퍼뜨리면 작은 성능 비용이 누적되고 구조도 흐려질 수 있다

## Sources & References

- **Origin brainstorm:** `docs/brainstorms/2026-03-11-owned-command-runtime-brainstorm.md`
  carry-forward한 핵심 결정: runtime-first slice, 제한된 error scope, read path의 DB-only reopen, `update`의 strict config requirement
- Command boundary: `docs/architecture/kqmd-command-boundary.md:6`
- Upstream compatibility policy: `docs/architecture/upstream-compatibility-policy.md:5`
- Existing CLI context and owned dispatch: `src/cli.ts:57`
- Owned command manifest: `src/commands/manifest.ts:3`
- Current command execution context: `src/types/command.ts:18`
- Path helpers: `src/config/qmd_paths.ts:10`
- Path parity tests: `test/path-compatibility.test.ts:56`
- Upstream SDK createStore modes: `node_modules/@tobilu/qmd/README.md:170`
- Upstream SDK store API: `node_modules/@tobilu/qmd/dist/index.d.ts:90`
- Upstream createStore implementation and DB-only behavior: `node_modules/@tobilu/qmd/dist/index.js:53`
- Official docs: [Node.js File system docs](https://nodejs.org/docs/latest/api/fs.html)
- Official docs: [TypeScript Handbook - Unions and Intersections](https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html)
- Institutional learning: `docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md`
  이 슬라이스도 injected dependency와 platform-neutral contract를 기준으로 테스트 가능하게 유지해야 한다
