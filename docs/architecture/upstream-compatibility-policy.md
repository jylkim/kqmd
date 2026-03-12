# Upstream 호환 정책

K-QMD는 upstream `@tobilu/qmd`를 vendored runtime source가 아니라 **추적 기준선**으로 본다.

## 현재 맞추는 것

- upstream `qmd` 실행 파일 탐색 방식
- `QMD_CONFIG_DIR` 기반 설정 경로 override
- `INDEX_PATH` 기반 DB 경로 override
- XDG 기반 config/cache fallback
- 현재 passthrough 명령 표면
- `createStore({ dbPath, configPath? })` 기반 owned runtime bootstrap 계약
- `search/query/update/embed`의 parse/validation/output parity baseline

## 아직 하지 않는 것

- upstream 소스 코드를 이 저장소로 들여와 직접 수정하기
- 무거운 fork 운영
- 모든 `qmd` 명령 재구현

## drift 대응 원칙

- 어떤 명령을 owned/passthrough로 둘지는 로컬 manifest에서 관리한다
- path compatibility 테스트는 설치된 upstream 패키지 동작과 비교한다
- publish 검증에는 `npm pack --dry-run`을 포함해 `qmd` bin, `files` allowlist,
  build 산출 계약을 같이 확인한다
- owned command parity는 `npm run test:parity`와 baseline metadata로 고정한다
- owned runtime은 upstream의 DB-only mode를 그대로 신뢰하지 않고, K-QMD policy로
  "기존 DB가 실제로 있을 때만 reopen" 규칙을 추가한다
- `search/query`는 config-file mode보다 기존 DB reopen을 우선해 read path metadata sync side effect를 줄인다
- upstream private CLI 경로(`@tobilu/qmd/dist/cli/*`)는 직접 import하지 않고 local adapter로 semantics를 반영한다

## delegate 실행 원칙

- passthrough 실행은 `shell: false`인 직접 spawn을 기본으로 둔다
- 실제 CLI 경로에서는 stdio를 그대로 상속한다
- 테스트와 로컬 검증을 위해 `KQMD_UPSTREAM_BIN` override를 허용한다

## owned runtime 실행 원칙

- owned runtime은 config-file mode와 DB-only mode를 명시적으로 구분한다
- `search`, `query`는 config가 있더라도 기존 DB가 있으면 DB-only reopen을 우선한다
- `embed`는 config가 없더라도 기존 DB가 있으면 DB-only reopen을 허용한다
- `update`는 collection 정의가 필요하므로 config가 없으면 명시적으로 실패한다
- preflight는 `createStore()` 호출 전에 수행해 빈 DB가 조용히 생성되는 일을 막는다

## owned command parity 실행 원칙

- `search/query/update/embed`는 공통 typed parser와 validation path를 사용한다
- format precedence는 upstream CLI 기준(`csv > md > xml > files > json > cli`)으로 고정한다
- `search/query` success output은 snapshot fixtures로 고정한다
- `update/embed`는 progress-level parity 대신 success summary shape를 우선 고정한다
- upstream `@tobilu/qmd` 버전이 바뀌면 `test/fixtures/owned-command-parity/baseline.json`과 parity suite를 함께 갱신한다
