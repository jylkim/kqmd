# K-QMD 명령 경계

K-QMD는 별도 병렬 CLI가 아니라 replacement distribution이다. 패키지 이름은 `kqmd`지만,
사용자에게 노출되는 명령은 계속 `qmd`다.

## 레이어 구분

1. `routing`
   [`src/commands/manifest.ts`](../../src/commands/manifest.ts)가
   owned 명령과 passthrough 명령의 단일 source of truth다.
2. `policy defaults`
   [`src/config/qmd_paths.ts`](../../src/config/qmd_paths.ts)가 upstream `qmd`와
   같은 설정/캐시/DB 경로 규칙을 유지하고,
   [`src/config/embedding_policy.ts`](../../src/config/embedding_policy.ts)가
   `effective model = QMD_EMBED_MODEL override ?? K-QMD default` 규칙을 유지한다.
   [`src/config/search_policy.ts`](../../src/config/search_policy.ts)는 current Korean lexical shadow index policy를 정의한다.
3. `owned runtime`
   [`src/commands/owned/runtime.ts`](../../src/commands/owned/runtime.ts)가
   owned 명령용 index path 해석, store bootstrap, 공통 runtime 실패 분류를 담당한다.
   `search/query/status`는 기존 DB가 있으면 DB-only reopen을 우선하고, DB가 없을 때만 config-file mode로
   bootstrap 한다.
4. `execution`
   owned 명령은 공통 parse/validation/output parity contract를 통해 실행된다.
   `search/query/update/embed/status/mcp`는 더 이상 fixed scaffold stderr만 반환하지 않고,
   owned runtime과 formatter layer를 거쳐 동작한다. `mcp`는 local MCP server boundary를 소유하고,
   passthrough 명령은 계속 upstream `qmd` 바이너리를 직접 실행한다.
5. `Korean lexical shadow index`
   [`src/commands/owned/search_shadow_index.ts`](../../src/commands/owned/search_shadow_index.ts)가
   same-DB `kqmd_documents_fts`를 소유한다. upstream `documents_fts`는 read-only baseline으로 남고,
   `update`가 shadow index를 rebuild 하며, `search`는 health가 clean일 때만 이를 사용한다.

## 현재 owned 명령

- `search`
- `query`
- `update`
- `embed`
- `status`
- `mcp`
- `cleanup`

## 현재 passthrough 명령

- `collection`
- `ls`
- `get`
- `multi-get`
- `skill`
- `context`
- `vsearch`
- `pull`
- help/version/명령 없음 진입점

## 가드레일

- owned runtime은 `search/query`에서 config가 있더라도 기존 DB가 실제로 있으면 DB-only reopen을 우선한다
- owned runtime은 `status`에서 `search/query`와 같은 read-path reopen policy를 따른다
- owned runtime은 `embed`에서 기존 DB가 실제로 있을 때만 DB-only reopen을 허용한다
- owned runtime은 `update`에서 config가 없으면 DB 존재 여부와 무관하게 명시적으로 실패한다
- owned command는 stored vector model과 current effective model이 다를 때 mismatch health를 드러낸다
- owned command는 current Korean search policy와 shadow index 상태가 다를 때 search policy health를 드러낸다
- owned `search`는 한글 query에서 clean shadow index를 우선하고, stale/untracked 상태면 경고 후 legacy lexical path로 fallback 한다
- owned `query`는 plain short-korean / mixed-technical query에서만 clean Korean shadow index를 search-assist rescue로 사용하고, quoted/negated syntax 또는 dirty search health에서는 보수적으로 skip 한다
- owned `query`/`search`는 conservative lexical syntax와 clean-shadow gating contract를 공유하며, `query`의 rescue provenance는 별도 `searchAssist` metadata로만 노출한다
- owned `update`는 upstream document scan 뒤 `kqmd_documents_fts`를 rebuild 한다
- owned `cleanup`는 upstream cleanup 뒤 `kqmd_documents_fts`를 rebuild하여 orphaned shadow rowid를 제거한다
- owned `mcp`는 upstream-compatible tool/resource names와 PID/log path를 유지하되, `query/status` semantics는 local policy를 사용한다
- owned `mcp` query surface는 plain `query` string과 structured `searches[]`를 모두 받아 CLI `query`와 같은 validation/adaptive policy를 최대한 재사용한다
- owned command I/O contract는 upstream `@tobilu/qmd` CLI parse/validation/output semantics를 기준선으로 둔다
- owned 명령은 private upstream CLI formatter 경로를 직접 import하지 않는다
- passthrough는 argv, stdio, exit code를 최대한 그대로 보존한다
- 알 수 없는 명령은 조용히 추측하지 말고 명시적으로 실패한다
