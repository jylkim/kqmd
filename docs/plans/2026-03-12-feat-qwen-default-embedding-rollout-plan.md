---
title: feat: Roll out Qwen as the default embedding model
type: feat
status: completed
date: 2026-03-12
origin: docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md
---

# feat: Roll out Qwen as the default embedding model

## Enhancement Summary

**Deepened on:** 2026-03-12
**Sections enhanced:** 4
**Research inputs:** `architecture-strategist`, `pattern-recognition-specialist`, `kieran-typescript-reviewer`, `performance-oracle`, `security-sentinel`, project `docs/solutions/*`, official Node.js process/child_process docs

### Key Improvements

1. `Qwen default` 설명을 `effective model = env override ?? K-QMD default` 정책으로 더 일반화해, 모델별 특례 없이 command UX를 설계하도록 보강했다.
2. `status` owned 전환이 ad hoc 분기가 아니라 기존 `manifest -> runtime -> handler -> formatter` 패턴 안에 들어가야 한다는 점을 더 분명히 했다.
3. mismatch health query를 문서 단위 집계와 single-pass read로 제한하고, stderr advisory / snapshot coverage / cross-platform smoke test 갱신까지 테스트 전략을 더 구체화했다.

### New Considerations Discovered

- Node 공식 문서 기준으로 `process.env` mutation은 현재 프로세스 안에서 유효하고, `child_process.spawn()`의 기본 `env`는 `process.env`이므로, `bin/qmd.js` 선-bootstrap 전략이 passthrough에도 자연스럽게 이어진다.
- `status`를 owned로 옮기더라도 `--json` 같은 새 surface를 성급히 만들 필요는 없다. 현재 요구는 “health와 next step을 정확히 드러내는 CLI output”이지 format matrix 확대가 아니다.
- `searchVec()`가 model column을 필터링하지 않기 때문에, mismatch detection은 부가 정보가 아니라 correctness guardrail이다.

## Overview

K-QMD의 다음 구현 슬라이스는 Qwen을 `kqmd` 배포 전체의 기본 embedding 모델로 실제 반영하는 것이다. 이번 작업은 단순히 `embed` 한 곳의 기본값을 바꾸는 수준이 아니라, 프로세스 bootstrap, owned `query/embed/update`, passthrough `pull`, 그리고 사용자에게 상태를 설명하는 `status`까지 하나의 제품 정책으로 정리하는 작업이다 (see brainstorm: `docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md`).

핵심 목표는 두 가지다. 첫째, fresh install에서는 별도 env 설정 없이 Qwen 기반 embedding 동작이 일관되게 선택되어야 한다. 둘째, 기존 인덱스의 저장 벡터가 현재 세션의 effective embedding model과 다를 때 조용한 품질 회귀를 허용하지 말고, mismatch를 감지해 `qmd embed --force` 경로를 분명하게 안내해야 한다 (see brainstorm: `docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md`).

## Problem Statement

현재 저장소는 Qwen 기본값을 제품 방향으로는 합의했지만, 실제 코드는 아직 그 결정을 구현하지 않았다.

- README는 embedding defaults가 아직 미구현이라고 명시한다 (`README.md`).
- `bin/qmd.js`는 별도 bootstrap 없이 바로 `dist/cli.js`를 import하므로, K-QMD 차원의 embed model default를 earliest point에서 주입하지 못한다 (`bin/qmd.js`).
- `status`는 아직 passthrough라서, K-QMD가 현재 effective model과 다른 stored vector mismatch를 health 정보로 노출할 수 없다 (`src/commands/manifest.ts`, `docs/architecture/kqmd-command-boundary.md`).
- owned `embed`는 `session.store.embed({ force })`만 호출하므로, 실제로 어떤 모델을 쓰는지 metadata에 반영하지 못하고, mismatch가 있어도 `--force` 없이 조용한 no-op가 될 수 있다 (`src/commands/owned/embed.ts`).
- owned `update`는 `needsEmbedding`만 보고 `qmd embed`를 안내한다. 하지만 현재 effective model과 다른 stored vectors가 남아 있으면 올바른 전환 명령은 `qmd embed --force`다 (`src/commands/owned/io/format.ts`).

upstream `@tobilu/qmd`는 Qwen 관련 기반을 이미 일부 갖고 있지만, 그대로 두면 이번 제품 요구를 만족하지 못한다.

- `llm.js`는 `QMD_EMBED_MODEL` override와 모델별 embedding formatting을 지원한다 (`node_modules/@tobilu/qmd/dist/llm.js`).
- 그러나 `store.js`의 `getHashesForEmbedding()`와 `getHashesNeedingEmbedding()`는 “벡터가 있는가”만 보고, “벡터가 어떤 모델로 생성되었는가”는 보지 않는다 (`node_modules/@tobilu/qmd/dist/store.js`).
- 더 큰 문제로 `searchVec()`는 `content_vectors.model`로 필터링하지 않고 모든 vector row를 검색한다. 따라서 query embedding의 현재 effective model과 저장된 문서 벡터 모델이 다르면 혼합 상태가 조용히 검색 품질을 망칠 수 있다 (`node_modules/@tobilu/qmd/dist/store.js`).

