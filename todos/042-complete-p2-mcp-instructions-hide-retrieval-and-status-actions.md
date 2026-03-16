---
status: complete
priority: p2
issue_id: "042"
tags: [code-review, mcp, agent-native, instructions, ux, typescript]
dependencies: []
---

# MCP initialize instructions hide available retrieval and status actions

## Problem Statement

The initialize-time instructions for the owned MCP server focus on collections and query behavior, but they do not clearly teach the agent about the full supported action flow for `get`, `multi_get`, and `status`. This weakens action parity at the prompt/instructions layer even though the tools are registered.

## Findings

- `buildInstructions()` describes collections, vector/embedding gaps, and query strategy, but does not give a clear retrieval/status workflow map ([src/mcp/server.ts:145](/Users/jylkim/kqmd/src/mcp/server.ts#L145)).
- The actual tool surface includes `get`, `multi_get`, and `status`, each with meaningful behavior ([src/mcp/server.ts:343](/Users/jylkim/kqmd/src/mcp/server.ts#L343), [src/mcp/server.ts:420](/Users/jylkim/kqmd/src/mcp/server.ts#L420), [src/mcp/server.ts:501](/Users/jylkim/kqmd/src/mcp/server.ts#L501)).
- This means the model can technically call the tools, but the instructions under-explain the “search -> inspect -> status” workflow the product intends.

## Proposed Solutions

### Option 1: Expand initialize instructions with an action map

**Approach:** Add a short workflow-oriented section describing when to use `query`, `get`, `multi_get`, and `status`.

**Pros:**
- Improves discoverability without adding new tools
- Aligns instructions with the actual surface

**Cons:**
- Slightly longer initialize prompt

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Add sample prompts/examples per tool

**Approach:** Keep the instructions compact but include one or two concrete examples that demonstrate the retrieval/status flow.

**Pros:**
- Easier for the model to imitate correctly

**Cons:**
- Still weaker than an explicit action map

**Effort:** 1 hour

**Risk:** Low

## Recommended Action

Use Option 1 and keep Option 2 as supporting detail. The initialize instructions should explicitly teach the full supported workflow, not just search syntax.

## Technical Details

**Affected files:**
- [src/mcp/server.ts](/Users/jylkim/kqmd/src/mcp/server.ts)
- [test/mcp-server.test.ts](/Users/jylkim/kqmd/test/mcp-server.test.ts)

## Resources

- Agent-native review finding

## Acceptance Criteria

- [x] initialize instructions mention when to use `status`, `get`, and `multi_get` in addition to `query`
- [x] instructions describe a supported retrieval workflow from search to document inspection
- [x] tests or snapshots cover the updated instruction text at a meaningful level

## Work Log

### 2026-03-16 - Code review finding

**By:** Codex

**Actions:**
- Reviewed initialize-time MCP instructions against the registered tool surface
- Compared documented workflow guidance with actual available actions

**Learnings:**
- Tool parity is not just registration; the model also needs enough instructions to discover the right action flow

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Expanded `buildInstructions()` with an explicit `query -> get/multi_get -> status` workflow map
- Added a regression assertion in `test/mcp-server.test.ts` against the initialize instructions text
- Verified with `bun run test -- test/mcp-server.test.ts` and `bun run typecheck`

**Learnings:**
- Agent discoverability is part of the product contract; registered tools still need a usable action map in the initialize prompt
