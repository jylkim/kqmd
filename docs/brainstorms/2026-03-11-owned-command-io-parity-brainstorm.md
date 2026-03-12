---
date: 2026-03-11
topic: owned-command-io-parity
---

# Owned Command I/O Parity Brainstorm

## What We're Building
K-QMD의 다음 내부 기반 슬라이스는 `search`, `query`, `update`, `embed` 전체에 공통으로 적용되는 `owned command I/O parity contract`다. 목적은 각 owned handler가 제각각 옵션을 해석하고 결과를 출력하는 상태를 막고, upstream `qmd` CLI와 가능한 한 동일한 입력/출력 계약 위에서 움직이게 만드는 것이다.

이번 작업은 추상 contract만 정의하고 끝내는 것이 아니라, 실제 handler 경로에 그 contract를 연결하는 것을 포함한다. 즉, parse/validation/error output은 네 명령 모두에 대해 공통화하고, 첫 parity snapshot 범위는 `search/query`의 정상 출력과 `search/query/update/embed` 전체의 validation 실패/에러 출력까지 포함한다. `update/embed`의 정상 성공 결과는 우선 기본 shape만 고정하고, 더 무거운 subprocess parity나 full runtime parity는 다음 단계로 미룬다.

## Why This Approach
세 가지 범위를 비교했다.

`Approach A: strict parity contract for all owned commands`
네 개 owned 명령 전체를 대상으로 upstream `@tobilu/qmd` CLI의 옵션 이름, validation, stdout/stderr shape, exit code를 기준선으로 고정한다. 첫 테스트 스위트는 parse/validation/output snapshot 중심으로 구성하고, qmd 버전 bump 시 재검증 절차를 같이 만든다.

Pros:
- owned command 전체가 같은 CLI 계약 위에 올라간다
- 이후 실제 기능 구현이 들어와도 사용자-facing drift를 줄일 수 있다
- 버전 업데이트 시 어디가 깨졌는지 테스트로 빨리 알 수 있다

Cons:
- 초기 범위가 작지 않다
- `update/embed`는 성공 경로까지 완전 parity를 당장 잡기엔 무겁다

Best when:
- 앞으로의 owned 구현 전부를 강한 CLI 호환성 위에 올리고 싶을 때 적합하다

`Approach B: read-command parity first`
`search/query`만 strict parity contract에 먼저 올리고, `update/embed`는 나중에 확장한다.

Pros:
- 검색 경로에 집중해 더 빨리 닫을 수 있다
- snapshot 범위를 단순하게 관리할 수 있다

Cons:
- 네 개 owned 명령이 같은 contract를 쓴다는 목표가 미뤄진다
- mutation command에서 다시 별도 규약이 생길 위험이 남는다

Best when:
- 다음 작업이 read path 중심으로 좁게 잡혀 있을 때 적합하다

`Approach C: parser-only foundation`
공통 parse/validation 모듈만 먼저 만들고 handler 연결과 output parity는 나중에 한다.

Pros:
- 구현 난도가 가장 낮다
- 옵션 타입과 validation 규칙만 먼저 고정할 수 있다

Cons:
- 실제 handler 경로를 강제하지 못한다
- 사용자-visible contract drift를 막는 효과가 약하다

Best when:
- entry path 연결 비용이 크거나, 실제 handler 설계가 아직 불분명할 때 적합하다

추천안은 `Approach A`다. 현재 저장소는 runtime, routing, path policy가 이미 준비되어 있어 이제는 실제 owned entry path를 strict contract 위에 올릴 시점이다. parser-only foundation은 지금 단계에서 너무 얇고, read-command-only scope는 네 개 owned 명령을 공통 규약에 묶겠다는 목적을 충분히 달성하지 못한다.

## Key Decisions
- Parity strength: upstream `@tobilu/qmd` CLI와의 `strict parity`를 목표로 한다
- Baseline source: 기준선은 현재 저장소에 설치된 upstream `@tobilu/qmd` 버전의 CLI 동작으로 고정한다
- Command coverage: `search`, `query`, `update`, `embed` 전체를 한 번에 contract 범위에 넣는다
- Entry-path enforcement: contract는 문서나 타입 선언이 아니라 실제 handler 경로에 연결한다
- First test scope: 첫 parity suite는 subprocess보다 `parse`, `validation`, `output snapshot` 중심으로 시작한다
- Success snapshot scope: `search/query`는 정상 출력 snapshot까지 포함한다
- Mutation scope: `update/embed`는 validation/error parity와 성공 결과의 기본 shape까지만 우선 고정한다
- Upgrade process: upstream `qmd` 버전 bump 시 parity test suite와 체크리스트를 함께 실행하는 검증 프로세스를 둔다
- Deferral boundary: full subprocess parity, deeper runtime success parity, model-dependent behavior는 후속 단계로 미룬다

## Open Questions
- 없음. 이번 슬라이스 범위를 정하는 데 필요한 핵심 질문은 정리되었다.

## Next Steps
-> `/prompts:ce-plan`으로 `owned command I/O parity contract` 구현 계획을 작성한다
-> planning에서는 contract module shape, fixture/snapshot 전략, qmd upgrade verification checklist를 구체화한다