즉 이번 작업의 본질은 “Qwen default 선언”만이 아니라, `effective model = env override ?? K-QMD default` 정책과 stored metadata, mismatch health, recovery UX를 하나의 coherent contract로 만드는 것이다 (see brainstorm: `docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md`).

## Proposed Solution

추천 구현은 세 레이어를 함께 도입하는 것이다.

1. **Canonical embedding policy**
   K-QMD가 채택하는 기본 Qwen URI와 “effective embedding model” 계산 규칙을 한 모듈에 모은다. 사용자 명시 override가 있으면 그것을 존중하고, 없으면 K-QMD default를 적용한다. 나머지 command behavior는 특정 모델명을 하드코딩하지 않고 이 effective model만 기준으로 삼는다.

2. **Embedding health / mismatch inspection**
   DB의 `content_vectors`를 직접 읽어 “missing vectors”와 “wrong-model vectors”를 구분하는 작은 health helper를 만든다. 이 helper는 `status`, `query`, `embed`, `update`가 공통으로 쓴다.

3. **Status ownership + command-specific advisory UX**
   mismatch를 사용자에게 보여줘야 하므로 `status`는 더 이상 완전 passthrough로 둘 수 없다. `status`를 owned command로 전환하고, `query`는 경고 후 계속, `embed`는 no-force mismatch를 막고 `--force`를 안내하며, `update`는 후속 명령 안내를 더 정확하게 바꾼다 (see brainstorm: `docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md`).

이 접근은 자동 fallback도, 자동 destructive migration도 하지 않는다. 사용자는 mismatch를 명확히 인지하고 직접 `qmd embed --force`를 선택한다. 이것이 브레인스토밍에서 합의한 “default는 분명히 바꾸되, 기존 데이터는 사용자가 통제한다”는 방향과 가장 잘 맞는다 (see brainstorm: `docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md`).

## Technical Approach

### Architecture

이번 슬라이스에서 추가 또는 수정될 핵심 파일은 아래와 같다.

- `bin/qmd.js`
  earliest bootstrap point. `dist/cli.js` import 전에 effective embed model env를 설치한다.
- `src/config/embedding_policy.ts`
  K-QMD default embed model, effective model resolution, env bootstrap helper를 정의한다.
- `src/commands/owned/embedding_health.ts`
  DB에서 `missing`, `mismatch`, `mixed-models`, `clean` 상태를 계산한다.
- `src/commands/owned/status.ts`
  owned status handler. `store.getStatus()` 기반으로 mismatch advisory와 model info를 추가한다.
- `src/commands/owned/runtime.ts`
  `status`를 read-only owned runtime policy에 편입한다.
- `src/commands/manifest.ts`, `src/types/command.ts`, `src/cli.ts`
  `status` route를 owned command로 옮기고 dispatch를 갱신한다.
- `src/commands/owned/embed.ts`, `src/commands/owned/query.ts`, `src/commands/owned/update.ts`, `src/commands/owned/io/format.ts`, `src/commands/owned/io/errors.ts`
  command-specific mismatch handling과 recovery copy를 추가한다.
- `test/*`
  routing, status output, mismatch detection, embed/query/update UX, passthrough smoke coverage를 새 경계에 맞게 갱신한다.

권장 모듈 shape는 아래와 같다.

```ts
// src/config/embedding_policy.ts
export const KQMD_DEFAULT_EMBED_MODEL_URI =
  'hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf';

export function resolveEffectiveEmbedModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.QMD_EMBED_MODEL ?? KQMD_DEFAULT_EMBED_MODEL_URI;
}

export function installKqmdEmbedModelDefault(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.QMD_EMBED_MODEL) {
    env.QMD_EMBED_MODEL = KQMD_DEFAULT_EMBED_MODEL_URI;
  }
}
```

```ts
// src/commands/owned/embedding_health.ts
export type EmbeddingHealth =
  | { kind: 'clean'; expectedModel: string; storedModels: string[]; missingDocuments: number }
  | { kind: 'needs-embedding'; expectedModel: string; storedModels: string[]; missingDocuments: number }
  | { kind: 'model-mismatch'; expectedModel: string; storedModels: string[]; mismatchedDocuments: number }
  | { kind: 'mixed-models'; expectedModel: string; storedModels: string[]; mismatchedDocuments: number };
```

### Research Insights

