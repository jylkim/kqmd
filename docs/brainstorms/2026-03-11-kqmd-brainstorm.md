---
date: 2026-03-11
topic: kqmd
---

# K-QMD Brainstorm

## What We're Building
K-QMD는 기존 사용 습관을 바꾸지 않으면서 한국어 검색 지원을 강화하려는 사용자를 위한 `qmd-compatible replacement distribution`이다. 사용자는 `kqmd`를 설치하지만 실제 사용 명령은 계속 `qmd`다. 제품 목표는 새로운 CLI 표면을 만드는 것이 아니라, 익숙한 `qmd` 경험을 유지한 채 검색과 인덱싱 경로의 한국어 처리를 개선하는 것이다.

이 프로젝트가 필요한 이유는 upstream `qmd`가 강한 마크다운 검색 시스템이긴 하지만, 특히 full-text 동작을 중심으로 한국어 지원이 아직 약하기 때문이다. 직접 upstream PR로 해결하려고 했을 때 변경 범위가 넓고 내부 영향도도 커 보여, maintainer가 아닌 입장에서 바로 밀어 넣기엔 위험이 컸다. 그래서 K-QMD는 공식 SDK를 기반으로 삼아 한국어 중심 동작을 독립적으로 실험하고 배포하며, 나중에 더 작은 단위의 조각만 upstream으로 돌려보낼 수 있게 한다.

## Why This Approach
세 가지 접근을 검토했다.

`Approach A: qmd-compatible replacement distribution`
`kqmd`를 설치하되 사용자에게는 `qmd`를 노출하고, 한국어 지원에 중요한 명령은 우리가 가로채며 나머지는 upstream 동작으로 위임한다.

Pros:
- 사용자의 기존 `qmd` 워크플로를 그대로 유지할 수 있다
- 한국어 지원을 upstream 릴리스 주기와 분리해서 발전시킬 수 있다
- 첫 단계부터 전체 CLI를 재구현하지 않아도 된다

Cons:
- upstream CLI drift를 계속 추적해야 한다
- 가로채는 명령과 passthrough 명령의 경계를 분명히 관리해야 한다

Best when:
- 사용자를 재교육하지 않으면서 한국어 지원만 실질적으로 개선하고 싶을 때 적합하다

`Approach B: separate kqmd CLI`
`kqmd`를 별도 명령으로 노출하고 사용자가 직접 그 명령을 쓰도록 한다.

Pros:
- 패키징과 배포 구성이 가장 단순하다
- upstream와의 경계가 명확하다

Cons:
- 사용자는 습관적으로 계속 `qmd`를 칠 가능성이 높다
- “같은 도구인데 한국어가 더 잘 된다”는 제품 가치가 약해진다

Best when:
- 프로젝트가 내부 실험용이거나 `qmd`와 의도적으로 분리되어야 할 때 적합하다

`Approach C: upstream-first invasive PR or fork`
한국어 지원 변경을 upstream 내부에 직접 반영하려 하거나, 더 무거운 포크를 유지한다.

Pros:
- 채택만 된다면 장기적으로 가장 일관된 구조가 될 수 있다
- wrapper 경계를 줄일 수 있다

Cons:
- non-maintainer 입장에서 리뷰와 유지보수 리스크가 크다
- 실험 사이클이 느려진다
- 큰 내부 변경은 안전하게 반영되기 어렵다

Best when:
- maintainer와의 긴밀한 합의가 있고 구조적 변경을 upstream이 감수할 의지가 있을 때 적합하다

추천안은 `Approach A`다. 이 접근이 제품 목표, maintainer 리스크 제약, 그리고 사용자에게 새 명령을 학습시키지 않고 한국어 검색 품질을 반복 개선해야 한다는 요구를 가장 잘 만족한다.

## Key Decisions
- Package identity: 패키지는 `kqmd`로 배포하지만 기본 CLI 명령은 `qmd`로 노출한다
- Product framing: K-QMD는 병렬 도구가 아니라 replacement distribution으로 정의한다
- Repository shape: 저장소는 단일 TypeScript 패키지로 시작한다
- Upstream relationship: upstream `qmd`는 런타임 소스가 아니라 추적 기준선으로 둔다
- Runtime base: upstream 내부를 직접 수정하기보다 `@tobilu/qmd` 위에서 동작한다
- Config compatibility: 설정, DB, 캐시 경로는 upstream `qmd`와 공유한다
- Command ownership: `search`, `query`, `update`, `embed`는 항상 우리가 가로챈다
- Command ownership: `collection`은 초기에는 passthrough로 둔다
- Command ownership: `status`, `ls`, `get`, `multi-get`, `mcp` 같은 저위험 명령은 필요가 생길 때까지 passthrough로 둔다
- Scope strategy: 첫 사이클부터 전체 CLI 재구현을 목표로 삼지 않는다
- Korean support strategy: 한국어 특화 동작의 핵심 seam은 search, query, indexing, embeddings로 본다
- Future defaulting: 이후 wrapper 레이어에서 Qwen3 embeddings를 zero-config 기본값으로 만든다

## Open Questions
- 무엇이 upstream-compatible 명령을 위임하는 가장 깔끔한 passthrough 메커니즘인가?
- wrapper 내부 책임을 routing, policy defaults, SDK calls, subprocess delegation으로 어떻게 나눌 것인가?
- 한국어 tokenization 또는 형태소 분석은 indexing, search, 둘 다 중 어디에 먼저 들어가야 하는가?
- 첫 번째 마일스톤에 필요한 parity test 표면은 어디까지인가?
- `collection`은 언제 passthrough에서 owned behavior로 옮겨야 하는가?
- 구현 계획 단계에서 upstream submodule은 어느 시점에 추가하는 것이 적절한가?

## Next Steps
-> `/ce:plan`으로 구현 계획을 구체화한다
-> 첫 번째 마일스톤을 CLI routing과 command interception 경계 중심으로 정의한다
-> `search`, `query`, `update`, `embed`의 내부 아키텍처를 구체화한다
