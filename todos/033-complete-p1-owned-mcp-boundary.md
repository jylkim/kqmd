---
status: complete
priority: p1
issue_id: "033"
tags: [typescript, mcp, cli, compatibility, architecture]
dependencies: []
---

# Add owned MCP boundary for K-QMD

## Problem Statement

`qmd mcp` is still a passthrough command even though the product goal is for MCP tool execution to reflect K-QMD-owned query/status policy. Upstream MCP opens its own store directly, so current CLI passthrough routing does not preserve K-QMD semantics for MCP clients.

## Findings

- `mcp` is still declared as a passthrough route in `src/commands/manifest.ts`.
- `src/cli.ts` delegates passthrough commands directly to the upstream binary.
- Installed upstream `@tobilu/qmd` MCP server handles `query/get/multi_get/status` by directly calling upstream store methods.
- The deepened plan at `docs/plans/2026-03-16-feat-mcp-compatibility-ownership-boundary-plan.md` closes scope around an owned MCP boundary, shared query/status core, and upstream-compatible transport shape.

## Proposed Solutions

### Option 1: Keep passthrough and only document the limitation

**Approach:** Leave `qmd mcp` delegated and explicitly state that MCP does not use K-QMD-owned semantics.

**Pros:**
- Lowest implementation cost
- No new MCP code to maintain

**Cons:**
- Fails the accepted product contract
- Leaves CLI and MCP semantics split

**Effort:** 1-2 hours

**Risk:** High

---

### Option 2: Own the MCP boundary locally

**Approach:** Route `qmd mcp` locally, implement stdio/HTTP transport in K-QMD, and connect MCP tools to K-QMD-owned query/status semantics.

**Pros:**
- Matches the agreed product direction
- Gives K-QMD control over semantics, testing, and drift handling

**Cons:**
- Requires new MCP code and contract tests
- Introduces additional maintenance surface

**Effort:** 1-2 days

**Risk:** Medium

## Recommended Action

Implement Option 2 in small slices:
1. Own the `mcp` route and add a local command handler.
2. Build a minimal stdio MCP server with `query/get/multi_get/status` and `qmd://{path}`.
3. Reuse K-QMD-owned query/status policy where it matters and keep retrieval wrappers thin.
4. Add HTTP/daemon support, contract tests, and docs only after stdio parity is stable.

## Technical Details

**Affected files:**
- `src/commands/manifest.ts`
- `src/types/command.ts`
- `src/cli.ts`
- `src/commands/owned/help.ts`
- `src/commands/owned/query.ts`
- `src/commands/owned/status.ts`
- `src/commands/owned/runtime.ts`
- `test/cli-routing.test.ts`
- `test/path-compatibility.test.ts`

**Planned new files:**
- `src/commands/owned/mcp.ts` or `src/mcp/cli.ts`
- `src/mcp/server.ts`
- `src/mcp/schema.ts`
- `src/mcp/resources.ts`
- `src/mcp/core/query_tool.ts`
- `src/mcp/core/status_tool.ts`
- `test/mcp/*.test.ts`

## Resources

- Plan: `docs/plans/2026-03-16-feat-mcp-compatibility-ownership-boundary-plan.md`
- Brainstorm: `docs/brainstorms/2026-03-16-mcp-passthrough-compatibility-brainstorm.md`
- Upstream MCP baseline: `node_modules/@tobilu/qmd/dist/mcp/server.js`
- Learnings: `docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md`

## Acceptance Criteria

- [x] `mcp` is no longer routed as a passthrough command
- [x] Local MCP server exists with stdio support and upstream-compatible tool/resource names
- [x] MCP `query` uses K-QMD-owned query/search policy instead of upstream raw `store.search(...)`
- [x] MCP `status` reuses K-QMD-owned health vocabulary
- [x] Relevant tests pass and the plan checklist is updated as work completes

## Work Log

### 2026-03-16 - Work kickoff

**By:** Codex

**Actions:**
- Reviewed the deepened MCP ownership plan
- Confirmed the user wants to proceed on `main`
- Audited current CLI routing, owned command types, and parser/help boundaries
- Chose a file-based todo to track execution slices

**Learnings:**
- The initial implementation can start with routing and stdio ownership before HTTP/daemon support
- Query/status reuse seams already exist; retrieval should stay thin in v1

### 2026-03-16 - Implementation complete

**By:** Codex

**Actions:**
- Moved `mcp` from passthrough to owned routing and added owned help/command handling
- Added local MCP server, HTTP transport, daemon lifecycle helpers, and daemon state inspection
- Extracted shared `query_core` / `status_core` helpers so CLI and MCP reuse the same decisions
- Added MCP route/stdio/in-memory/HTTP contract tests and wired them into `test:release-contract`
- Updated README, architecture docs, development docs, and review context to reflect MCP ownership
- Ran `bun run lint`, `bun run typecheck`, `bun run test:release-contract`, and `bun run check`

**Learnings:**
- MCP ownership can land without expanding CLI retrieval ownership if query/status policy reuse is extracted first
- In-memory MCP transport is a good fit for contract tests, while HTTP client coverage catches real session/route integration
