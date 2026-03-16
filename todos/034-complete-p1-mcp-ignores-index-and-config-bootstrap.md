---
status: complete
priority: p1
issue_id: "034"
tags: [code-review, mcp, cli, compatibility, runtime, typescript]
dependencies: []
---

# MCP runtime ignores --index and config bootstrap

## Problem Statement

The new owned MCP entrypoint does not honor the same index-selection and config/bootstrap rules as the rest of the owned CLI surface. This breaks compatibility for users who rely on `--index <name>` or a config-defined index that has not been materialized to SQLite yet.

## Findings

- `handleMcpCommand()` parses the raw argv but never uses `context.indexName`, so `qmd --index work mcp` is treated the same as `qmd mcp` ([src/commands/owned/mcp.ts:159](/Users/jylkim/kqmd/src/commands/owned/mcp.ts#L159)).
- `startOwnedMcpServer()` always opens `getDefaultDbPath('index', env)` and never consults a named index or config path ([src/mcp/server.ts:552](/Users/jylkim/kqmd/src/mcp/server.ts#L552)).
- `startOwnedMcpHttpServer()` repeats the same fixed `index.sqlite` open path ([src/mcp/server.ts:562](/Users/jylkim/kqmd/src/mcp/server.ts#L562)).
- This bypasses the owned runtime policy already used by `query`/`status`, where config-file mode is selected when the DB is absent but config exists ([src/commands/owned/runtime.ts:101](/Users/jylkim/kqmd/src/commands/owned/runtime.ts#L101)).

## Proposed Solutions

### Option 1: Thread indexName into MCP startup and reuse owned runtime path resolution

**Approach:** Pass `context.indexName` from `handleMcpCommand()` into the MCP server bootstrap and choose `{ dbPath, configPath? }` via the same runtime rules as other owned commands.

**Pros:**
- Preserves CLI compatibility
- Reuses an existing policy seam
- Fixes both stdio and HTTP/daemon modes together

**Cons:**
- Requires plumbing startup options through the MCP boundary
- Needs new tests for named index and config-file mode

**Effort:** 2-4 hours

**Risk:** Medium

---

### Option 2: Add a dedicated MCP runtime resolver

**Approach:** Build a transport-agnostic runtime helper specifically for MCP startup, mirroring owned command behavior.

**Pros:**
- Keeps MCP bootstrap explicit
- Easier to extend for future MCP-only runtime differences

**Cons:**
- Risks duplicating existing runtime logic
- More code to keep in sync with owned CLI behavior

**Effort:** 4-6 hours

**Risk:** Medium

## Recommended Action

Use Option 1. Treat MCP bootstrap as another caller of the owned runtime policy rather than inventing a new path-resolution layer.

## Technical Details

**Affected files:**
- [src/commands/owned/mcp.ts](/Users/jylkim/kqmd/src/commands/owned/mcp.ts)
- [src/mcp/server.ts](/Users/jylkim/kqmd/src/mcp/server.ts)
- [src/commands/owned/runtime.ts](/Users/jylkim/kqmd/src/commands/owned/runtime.ts)
- [test/mcp-runtime.test.ts](/Users/jylkim/kqmd/test/mcp-runtime.test.ts)

## Resources

- Review context: current working tree on `main`
- Related runtime pattern: [docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md](/Users/jylkim/kqmd/docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)

## Acceptance Criteria

- [x] `qmd --index <name> mcp` opens the named index rather than hard-coded `index.sqlite`
- [x] MCP stdio and HTTP modes honor config-file bootstrap when config exists and DB does not
- [x] Regression tests cover named-index startup and config-file startup
- [x] MCP bootstrap semantics match owned CLI runtime policy

## Work Log

### 2026-03-16 - Code review finding

**By:** Codex

**Actions:**
- Reviewed MCP routing and startup code
- Compared MCP bootstrap path with owned runtime policy used by `query`/`status`
- Identified fixed `index.sqlite` startup as a compatibility regression

**Learnings:**
- The MCP ownership work reused query/status semantics, but not the startup/runtime selection rules

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Threaded runtime-derived startup options through MCP stdio/HTTP bootstrap
- Preserved explicit `--index` selection for daemon child startup
- Reused `resolveOwnedRuntimePlan('mcp', ...)` so MCP startup now follows owned runtime policy
- Added named-index and config-bootstrap regression tests

**Learnings:**
- MCP startup compatibility is part of runtime selection, not just transport/server wiring
