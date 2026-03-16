---
status: complete
priority: p2
issue_id: "038"
tags: [code-review, quality, mcp, query, formatting, typescript]
dependencies: []
---

# HTTP /query alias drifts from MCP query tool shaping

## Problem Statement

The HTTP compatibility path for `/query` and `/search` duplicates the MCP query-tool result shaping logic instead of reusing it. The two paths already produce different snippets for the same request, which means users get different results depending on transport.

## Findings

- The MCP `query` tool shapes rows and snippets in one branch ([src/mcp/server.ts:269](/Users/jylkim/kqmd/src/mcp/server.ts#L269)).
- The HTTP `/query` and `/search` branch reimplements the same logic separately ([src/mcp/server.ts:631](/Users/jylkim/kqmd/src/mcp/server.ts#L631)).
- The MCP tool path passes `intent` through to `extractSnippet()` ([src/mcp/server.ts:301](/Users/jylkim/kqmd/src/mcp/server.ts#L301)).
- The HTTP alias path omits `intent` when extracting snippets ([src/mcp/server.ts:671](/Users/jylkim/kqmd/src/mcp/server.ts#L671)).
- This means the same structured query can return different snippets over `/mcp` versus `/query`.

## Proposed Solutions

### Option 1: Extract shared query-response shaping helper

**Approach:** Move primary-query selection, snippet extraction, and row shaping into one helper reused by both MCP and HTTP alias paths.

**Pros:**
- Eliminates current drift
- Easier to maintain future changes
- Keeps transport-specific wrappers thin

**Cons:**
- Small refactor touching both paths

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Treat `/query` as a thin wrapper around the MCP tool handler

**Approach:** Convert the HTTP alias path into a transport wrapper that calls the same core response builder used by the tool.

**Pros:**
- Stronger single-source-of-truth story

**Cons:**
- May require slightly more plumbing between the HTTP endpoint and tool-layer response model

**Effort:** 2-3 hours

**Risk:** Low

## Recommended Action

Use Option 1 immediately. The duplication is already producing user-visible drift and should be collapsed into a single shaping helper.

## Technical Details

**Affected files:**
- [src/mcp/server.ts](/Users/jylkim/kqmd/src/mcp/server.ts)
- [test/mcp-http.test.ts](/Users/jylkim/kqmd/test/mcp-http.test.ts)
- [test/mcp-server.test.ts](/Users/jylkim/kqmd/test/mcp-server.test.ts)

## Resources

- Code simplicity review finding

## Acceptance Criteria

- [x] `/mcp` query tool and `/query`/`/search` HTTP alias share the same row/snippet shaping logic
- [x] `intent` affects snippet extraction consistently across both paths
- [x] Regression tests prove identical shaping for equivalent requests

## Work Log

### 2026-03-16 - Code review finding

**By:** Codex

**Actions:**
- Compared MCP tool response shaping with HTTP alias shaping
- Found duplicate primary-query/snippet extraction logic
- Confirmed missing `intent` propagation on the HTTP path

**Learnings:**
- Thin transport wrappers only stay thin if response shaping has a single source of truth

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Extracted a shared MCP query response shaping helper in `src/mcp/server.ts`
- Routed both the MCP tool path and the HTTP `/query`/`/search` alias path through the same helper
- Added regression coverage in `test/mcp-http.test.ts` to assert identical snippet shaping for equivalent requests with `intent`
- Verified the scope with `bun run test -- test/mcp-http.test.ts test/mcp-server.test.ts` and `bun run typecheck`

**Learnings:**
- Sharing just the core search execution is not enough; response shaping also needs a single source of truth to avoid transport drift
