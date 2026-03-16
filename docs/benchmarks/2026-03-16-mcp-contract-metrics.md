# MCP Contract Metrics

Date: 2026-03-16
Command: `bun run scripts/measure_mcp_contract.ts`

이 문서는 owned MCP boundary 작업에서 측정한 HTTP transport 기준의 로컬 contract metrics 기록이다.
수치는 developer laptop 참고값이며, absolute SLA보다는 regression 비교 기준으로 사용한다.

## Method

- environment:
  - temporary HOME / XDG cache
  - empty local index bootstrap
- transport:
  - local owned `qmd mcp --http` equivalent via `startOwnedMcpHttpServer()`
- measured axes:
  - cold start (HTTP server bootstrap)
  - first `tools/list`
  - warm `query`
  - warm `status`
  - repeated control-plane call (`tools/list` x100)
  - daemon soak proxy (`query + status` in parallel x50)

## Results

| Metric | Value (ms) |
|---|---:|
| cold start | 16.93 |
| first tools/list | 4.50 |
| warm query | 3.39 |
| warm status | 0.98 |
| control-plane avg | 0.43 |
| control-plane p50 | 0.34 |
| control-plane p95 | 0.79 |
| daemon soak avg | 0.72 |
| daemon soak p50 | 0.62 |
| daemon soak p95 | 1.42 |

## Notes

- empty index 기준이라 retrieval/store workload는 가볍다
- 이 문서는 contract overhead와 transport/session reuse regression 신호로 본다
- 실제 query corpus와 long-running daemon memory profile은 별도 follow-up 운영 검증이 필요하다

