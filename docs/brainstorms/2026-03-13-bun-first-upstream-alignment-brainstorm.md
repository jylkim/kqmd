---
date: 2026-03-13
topic: bun-first-upstream-alignment
---

# Bun-First Upstream Alignment

## What We're Building
K-QMD 저장소의 개발, 테스트, 빌드, 검증, 배포 준비 흐름을 Bun-first 기준으로 정렬한다. 지금처럼 upstream `qmd`를 추적 기준선으로 삼되, 레포 운영 방식만 Node/npm 중심에 남겨 두는 상태를 끝내고, upstream과 비슷한 도구 감각으로 움직일 수 있게 만드는 것이 목적이다.

이 변경은 사용자에게 노출되는 제품 정체성을 바꾸려는 것이 아니다. 패키지는 계속 `kqmd`로 배포하고, 사용자가 실행하는 명령은 계속 `qmd`이며, upstream compatibility와 owned/passthrough command boundary도 유지한다. 달라지는 것은 “이 저장소를 어떻게 개발하고 검증하느냐”의 기본값이다.

## Why This Approach
세 가지 접근을 비교했다.

`Approach A: Full Bun-first repo conversion`
레포 전반의 기본 package manager와 실행 흐름을 Bun으로 통일한다. 개발 문서, lockfile, 스크립트 진입점, 검증 루틴, 버전 bump 체크리스트도 이 기준으로 맞춘다.

Pros:
- upstream이 Bun 쪽으로 이동하더라도 추적 비용이 줄어든다
- 개발자 경험, 검증 흐름, 런타임 확인 기준을 한 방향으로 정리할 수 있다
- 작은 저장소에서 이중 체계를 유지하는 비용을 피할 수 있다

Cons:
- 기존 npm 기반 습관과 문서를 한 번에 바꿔야 한다
- 일부 smoke/publish/entrypoint 검증에서 Bun과 Node의 경계가 다시 드러날 수 있다

Best when:
- 저장소 규모가 작고, upstream alignment를 빠르게 높이고 싶을 때 적합하다

`Approach B: Dual support for npm and Bun`
`npm`과 `bun`을 둘 다 지원하는 혼합 운영으로 간다. 사용자나 기여자가 어느 쪽을 써도 되게 한다.

Pros:
- 전환 충격이 작다
- 특정 개발 환경에서 대응 폭이 넓다

Cons:
- 문서, lockfile, 테스트 기준, 버그 재현 방식이 다시 두 갈래로 갈라진다
- “우리가 무엇을 기준으로 검증했는가”가 흐려진다

Best when:
- 큰 팀이나 외부 기여자 풀이 넓어서 강한 표준화를 밀기 어려울 때 적합하다

`Approach C: Keep Node-first and add Bun-only checks`
현재 운영은 유지하고, upstream drift를 감지하는 보조 체크만 Bun 관점으로 더한다.

Pros:
- 현재 저장소 변화량이 가장 작다
- 일부 위험만 빠르게 줄일 수 있다

Cons:
- 개발자 경험, 검증, 배포 감각의 중심은 계속 갈라진다
- 사용자가 느끼는 “업스트림과 같은 방향으로 간다”는 신뢰를 만들기 어렵다

Best when:
- 저장소 전환을 당장 감당하기 어렵고 임시 완충재가 필요할 때 적합하다

추천안은 `Approach A`다. 사용자 의도는 “gap을 관리하는 체계”보다 “gap 자체를 없애는 방향”에 가깝고, 현재 저장소 규모도 전체 Bun-first 전환을 감당할 만큼 작다. YAGNI 관점에서도 이중 체계를 유지하는 것보다 기준을 하나로 줄이는 편이 단순하다.

## Key Decisions
- Repo operating mode: K-QMD는 저장소 운영 기준을 Bun-first로 전환한다
- Scope: 개발, 테스트, 빌드, 포맷, 타입체크, parity 검증, publish 검증 문서까지 전환 범위에 포함한다
- Package manager policy: npm 기반 lockfile과 npm-first 안내는 제거하고 Bun 기준 lockfile과 명령 안내를 기본으로 둔다
- Upstream alignment goal: upstream이 Bun을 쓰는 만큼 우리도 같은 감각으로 버전 bump와 drift 추적을 수행한다
- Product identity: 패키지 이름 `kqmd`, 실행 명령 `qmd`, replacement distribution framing은 유지한다
- Compatibility boundary: owned/passthrough command boundary와 upstream compatibility policy는 유지한다
- Verification goal: Bun 전환 뒤에도 owned command parity, path compatibility, bin smoke, publish artifact 검증은 계속 핵심 품질 게이트로 남긴다
- Non-goal: 이번 결정은 `qmd` 사용자-facing 명령 semantics를 재설계하는 작업이 아니다
- Non-goal: npm과 Bun의 장기 병행 지원은 목표로 두지 않는다

## Resolved Questions
- DX, 검증, 런타임 갭 중 무엇을 우선할 것인가?: 셋을 따로 쪼개지 않고 Bun-first 전환으로 한 번에 정렬한다
- 저장소가 hybrid toolchain을 유지해야 하는가?: 아니다. 작은 저장소인 만큼 기준을 하나로 줄인다
- 변경의 중심이 문서/툴링인가, 제품 동작 자체인가?: 중심은 저장소 운영 기준과 검증 흐름이며, 사용자-facing 계약은 유지한다

## Open Questions
없음. 구현 순서와 세부 작업 분해는 planning 단계에서 정한다.

## Next Steps
-> `/prompts:ce-plan`으로 Bun-first 전환 계획을 세운다
-> package manager, script surface, 검증 루틴, 문서 업데이트를 한 마일스톤으로 묶는다
-> upstream version bump와 parity/publish smoke 절차를 Bun 기준으로 다시 정리한다
