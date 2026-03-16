---
date: 2026-03-16
topic: mcp-passthrough-compatibility
---

# MCP Passthrough Compatibility

## What We're Building
K-QMD의 현재 CLI passthrough 전략을 MCP에도 적용할 수 있는지 평가한다. 목표는 단순히 `qmd mcp` 서버가 뜨는지 확인하는 것이 아니라, upstream MCP entrypoint를 유지한 채 MCP tool surface 전체가 K-QMD의 owned runtime/policy와 일관되게 동작할 수 있는지 판단하는 것이다.

성공 기준은 all-or-nothing이다. 일부 tool만 downstream 로직을 타는 혼합 상태는 제품 계약으로 인정하지 않는다. 사용자는 upstream이 문서화한 MCP 진입점과 transport를 그대로 사용하되, 실제 tool 호출 결과와 상태가 K-QMD의 owned CLI surface와 같은 세계관을 보여야 한다.

## Why This Approach
처음 가설은 CLI passthrough처럼 MCP도 passthrough 가능할 수 있다는 것이었다. 하지만 upstream 구현을 확인한 결과, `qmd mcp`는 CLI 명령을 재호출하지 않고 별도의 MCP server 모듈을 직접 띄운다. 그 안에서 tool handler는 `createStore()`가 반환한 upstream store API를 직접 호출해 `query`, `get`, `multi_get`, `status`를 수행한다.

이 구조에서는 단순 replacement-distribution만으로 K-QMD의 owned `search/query/status/update/embed` 로직이 자연스럽게 개입하지 않는다. 따라서 이번 평가의 핵심은 "MCP passthrough가 되는가"가 아니라 "upstream MCP entrypoint를 유지한 채 전체 MCP tool surface를 K-QMD 정책과 정합적으로 만들 수 있는가"가 된다.

## Key Decisions
- 성공 기준은 `서버 기동`이 아니라 `전체 tool surface 정합성`이다: `qmd mcp`가 뜨는 것만으로는 충분하지 않고, MCP의 `query/get/multi_get/status`가 K-QMD 계약과 일관돼야 한다.
- 평가는 `all or nothing`으로 본다: 일부 tool만 downstream화된 혼합 상태는 사용자 계약으로 부적절하다.
- 첫 조사 축은 `실행 경로 확인`이다: upstream MCP가 CLI/bin 재호출인지 library 직결인지 먼저 확인한다.
- 현재까지의 조사 결론은 `library 직결`이다: upstream MCP server는 CLI passthrough를 재사용하지 않고 upstream `createStore()`와 store methods를 직접 호출한다.
- 따라서 `순수 MCP passthrough`가 행복 경로일 수는 있어도, 현재 구조만으로는 성립 가능성이 낮다: 추가 adapter 또는 owned MCP layer 없이 downstream owned 로직이 자동 적용되기 어렵다.

## Resolved Questions
- 무엇을 평가할 것인가?: MCP 기능 범위 확장 여부가 아니라, CLI passthrough 정책처럼 MCP passthrough가 가능한지 평가한다.
- 성공 기준은 무엇인가?: upstream MCP entrypoint를 거의 그대로 유지한 채 전체 tool surface가 K-QMD 정책과 일관되게 동작해야 한다.
- 부분 성공도 허용하는가?: 아니다. 사용자 계약 관점에서는 all-or-nothing으로 판단한다.
- 첫 검증 대상은 무엇인가?: 사용자 가치보다 먼저 upstream MCP의 실제 실행 경로를 확인한다.

## Open Questions
- upstream MCP server를 유지하면서 store layer만 치환하거나 감쌀 수 있는 현실적인 interception seam이 있는가?
- interception seam이 없다면, K-QMD가 얇은 MCP adapter를 소유하면서도 upstream MCP surface와 drift를 감당할 수 있는가?
- MCP에서 기대하는 "전체 tool surface 정합성" 범위에 `query/get/multi_get/status`만 포함하면 충분한가, 아니면 HTTP transport/daemon/status 표시까지 같은 제품 계약으로 묶어야 하는가?

## Next Steps
-> `/prompts:ce-plan`에서 다음 작업을 계획한다:
1. upstream MCP server의 seam 후보를 더 깊게 조사한다.
2. pure passthrough 불가 시 adapter-owned MCP 대안을 설계한다.
3. MCP compatibility claim을 위한 최소 테스트/문서 계약을 정의한다.
