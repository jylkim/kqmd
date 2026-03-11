# K-QMD

K-QMD는 기존 `qmd` 사용 습관을 바꾸지 않으면서 한국어 검색 지원을 강화하기 위한
`qmd-compatible replacement distribution` 프로젝트입니다. 패키지는 `kqmd`로 배포하지만,
사용자가 실제로 실행하는 명령은 계속 `qmd`입니다.

## 이 프로젝트가 하려는 일

- 사용자가 새 CLI 이름을 외우지 않아도 되게 한다
- upstream `qmd`와 같은 설정/DB/캐시 경로를 공유한다
- 한국어 지원이 필요한 명령만 별도로 소유할 수 있는 경계를 만든다
- 나머지 저위험 명령은 upstream `qmd`로 그대로 위임한다

## 현재 상태

지금 저장소는 **스캐폴딩 단계**입니다. 즉, 한국어 검색 품질 개선 로직은 아직 구현되지 않았고,
다음 스프린트에서 붙일 수 있도록 CLI 경계, 패키징, 테스트, 문서 구조만 먼저 세운 상태입니다.

따라서 현재 README는 "지금 당장 일반 사용자가 설치해서 쓰는 완성 도구" 소개 문서라기보다,
이 프로젝트가 어떤 방향의 배포판인지 설명하는 사용자 중심 개요 문서입니다.

## 지금 동작하는 범위

### K-QMD가 소유하는 명령

아래 명령은 앞으로 K-QMD가 직접 구현할 표면입니다. 현재는 의도적으로 stub 상태입니다.

- `search`
- `query`
- `update`
- `embed`

### upstream로 위임하는 명령

아래 명령은 현재 upstream `qmd`로 passthrough 됩니다.

- `collection`
- `status`
- `ls`
- `get`
- `multi-get`
- `mcp`

## 사용자 관점에서 알아둘 점

- 설치 패키지 이름은 `kqmd`지만, 실행 명령은 `qmd`입니다
- 설정 경로는 upstream `qmd`와 동일하게 유지합니다
- 아직 `search/query/update/embed`는 실제 한국어 기능이 아니라 scaffold stub입니다
- 따라서 현재 시점의 저장소는 **실사용 완성본**보다는 **다음 구현 스프린트를 위한 기반**에 가깝습니다

## 문서 안내

개발자용 문서는 README에서 분리했습니다.

- 개발 환경과 스크립트: [docs/development.md](docs/development.md)
- 명령 소유 경계: [docs/architecture/kqmd-command-boundary.md](docs/architecture/kqmd-command-boundary.md)
- upstream 호환 정책: [docs/architecture/upstream-compatibility-policy.md](docs/architecture/upstream-compatibility-policy.md)
- 구현 계획: [docs/plans/2026-03-11-feat-kqmd-replacement-distribution-scaffold-plan.md](docs/plans/2026-03-11-feat-kqmd-replacement-distribution-scaffold-plan.md)

## 다음 단계

다음 스프린트에서는 지금 만들어 둔 owned command 경계를 유지한 채,
`search/query/update/embed`에 실제 한국어 지원 동작을 붙이는 것이 목표입니다.
