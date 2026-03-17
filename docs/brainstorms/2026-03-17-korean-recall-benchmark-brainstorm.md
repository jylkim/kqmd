# Korean Recall Benchmark Brainstorm

Date: 2026-03-17

## What We're Building

upstream qmd FTS5 대비 kqmd shadow index의 **한국어 recall 향상**을 수치로 증명하는 벤치마크.
두 가지 목적을 동시에 충족한다:

1. **오픈소스 프로모션**: README/블로그에 넣을 직관적인 recall rate 비교표
2. **내부 회귀 감지**: CI에서 돌리는 regression signal (`bun run measure:recall-comparison`)

## Why This Approach

### 현재 빠진 조각

기존 벤치마크 4개는 모두 latency/memory 측정이다. 프로젝트의 핵심 가치인 "한국어 recall 향상"을 수치로 보여주는 벤치마크가 없다. 실제 vault(114개 문서)에서 테스트하면 띄어쓰기가 잘 되어 있어 차이가 미미하다 (에이전트 65건 vs 66건). synthetic fixture로 한국어 고유 패턴을 의도적으로 구성해야 극적인 차이가 드러난다.

### 실험에서 확인된 사실

| 패턴 | 예시 | upstream FTS5 | kqmd shadow |
|------|------|:---:|:---:|
| 복합어 분리 | "서브에이전트" → "에이전트" 검색 | miss | hit |
| 복합어 분리 | "형태소분석" → "분석" 검색 | miss | hit |
| 조사 붙여쓰기 | "에이전트가" → "에이전트" 검색 | miss (공백 없을 때) | hit |
| 띄어쓰기 된 조사 | "에이전트가 필요" → "에이전트" 검색 | hit | hit |

**핵심 인사이트**: 복합어 분리가 가장 확실한 차이를 만든다. 조사 제거는 붙여쓰기 시에만 차이가 난다.

## Key Decisions

### 1. Corpus: Synthetic fixture

- CI에서 재현 가능
- 차이가 극적으로 드러나도록 의도적 설계
- 기존 measure 스크립트와 동일한 패턴 (`mkdtempSync`, `createStore()`, cleanup)
- deterministic tokenize stub 사용 (Kiwi 모델 다운로드 불필요)

### 2. 포함할 한국어 패턴

**복합어 분리** (가장 효과적):
- 형태소분석기 → 형태소, 분석
- 거대언어모델 → 거대, 언어, 모델
- 서브에이전트 → 서브, 에이전트
- 데이터베이스 → 데이터, 베이스

**조사 제거** (붙여쓰기 시 효과적):
- 에이전트가, 에이전트를, 에이전트는 → 에이전트
- 미들웨어의, 미들웨어에서 → 미들웨어

**한영 혼합 붙여쓰기**:
- API연동 → API, 연동
- OAuth인증 → OAuth, 인증

### 3. 핵심 지표: Recall rate 비교

- upstream recall% vs kqmd recall% — 가장 직관적
- 쿼리-문서 쌍의 expected hit 기준으로 hit/miss 판정
- 예상 출력: "upstream recall: 40%, kqmd recall: 95%"

### 4. 출력 형식

기존 measure 스크립트 컨벤션 준수:
- 스크립트: `scripts/measure_recall_comparison.ts`
- 출력: `docs/benchmarks/YYYY-MM-DD-recall-comparison-metrics.md`
- 형식: markdown header → method → 결과 테이블 → derived signals → JSON

## Scope

### In scope
- synthetic fixture 생성 및 upstream/shadow 쿼리 비교
- recall rate 계산 및 markdown 출력
- package.json에 `measure:recall-comparison` 스크립트 등록
- deterministic tokenize stub (Kiwi 의존 없음)

### Out of scope
- 실제 corpus (나무위키, 위키백과) 벤치마크
- MRR/NDCG 같은 IR 정밀 지표
- ranking 품질 비교 (별도 벤치마크 이미 존재)
- CJK 확장 (중국어, 일본어) — 향후 과제

## Open Questions

없음 — 위 결정사항으로 진행 가능.
