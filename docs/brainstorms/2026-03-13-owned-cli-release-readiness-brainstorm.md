---
date: 2026-03-13
topic: owned-cli-release-readiness
---

# Owned CLI Release Readiness Brainstorm

## What We're Building
이번 마일스톤은 최근 고도화된 Kiwi 기반 동작을 포함해 K-QMD의 owned CLI 전체(`search/query/update/embed/status`)를 첫 릴리즈 품질로 끌어올리기 위한 release-readiness 정리다. 핵심은 “기능이 대체로 돌아간다”가 아니라, 사용자가 owned surface를 실행했을 때 명령 의미와 실제 동작이 어긋나지 않고, release 직전에도 그 계약을 빠르게 다시 확인할 수 있게 만드는 것이다.

우선순위는 배포 편의보다 기능 신뢰성이다. 특히 `status`가 설명하는 상태와 실제 `search/query/update/embed` 행동이 엇갈리면 안 되고, owned surface에 들어온 이상 `does not yet support` 같은 명시적 non-support도 첫 릴리즈에서는 남기지 않는다. package/publish 검증은 필요하지만, 이번 릴리즈에서는 기능 계약을 전달하는 보조 게이트로 둔다.

## Why This Approach
세 가지 접근을 검토했다.

`Approach A: 계약 폐쇄 + 릴리즈 게이트`
먼저 owned CLI의 남은 계약 구멍을 닫고, 그다음 그 계약을 로컬 release gate로 고정한다. 즉 unsupported flag와 command behavior gap을 먼저 해소하고, 이후 owned surface 전체를 다시 확인하는 package script와 release checklist를 둔다.

Pros:
- 가장 중요한 `No-Go`인 기능 신뢰성 문제를 정면으로 다룬다
- 첫 릴리즈에서 허용하지 않기로 한 explicit non-support를 실제로 제거할 수 있다
- 범위를 과하게 넓히지 않고도 “출시 가능한 owned CLI”라는 의미를 만들 수 있다

Cons:
- upstream의 모든 세부 parity를 한 번에 다 닫지는 못할 수 있다
- CI나 heavier publish automation은 후순위로 남는다

Best when:
- 이번 릴리즈를 현실적으로 끝내면서도 owned CLI의 사용자-facing contract는 단단히 닫고 싶을 때 적합하다

`Approach B: strict parity release`
owned CLI 전체를 더 넓은 upstream parity 기준으로 닫는다. 옵션/usage/output drift를 더 광범위하게 추적하고, subprocess parity와 stronger release automation까지 함께 끌어올리는 접근이다.

Pros:
- 릴리즈 후 surprising drift 가능성이 가장 낮다
- 장기 유지보수 기준이 아주 명확해진다

Cons:
- 첫 릴리즈 범위가 빠르게 커진다
- parity chase가 실제 릴리즈를 지연시킬 수 있다

Best when:
- 출시 시점보다 “한 번 내놓을 때 최대한 엄격하게”가 더 중요할 때 적합하다

`Approach C: 자동화 우선 audit`
먼저 release harness와 자동화 검증을 세우고, 그 결과가 드러내는 기능 gaps를 따라 닫는다. 구현보다 검증 틀을 먼저 세우는 접근이다.

Pros:
- 회귀 방지 체계가 빠르게 생긴다
- 빠뜨린 release risk를 구조적으로 찾기 쉽다

Cons:
- 현재 이미 보이는 기능 gaps를 닫는 속도는 늦어질 수 있다
- 가장 중요한 기능 신뢰성 개선이 체감되기까지 시간이 걸린다

Best when:
- 남은 문제의 대부분이 구현보다 검증 부재라고 볼 때 적합하다

추천안은 `Approach A`다. 현재 저장소는 Kiwi reliability hardening, parity baseline, release go/no-go 문서까지는 이미 갖고 있다. 지금 필요한 것은 unsupported owned behavior를 남기지 않고, owned surface 전체가 release candidate인지 아닌지를 로컬에서 빠르게 재판단할 수 있는 계약을 만드는 일이다.

## Key Decisions
- Primary scope: 첫 릴리즈 품질 범위는 owned CLI 전체(`search/query/update/embed/status`)다
- Priority: 가장 중요한 `No-Go`는 기능 신뢰성이다
- Contract stance: owned surface에 들어온 옵션과 동작은 explicit non-support 상태로 남기지 않는다
- Gap closure goal: 현재 드러난 `query --candidate-limit`, `update --pull` 같은 command capability gap은 릴리즈 전 닫는다
- Release evidence: 개별 unit/parity test만이 아니라 owned command들을 하나의 제품 계약으로 다시 확인하는 release gate가 필요하다
- Automation level: release gate는 local `package.json` scripts와 checklist 수준이면 충분하다
- Packaging stance: `pack`/`publish --dry-run`과 tarball smoke는 보조 검증으로 유지하되, 기능 신뢰성보다 우선하지 않는다
- Documentation stance: README와 개발 문서는 “초기 실험”보다 “이번 릴리즈가 실제로 약속하는 owned contract”를 더 분명히 드러내야 한다
- Non-goal: 이번 결정은 GitHub Actions 같은 필수 CI gate를 전제로 하지 않는다

## Resolved Questions
- 이번 릴리즈는 무엇을 우선하는가?: 기능 신뢰성을 우선하고, 배포 검증은 보조 게이트로 둔다
- 릴리즈 범위는 어디까지인가?: owned CLI 전체(`search/query/update/embed/status`)다
- explicit non-support를 허용하는가?: 아니다. 첫 릴리즈 전 반드시 닫는다
- 추천 접근은 무엇인가?: 계약 폐쇄 후 로컬 release gate로 고정하는 `Approach A`다
- release gate 자동화는 어디까지 필요한가?: local `package.json` scripts와 checklist면 충분하다

## Open Questions
없음. 구현 순서와 세부 acceptance criteria는 planning 단계에서 구체화한다.

## Next Steps
-> `/prompts:ce-plan`으로 owned CLI release-readiness 계획을 세운다
-> 남아 있는 capability gap과 release blocker를 command별로 inventory 한다
-> local release gate script, supporting publish checks, 문서 업데이트를 한 세트로 정리한다