**Best Practices:**
- embedding policy resolution과 advisory copy를 같은 handler 안에서 반복 계산하지 말고, `src/config/embedding_policy.ts`와 `src/commands/owned/embedding_health.ts` 두 모듈로 분리하는 편이 현재 codebase의 `config -> runtime -> command -> format` 패턴과 가장 잘 맞는다.
- `EmbeddingHealth`는 raw string 비교 결과가 아니라 discriminated union으로 굳히는 편이 TypeScript 품질과 formatter 분기 안정성에 유리하다.
- `status`는 `cli.ts`에서 특별 취급하지 말고, 기존 owned command와 같은 dispatch 경로에 태워야 boundary drift를 막을 수 있다.

**Performance Considerations:**
- health 계산은 `seq = 0` 기준 문서 단위 집계 한 번과 기존 `needsEmbedding` 조회 한 번으로 끝내는 편이 좋다. chunk row 전체를 매 command마다 스캔하면 큰 인덱스에서 불필요한 I/O가 커진다.
- `status`에서 device/GPU 정보는 best-effort로 유지하되, embedding health 계산과 분리해 “health query는 빠르게, device info는 실패 허용” 구조를 지키는 편이 좋다.
- command invocation마다 같은 DB를 여러 번 열지 말고, health helper는 이미 열린 owned store session 안에서 계산해야 한다.

**Implementation Details:**
```ts
// src/config/embedding_policy.ts
export type EffectiveEmbedModel = {
  readonly uri: string;
  readonly source: 'default' | 'env-override';
};

export function describeEffectiveEmbedModel(
  env: NodeJS.ProcessEnv = process.env,
): EffectiveEmbedModel {
  const override = env.QMD_EMBED_MODEL;

  if (override) {
    return { uri: override, source: 'env-override' };
  }

  return { uri: KQMD_DEFAULT_EMBED_MODEL_URI, source: 'default' };
}
```

```ts
// src/commands/owned/embedding_health.ts
export function readEmbeddingHealth(db: Database, expectedModel: string): EmbeddingHealth {
  const rows = db
    .prepare(
      `
        SELECT model, COUNT(DISTINCT hash) AS documents
        FROM content_vectors
        WHERE seq = 0
        GROUP BY model
      `,
    )
    .all() as Array<{ model: string; documents: number }>;

  const storedModels = rows.map((row) => row.model);
  const mismatchedDocuments = rows
    .filter((row) => row.model !== expectedModel)
    .reduce((sum, row) => sum + row.documents, 0);

  // Remaining branch selection omitted for brevity.
  return { kind: 'clean', expectedModel, storedModels, missingDocuments: 0 };
}
```

**Edge Cases:**
- 사용자가 run 사이에 `QMD_EMBED_MODEL` override를 바꾸면, 기존 Qwen vectors도 즉시 mismatch가 된다. 이것은 버그가 아니라 effective-model policy의 자연스러운 결과다.
- `embed --force` 중간 실패 후에는 일부 문서만 새 model metadata를 갖는 mixed state가 될 수 있으므로, status/query/update는 clean assumption으로 돌아가면 안 된다.
- `content_vectors`가 비어 있고 `vectors_vec`도 없으면 mismatch가 아니라 `needs-embedding`으로 취급해야 한다.

**References:**
- Node.js `process.env`: https://nodejs.org/api/process.html
- Node.js `child_process.spawn()`: https://nodejs.org/api/child_process.html
- `docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`
- `docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`

### Implementation Phases

#### Phase 1: Canonical policy bootstrap

목표는 “fresh install에서는 K-QMD default가 잡히고, override가 있으면 그것이 effective model이 된다”를 가장 이른 지점에서 고정하는 것이다.

- `src/config/embedding_policy.ts`를 추가한다.
- pinned default URI는 upstream `llm.js`의 `QMD_EMBED_MODEL` override example과 같은 값으로 둔다:
  `hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf` (`node_modules/@tobilu/qmd/dist/llm.js`).
- effective model resolution precedence를 `explicit env override > K-QMD default`로 둔다.
  이 우선순위는 upstream compatibility와 사용자 제어권을 유지하기 위해 필요하다.
- `bin/qmd.js`에서 `dist/cli.js`를 import하기 전에 `installKqmdEmbedModelDefault(process.env)`를 호출한다.
  이 위치가 중요한 이유는 `@tobilu/qmd/dist/llm.js`가 import 시점에 default model URI를 결정하기 때문이다 (`bin/qmd.js`, `node_modules/@tobilu/qmd/dist/llm.js`).
- passthrough command는 별도 옵션 없이도 현재 process env를 상속하므로, 이 bootstrap만으로 `pull` 같은 passthrough도 same effective model policy를 물려받는다 (`src/passthrough/delegate.ts`).

