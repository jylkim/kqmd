---
date: 2026-03-12
topic: korean-search-recall
---

# Korean Search Recall Brainstorm

## What We're Building
K-QMD의 첫 한국어 검색 품질 마일스톤은 `qmd query`나 vector DB를 더 손보는 것이 아니라, `qmd search`에서 한국어 lexical recall을 먼저 끌어올리는 것이다. 현재 owned `search` 경로는 lexical-only이고 whitespace 기반 토큰 경계에 크게 의존하므로, 사용자가 찾고 싶은 문서를 아예 찾지 못하는 경우가 생긴다.

대표 실패 유형은 `형태소 분석`으로 검색했을 때 `형태소분석기`가 잡히지 않거나, `모델`로 검색했을 때 `거대언어모델`이 잡히지 않는 경우다. 첫 릴리스의 목표는 이런 미탐을 줄여 “지금은 아예 못 찾는 문서가 찾히게 만드는 것”이다.

## Why This Approach
세 가지 접근을 검토했다.

`Approach A: Kiwi 기반 한국어 토큰화를 search/update에 도입`
오픈소스 형태소 분석기 Kiwi를 사용해 문서 색인과 검색어 해석 모두에 한국어 토큰화를 적용한다. 기존 whitespace 중심 lexical 검색의 가장 큰 약점인 붙여쓰기, 합성어, 복합명사 경계 문제를 직접 줄이는 접근이다.

Pros:
- 현재 가장 큰 사용자 문제인 recall 미탐에 직접 대응한다
- `형태소 분석`/`형태소분석기`, `모델`/`거대언어모델` 같은 사례를 함께 개선할 수 있다
- 한글 전용 검색 엔진을 새로 설계하지 않고도 시작할 수 있다

Cons:
- 첫 릴리스에서 재색인이 필요하다
- 토큰 정책과 인덱스 버전 관리가 필요하다
- ranking 개선보다는 recall 개선에 초점이 맞춰진다

Best when:
- 사용자가 가장 불편하게 느끼는 문제가 “아예 못 찾음”일 때 적합하다

`Approach B: 기존 인덱스 유지 + 한국어 보조 토큰 병행 저장`
기존 whitespace 기반 인덱스를 유지하고, 한국어 분석 결과를 보조 토큰 집합으로 별도 추가한다. 호환성은 조금 더 보수적으로 가져가지만 구조 복잡도가 늘어난다.

Pros:
- 기존 동작을 덜 흔든다
- 점진 실험과 비교가 쉽다

Cons:
- 첫 릴리스치고 구조가 복잡해진다
- 현재 저장소 규모에 비해 설계 비용이 크다

Best when:
- recall보다 기존 동작 보존이 더 중요한 경우에 적합하다

`Approach C: 한글 전용 인덱스/랭킹을 먼저 설계`
형태소 분석, 인덱스 구조, 랭킹까지 함께 재설계한다. 장기적으로는 강할 수 있지만 지금 단계에서는 과한 접근이다.

Pros:
- 장기 확장성은 가장 크다

Cons:
- 구현 범위가 너무 넓다
- 현재 가장 시급한 미탐 문제를 빠르게 닫기 어렵다

Best when:
- 이미 요구사항이 충분히 복잡하고 장기 구조를 지금 고정해야 할 때 적합하다

추천안은 `Approach A`다. vector 경로는 이미 한국어 지원 embedding 모델 정책을 갖고 있고, 현재 저장소의 가장 약한 고리는 lexical search recall이므로 Kiwi 기반 토큰화를 먼저 도입하는 것이 가장 합리적이다.

## Key Decisions
- First milestone: 첫 한국어 검색 품질 개선 범위는 `query`보다 `search`에 둔다
- Primary goal: 첫 릴리스의 성공 기준은 ranking 개선이 아니라 recall 미탐 감소다
- Problem shape: 핵심 실패는 whitespace 기반 lexical indexing 때문에 생기는 붙여쓰기, 합성어, 복합명사 경계 문제다
- Morphological strategy: 형태소 분석기는 직접 개발하지 않고 오픈소스 `Kiwi`를 사용한다
- Scope boundary: 검색어만 보정하는 것이 아니라 문서 색인과 검색 양쪽에 같은 한국어 토큰화 정책을 적용한다
- Command scope: 실질 구현 범위는 `search` 단독이 아니라 `update`까지 포함한 한국어 lexical indexing/search다
- Reindex policy: 첫 릴리스에서 재색인을 허용한다
- Policy UX: embedding model mismatch와 유사하게, 검색 인덱스 정책 버전이 바뀌면 재색인 필요를 안내하는 UX를 둔다
- YAGNI boundary: 사용자 사전, 한글 전용 별도 검색 엔진, 전면적인 랭킹 재설계는 첫 릴리스 범위에서 제외한다

## Resolved Questions
- Vector DB를 먼저 손볼 것인가?: 아니다. 현재는 한국어 지원 embedding model 정책이 이미 있고, 첫 사용자 문제는 lexical recall 쪽이다
- 첫 성공 기준은 recall인가 ranking인가?: recall이다. 지금은 아예 못 찾는 것이 더 큰 문제다
- 형태소 분석기를 직접 만들 것인가?: 아니다. 오픈소스 Kiwi를 사용한다
- 첫 릴리스에서 재색인을 허용할 것인가?: 허용한다
- 사용자 사전이 첫 단계에 필요한가?: 현재는 필요하지 않은 것으로 본다

## Open Questions
없음. 구현 세부사항은 planning 단계에서 다룬다.

## Next Steps
-> `/prompts:ce-plan`으로 구현 계획을 구체화한다
-> Kiwi를 기준으로 검색 토큰 정책, 인덱스 정책 버전, 재색인 UX를 설계한다
-> `search`와 `update` 경계 안에서 한국어 lexical indexing/search를 구현한다
