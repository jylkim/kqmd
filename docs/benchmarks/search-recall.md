# Korean Search Recall Benchmark

Date: 2026-03-23
Command: `bun run benchmark:search-recall`

QMD의 search 명령에서 한국어 검색 품질을 비교한 벤치마크입니다.
복합어 분리, 조사 제거, 한영 혼합 세 가지 한국어 패턴에서 QMD 대비 K-QMD의 검색 결과를 비교합니다.

## 테스트 방법

- synthetic fixture 문서 8개 + noise 문서 10개에 대해 QMD와 K-QMD의 search 결과를 비교합니다.
- hit: target 문서가 검색 결과(limit=20)에 포함되면 검색 성공입니다.
- miss: target 문서가 검색 결과에 없으면 검색 실패입니다.

## 결과

| 패턴 | 쿼리 | 문서 내용 | QMD | K-QMD |
|---|---|---|:---:|:---:|
| 복합어 | 분석 | 형태소**분석**기와 거대언어모델을 비교하는 실험 문서입니다. | miss | **hit** |
| 복합어 | 모델 | 형태소분석기와 거대언어**모델**을 비교하는 실험 문서입니다. | miss | **hit** |
| 복합어 | 형태소 | **형태소**분석기와 거대언어모델을 비교하는 실험 문서입니다. | hit | hit |
| 복합어 | 처리 | 자연어**처리** 파이프라인 설계를 다룹니다. | miss | **hit** |
| 복합어 | 에이전트 | 서브**에이전트** 패턴으로 마이크로서비스를 구성합니다. | miss | **hit** |
| 복합어 | 서비스 | 서브에이전트 패턴으로 마이크로**서비스**를 구성합니다. | miss | **hit** |
| 복합어 | 브로커 | 데이터베이스 스키마와 메시지**브로커** 설정을 포함합니다. | miss | **hit** |
| 복합어 | 밸런서 | 로드**밸런서** 뒤에 오토스케일링 그룹을 배치합니다. | miss | **hit** |
| 복합어 | 스케일링 | 로드밸런서 뒤에 오토**스케일링** 그룹을 배치합니다. | miss | **hit** |
| 복합어 | 오케스트레이션 | 컨테이너**오케스트레이션** 플랫폼으로 운영합니다. | miss | **hit** |
| 복합어 | 케이스 | 테스트**케이스**에 엣지케이스를 포함합니다. | miss | **hit** |
| 조사 | 프레임워크 | 에이전트가 필요합니다. **프레임워크**를 선택해야 합니다. | hit | hit |
| 조사 | 오케스트레이터 | **오케스트레이터**는 에이전트를 관리합니다. | hit | hit |
| 조사 | 미들웨어 | **미들웨어**를 구성하고 샌드박스는 격리하며 운영합니다. | hit | hit |
| 조사 | 샌드박스 | 미들웨어를 구성하고 **샌드박스**는 격리하며 운영합니다. | hit | hit |
| 조사 | 가드레일 | 파이프라인의 **가드레일**을 설정합니다. | hit | hit |
| 조사 | 리팩토링 | **리팩토링**이 완료되면 커버리지를 확인합니다. | hit | hit |
| 조사 | 커버리지 | 리팩토링이 완료되면 **커버리지**를 확인합니다. | hit | hit |
| 한영 혼합 | 연동 | API**연동** 가이드와 OAuth인증 설정을 정리합니다. | miss | **hit** |
| 한영 혼합 | 인증 | API연동 가이드와 OAuth**인증** 설정을 정리합니다. | miss | **hit** |
| 한영 혼합 | 엔드포인트 | REST**엔드포인트**와 GraphQL스키마를 비교합니다. | miss | **hit** |
| 한영 혼합 | 스키마 | REST엔드포인트와 GraphQL**스키마**를 비교합니다. | miss | **hit** |
| 한영 혼합 | 파이프라인 | CI**파이프라인** 구축과 Docker컨테이너 배포를 다룹니다. | miss | **hit** |
| 한영 혼합 | 컨테이너 | CI파이프라인 구축과 Docker**컨테이너** 배포를 다룹니다. | miss | **hit** |
| 한영 혼합 | 클러스터 | Kubernetes**클러스터** 운영 노하우를 공유합니다. | miss | **hit** |

