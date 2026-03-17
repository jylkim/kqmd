---
status: complete
priority: p2
issue_id: "052"
tags: [code-review, mcp, query, validation, parity, security]
dependencies: []
---

# MCP query validation still bypasses CLI hardening

MCP/HTTP `query` 입력은 CLI `query`에 추가한 control-character / multiline hardening을 아직 재사용하지 않습니다.

## Problem Statement

CLI 경로는 `validatePlainQueryText()`와 structured line validation으로 제어문자와 oversized line을 막지만, MCP/HTTP `query`는 Zod length check만 거친 뒤 `QueryCommandInput`을 직접 구성합니다. 그 결과 네트워크 경로에서 `searches[].query`나 `intent`에 control character, ANSI escape, embedded newline이 섞여도 검색 레이어까지 흘러갈 수 있습니다.

같은 feature를 네트워크 surface로도 노출하는 이상, 입력 경계는 CLI와 최대한 같아야 합니다.

## Findings

- [`src/mcp/server.ts:38`](../src/mcp/server.ts#L38) 의 `queryRequestSchema`는 길이 위주 검증만 수행합니다.
- [`src/mcp/server.ts:94`](../src/mcp/server.ts#L94) / [`src/mcp/server.ts:751`](../src/mcp/server.ts#L751) 는 validated body로 `QueryCommandInput`을 직접 구성합니다.
- CLI는 [`src/commands/owned/io/validate.ts`](../src/commands/owned/io/validate.ts) 와 [`src/commands/owned/io/parse.ts`](../src/commands/owned/io/parse.ts) 에서 control char / structured line cap을 막습니다.
- reviewer 재현에 따르면 `/query`에 `auth\u0007flow`, `foo\nsecond`, `\u001b[31m` 같은 payload가 통과합니다.

## Proposed Solutions

### Option 1: CLI validator 재사용

**Approach:** MCP/HTTP path에서 `searches[].query`, `intent`, `collections`를 CLI와 같은 validator helper로 정규화/검증합니다.

**Pros:**
- parity가 가장 높습니다
- 같은 버그를 두 군데서 따로 고치지 않아도 됩니다

**Cons:**
- validator를 network payload shape에 맞게 약간 분리해야 할 수 있습니다

**Effort:** Small

**Risk:** Low

---

### Option 2: MCP 전용 validator 추가

**Approach:** Zod layer에 control-char / newline / trim rules를 직접 넣습니다.

**Pros:**
- 구현은 빠를 수 있습니다

**Cons:**
- CLI와 규칙이 다시 drift할 위험이 큽니다

**Effort:** Small

**Risk:** Medium

## Recommended Action

MCP/HTTP query payload를 shared validation helper로 정규화하고, structured payload는 CLI query document parser를 통해 검증해서 rule drift를 줄인다.

## Technical Details

**Affected files:**
- `src/mcp/server.ts`
- `src/commands/owned/io/validate.ts`
- `test/mcp-http.test.ts`
- `test/mcp-server.test.ts`

## Resources

- **Branch:** `feat/adaptive-korean-query-ranking`
- **Commit:** `99b4d2d`
- **Related learning:** `docs/solutions/logic-errors/owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md`

## Acceptance Criteria

- [x] MCP/HTTP `query` input이 CLI와 같은 control-char / multiline / cap rules를 따른다
- [x] `searches[].query`와 `intent`가 unsafe control characters를 허용하지 않는다
- [x] related MCP tests가 parity regression을 고정한다

## Work Log

### 2026-03-17 - Initial Review Finding

**By:** Codex

**Actions:**
- MCP schema와 CLI validator 경로를 비교
- security reviewer와 learnings-researcher finding을 합쳐 todo로 기록

**Learnings:**
- row shaping parity를 맞췄더라도 validation parity가 비어 있으면 같은 기능이 다른 surface에서 다른 입력 경계를 갖게 된다

### 2026-03-17 - Resolved On Branch

**By:** Codex

**Actions:**
- single-line text validator를 추가하고 MCP collections/intent 검증에 재사용했다
- structured `searches[]` payload를 query document로 재구성해 CLI `parseStructuredQueryDocument()`로 검증했다
- multiline search/control-character intent regression tests를 HTTP layer에 추가했다

**Learnings:**
- MCP 전용 Zod 규칙을 늘리는 것보다 CLI parser를 그대로 통과시키는 편이 semantic drift를 줄인다
- network payload라도 structured lines를 document 형태로 재구성하면 기존 hardening을 자연스럽게 공유할 수 있다