이 단계의 핵심 가드레일은 “bootstrap이 너무 늦어져 import-time default capture를 놓치지 않도록 한다”는 점이다.

#### Phase 2: Embedding health inspection

목표는 existing index 상태를 “missing vectors”와 “effective model과 다른 vectors”로 구분하는 것이다.

- `session.store.internal.db` 또는 동등한 공개 타입 경로를 사용해 `content_vectors`를 읽는다.
- 문서 단위 카운트가 필요하므로 `seq = 0` 기준의 distinct hash 집계를 사용한다.
- `needsEmbedding`는 기존 의미를 유지하되, mismatch detection은 아래처럼 별도 계산한다.

```sql
-- src/commands/owned/embedding_health.ts
SELECT model, COUNT(DISTINCT hash) AS documents
FROM content_vectors
WHERE seq = 0
GROUP BY model
ORDER BY documents DESC;
```

- health helper는 최소한 아래 상태를 구분해야 한다.
  - vector row 자체가 부족한 상태
  - 모든 vector가 expected model과 일치하는 상태
  - expected model이 아닌 단일 다른 model만 존재하는 상태
  - expected model과 다른 model들이 섞여 있는 mixed 상태
- helper는 user-facing 문구를 직접 만들지 않고, command layer가 선택적으로 copy를 붙일 수 있게 구조화된 결과만 반환한다.

이 health helper가 없으면 `getHashesNeedingEmbedding()`와 `searchVec()`의 현재 semantics 때문에 mismatch를 절대 잡을 수 없다 (`node_modules/@tobilu/qmd/dist/store.js`).

#### Phase 3: `status`를 owned command로 승격

브레인스토밍에서 `status`는 “필요가 생길 때까지 passthrough”였다. 이번 feature는 정확히 그 필요가 생긴 경우다 (`docs/brainstorms/2026-03-11-kqmd-brainstorm.md`).

- `src/types/command.ts`에서 `status`를 `OwnedCommand`에 편입한다.
- `src/commands/manifest.ts`와 `src/cli.ts`에서 status dispatch를 owned path로 옮긴다.
- `src/commands/owned/runtime.ts`에 `status` read policy를 추가한다.
  정책은 `search/query`와 같은 read-only reopen 정책이 자연스럽다: 기존 DB 우선, 없으면 config-file, 둘 다 없으면 `config-missing`.
- `src/commands/owned/status.ts`를 추가하고 아래 두 source를 합친다.
  - `store.getStatus()` 기반 index/collection stats
  - local `EmbeddingHealth` 기반 mismatch advisory
- device/GPU 정보는 upstream status와 같은 철학으로 best-effort로만 시도하고, 실패해도 command 전체를 깨뜨리지 않는다 (`node_modules/@tobilu/qmd/dist/cli/qmd.js`).

이번 전환은 “status 전체를 upstream와 byte-for-byte parity”로 복제하려는 작업이 아니다. 대신 K-QMD product policy를 드러내기 위해 필요한 정보만 stable하게 owned rendering으로 옮긴다. 그 과정에서 기존 smoke test가 `status`를 passthrough 증거로 쓰고 있으면 다른 command로 교체해야 한다 (`test/bin-smoke.test.ts`).

#### Phase 4: Command-specific UX hardening

이 단계는 브레인스토밍에서 정한 동작을 실제 command UX로 번역한다 (see brainstorm: `docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md`).

- `embed`
  - `store.embed()` 호출 시 `model: resolveEffectiveEmbedModel()`을 명시적으로 전달해 `content_vectors.model` metadata가 실제 정책과 어긋나지 않게 한다.
  - mismatch가 감지되고 `--force`가 없으면 조용한 no-op를 허용하지 말고, `qmd embed --force`를 안내하는 validation/runtime error로 막는다.
  - mismatch가 있고 `--force`가 있으면 재임베딩을 수행한다.
- `query`
  - mismatch가 감지되면 stderr 경고를 출력하되, 결과 검색은 계속 수행한다.
  - 경고는 stdout formatter를 오염시키지 않도록 stderr로만 보낸다. 특히 `--json`, `--xml` 같은 machine-readable output에 섞이면 안 된다.
  - model load / resolve failure가 발생하면 generic stack 대신 `qmd pull` 또는 explicit override를 안내하는 recovery copy를 붙인다.
- `update`
  - `needsEmbedding > 0`만 있을 때는 기존처럼 `qmd embed`를 안내한다.
  - mismatch health가 있으면 후속 안내를 `qmd embed --force`로 바꾼다.
- `search`
  - 현재 owned `search`는 lexical-only이므로, 이번 슬라이스에서는 mismatch warning을 추가하지 않는다.
  - embedding mismatch 경고를 `search`에 붙이면 사용자가 “지금 이 검색 결과가 vector를 쓰고 있다”고 오해할 수 있으므로, 이 경계는 명시적으로 유지한다.

