---
status: complete
priority: p3
issue_id: "041"
tags: [code-review, test, mcp, reliability, typescript]
dependencies: []
---

# MCP command test depends on real HOME/XDG state

## Problem Statement

One of the new MCP command tests runs against the process environment instead of an isolated temp HOME/XDG cache. This makes the test sensitive to a developer machine’s actual daemon state and can create non-deterministic behavior.

## Findings

- `test/mcp-command.test.ts` calls `handleMcpCommand(['mcp', 'stop'])` without injecting an isolated environment ([test/mcp-command.test.ts:40](/Users/jylkim/kqmd/test/mcp-command.test.ts#L40)).
- `handleMcpCommand()` defaults to `process.env`, so a real `~/.cache/qmd/mcp.pid` can influence the test outcome.

## Proposed Solutions

### Option 1: Add dependency injection for the MCP command environment

**Approach:** Make the stop path testable with an explicit env override or isolated path helper injection.

**Pros:**
- Deterministic tests
- Cleaner test seam

**Cons:**
- Small amount of extra plumbing

**Effort:** 1 hour

**Risk:** Low

---

### Option 2: Stub the path/state helpers in the test

**Approach:** Mock daemon-state helpers or env lookups directly within the test.

**Pros:**
- Minimal production changes

**Cons:**
- Less representative than an explicit seam

**Effort:** 30-60 minutes

**Risk:** Low

## Recommended Action

Use Option 1 if more MCP command tests are expected; otherwise Option 2 is acceptable as a lightweight cleanup.

## Technical Details

**Affected files:**
- [test/mcp-command.test.ts](/Users/jylkim/kqmd/test/mcp-command.test.ts)
- [src/commands/owned/mcp.ts](/Users/jylkim/kqmd/src/commands/owned/mcp.ts)

## Resources

- Code review finding from TypeScript review

## Acceptance Criteria

- [x] MCP command tests run against isolated daemon state
- [x] test results do not depend on the reviewer’s real HOME/XDG cache

## Work Log

### 2026-03-16 - Code review finding

**By:** Codex

**Actions:**
- Reviewed new MCP command tests for environment isolation
- Identified direct dependence on process environment

**Learnings:**
- Process-state tests should always isolate HOME/XDG when daemon files are involved

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Added a temp HOME/XDG helper in `test/mcp-command.test.ts`
- Updated the `mcp stop` no-op test to run against isolated daemon state

**Learnings:**
- The cheapest stable fix here is test-level isolation; production seams can stay unchanged
