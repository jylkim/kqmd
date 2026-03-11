# Upstream 호환 정책

K-QMD는 upstream `@tobilu/qmd`를 vendored runtime source가 아니라 **추적 기준선**으로 본다.

## 현재 맞추는 것

- upstream `qmd` 실행 파일 탐색 방식
- `QMD_CONFIG_DIR` 기반 설정 경로 override
- `INDEX_PATH` 기반 DB 경로 override
- XDG 기반 config/cache fallback
- 현재 passthrough 명령 표면

## 아직 하지 않는 것

- upstream 소스 코드를 이 저장소로 들여와 직접 수정하기
- 무거운 fork 운영
- 모든 `qmd` 명령 재구현

## drift 대응 원칙

- 어떤 명령을 owned/passthrough로 둘지는 로컬 manifest에서 관리한다
- path compatibility 테스트는 설치된 upstream 패키지 동작과 비교한다
- publish 검증에는 `npm pack --dry-run`을 포함해 `qmd` bin, `files` allowlist,
  build 산출 계약을 같이 확인한다

## delegate 실행 원칙

- passthrough 실행은 `shell: false`인 직접 spawn을 기본으로 둔다
- 실제 CLI 경로에서는 stdio를 그대로 상속한다
- 테스트와 로컬 검증을 위해 `KQMD_UPSTREAM_BIN` override를 허용한다