#### Phase 5: Tests, docs, and boundary updates

이번 feature는 라우팅, bootstrap, formatter, advisory copy를 동시에 바꾸므로 테스트와 문서를 먼저-class로 다뤄야 한다.

- routing tests
  - `status`가 더 이상 passthrough가 아님을 반영한다.
- bin smoke test
  - passthrough 증거 command를 `status`에서 다른 passthrough command로 바꾼다.
- embedding policy tests
  - explicit env override가 있으면 K-QMD default를 덮어쓰는지 검증한다.
- health helper tests
  - clean / missing / mismatch / mixed-models 네 상태를 fixture DB 또는 충분히 작은 integration setup으로 검증한다.
- owned command tests
  - `embed` mismatch + no force → explicit advisory
  - `embed --force` → expected model argument propagation
  - `query` mismatch → stderr warning + stdout result coexistence
  - `update` mismatch → `qmd embed --force` guidance
  - `status` output snapshot → model + health section
- docs updates
  - `README.md`
  - `docs/development.md`
  - `docs/architecture/kqmd-command-boundary.md`
  - `docs/architecture/upstream-compatibility-policy.md`

## Alternative Approaches Considered

### Approach A: env bootstrap only, keep `status` passthrough

`bin/qmd.js`에서 `QMD_EMBED_MODEL`만 주입하고 나머지 UX는 그대로 둔다.

왜 기각했는가:
- legacy index mismatch를 `status`에서 드러낼 수 없다
- `embed`는 여전히 `--force` 없이 조용한 no-op가 가능하다
- `update` 후 안내가 계속 `qmd embed`로 남아 migration UX가 부정확하다

### Approach B: fresh index에만 Qwen default 적용

새 인덱스만 Qwen을 쓰고 기존 DB health는 신경 쓰지 않는다.

왜 기각했는가:
- `searchVec()`가 모델 필터 없이 vector row를 읽기 때문에 기존 인덱스 품질 회귀가 조용히 남는다
- 브레인스토밍에서 합의한 “기본값은 분명히 바꾸되, mismatch는 숨기지 않는다”와 어긋난다 (see brainstorm: `docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md`)

### Approach C: 첫 전환 시 자동 force re-embed

`embed` 또는 `query`에서 mismatch를 감지하면 자동으로 기존 vectors를 지우고 다시 만든다.

왜 기각했는가:
- 사용자의 기존 데이터를 자동으로 파괴하는 동작은 너무 공격적이다
- 모델 다운로드/실패/중단 시 partial state를 더 예측하기 어렵게 만든다
- 브레인스토밍에서 명시적으로 자동 migration을 피하기로 했다 (see brainstorm: `docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md`)

## SpecFlow Findings

이번 feature의 핵심 흐름은 네 가지다.

### Flow 1: Fresh install / zero-config happy path

1. 사용자가 `qmd pull`을 실행한다.
2. passthrough upstream CLI는 K-QMD가 bootstrap한 default env를 상속해 Qwen embedding model을 pull 후보에 포함한다.
3. 사용자가 `qmd update` 후 `qmd embed`를 실행한다.
4. `embed`는 effective model을 metadata와 함께 기록한다.
5. `qmd status`는 현재 기본 모델과 clean health를 보여 준다.

중요한 요구:
- default bootstrap은 import 이전에 적용되어야 한다
- `status`가 user-visible source of truth가 되어야 한다

### Flow 2: Existing index with non-effective-model vectors

1. 사용자가 이전 인덱스로 `qmd status`를 본다.
2. `status`는 vector row 존재만으로 healthy라고 말하지 않고 mismatch를 노출한다.
3. 사용자가 `qmd query`를 실행하면 stderr warning을 보되 결과는 계속 받는다.
4. 사용자가 `qmd embed`만 실행하면, command는 no-op 대신 `qmd embed --force`를 안내한다.
5. 사용자가 `qmd embed --force`를 실행하면 재임베딩이 시작된다.

중요한 요구:
- mismatch 경고는 stdout이 아니라 stderr여야 한다
- `embed`는 migration path의 중심 command여야 한다

### Flow 3: Partially repaired or mixed-model index

1. 일부 문서만 현재 effective model로 다시 임베딩되었거나 여러 model row가 섞여 있다.
2. `status`는 clean이 아니라 mixed-models로 보고해야 한다.
3. `query`는 경고 후 계속 수행한다.
4. `update`는 단순 `qmd embed`가 아니라 `qmd embed --force`를 권해야 한다.

중요한 요구:
- health helper는 단순 boolean이 아니라 mixed 상태를 구분해야 한다

### Flow 4: Effective model preparation failure

