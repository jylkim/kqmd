---
date: 2026-03-16
topic: korean-query-ranking-adaptive-fusion
---

# Korean Query Ranking Adaptive Fusion

## What We're Building
K-QMD의 owned `query` 경로에 한국어 질의 유형에 적응하는 ranking baseline을 도입한다. 목표는 upstream `qmd`를 수정하지 않으면서, downstream policy만으로 한국어 검색 결과가 더 자연스럽고 설명 가능하게 보이도록 만드는 것이다.

이번 기준선은 특히 두 가지 질의군을 우선한다. 첫째는 `지속 학습`, `문서 업로드 파싱` 같은 짧은 한국어 구 검색이다. 둘째는 `auth flow`, `agent orchestration`, `지속 learning` 같은 한영 혼합 기술어 검색이다. `지속` 같은 1단어 한국어 키워드는 지원하되, 우선순위는 그보다 낮다. 자연어 질문형 검색은 이번 범위의 핵심 타깃이 아니다.

문제 정의는 특정 코퍼스나 특정 문서 타입에 맞춘 패치가 아니다. 예시로 본 일간 노트 결과는 증상일 뿐이며, 실제 목표는 한국어 검색 전반에서 phrase/근접 매치, 제목/헤더 구조 신호, 핵심 문맥 집중도를 더 잘 반영해 “왜 이 문서가 위에 있지?” 같은 상위 결과의 어색함을 줄이는 것이다.

## Why This Approach
세 가지 접근을 검토했다.

`Approach A: Query-Type Adaptive Fusion`
질의 타입을 가볍게 분류한 뒤, 타입별로 lexical/hybrid ranking 비중과 구조 신호를 다르게 적용한다. 짧은 한국어 구는 lexical-first로 다루고, 한영 혼합 기술어는 literal evidence와 hybrid evidence를 더 균형 있게 섞는다.

Pros:
- 사용자 우선순위인 짧은 한국어 구와 한영 혼합 기술어를 동시에 정면으로 다룬다
- upstream 변경 없이 owned `query` policy로 닫기 좋다
- 결과 차이를 explain/help에서 제품 원칙으로 설명하기 쉽다

Cons:
- 질의 타입 분류 규칙이 새 계약이 된다
- 단일 점수식보다 tuning 축이 늘어난다

Best when:
- `query`를 한국어/기술어 질의에 적응하는 검색으로 정의하고 싶을 때 적합하다

`Approach B: Structure-First Ranking`
질의 타입 분기 없이 제목, 헤더, phrase/근접, match concentration 같은 구조 신호를 전역적으로 강화한다.

Pros:
- 코퍼스에 덜 종속적이다
- explain 가능성이 높다

Cons:
- 한영 혼합 기술어에서 adaptive behavior가 약하다
- 질의군별 차이를 충분히 살리기 어렵다

Best when:
- 결과의 기본 질서를 먼저 바로잡고 싶을 때 적합하다

`Approach C: Conservative Korean Lexical Gate + Hybrid Backoff`
한국어 신호가 강한 질의는 lexical evidence가 충분할 때 hybrid 개입을 줄이고, lexical confidence가 약할 때만 hybrid를 보조적으로 키운다.

Pros:
- 짧은 한국어 구에서 상위 결과의 이상함을 빠르게 줄이기 쉽다
- `search`와 `query`의 체감 차이를 줄일 가능성이 높다

Cons:
- 한영 혼합 기술어에 다소 보수적일 수 있다
- hybrid를 다시 키우는 기준이 별도 정책이 된다

Best when:
- 현재의 어색한 한국어 상위 결과를 우선 안정화하고 싶을 때 적합하다

추천안은 `Approach A`다. 이번 목표는 단순한 lexical 강화가 아니라, 질의 유형에 맞게 ranking 원칙을 달리해 짧은 한국어 구와 한영 혼합 기술어를 모두 제품적으로 더 자연스럽게 다루는 것이다. `Approach B`는 지나치게 평평하고, `Approach C`는 현재 증상 완화에는 좋지만 목표 질의군 전체를 포괄하는 기준선으로는 방어적이다.

## Key Decisions
- Ownership boundary: upstream `qmd` 구현은 건드리지 않고 owned `query` 경로의 downstream ranking policy만 조정한다
- Product goal: 한국어 검색 관점에서 affordable하고 설명 가능한 ranking baseline을 만든다
- Query strategy: `query`는 질의 타입에 따라 ranking 원칙을 다르게 가져가는 adaptive fusion을 사용한다
- Priority queries: 짧은 한국어 구 검색을 최우선으로, 한영 혼합 기술어 검색을 그 다음으로 개선한다
- Lower-priority queries: 1단어 한국어 키워드는 지원하되 우선순위는 낮다
- Non-goal: 자연어 질문형 검색 최적화는 이번 브레인스토밍의 핵심 범위가 아니다
- Failure ordering:
- 짧은 한국어 구에서 phrase/근접 매치보다 토큰이 흩어진 문서가 위로 뜨는 문제를 가장 먼저 줄인다
- 제목/헤더 매치가 본문의 희박한 언급보다 충분히 강하지 않은 문제를 다음으로 줄인다
- 핵심 주제 문서보다 우연한 언급 문서가 위로 뜨는 문제는 문서 타입 규칙이 아니라 구조 신호와 문맥 집중도로 해결한다
- 한영 혼합 기술어에서는 literal evidence와 hybrid evidence를 질의 타입에 맞게 섞는다
- Success criteria:
- 짧은 한국어 구 검색에서 상위 결과의 “왜 이 문서가 위에 있지?” 같은 어색함이 눈에 띄게 줄어든다
- 한영 혼합 기술어 검색에서 literal evidence와 의미적/hybrid evidence의 혼합이 더 자연스럽게 보인다
- Guardrail: 특정 코퍼스나 일간 노트 같은 지역적 사례에 맞춘 하드코딩은 피한다

## Resolved Questions
- `query` ranking 문제로 좁힐 것인가?: 그렇다. 이번 브레인스토밍은 `query` ranking 조정에만 집중한다
- `A`를 임시 단계로 둘 것인가?: 아니다. 처음부터 adaptive fusion을 목표 계약으로 본다
- 어떤 질의군을 우선할 것인가?: 짧은 한국어 구, 한영 혼합 기술어, 1단어 한국어 키워드 순이다
- 특정 문서 타입 패널티를 둘 것인가?: 아니다. 문서 타입이 아니라 구조 신호와 문맥 집중도로 일반 문제를 푼다
- 가장 중요한 v1 성공 기준은 무엇인가?: 짧은 한국어 구의 상위 결과 품질 개선과 한영 혼합 기술어의 더 자연스러운 혼합이다

## Open Questions
없음. 구체적인 scoring features, threshold, explain/output contract, evaluation set은 planning 단계에서 정의한다.

## Next Steps
-> `/prompts:ce-plan`으로 adaptive query ranking 계획을 세운다
-> 질의 타입 분류 기준과 질의군별 ranking signals를 계획 문서에서 acceptance criteria로 고정한다
-> `search`와 `query`의 explain contract가 새 ranking policy를 사용자에게 설명 가능하게 만드는지 함께 검토한다
