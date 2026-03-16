---
status: complete
priority: p1
issue_id: "035"
tags: [code-review, security, mcp, http, origin, typescript]
dependencies: []
---

# HTTP MCP origin validation is too permissive

## Problem Statement

The HTTP MCP server currently accepts requests from any `http://localhost:*` or `http://127.0.0.1:*` origin, which defeats browser same-origin isolation for local web pages. A different local app or malicious page served on localhost can call the MCP endpoint and read local index content.

## Findings

- `assertLocalOrigin()` accepts any origin whose hostname is `localhost` or `127.0.0.1`, regardless of the requesting port or full origin ([src/mcp/server.ts:108](/Users/jylkim/kqmd/src/mcp/server.ts#L108)).
- The check is applied before `/mcp`, `/query`, `/search`, and `/health`, so the entire HTTP surface inherits this overly broad trust model ([src/mcp/server.ts:613](/Users/jylkim/kqmd/src/mcp/server.ts#L613)).
- This allows a separate localhost web app to cross-call the MCP endpoint in the browser even though it should be treated as a different origin.

## Proposed Solutions

### Option 1: Only allow exact host:port origin matches

**Approach:** Require `Origin` to match the incoming `Host` exactly, with no broad localhost hostname fallback.

**Pros:**
- Restores browser same-origin expectations
- Small and easy to reason about
- No silent trust expansion

**Cons:**
- Cross-port localhost clients would need explicit opt-in or a different access path

**Effort:** 1-2 hours

**Risk:** Low

---

### Option 2: Make allowed origins an explicit allowlist

**Approach:** Introduce a config/env allowlist for permitted origins and default it to exact self-origin only.

**Pros:**
- Flexible for future integrations
- Makes trust boundaries explicit

**Cons:**
- More surface area to document and test
- Extra configuration complexity for a local-first server

**Effort:** 3-4 hours

**Risk:** Medium

## Recommended Action

Implement Option 1 now. If broader browser integration is needed later, add an explicit allowlist rather than implicit localhost trust.

## Technical Details

**Affected files:**
- [src/mcp/server.ts](/Users/jylkim/kqmd/src/mcp/server.ts)
- [test/mcp-http.test.ts](/Users/jylkim/kqmd/test/mcp-http.test.ts)

## Resources

- Review finding from security analysis
- Related external guidance already cited in the plan: MCP security best practices

## Acceptance Criteria

- [x] HTTP MCP rejects cross-port localhost origins by default
- [x] Allowed origin logic is documented and tested
- [x] `/mcp`, `/query`, `/search`, and `/health` all follow the same tightened origin rule
- [x] Regression tests cover both matching and non-matching origins

## Work Log

### 2026-03-16 - Code review finding

**By:** Codex

**Actions:**
- Reviewed HTTP origin handling in the owned MCP server
- Confirmed that hostname-only localhost matching broadens trust too far

**Learnings:**
- Localhost-only is not the same as same-origin; port is part of the browser security boundary

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Tightened `assertLocalOrigin()` to require exact self-origin matching (`http://<host:port>`)
- Added regression coverage for exact origin allow, cross-port localhost reject, and unrelated origin reject
- Documented the stricter origin rule in the upstream compatibility policy

**Learnings:**
- Local-only transport still needs browser-accurate origin boundaries when exposed over HTTP