1. 사용자가 `query` 또는 `embed`를 실행한다.
2. model download 또는 load가 실패한다.
3. command는 기존 기본값으로 silent fallback 하지 않는다.
4. 대신 `qmd pull` 또는 explicit env override를 포함한 recovery guidance를 출력한다.

중요한 요구:
- generic thrown error를 그대로 노출하지 말고 product-level next step을 제공해야 한다

### Research Insights

**Best Practices:**
- zero-config happy path와 legacy mismatch path를 같은 helper output 위에서 설명해야 한다. 그렇지 않으면 `status`, `query`, `embed`, `update`가 서로 다른 truth를 말하게 된다.
- migration UX는 `embed --force` 하나로 수렴시키는 편이 가장 단순하다. 별도 repair command나 background auto-fix를 도입하면 사용자는 상태 추적이 더 어려워진다.

**Implementation Details:**
- `query` warning은 stderr-only snapshot을 별도로 두는 편이 좋다. stdout snapshot만으로는 machine-readable output 오염 여부를 검증할 수 없다.
- `embed` no-force mismatch path는 success formatter가 아니라 preflight validation/result branch로 구현해야 한다. 그래야 upstream embed result shape를 억지로 왜곡하지 않는다.

**Edge Cases:**
- `update` 직후 새 문서가 생기고 동시에 old-model vectors가 남아 있을 수 있다. 이 경우 안내 문구는 `qmd embed`가 아니라 `qmd embed --force`여야 한다.
- `status`를 owned로 옮긴 뒤에도 passthrough smoke test는 계속 유지되어야 한다. 다만 대상 command는 `status`가 아니라 다른 passthrough command여야 한다.

**References:**
- `docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md`
- `docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`

## System-Wide Impact

### Interaction Graph

이번 변경의 주요 호출 그래프는 아래와 같다.

1. `bin/qmd.js`가 effective embed env를 설치한다.
2. `src/cli.ts`가 route를 결정한다.
3. `status/query/update/embed`는 owned path로 들어간다.
4. owned command는 `withOwnedStore()`로 store를 연다.
5. command별로 `EmbeddingHealth`를 읽고 advisory policy를 적용한다.
6. `query/embed/update/status` formatter가 stdout/stderr를 분리해 최종 UX를 만든다.

`pull`, `collection`, `ls`, `get`, `multi-get`, `mcp`는 계속 passthrough지만, process env bootstrap의 영향을 받는다.

### Error & Failure Propagation

- bootstrap 단계 실패는 없어야 한다. env default 설치는 pure mutation 수준이어야 한다.
- runtime open 실패는 기존 `config-missing` / `store-open-failed` taxonomy를 그대로 사용한다 (`src/commands/owned/runtime.ts`).
- model load / resolve failure는 현재 main-level generic error로 새어 나갈 수 있으므로, command layer에서 user-facing recovery copy로 정규화해야 한다.
- status는 device/GPU 조회 실패가 있더라도 command 전체는 성공해야 한다. upstream status도 같은 철학을 쓴다 (`node_modules/@tobilu/qmd/dist/cli/qmd.js`).

### State Lifecycle Risks

- `embed --force`는 upstream 구현상 기존 vectors를 지운 뒤 다시 넣는다 (`node_modules/@tobilu/qmd/dist/store.js`).
- 중간 실패가 발생하면 partial re-embedding 상태가 남을 수 있다.
- 이번 feature는 이 partial state를 자동 복구하지 않지만, 최소한 `status/query/update`가 clean으로 오인하지 않도록 health helper가 계속 mismatch/missing을 계산해야 한다.

### API Surface Parity

- `status` route가 passthrough에서 owned로 옮겨간다. 이는 manifest, CLI routing tests, smoke tests, supported command list에 직접 영향을 준다 (`src/commands/manifest.ts`, `src/cli.ts`).
- `embed`와 `update` success copy는 더 이상 “벡터가 있느냐”만 보는 순진한 메시지로 남을 수 없다.
- `query`는 output parity 외에 stderr advisory channel을 새로 갖게 된다.
- `pull`은 명령 자체는 passthrough지만, K-QMD default env 정책의 영향을 받는 command로 문서화되어야 한다.

### Integration Test Scenarios

- current effective model과 다른 vectors가 들어 있는 DB에서 `qmd status`가 mismatch를 보여 준다.
- 같은 DB에서 `qmd query --json ...`이 stdout JSON은 유지하면서 stderr에만 advisory를 낸다.
- 같은 DB에서 `qmd embed`가 조용히 성공하지 않고 `qmd embed --force`를 안내한다.
- 같은 DB에서 `qmd embed --force`가 expected model argument로 실행된다.
- fresh env에서 passthrough `pull`이 K-QMD default embed model env를 상속한다.

### Research Insights

