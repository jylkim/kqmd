---
date: 2026-03-11
topic: owned-command-runtime
---

# Owned Command Runtime Brainstorm

## What We're Building
K-QMD의 첫 실제 구현 슬라이스는 `search`, `query`, `update`, `embed`가 공통으로 사용할 `owned command runtime`이다. 이 레이어는 각 명령의 사용자 경험이나 출력 포맷을 구현하는 것이 아니라, upstream-compatible index 경로 해석, QMD store bootstrap, 공통 실패 분류를 담당한다.

목표는 owned command들이 더 이상 동일한 stub가 아니라 같은 실행 기반 위에서 움직이게 만드는 것이다. 이 기반이 있어야 이후 스프린트에서 `search/query` 같은 read path와 `update/embed` 같은 mutation path를 같은 진입 구조 안에서 점진적으로 구현할 수 있다.

## Why This Approach
세 가지 범위를 비교했다.

`Approach A: store bootstrap only`
`--index`와 env를 바탕으로 `dbPath`와 `configPath`를 계산하고 `@tobilu/qmd`의 `createStore()`를 열고 닫는 최소 레이어만 만든다.

Pros:
- 가장 작고 빠르게 만들 수 있다
- owned command 공통 기반을 시작할 수 있다

Cons:
- 실패가 그대로 raw upstream/runtime error로 새어 나온다
- 실제 command handler에서 같은 에러 정리를 반복하게 될 가능성이 높다

Best when:
- 진짜 최소 seam만 먼저 만들고 후속 스프린트에서 에러 정책을 다시 붙일 때 적합하다

`Approach B: store bootstrap + common error handling`
bootstrap에 더해 config 없음, store open 실패 같은 공통 실패를 K-QMD 의미로 정리한다.

Pros:
- 첫 번째 공통 인프라로 충분히 가치가 있다
- command별 구현 전에 에러 경계를 안정화할 수 있다
- formatter나 command-specific parsing까지 번지지 않는다

Cons:
- bootstrap-only보다 범위가 약간 넓다

Best when:
- 첫 구현 슬라이스가 너무 얇지도, 너무 넓지도 않아야 할 때 적합하다

`Approach C: bootstrap + error handling + full command input contract`
공통 runtime에 더해 `search/query/update/embed`의 옵션 규약과 execution context까지 한 번에 정한다.

Pros:
- 이후 command 구현 시 구조가 더 빨리 고정된다

Cons:
- command-specific parsing과 UX 설계로 빠르게 번진다
- 아직 필요한 shape를 충분히 모르는 상태에서 너무 일찍 계약을 굳힐 수 있다

Best when:
- 각 명령의 제품 요구가 이미 충분히 구체적일 때 적합하다

추천안은 `Approach B`다. 현재 저장소 상태에서는 runtime seam과 공통 에러 경계를 먼저 만드는 것이 가장 합리적이고, 이후 `search/query/update/embed` 구현을 위한 재사용 기반도 가장 잘 마련된다.

## Key Decisions
- First implementation slice: 첫 구현 슬라이스는 feature command가 아니라 `owned command runtime`이다
- Runtime responsibility: 이 레이어는 path resolution, store bootstrap, common error classification까지만 맡는다
- Runtime base: owned command는 subprocess passthrough가 아니라 `@tobilu/qmd` SDK의 `createStore()` 위에서 동작한다
- Error scope: 첫 슬라이스의 공통 에러 처리는 `config missing`과 `store open failure`까지만 다룬다
- Error deferral: 모델, embedding, `sqlite-vec` 같은 vector/runtime 의존성 문제는 command-specific concern으로 남긴다
- Reopen policy: `search`와 `query`는 config 파일이 없어도 기존 DB가 있으면 `DB-only reopen`을 허용한다
- Strict config policy: `update`처럼 설정이 필요한 명령에서만 config 없음 에러를 강하게 낸다
- YAGNI boundary: formatter, result shaping, command별 옵션 계약은 이번 슬라이스 범위에서 제외한다

## Resolved Questions
- 무엇을 먼저 구현할 것인가?: command 하나가 아니라 네 개 owned 명령이 공통으로 쓰는 runtime layer를 먼저 만든다
- 첫 슬라이스 종료 조건은 무엇인가?: `store bootstrap + common error handling`까지를 완료 기준으로 본다
- 어떤 에러를 공통 레이어에서 다룰 것인가?: `config missing`과 `store open failure`만 공통 처리한다
- vector/model 의존성 문제도 공통 처리할 것인가?: 아니다. 이는 `qmd`가 이미 많이 설명해 주는 영역이라 command-specific handling으로 미룬다
- config 파일이 없을 때 read path는 어떻게 할 것인가?: `search/query`는 기존 DB가 있으면 `DB-only reopen`을 허용한다

## Open Questions
- 없음. 세션 범위의 핵심 질문은 모두 정리되었다.

## Next Steps
-> `/prompts:ce-plan`으로 `owned command runtime` 구현 계획을 작성한다
-> planning에서는 runtime module shape, error type shape, read-only vs mutation command policy를 세부화한다
