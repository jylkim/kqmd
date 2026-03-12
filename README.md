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

지금 저장소는 **첫 한국어 lexical recall 기능이 들어간 초기 구현 단계**입니다.
CLI 경계, 패키징, 테스트, 문서 구조 위에, `qmd search`의 한글 복합어/붙여쓰기 recall을 높이기 위한
Kiwi 기반 shadow FTS 경로가 추가되어 있습니다.

따라서 현재 README는 "지금 당장 일반 사용자가 설치해서 쓰는 완성 도구" 소개 문서라기보다,
이 프로젝트가 어떤 방향의 배포판인지 설명하는 사용자 중심 개요 문서입니다.

## 지금 동작하는 범위

### K-QMD가 소유하는 명령

아래 명령은 K-QMD가 직접 소유하는 표면입니다. 현재는 upstream-compatible I/O contract와
runtime bootstrap 경로까지 연결되어 있습니다.

- `search`
- `query`
- `update`
- `embed`
- `status`

### upstream로 위임하는 명령

아래 명령은 현재 upstream `qmd`로 passthrough 됩니다.

- `collection`
- `ls`
- `get`
- `multi-get`
- `mcp`

## 사용자 관점에서 알아둘 점

- 설치 패키지 이름은 `kqmd`지만, 실행 명령은 `qmd`입니다
- 설정 경로는 upstream `qmd`와 동일하게 유지합니다
- `search/query/update/embed`는 fixed stub는 아니며, 공통 parse/validation/output contract 위에서 동작합니다
- 기본 embedding model은 upstream override 예시와 같은 Qwen3 URI를 zero-config 기본값으로 사용합니다
- 사용자가 `QMD_EMBED_MODEL`을 직접 지정하면 그 값이 effective model이 됩니다
- 기존 인덱스의 stored vectors가 현재 effective model과 다르면 `status/query/embed/update`가 mismatch를 감지하고
  `qmd embed --force`를 안내합니다
- `search`는 Kiwi 기반 한국어 shadow FTS를 사용해 `형태소 분석`/`형태소분석기`, `모델`/`거대언어모델`
  같은 복합어 recall을 개선합니다
- Korean search shadow index가 없거나 현재 policy와 어긋나면 `status`가 이를 드러내고, `search`는 경고 후 legacy lexical path로 fallback 합니다
- `update`는 upstream 문서 스캔 뒤 K-QMD-owned Korean shadow index를 rebuild 합니다
- 다만 아직 사용자 사전, 동의어 사전, 한글 전용 ranking, `query` 경로의 의미 검색 개선은 첫 릴리스 범위 밖입니다

## 문서 안내

개발자용 문서는 README에서 분리했습니다.

- 개발 환경과 스크립트: [docs/development.md](docs/development.md)
- 명령 소유 경계: [docs/architecture/kqmd-command-boundary.md](docs/architecture/kqmd-command-boundary.md)
- upstream 호환 정책: [docs/architecture/upstream-compatibility-policy.md](docs/architecture/upstream-compatibility-policy.md)
- 구현 계획: [docs/plans/2026-03-11-feat-kqmd-replacement-distribution-scaffold-plan.md](docs/plans/2026-03-11-feat-kqmd-replacement-distribution-scaffold-plan.md)

## 다음 단계

다음 단계는 첫 lexical recall 기능을 더 단단하게 만드는 것입니다. 특히:

- `search` shadow index의 rebuild 비용 최적화
- quoted/negated Korean query edge case 보강
- user dictionary / synonym 정책 검토
- `query` 경로와 lexical Korean policy의 장기 관계 정리
