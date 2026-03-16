---
status: complete
priority: p2
issue_id: "040"
tags: [code-review, mcp, http, validation, typescript]
dependencies: []
---

# HTTP /query and /search endpoints bypass typed input validation

## Problem Statement

The MCP tool path validates query inputs through Zod, but the compatibility HTTP endpoints `/query` and `/search` accept raw JSON and pass values through with only a shallow `searches` array check. This allows malformed or out-of-range values to reach the core path and diverge from the validated MCP surface.

## Findings

- The HTTP handler parses JSON directly and only checks that `searches` is a non-empty array ([src/mcp/server.ts:631](/Users/jylkim/kqmd/src/mcp/server.ts#L631)).
- `limit`, `minScore`, `candidateLimit`, `collections`, and `intent` are forwarded without type/range normalization ([src/mcp/server.ts:647](/Users/jylkim/kqmd/src/mcp/server.ts#L647)).
- This creates a mismatch with the MCP tool path, where the same inputs are schema-validated before they reach the core.

## Proposed Solutions

### Option 1: Reuse the same schema validation for HTTP aliases

**Approach:** Extract a shared request schema/parser and apply it to both the MCP tool and the HTTP alias endpoints.

**Pros:**
- One contract for both transports
- Prevents transport-specific undefined behavior

**Cons:**
- Requires a small refactor of request parsing

**Effort:** 2-3 hours

**Risk:** Low

---

### Option 2: Remove the HTTP alias endpoints

**Approach:** Support only `/mcp` and push all callers through the protocol surface.

**Pros:**
- Simplest contract
- Removes duplicated validation path

**Cons:**
- Breaks a documented compatibility surface

**Effort:** 1-2 hours

**Risk:** High

## Recommended Action

Use Option 1. The HTTP aliases should be thin wrappers over the same validated input contract, not a looser shadow API.

## Technical Details

**Affected files:**
- [src/mcp/server.ts](/Users/jylkim/kqmd/src/mcp/server.ts)
- [test/mcp-http.test.ts](/Users/jylkim/kqmd/test/mcp-http.test.ts)

## Resources

- Code review finding from TypeScript review

## Acceptance Criteria

- [x] `/query` and `/search` use the same validation rules as the MCP `query` tool
- [x] malformed or out-of-range values produce deterministic client errors rather than leaking into core logic
- [x] regression tests cover invalid numeric and structural input on the HTTP alias surface

## Work Log

### 2026-03-16 - Code review finding

**By:** Codex

**Actions:**
- Compared MCP tool request validation with the HTTP alias path
- Identified missing validation for non-`searches` fields on the HTTP path

**Learnings:**
- Compatibility endpoints still need the same typed contract if they share the same semantics

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Extracted a shared `queryRequestSchema` in `src/mcp/server.ts`
- Reused that schema for both the MCP `query` tool registration and the HTTP `/query`/`/search` alias path
- Added regression coverage for invalid string and out-of-range numeric input in `test/mcp-http.test.ts`
- Verified with `bun run test -- test/mcp-http.test.ts test/mcp-server.test.ts` and `bun run typecheck`

**Learnings:**
- MCP tool and HTTP alias paths only stay compatible if they literally share the same schema, not just the same downstream core
