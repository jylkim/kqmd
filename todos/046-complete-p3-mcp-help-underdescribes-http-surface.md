---
status: complete
priority: p3
issue_id: "046"
tags: [code-review, cli, help, mcp, documentation]
dependencies: []
---

# `mcp` help가 실제 HTTP surface를 너무 축약해서 설명함

## Problem Statement

현재 `qmd mcp --http` / `--daemon` help는 HTTP에서 MCP server만 뜨는 것처럼 읽히지만, 실제 local server는 `/mcp` 외에도 session 없이 호출 가능한 `/query`, `/search`, `/health` 경로를 함께 엽니다. localhost bind라서 즉시 위험한 문제는 아니지만, help를 읽은 사용자는 실제 reachable HTTP surface를 과소평가할 수 있습니다.

## Findings

- [`src/commands/owned/help.ts`](../src/commands/owned/help.ts) 의 `mcp` 도움말은 stdio/HTTP/daemon mode와 option surface만 설명합니다.
- 실제 HTTP surface는 [`src/mcp/server.ts`](../src/mcp/server.ts) 에서 `/mcp`, `/health`, `/query`, `/search` 를 함께 노출합니다.
- 이번 diff는 `mcp` help를 expanded local help 후보로 다루고 있으므로, 이런 차이는 앞으로도 문서/실제 surface drift로 남을 수 있습니다.

## Proposed Solutions

### Option 1: `mcp` help에 local HTTP route surface를 한 줄로 명시

**Approach:** `--http` 설명 한 줄에 `/mcp`, `/health`, `/query`, `/search` 가 함께 열린다는 짧은 note를 추가합니다.

**Pros:**
- 실제 surface를 더 정직하게 드러냅니다
- 구현 변경 없이 help만 보강하면 됩니다

**Cons:**
- help가 조금 더 길어집니다

**Effort:** Small

**Risk:** Low

---

### Option 2: 현재 수준을 유지하고 development docs에만 route surface를 더 자세히 적기

**Approach:** CLI help는 간단히 두고, route surface는 `docs/development.md` 나 architecture docs로 넘깁니다.

**Pros:**
- CLI help를 짧게 유지할 수 있습니다

**Cons:**
- quick-discovery help로는 여전히 surface가 축약됩니다

**Effort:** Small

**Risk:** Low

## Recommended Action

Option 1 기준으로 마무리했다. 현재 workspace의 `mcp --help` 는 이미 `--http` 에서 localhost `/mcp`, `/health`, `/query`, `/search` surface를 드러내고 있었고, 이번 해결에서는 그 문구를 canonical help snapshot으로 고정하고 developer checklist도 같은 route surface를 보도록 맞췄다.

## Technical Details

**Affected files:**
- `docs/development.md`
- `test/owned-command-parity/help-output.test.ts`
- `test/fixtures/owned-command-parity/help/mcp-help.output.txt`

## Resources

- Review source: current uncommitted diff on `main`

## Acceptance Criteria

- [x] `mcp --help` 가 HTTP mode에서 열리는 local route surface를 현재 문구보다 더 정확히 드러낸다
- [x] help wording과 actual server route surface 사이의 설명 격차가 줄어든다

## Work Log

### 2026-03-16 - Initial Discovery

**By:** Codex

**Actions:**
- Reviewed `mcp` help text against the actual HTTP server route registration
- Confirmed help mentions mode and constraints but not the extra local HTTP routes

**Learnings:**
- help surface를 local authority로 넓힐수록, “무엇을 일부러 생략할 것인가”도 명시적으로 판단해야 한다

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Added a canonical `mcp --help` snapshot assertion in [`test/owned-command-parity/help-output.test.ts`](../test/owned-command-parity/help-output.test.ts) and recorded the expected output in [`test/fixtures/owned-command-parity/help/mcp-help.output.txt`](../test/fixtures/owned-command-parity/help/mcp-help.output.txt)
- Updated the upstream MCP verification checklist in [`docs/development.md`](../docs/development.md) so it now calls out `/query` and `/search` alongside `/mcp` and `/health`
- Verified with `bun run test -- test/owned-command-parity/help-output.test.ts`, `bun run test -- test/mcp-command.test.ts test/mcp-http.test.ts`

**Learnings:**
- once CLI help is corrected, the next drift risk is regression coverage; a canonical snapshot and checklist update are enough to keep the reachable HTTP surface visible without broadening the help further
