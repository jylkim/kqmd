# Korean Recall Comparison Metrics

Date: 2026-03-17
Command: `bun run measure:recall-comparison`

이 문서는 upstream qmd FTS5 대비 kqmd shadow index의 한국어 recall 비교 벤치마크다.
synthetic fixture에서 복합어 분리, 조사 제거, 한영 혼합 세 가지 한국어 패턴의 hit/miss를 비교한다.

## Method

- fixture 규모: target 문서 8개 + noise 문서 10개
- 패턴 카테고리:
  - `compound`: 복합어 분리 (형태소분석기 → 형태소+분석)
  - `particle`: 조사 제거 (에이전트가 → 에이전트)
  - `mixed`: 한영 혼합 (API연동 → API+연동)
  - `baseline`: 양쪽 모두 매칭되는 기준 쿼리
- hit 정의: target 문서의 displayPath가 결과 목록(limit=20)에 존재
- tokenizer: deterministic stub 사용 (Kiwi 모델 다운로드 불필요)
- query 전달: 양쪽 모두 동일한 raw query string 사용 (index-side projection 효과만 격리 측정)

## Results

| Category | Query | Target | upstream | shadow | Delta |
|---|---|---|---|---|---|
| compound | 분석 | docs/compound-nlp.md | miss | hit | +1 |
| compound | 모델 | docs/compound-nlp.md | miss | hit | +1 |
| compound | 형태소 | docs/compound-nlp.md | hit | hit | 0 |
| compound | 처리 | docs/compound-nlp.md | miss | hit | +1 |
| compound | 에이전트 | docs/compound-arch.md | miss | hit | +1 |
| compound | 서비스 | docs/compound-arch.md | miss | hit | +1 |
| compound | 브로커 | docs/compound-arch.md | miss | hit | +1 |
| compound | 밸런서 | docs/compound-infra.md | miss | hit | +1 |
| compound | 스케일링 | docs/compound-infra.md | miss | hit | +1 |
| compound | 오케스트레이션 | docs/compound-infra.md | miss | hit | +1 |
| compound | 케이스 | docs/particle-review.md | miss | hit | +1 |
| particle | 프레임워크 | docs/particle-agent.md | hit | hit | 0 |
| particle | 오케스트레이터 | docs/particle-agent.md | hit | hit | 0 |
| particle | 미들웨어 | docs/particle-middleware.md | hit | hit | 0 |
| particle | 샌드박스 | docs/particle-middleware.md | hit | hit | 0 |
| particle | 가드레일 | docs/particle-middleware.md | hit | hit | 0 |
| particle | 리팩토링 | docs/particle-review.md | hit | hit | 0 |
| particle | 커버리지 | docs/particle-review.md | hit | hit | 0 |
| mixed | 연동 | docs/mixed-api.md | miss | hit | +1 |
| mixed | 인증 | docs/mixed-api.md | miss | hit | +1 |
| mixed | 엔드포인트 | docs/mixed-api.md | miss | hit | +1 |
| mixed | 스키마 | docs/mixed-api.md | miss | hit | +1 |
| mixed | 파이프라인 | docs/mixed-devops.md | miss | hit | +1 |
| mixed | 컨테이너 | docs/mixed-devops.md | miss | hit | +1 |
| mixed | 클러스터 | docs/mixed-devops.md | miss | hit | +1 |
| baseline | 형태소분석기 | docs/compound-nlp.md | hit | hit | 0 |
| baseline | 데이터베이스 | docs/compound-arch.md | hit | hit | 0 |
| baseline | 필요합니다 | docs/particle-agent.md | hit | hit | 0 |
| baseline | API | docs/mixed-api.md | hit | hit | 0 |
| baseline | 설정 | docs/particle-middleware.md | hit | hit | 0 |

## Aggregate

| Side | Hits | Total | Recall |
|---|---:|---:|---:|
| upstream | 13 | 30 | 43% |
| shadow | 30 | 30 | 100% |

## Derived Signals

- Shadow recall uplift: +57pp

## Notes

- shadow table은 `tokenize='porter unicode61'`, upstream은 `unicode61`을 사용한다. 영어 토큰에서 porter stemming이 shadow에 유리하게 작용할 수 있으나, 이 벤치마크의 핵심 비교 대상은 한국어 패턴이다.
- deterministic tokenize stub를 사용하므로, 실제 Kiwi 형태소 분석과 결과가 다를 수 있다. 이 벤치마크는 shadow index projection 메커니즘의 recall 효과를 측정한다.
- baseline 카테고리는 양쪽 모두 hit이어야 하는 sanity check 쿼리다.

JSON
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
