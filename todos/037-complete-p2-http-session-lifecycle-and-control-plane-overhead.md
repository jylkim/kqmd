---
status: complete
priority: p2
issue_id: "037"
tags: [code-review, performance, mcp, daemon, runtime, typescript]
dependencies: []
---

# HTTP MCP sessions are unbounded and re-run expensive setup work

## Problem Statement

The HTTP MCP server accumulates session objects without any idle eviction and rebuilds expensive per-session server state on each initialize. In daemon mode this can grow memory usage over time and erode the value of keeping the server warm.

## Findings

- A new `McpServer` and `StreamableHTTPServerTransport` are created for every initialize request and stored in `sessions` ([src/mcp/server.ts:586](/Users/jylkim/kqmd/src/mcp/server.ts#L586)).
- Session removal only happens through `transport.onclose`, with no TTL or upper bound for abandoned sessions ([src/mcp/server.ts:599](/Users/jylkim/kqmd/src/mcp/server.ts#L599)).
- `createOwnedMcpServer()` always rebuilds instructions from `readStatusCore()`, `listContexts()`, and `getGlobalContext()` during session creation ([src/mcp/server.ts:145](/Users/jylkim/kqmd/src/mcp/server.ts#L145), [src/mcp/server.ts:186](/Users/jylkim/kqmd/src/mcp/server.ts#L186)).
- `executeQueryCore()` also re-reads collection/default-selection/embedding-health state on every query request ([src/commands/owned/query_core.ts:34](/Users/jylkim/kqmd/src/commands/owned/query_core.ts#L34)).

## Proposed Solutions

### Option 1: Add session TTL/upper bound and cache immutable setup results

**Approach:** Bound the `sessions` map with idle cleanup, and reuse stable instruction/control-plane data where safe.

**Pros:**
- Addresses both memory growth and repeated setup overhead
- Preserves current user-facing behavior

**Cons:**
- Requires cache invalidation rules for instruction data

**Effort:** 3-5 hours

**Risk:** Medium

---

### Option 2: Use stateless HTTP mode for JSON-response paths

**Approach:** Keep `/query` and `/search` stateless while limiting session-backed MCP to explicit protocol usage.

**Pros:**
- Smaller long-lived session surface

**Cons:**
- Still leaves `/mcp` session growth unsolved
- More branching between transport behaviors

**Effort:** 2-4 hours

**Risk:** Medium

## Recommended Action

Implement Option 1. The daemon server should stay warm without accumulating abandoned session state or repeating initialization queries unnecessarily.

## Technical Details

**Affected files:**
- [src/mcp/server.ts](/Users/jylkim/kqmd/src/mcp/server.ts)
- [src/commands/owned/query_core.ts](/Users/jylkim/kqmd/src/commands/owned/query_core.ts)
- [test/mcp-http.test.ts](/Users/jylkim/kqmd/test/mcp-http.test.ts)
- [docs/benchmarks/2026-03-16-mcp-contract-metrics.md](/Users/jylkim/kqmd/docs/benchmarks/2026-03-16-mcp-contract-metrics.md)

## Resources

- Performance review finding
- Known runtime ownership pattern: [docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md](/Users/jylkim/kqmd/docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)

## Acceptance Criteria

- [x] HTTP MCP sessions have a bounded lifecycle (TTL or explicit cleanup strategy)
- [x] Session creation does not repeat unnecessary control-plane reads on every initialize
- [x] MCP daemon soak tests cover repeated reconnects
- [x] Benchmark notes capture the before/after impact

## Work Log

### 2026-03-16 - Code review finding

**By:** Codex

**Actions:**
- Reviewed HTTP session map lifecycle and per-session server creation
- Compared session lifecycle with the project’s warm-daemon goals

**Learnings:**
- Warm daemon semantics are undercut if every reconnect rebuilds instruction state and abandoned sessions never expire

### 2026-03-16 - Resolution complete

**By:** Codex

**Actions:**
- Added session TTL and periodic eviction to the HTTP MCP session map
- Cached initialize instructions and collection/default-selection metadata across HTTP sessions
- Updated HTTP tests to assert metadata cache reuse and session expiry behavior
- Verified with `bun run test -- test/mcp-http.test.ts test/mcp-server.test.ts test/query-core.test.ts test/mcp-runtime.test.ts`
- Verified with `bun run typecheck`

**Learnings:**
- The smallest safe fix was to cache per-server metadata and bound sessions, without changing the external transport contract
