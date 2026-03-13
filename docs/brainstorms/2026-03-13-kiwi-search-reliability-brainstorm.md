---
date: 2026-03-13
topic: kiwi-search-reliability
---

# Kiwi Search Reliability Brainstorm

## What We're Building
이번 마일스톤은 K-QMD의 Kiwi 기반 한국어 `qmd search`가 실제로 믿고 쓸 수 있는 상태인지 확인하고, 부족한 부분이 있다면 `search` 단독이 아니라 `update`와 `status`까지 포함한 계약으로 보완하는 것이다. 핵심은 “한국어 검색 recall이 좋아졌다”를 넘어서, 사용자가 `qmd update`를 실행한 뒤 shadow index가 실제로 같은 세대로 맞춰져 있고, `qmd status`가 그 상태를 신뢰 가능하게 설명하며, `qmd search`가 그 전제 위에서 안정적으로 동작하는지를 고정하는 데 있다.

이 작업의 범위는 `search/update/status`까지다. `embed` owned 여부나 `query`의 장기 경계는 이번 슬라이스에 포함하지 않는다. 이번 결정은 먼저 Kiwi search의 운영 신뢰성을 제품 수준에서 닫고, 그다음에 다른 owned command 경계를 재검토하기 위한 기반을 만드는 것이다.

## Why This Approach
세 가지 접근을 검토했다.

`Approach A: search reliability milestone`
`search`, `update`, `status`를 하나의 한국어 검색 계약으로 보고, `qmd update` 성공 조건에 Kiwi shadow index 동기화를 포함한다. 자동화 테스트와 실제 CLI 흐름 검증을 함께 사용해 stale 없는 성공과 명확한 실패를 증명하는 접근이다.

Pros:
- 지금 가장 중요한 실패 유형인 “update는 끝났지만 shadow index는 stale” 문제를 정면으로 다룬다
- 기존 owned command 구조를 유지하면서도 제품 신뢰도를 올릴 수 있다
- `search` 품질 논의를 상태 계약과 함께 다룰 수 있다

Cons:
- `embed`나 `query` ownership 재정의는 뒤로 미뤄진다
- 품질 향상보다 상태 일관성 검증이 먼저라 체감 기능 변화는 작을 수 있다

Best when:
- 지금 가장 필요한 것이 “Kiwi search를 실제로 믿을 수 있는가”를 검증하는 일일 때 적합하다

`Approach B: readiness/status gate 중심 정리`
`status` 표현과 문서화를 더 강화해 release gate에 가까운 readiness 체계를 먼저 정리한다. clean/stale/mismatch/fallback 상태를 더 세밀하게 보여 주는 데 초점을 둔다.

Pros:
- 운영 상태를 이해하기 쉬워진다
- 배포 판단 기준을 만들기 좋다

Cons:
- 실제 failure contract 보강보다 표현 계층 정리가 앞설 수 있다
- 이번 문제의 핵심인 `update` 성공 조건을 직접 고정하지 못할 수 있다

Best when:
- 내부 운영 기준과 가시성이 가장 급할 때 적합하다

`Approach C: search 안정화와 command boundary 재검토를 함께 진행`
Kiwi search 검증과 동시에 `embed/query`를 계속 owned로 둘지까지 함께 정리한다. 기능 경계 재설계까지 한 번에 다루는 접근이다.

Pros:
- 장기 command ownership 논의를 일찍 연결할 수 있다

Cons:
- 이번 범위가 흐려지고, reliability milestone이 제품 경계 논의에 묻힐 수 있다
- 현재 사용자 문제를 닫는 데 필요한 집중력이 떨어진다

Best when:
- command boundary 재설계가 reliability 자체보다 더 급할 때 적합하다

추천안은 `Approach A`다. 현재 저장소에는 Kiwi tokenizer, shadow index, health helper, fallback path, hardening 문서가 이미 있어 완전히 새 기능을 설계하는 단계는 지났다. 지금 필요한 것은 신뢰성 계약을 고정하고, 그 계약이 테스트와 실제 CLI 흐름에서 모두 성립하는지 확인하는 일이다.

## Key Decisions
- Primary scope: 이번 마일스톤의 중심 범위는 `search`이며, 실제 검증 범위는 `update/status`까지 포함한다
- Reliability contract: Kiwi search 완성도의 1차 기준은 검색 품질 자체보다 shadow index 운영 일관성이다
- Success condition: `qmd update`의 성공 조건에는 Kiwi shadow index가 같은 세대로 동기화되는 것이 포함된다
- Failure policy: Kiwi 준비나 shadow rebuild를 끝내지 못하면 `qmd update`는 성공처럼 끝나면 안 된다
- User experience priority: upstream `qmd`의 사용자 경험을 기준선으로 보되, K-QMD에서는 Kiwi shadow index를 본업 일부로 본다
- Verification evidence: 자동화된 계약 테스트와 실제 CLI 사용 검증이 둘 다 필요하다
- Health expectation: `qmd status`가 clean이라고 말하면 실제 `qmd search`도 그 전제를 만족해야 한다
- Non-goal: 이번 슬라이스에서는 `embed` owned 여부와 `query` ownership 재조정은 다루지 않는다

## Resolved Questions
- 이번 검토 범위는 무엇인가?: `search` 중심으로 보되, `update/status` 연동까지 포함한다
- 무엇이 가장 중요한 성공 기준인가?: 검색 품질보다 먼저 운영 안정성이다
- 가장 먼저 막아야 할 실패 유형은 무엇인가?: `update`는 성공했지만 shadow index가 stale로 남는 경우다
- Kiwi shadow index는 부가 기능인가 본업인가?: K-QMD에서는 `qmd update`의 본업 일부로 본다
- Kiwi 준비가 안 된 상태에서 `update`는 어떻게 끝나야 하는가?: 성공처럼 끝나면 안 되며, 명확히 실패해야 한다
- 어떤 증거로 완성도를 판단할 것인가?: 테스트와 실제 CLI 흐름 검증을 함께 본다
- `embed`는 이번 문서에서 다루는가?: 아니다. 이번 브레인스토밍 범위에서 제외한다

## Open Questions
없음. 구현과 검증 세부사항은 planning 단계에서 구체화한다.

## Next Steps
-> `/prompts:ce-plan`으로 `search/update/status` 신뢰성 계약을 구현 계획으로 전개한다
-> `qmd update` 성공 조건, stale 방지 정책, `status` health 의미를 테스트 가능한 acceptance criteria로 바꾼다
-> 실제 CLI 검증 시나리오를 함께 정의해 automated test와 manual proof를 모두 확보한다