**Best Practices:**
- security 관점에서 passthrough delegation은 계속 `shell: false`를 유지해야 하고, effective model URI는 shell command 조합이 아니라 environment inheritance로만 전달하는 편이 안전하다.
- architecture 관점에서 `status` owned 전환은 단순 기능 추가가 아니라 command boundary 수정이므로, manifest와 supported command list가 single source of truth로 계속 남아야 한다.
- pattern consistency 관점에서 new helper 이름은 `embedding_policy`, `embedding_health`, `handleStatusCommand`처럼 현재 `owned/runtime/io` naming pattern에 맞추는 편이 좋다.

**Performance Considerations:**
- `status`와 `query`가 각각 health query를 독립 실행하더라도 invocation당 한 번으로 제한하면 충분하다. cross-command cache를 추가하는 것은 YAGNI에 가깝다.
- child process passthrough path는 여전히 `spawn()` 기반 비동기 경로를 유지해야 한다. sync execution으로 바꾸면 bin smoke나 future CLI UX 모두 더 느려진다.

**Security Considerations:**
- model URI는 사용자 override가 가능하므로, warning/log message에는 전체 env dump를 절대 남기지 않는다.
- health SQL은 정적 query만 사용하고, model comparison은 application layer에서 수행하는 편이 입력 조합을 단순하게 만든다.

**References:**
- Node.js `child_process.spawn()`: https://nodejs.org/api/child_process.html
- `docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`

## Acceptance Criteria

### Functional Requirements

- [x] `bin/qmd.js`가 `dist/cli.js` import 전에 K-QMD default embed model env를 설치한다.
- [x] explicit `QMD_EMBED_MODEL` env override가 있으면 K-QMD default보다 우선한다.
- [x] `status`는 owned command로 동작하며 effective model과 embedding health를 노출한다.
- [x] `embed`는 effective model을 metadata에 기록하도록 explicit model argument를 전달한다.
- [x] current effective model과 다른 stored vectors가 있을 때 `embed`는 `--force` 없이 조용히 통과하지 않고 `qmd embed --force`를 안내한다.
- [x] current effective model과 다른 stored vectors가 있을 때 `query`는 warning 후 계속 수행한다.
- [x] mismatch가 있을 때 `update` 후 안내는 `qmd embed --force`를 사용한다.
- [x] current lexical-only `search`는 이번 슬라이스에서 동작을 바꾸지 않는다.

### Non-Functional Requirements

- [x] automatic fallback은 없다.
- [x] automatic destructive migration도 없다.
- [x] `query` advisory는 stdout이 아닌 stderr만 사용한다.
- [x] `status` health check는 read-only command semantics를 유지한다.
- [x] bootstrap default는 fresh install과 published bin 경로에서 동일하게 작동한다.

### Quality Gates

