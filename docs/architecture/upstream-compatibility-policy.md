# Upstream 호환 정책

K-QMD는 upstream `@tobilu/qmd`를 vendored runtime source가 아니라 **추적 기준선**으로 본다.

## 현재 맞추는 것

- upstream `qmd` 실행 파일 탐색 방식
- `QMD_CONFIG_DIR` 기반 설정 경로 override
- `INDEX_PATH` 기반 DB 경로 override
- XDG 기반 config/cache fallback
- 현재 passthrough CLI 명령 표면 (command surface coverage contract test로 검증)

- `createStore({ dbPath, configPath? })` 기반 owned runtime bootstrap 계약
- `search/query/update/embed`의 parse/validation/output parity baseline
- `mcp`의 tool/resource names, route paths, PID/log path conventions
- `QMD_EMBED_MODEL` override precedence와 K-QMD default embed bootstrap
- same-DB Korean lexical shadow FTS ownership과 `store_config` metadata policy

## 아직 하지 않는 것

- upstream 소스 코드를 이 저장소로 들여와 직접 수정하기
- 무거운 fork 운영
- 모든 `qmd` 명령 재구현

## drift 대응 원칙

- 어떤 명령을 owned/passthrough로 둘지는 로컬 manifest에서 관리한다
- contract test가 upstream `qmd.js` 소스에서 command를 직접 추출하여 manifest와의 drift를 방지한다
- path compatibility 테스트는 설치된 upstream 패키지 동작과 비교한다
- publish 검증에는 `bun pm pack --dry-run`과 actual tarball smoke를 포함해 `qmd` bin,
  `files` allowlist, build 산출 계약을 같이 확인한다
- owned command parity는 `bun run test:parity`와 baseline metadata로 고정한다
- owned runtime은 upstream의 DB-only mode를 그대로 신뢰하지 않고, K-QMD policy로
  "기존 DB가 실제로 있을 때만 reopen" 규칙을 추가한다
- `search/query`는 config-file mode보다 기존 DB reopen을 우선해 read path metadata sync side effect를 줄인다
- upstream private CLI 경로(`@tobilu/qmd/dist/cli/*`)는 직접 import하지 않고 local adapter로 semantics를 반영한다
- upstream MCP surface는 tool/resource names와 transport routes를 기준선으로 삼되, local MCP adapter가 execution semantics를 소유할 수 있다
- intentional MCP divergence는 [`docs/architecture/mcp-divergence-registry.md`](./mcp-divergence-registry.md)에 기록한다
- default embedding model은 upstream `llm.js` override example과 같은
  `hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf`를 사용하되,
  explicit `QMD_EMBED_MODEL` override가 항상 우선한다
- upstream `documents_fts`는 직접 변경하지 않고 baseline으로 남긴다
- Korean lexical recall은 K-QMD-owned `kqmd_documents_fts` shadow table로 구현한다
- shadow FTS metadata는 upstream DB의 `store_config`를 재사용하되, key namespace는 `kqmd_*`로 구분한다

## delegate 실행 원칙

- passthrough 실행은 `shell: false`인 직접 spawn을 기본으로 둔다
- 실제 CLI 경로에서는 stdio를 그대로 상속한다
- 테스트와 로컬 검증을 위해 `KQMD_UPSTREAM_BIN` override를 허용한다
- bin smoke에서는 top-level `qmd` entrypoint와 delegated upstream fixture를 모두 explicit Node runtime으로 검증한다
- passthrough subprocess는 현재 process env를 상속하므로 embed model default bootstrap도 동일하게 전달된다

## owned MCP 실행 원칙

- `qmd mcp`는 local ownership boundary다
- stdio mode의 stdout은 MCP protocol 전용으로 유지한다
- HTTP mode는 localhost bind를 기본값으로 두고, `/mcp`, `/health`, `/query`, `/search`를 upstream-compatible route로 유지한다
- HTTP mode는 `Origin`이 있을 때 exact self-origin(`http://<host:port>`)만 허용한다
- MCP daemon은 upstream-compatible PID/log path를 사용한다
- `query/status` tool semantics는 K-QMD-owned policy를 따르고, `get/multi_get`는 thin adapter로 upstream-compatible retrieval semantics를 유지한다

## owned runtime 실행 원칙

- owned runtime은 config-file mode와 DB-only mode를 명시적으로 구분한다
- `search`, `query`는 config가 있더라도 기존 DB가 있으면 DB-only reopen을 우선한다
- `status`는 `search`, `query`와 같은 read-path reopen policy를 따른다
- `embed`는 config가 없더라도 기존 DB가 있으면 DB-only reopen을 허용한다
- `update`는 collection 정의가 필요하므로 config가 없으면 명시적으로 실패한다
- preflight는 `createStore()` 호출 전에 수행해 빈 DB가 조용히 생성되는 일을 막는다
- stored vector rows의 `model` 값과 current effective model이 다르면 owned command가 mismatch health와 recovery guidance를 제공한다
- search shadow index는 same-DB transaction으로 rebuild 하고, clean 상태가 아닐 때는 `search`가 legacy lexical path로 fallback 한다
- Korean search policy drift 판단은 `documents`, `content`, `store_config`, `QMDStore.internal` contract 위에서 수행한다

## owned command parity 실행 원칙

- `search/query/update/embed`는 공통 typed parser와 validation path를 사용한다
- format precedence는 upstream CLI 기준(`csv > md > xml > files > json > cli`)으로 고정한다
- `search/query` success output은 snapshot fixtures로 고정한다
- `update/embed`는 progress-level parity 대신 success summary shape를 우선 고정한다
- upstream `@tobilu/qmd` 버전이 바뀌면 `test/fixtures/owned-command-parity/baseline.json`과 parity suite를 함께 갱신한다
- shadow FTS helper는 local implementation이지만, user-visible search formatter contract는 기존 parity baseline을 유지한다

## Bun-first 레포 운영 원칙

- repository toolchain의 canonical package manager는 Bun이다
- package script 실행은 항상 `bun run <script>` 형태를 사용한다
- lockfile migration과 install trust audit은 `bun pm migrate`, `bun pm untrusted`, `bun pm trust` 기준으로 관리한다
- `trustedDependencies`는 exact allowlist와 rationale을 함께 관리한다
- `run.bun` 또는 Bun runtime forcing은 baseline이 아니라 호환성 검증 뒤 opt-in 으로만 다룬다
- published `bin/qmd.js`는 계속 Node-compatible contract를 유지한다
