# Korean Search Recall Benchmark

Date: 2026-03-25
Command: `bun run benchmark:search-recall`

QMD의 search 명령에서 한국어 검색 품질을 비교한 벤치마크입니다.
복합어 분리, 한영 혼합 두 가지 한국어 패턴에서 QMD 대비 K-QMD의 검색 결과를 비교합니다.

## 테스트 방법

- synthetic fixture 문서 8개 + noise 문서 10개에 대해 QMD와 K-QMD의 search 결과를 비교합니다.
- hit: target 문서가 검색 결과(limit=20)에 포함되면 검색 성공입니다.
- miss: target 문서가 검색 결과에 없으면 검색 실패입니다.

## 결과

| 패턴 | 쿼리 | 문서 내용 | QMD | K-QMD |
|---|---|---|:---:|:---:|
| 복합어 | 스크립트 | 빌드**스크립트**를 리팩토링하고 캐싱 전략을 최적화했습니다. | miss | **hit** |
| 복합어 | 에이전트 | 서브**에이전트** 패턴으로 멀티에이전트 시스템을 구성합니다. | miss | **hit** |
| 복합어 | 프롬프트 | 시스템**프롬프트** 주입 기능과 맥락 관리가 핵심 요구사항입니다. | miss | **hit** |
| 복합어 | 공격 | 공급망**공격** 방지를 위해 의존성 무결성 검증 절차를 도입했습니다. | miss | **hit** |
| 복합어 | 취약점 | 보안**취약점** 스캔 결과를 감사 로그에 기록합니다. | miss | **hit** |
| 복합어 | 힌트 | 타입**힌트**를 Python 3.10+ 문법으로 모더나이제이션했습니다. | miss | **hit** |
| 복합어 | 토큰 | Tailwind설정과 디자인**토큰** 통합을 완료했습니다. | miss | **hit** |
| 복합어 | 커버리지 | 리팩토링이 완료된 모듈의 테스트**커버리지**를 확인했습니다. | miss | **hit** |
| 복합어 | 분석 | 정적**분석** 도구를 PMD에서 SonarQube로 전환하는 안건을 논의했습니다. | miss | **hit** |
| 복합어 | 추적 | 분산**추적** 설정과 메트릭수집 파이프라인을 구축합니다. | miss | **hit** |
| 복합어 | 수집 | 분산추적 설정과 메트릭**수집** 파이프라인을 구축합니다. | miss | **hit** |
| 복합어 | 소싱 | SQLite에 이벤트**소싱** 패턴을 적용하여 상태를 관리합니다. | miss | **hit** |
| 한영 혼합 | 파이프라인 | Jenkins**파이프라인**에서 GitHub Actions로 전환을 진행했습니다. | miss | **hit** |
| 한영 혼합 | 이미지 | Docker**이미지** 빌드 시간이 40% 단축되었습니다. | miss | **hit** |
| 한영 혼합 | 실행 | pytest**실행** 환경을 uv로 전환했습니다. | miss | **hit** |
| 한영 혼합 | 린팅 | ruff**린팅** 규칙을 추가하고 기존 pylint 설정을 대체했습니다. | miss | **hit** |
| 한영 혼합 | 설정 | Tailwind**설정**과 디자인토큰 통합을 완료했습니다. | miss | **hit** |
| 한영 혼합 | 문서화 | Storybook**문서화**를 추가하여 컴포넌트 카탈로그를 구축합니다. | miss | **hit** |
| 한영 혼합 | 대시보드 | Grafana**대시보드**에 API 레이턴시와 에러율 패널을 추가합니다. | miss | **hit** |
| 한영 혼합 | 바인딩 | PyO3**바인딩**으로 Python에서 Rust 코어를 호출합니다. | miss | **hit** |

### 기준선 (양쪽 모두 hit)

| 쿼리 | 문서 내용 | QMD | K-QMD |
|---|---|:---:|:---:|
| Jenkins | **Jenkins**파이프라인에서 GitHub Actions로 전환을 진행했습니다. | hit | hit |
| 샌드박싱 | seccomp필터와 Landlock LSM을 결합한 다층 방어를 구현합니다. | hit | hit |
| pytest | **pytest**실행 환경을 uv로 전환했습니다. | hit | hit |
| Grafana | **Grafana**대시보드에 API 레이턴시와 에러율 패널을 추가합니다. | hit | hit |
| 리팩토링 | **리팩토링**이 완료된 모듈의 테스트커버리지를 확인했습니다. | hit | hit |
| Tower | 이벤트드리븐 아키텍처를 **Tower** 미들웨어로 구현했습니다. | hit | hit |

## 요약

| | Hits | Total | Recall |
|---|---:|---:|---:|
| QMD | 6 | 26 | 23% |
| K-QMD | 26 | 26 | **100%** |

## Notes

- deterministic tokenize stub를 사용하므로, 실제 Kiwi 형태소 분석과 결과가 다를 수 있습니다.
- 기준선 카테고리는 양쪽 모두 hit이어야 하는 sanity check 쿼리입니다.
- 아래 JSON은 전체 측정 데이터입니다.

```json
{
  "rows": [
    {
      "category": "compound",
      "query": "스크립트",
      "targetDoc": "docs/devops-deploy.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "에이전트",
      "targetDoc": "docs/agent-architecture.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "프롬프트",
      "targetDoc": "docs/agent-architecture.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "공격",
      "targetDoc": "docs/security-sandbox.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "취약점",
      "targetDoc": "docs/security-sandbox.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "힌트",
      "targetDoc": "docs/python-migration.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "토큰",
      "targetDoc": "docs/frontend-sprint.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "커버리지",
      "targetDoc": "docs/meeting-review.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "분석",
      "targetDoc": "docs/meeting-review.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "추적",
      "targetDoc": "docs/observability-guide.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "수집",
      "targetDoc": "docs/observability-guide.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "소싱",
      "targetDoc": "docs/rust-sdk.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "파이프라인",
      "targetDoc": "docs/devops-deploy.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "이미지",
      "targetDoc": "docs/devops-deploy.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "실행",
      "targetDoc": "docs/python-migration.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "린팅",
      "targetDoc": "docs/python-migration.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "설정",
      "targetDoc": "docs/frontend-sprint.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "문서화",
      "targetDoc": "docs/frontend-sprint.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "대시보드",
      "targetDoc": "docs/observability-guide.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "바인딩",
      "targetDoc": "docs/rust-sdk.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "baseline",
      "query": "Jenkins",
      "targetDoc": "docs/devops-deploy.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "baseline",
      "query": "샌드박싱",
      "targetDoc": "docs/security-sandbox.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "baseline",
      "query": "pytest",
      "targetDoc": "docs/python-migration.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "baseline",
      "query": "Grafana",
      "targetDoc": "docs/observability-guide.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "baseline",
      "query": "리팩토링",
      "targetDoc": "docs/meeting-review.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "baseline",
      "query": "Tower",
      "targetDoc": "docs/rust-sdk.md",
      "upstreamHit": true,
      "shadowHit": true
    }
  ],
  "aggregate": [
    {
      "side": "upstream",
      "hits": 6,
      "total": 26,
      "recall": 23
    },
    {
      "side": "shadow",
      "hits": 26,
      "total": 26,
      "recall": 100
    }
  ]
}
```