- [x] routing, smoke, policy, health, formatter 테스트가 새 경계를 반영한다.
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run test:parity`
- [x] `npm run lint`
- [x] README와 architecture docs가 새 정책을 설명한다.

### Research Insights

**Best Practices:**
- quality gate는 “feature works”보다 “silent mismatch가 다시 숨지 않는다”에 맞춰야 한다. 그래서 advisory stderr와 no-force embed branch는 snapshot 또는 direct assertion으로 고정하는 편이 좋다.
- status owned 전환은 smoke test 한 개만으로 충분하지 않다. routing test, output snapshot, passthrough smoke 재배치가 같이 있어야 경계 drift를 막을 수 있다.

**Recommended Additional Checks:**
- `effective model` helper unit test: default vs env override precedence
- `EmbeddingHealth` helper test: clean / needs-embedding / model-mismatch / mixed-models
- `query --json` test: stdout JSON, stderr advisory 동시 검증
- `embed` mismatch preflight test: no-force guidance vs force path separation
- `status` output snapshot: model source, health summary, next-step copy 포함

## Success Metrics

- fresh install 사용자가 별도 env 설정 없이 Qwen 기반 embedding workflow를 밟을 수 있다.
- current effective model과 다른 stored vector 상태가 더 이상 silent failure로 남지 않는다.
- `status`, `query`, `embed`, `update`가 서로 모순되지 않는 recovery guidance를 제공한다.
- user-visible default model 설명이 문서, status, pull path에서 일관된다.

## Dependencies & Prerequisites

- existing owned runtime bootstrap이 이미 있으므로 이번 작업은 그 seam 위에서 진행한다 (`docs/plans/2026-03-11-feat-owned-command-runtime-bootstrap-plan.md`).
- `status` owned 전환은 command boundary 문서와 테스트 계약을 같이 갱신해야 한다 (`docs/architecture/kqmd-command-boundary.md`).
- exact Qwen URI pinning은 `src/config/embedding_policy.ts`에 한 번만 정의하고, upstream `llm.js` override example과 동일한
  `hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf`를 사용한다. 나머지 코드는 effective model helper만 참조해야 한다.
- `docs/solutions/patterns/critical-patterns.md`는 현재 저장소에 존재하지 않으므로, 이번 계획은 개별 solution docs와 existing architecture docs를 primary institutional source로 삼는다.

## Risk Analysis & Mitigation

- **Risk:** env bootstrap이 import 이후에 실행되어 default capture를 놓칠 수 있다.
  **Mitigation:** `bin/qmd.js`에서 dynamic import 전에 설치한다.
- **Risk:** 실제 effective model과 stored `content_vectors.model` metadata가 어긋날 수 있다.
  **Mitigation:** `embed`에서 effective model을 explicit argument로 전달한다.
- **Risk:** status를 owned로 옮기면서 passthrough contract tests가 깨진다.
  **Mitigation:** smoke test 대상을 다른 passthrough command로 교체하고 routing snapshots를 갱신한다.
- **Risk:** advisory가 JSON/XML output을 깨뜨릴 수 있다.
  **Mitigation:** warning은 stderr only로 고정하고 snapshot으로 검증한다.
- **Risk:** partial `--force` re-embed 후 상태 판단이 애매해질 수 있다.
  **Mitigation:** health helper가 mixed/missing 상태를 명시적으로 구분한다.
- **Risk:** generic execution exceptions가 main-level raw message로 새어 나간다.
  **Mitigation:** command layer에서 model-related execution error를 product-level recovery copy로 번역한다.

## Future Considerations

- owned `search`가 이후 semantic path를 쓰게 되면, 같은 `EmbeddingHealth` advisory를 재사용할 수 있다.
- upstream가 model-aware status / health API를 공개하면 로컬 SQL helper를 줄일 수 있다.
- 장기적으로 `pull`도 owned policy surface로 흡수할지 검토할 수 있지만, 이번 슬라이스에서는 passthrough를 유지한다.
- 이번 기능 완료 후 `docs/solutions/`에 “Qwen default rollout / mismatch advisory” learnings를 남기면 다음 vector policy 변경 때 재활용할 수 있다.

## Documentation Plan

- `README.md`
  - K-QMD의 기본 embedding model이 Qwen이라는 점
  - 기존 인덱스가 현재 기본값과 다르면 `qmd embed --force`가 필요할 수 있다는 점
- `docs/development.md`
  - 관련 테스트 명령과 새 snapshot 범위
- `docs/architecture/kqmd-command-boundary.md`
  - `status` owned 전환
  - embedding policy / health layer 추가
- `docs/architecture/upstream-compatibility-policy.md`
  - effective model precedence
  - passthrough env inheritance
  - mismatch advisory는 K-QMD product policy라는 점

## Sources & References

### Origin

- **Brainstorm document:** `docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md`
  - carried-forward decisions:
    - product-wide Qwen default
    - no automatic fallback
    - mismatch advisory with `qmd embed --force`
    - `status` exposes health, `query` warns and continues

### Internal References

- Product and architecture context
  - `README.md`
  - `docs/architecture/kqmd-command-boundary.md`
  - `docs/architecture/upstream-compatibility-policy.md`
  - `docs/plans/2026-03-11-feat-owned-command-runtime-bootstrap-plan.md`
- Current routing / command ownership
  - `bin/qmd.js`
  - `src/cli.ts`
  - `src/commands/manifest.ts`
  - `src/types/command.ts`
  - `src/passthrough/delegate.ts`
- Current owned command behavior
  - `src/commands/owned/query.ts`
  - `src/commands/owned/embed.ts`
  - `src/commands/owned/update.ts`
  - `src/commands/owned/runtime.ts`
  - `src/commands/owned/io/format.ts`
  - `src/commands/owned/io/errors.ts`
- Upstream package behavior
  - `node_modules/@tobilu/qmd/dist/llm.js`
  - `node_modules/@tobilu/qmd/dist/store.js`
  - `node_modules/@tobilu/qmd/dist/index.js`
  - `node_modules/@tobilu/qmd/dist/cli/qmd.js`
- Tests affected
  - `test/passthrough-contract.test.ts`
  - `test/bin-smoke.test.ts`
  - `test/owned-command-parity/mutation-output.test.ts`
  - `test/owned-command-parity/query-output.test.ts`

### Institutional Learnings

- `docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`
  - read-path side effects와 lifecycle ownership을 먼저 고정해야 한다는 점
- `docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`
  - conditional formatter branch와 silent no-op를 테스트로 막아야 한다는 점
- `docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md`
  - published bin / delegation smoke tests는 cross-platform contract를 유지해야 한다는 점

### External References

- 없음. 이번 계획은 현재 저장소 문서와 설치된 upstream `@tobilu/qmd` source로 충분히 grounded 된다.
