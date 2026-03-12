---
date: 2026-03-12
topic: qwen-default-embedding
---

# Qwen Default Embedding Brainstorm

## What We're Building
K-QMD의 다음 제품 슬라이스는 embedding 기본값을 `embeddinggemma` 계열에서 Qwen 계열로 전환하는 것이다. 범위는 `embed` 명령 하나에 한정하지 않고, `kqmd` 배포 전체에서 사용자가 “기본 embedding 모델은 Qwen이다”라고 일관되게 인식하도록 맞춘다. 여기에는 embed 실행, query/search에서의 기대 모델, model pull 안내, 상태 메시지와 문서 표현이 모두 포함된다.

이번 변경은 단순한 env override 추가가 아니라 제품 기본값 선언에 가깝다. 기존 브레인스토밍에서 합의한 “Qwen3 embeddings zero-config 기본값”을 실제 사용자 경험으로 끌어내리는 단계이며, 특히 기존 인덱스에 다른 embedding 모델 벡터가 남아 있을 때 조용히 품질이 흔들리지 않도록 mismatch 감지와 안내를 함께 설계하는 것이 핵심이다.

## Why This Approach
세 가지 접근을 비교했다.

`Approach A: product-wide Qwen default + mismatch advisory`
`kqmd` 전체 기본값을 Qwen으로 통일하고, 기존 인덱스에 다른 embedding 모델이 남아 있으면 `status/query/embed`에서 이를 감지해 `qmd embed --force`를 안내한다. 자동 fallback이나 자동 재임베딩은 하지 않는다.

Pros:
- 제품 기본값이 가장 일관된다
- 기존 인덱스의 조용한 품질 회귀를 숨기지 않는다
- 자동 부작용 없이 사용자가 전환 시점을 통제할 수 있다

Cons:
- 모델 불일치 감지와 사용자 안내 UX를 별도로 설계해야 한다

Best when:
- 기본값 전환을 분명히 하면서도 기존 사용자 데이터를 자동으로 건드리고 싶지 않을 때 적합하다

`Approach B: Qwen default for fresh work only`
새 인덱스나 새 embed부터만 Qwen을 기본으로 쓰고, 기존 인덱스의 다른 모델 벡터는 특별히 감지하지 않는다.

Pros:
- 범위가 가장 작다
- 기존 health/status 로직을 거의 바꾸지 않아도 된다

Cons:
- 기존 인덱스가 혼합 상태로 남을 수 있다
- “기본값이 바뀌었다”는 제품 의미가 사용자 경험에 충분히 드러나지 않는다

Best when:
- 빠르게 기본값만 바꾸고 migration UX는 뒤로 미루고 싶을 때 적합하다

`Approach C: opt-in transition period`
기본값은 유지한 채 플래그나 환경변수로만 Qwen 기본값을 먼저 실험한다.

Pros:
- 가장 보수적이다
- 초기 리스크를 제한하기 쉽다

Cons:
- default를 바꾼다는 목표와 어긋난다
- 문서와 운영 경로가 더 복잡해진다

Best when:
- 제품 결정 전 실험 단계가 더 중요할 때 적합하다

추천안은 `Approach A`다. 현재 upstream `@tobilu/qmd`는 이미 Qwen embedding 포맷과 `QMD_EMBED_MODEL` override를 지원하고 있고, K-QMD에도 owned runtime seam이 있으므로 큰 인프라 선행보다 제품 정책과 불일치 UX를 명확히 잡는 편이 맞다.

## Key Decisions
- Default scope: Qwen embedding 기본값은 `embed`만이 아니라 `kqmd` 배포 전체 사용자 경험에 적용한다
- Failure policy: Qwen 로딩이나 준비가 실패해도 기존 기본값으로 자동 fallback 하지 않는다
- Recovery UX: 실패 시에는 사용자가 다음 행동을 바로 알 수 있도록 복구 안내를 명시적으로 제공한다
- Existing indexes: 기존 인덱스에 다른 embedding 모델 벡터가 남아 있으면 이를 감지해서 재임베딩을 강하게 안내한다
- Query behavior: 모델 불일치가 있어도 `query`는 경고를 보여준 뒤 계속 수행한다
- Status behavior: `status`는 모델 불일치를 건강 상태 정보로 노출한다
- Embed behavior: `embed`는 전환 경로의 중심 명령으로 두고, 필요 시 `qmd embed --force`를 안내한다
- Migration policy: 첫 전환 시 자동으로 기존 벡터를 지우거나 자동 재임베딩하지 않는다
- Infra assessment: 지금 단계에서 추가 대규모 인프라 선행보다, model mismatch 감지와 제품 메시지 정리가 우선이다

## Resolved Questions
- 기본값 전환 범위는 어디까지인가?: `kqmd` 전체 배포 기본값으로 본다
- Qwen 준비 실패 시 어떻게 할 것인가?: 자동 fallback 없이 복구 안내를 제공한다
- 기존 인덱스에 다른 모델 벡터가 있으면 어떻게 할 것인가?: mismatch를 감지하고 재임베딩을 강하게 안내한다
- mismatch가 있을 때 `query`는 막을 것인가?: 아니다. 경고 후 계속 수행한다
- mismatch가 있을 때 `status`는 무엇을 해야 하는가?: 건강 상태 정보로 이를 드러낸다

## Open Questions
- 없음. 브레인스토밍 범위의 핵심 제품 결정은 모두 정리되었다.

## Next Steps
-> `/prompts:ce-plan`으로 Qwen 기본값 주입 지점, mismatch detection 기준, 사용자 안내 표면을 구현 계획으로 정리한다
