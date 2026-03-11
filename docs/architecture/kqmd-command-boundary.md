# K-QMD 명령 경계

K-QMD는 별도 병렬 CLI가 아니라 replacement distribution이다. 패키지 이름은 `kqmd`지만,
사용자에게 노출되는 명령은 계속 `qmd`다.

## 레이어 구분

1. `routing`
   [`src/commands/manifest.ts`](../../src/commands/manifest.ts)가
   owned 명령과 passthrough 명령의 단일 source of truth다.
2. `policy defaults`
   [`src/config/qmd_paths.ts`](../../src/config/qmd_paths.ts)가 upstream `qmd`와
   같은 설정/캐시/DB 경로 규칙을 유지한다.
3. `owned runtime`
   [`src/commands/owned/runtime.ts`](../../src/commands/owned/runtime.ts)가
   owned 명령용 index path 해석, store bootstrap, 공통 runtime 실패 분류를 담당한다.
4. `execution`
   owned 명령은 아직 사용자-facing 동작은 scaffold stub를 유지하지만, 이후 구현은 owned runtime을
   통해 store를 열게 된다. passthrough 명령은 계속 upstream `qmd` 바이너리를 직접 실행한다.

## 현재 owned 명령

- `search`
- `query`
- `update`
- `embed`

## 현재 passthrough 명령

- `collection`
- `status`
- `ls`
- `get`
- `multi-get`
- `mcp`
- help/version/명령 없음 진입점

## 가드레일

- owned runtime은 `search/query/embed`에서 기존 DB가 실제로 있을 때만 DB-only reopen을 허용한다
- owned runtime은 `update`에서 config가 없으면 DB 존재 여부와 무관하게 명시적으로 실패한다
- owned 명령은 실제 구현 전까지 shared upstream 상태를 바꾸지 않는다
- passthrough는 argv, stdio, exit code를 최대한 그대로 보존한다
- 알 수 없는 명령은 조용히 추측하지 말고 명시적으로 실패한다