### 기준선 (양쪽 모두 hit)

| 쿼리 | 문서 내용 | QMD | K-QMD |
|---|---|:---:|:---:|
| 형태소분석기 | **형태소분석기**와 거대언어모델을 비교하는 실험 문서입니다. | hit | hit |
| 데이터베이스 | **데이터베이스** 스키마와 메시지브로커 설정을 포함합니다. | hit | hit |
| 필요합니다 | 에이전트가 **필요합니다**. 프레임워크를 선택해야 합니다. | hit | hit |
| API | **API**연동 가이드와 OAuth인증 설정을 정리합니다. | hit | hit |
| 설정 | 파이프라인의 가드레일을 **설정**합니다. | hit | hit |

## 요약

| | Hits | Total | Recall |
|---|---:|---:|---:|
| QMD | 13 | 30 | 43% |
| K-QMD | 30 | 30 | **100%** |

## Notes

- deterministic tokenize stub를 사용하므로, 실제 Kiwi 형태소 분석과 결과가 다를 수 있습니다.
- 기준선 카테고리는 양쪽 모두 hit이어야 하는 sanity check 쿼리입니다.
- 아래 JSON은 전체 측정 데이터입니다.

```json
{
  "rows": [
    {
      "category": "compound",
      "query": "분석",
      "targetDoc": "docs/compound-nlp.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "모델",
      "targetDoc": "docs/compound-nlp.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "형태소",
      "targetDoc": "docs/compound-nlp.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "처리",
      "targetDoc": "docs/compound-nlp.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "에이전트",
      "targetDoc": "docs/compound-arch.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "서비스",
      "targetDoc": "docs/compound-arch.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "브로커",
      "targetDoc": "docs/compound-arch.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "밸런서",
      "targetDoc": "docs/compound-infra.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "스케일링",
      "targetDoc": "docs/compound-infra.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "오케스트레이션",
      "targetDoc": "docs/compound-infra.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "compound",
      "query": "케이스",
      "targetDoc": "docs/particle-review.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "particle",
      "query": "프레임워크",
      "targetDoc": "docs/particle-agent.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "particle",
      "query": "오케스트레이터",
      "targetDoc": "docs/particle-agent.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "particle",
      "query": "미들웨어",
      "targetDoc": "docs/particle-middleware.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "particle",
      "query": "샌드박스",
      "targetDoc": "docs/particle-middleware.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "particle",
      "query": "가드레일",
      "targetDoc": "docs/particle-middleware.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "particle",
      "query": "리팩토링",
      "targetDoc": "docs/particle-review.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "particle",
      "query": "커버리지",
      "targetDoc": "docs/particle-review.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "연동",
      "targetDoc": "docs/mixed-api.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "인증",
      "targetDoc": "docs/mixed-api.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "엔드포인트",
      "targetDoc": "docs/mixed-api.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "스키마",
      "targetDoc": "docs/mixed-api.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "파이프라인",
      "targetDoc": "docs/mixed-devops.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "컨테이너",
      "targetDoc": "docs/mixed-devops.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "mixed",
      "query": "클러스터",
      "targetDoc": "docs/mixed-devops.md",
      "upstreamHit": false,
      "shadowHit": true
    },
    {
      "category": "baseline",
      "query": "형태소분석기",
      "targetDoc": "docs/compound-nlp.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "baseline",
      "query": "데이터베이스",
      "targetDoc": "docs/compound-arch.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "baseline",
      "query": "필요합니다",
      "targetDoc": "docs/particle-agent.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "baseline",
      "query": "API",
      "targetDoc": "docs/mixed-api.md",
      "upstreamHit": true,
      "shadowHit": true
    },
    {
      "category": "baseline",
      "query": "설정",
      "targetDoc": "docs/particle-middleware.md",
      "upstreamHit": true,
      "shadowHit": true
    }
  ],
  "aggregate": [
    {
      "side": "upstream",
      "hits": 13,
      "total": 30,
      "recall": 43
    },
    {
      "side": "shadow",
      "hits": 30,
      "total": 30,
      "recall": 100
    }
  ]
}
```
