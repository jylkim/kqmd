---
status: complete
priority: p2
issue_id: "039"
tags: [code-review, mcp, daemon, reliability, typescript]
dependencies: []
---

# MCP daemon start can report success before the server is actually ready

## Problem Statement

`qmd mcp --http --daemon` returns a success message and writes a PID file immediately after spawning the child process, without verifying that the HTTP server booted successfully. A startup failure can therefore leave a stale PID file and a false positive success response.

## Findings

- `startDaemon()` records `mcp.pid` and prints `Started on ...` immediately after `spawn()` ([src/commands/owned/mcp.ts:102](/Users/jylkim/kqmd/src/commands/owned/mcp.ts#L102)).
- The child may still fail afterward due to port collisions, store open failures, or bootstrap errors.
- There is no readiness probe, health check wait, or handshake before success is reported.

## Proposed Solutions

### Option 1: Wait for child readiness before reporting success

**Approach:** After spawning the daemon, poll `/health` or wait for a startup sentinel before writing the PID file and success message.

**Pros:**
- Eliminates false-positive startup
- Keeps user-facing CLI honest

**Cons:**
- Slightly slower daemon command
- Requires timeout handling and cleanup on failure

**Effort:** 2-3 hours

**Risk:** Medium

---

### Option 2: Keep immediate return but mark startup as provisional

**Approach:** Return a “starting” message and require the caller to verify with `status` or `/health`.

**Pros:**
- Minimal implementation

**Cons:**
- Still leaves stale PID risk
- Weakens CLI contract

**Effort:** 1 hour

**Risk:** Medium

## Recommended Action

Use Option 1. The daemon command should only report success after it knows the child server is actually reachable.

## Technical Details

**Affected files:**
- [src/commands/owned/mcp.ts](/Users/jylkim/kqmd/src/commands/owned/mcp.ts)
- [src/mcp/server.ts](/Users/jylkim/kqmd/src/mcp/server.ts)
- [test/mcp-command.test.ts](/Users/jylkim/kqmd/test/mcp-command.test.ts)
- [scripts/verify_release_artifact.ts](/Users/jylkim/kqmd/scripts/verify_release_artifact.ts)

## Resources

- Code review finding from Kieran-style review

## Acceptance Criteria

- [x] daemon start only returns success after the HTTP server is reachable
- [x] startup failure cleans up any provisional PID state
- [x] tests cover port collision or startup failure paths

## Work Log

### 2026-03-16 - Code review finding

**By:** Codex

**Actions:**
- Reviewed daemon start lifecycle in the owned MCP command
- Noted that success is reported before any readiness proof exists

**Learnings:**
- Long-running process startup needs a readiness boundary, not just a successful spawn

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Added pre-spawn port availability checks for daemon startup
- Added post-spawn health polling and timeout/error handling before writing PID/success output
- Ensured failed startup returns an error instead of a false positive success message
- Added/updated tests covering the occupied-port failure path
- Ran `bun run lint`, `bun run typecheck`, and `bun run test -- test/mcp-command.test.ts`

**Learnings:**
- For daemon UX, “spawn succeeded” is not a valid success boundary; readiness must be observable from the parent
