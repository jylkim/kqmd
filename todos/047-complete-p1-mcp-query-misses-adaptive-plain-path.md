---
status: complete
priority: p1
issue_id: "047"
tags: [code-review, mcp, query, parity, agent-native, typescript]
dependencies: []
---

# MCP query misses adaptive plain-query path

MCP/HTTP `query`가 이번 브랜치의 핵심 기능인 adaptive plain-query semantics에 도달하지 못합니다.

## Problem Statement

CLI 사용자는 short Korean phrase / mixed technical plain query에서 adaptive classification, rerank disable, fetch window, local structural ranking을 사용합니다. 하지만 MCP/HTTP `query`는 여전히 모든 요청을 structured input으로 감싸서 `queryMode: 'structured'`로 고정합니다. 그 결과 에이전트는 같은 기능에 접근할 수 없고, adaptive explain signals도 structured payload에서 볼 수 없습니다.

이 저장소는 replacement distribution이면서 agent-native parity를 중요하게 다루므로, 사용자가 할 수 있는 검색 행위를 agent가 못 하는 것은 merge-blocker로 보는 편이 맞습니다.

## Findings

- [`src/mcp/server.ts:94`](/Users/jylkim/projects/kqmd/src/mcp/server.ts#L94) 의 `buildStructuredQueryInput()`가 MCP/HTTP query를 모두 structured `searches[]`로 강제합니다.
- [`src/commands/owned/query_core.ts:75`](/Users/jylkim/projects/kqmd/src/commands/owned/query_core.ts#L75) 이후 adaptive classification과 fetch/rerank policy는 plain query에서만 실질적인 차이를 냅니다.
- [`src/commands/owned/query_ranking.ts:183`](/Users/jylkim/projects/kqmd/src/commands/owned/query_ranking.ts#L183) 는 structured query를 compatibility path로 취급합니다.
- [`src/mcp/server.ts:167`](/Users/jylkim/projects/kqmd/src/mcp/server.ts#L167) 이하 응답 shaping은 `adaptive`/`explain` metadata를 포함하지 않아 agent가 새 ranking signals를 볼 수 없습니다.
- README는 `query`가 short Korean phrase / mixed technical path를 다르게 다룬다고 설명하지만, 현재 구현은 CLI plain query에 사실상 한정됩니다.

## Proposed Solutions

### Option 1: MCP plain-query path 추가

**Approach:** MCP/HTTP `query` payload에 plain query string 모드를 추가하고, CLI와 같은 `QueryCommandInput` plain path로 `executeQueryCore()`를 호출합니다.

**Pros:**
- 사용자/agent parity를 직접 회복합니다
- adaptive explain signals도 같은 core에서 자연스럽게 재사용됩니다

**Cons:**
- MCP request schema와 tool contract가 바뀝니다
- 기존 structured-only consumers와의 호환성 검토가 필요합니다

**Effort:** Medium

**Risk:** Medium

---

### Option 2: Structured MCP 유지 + explicit divergence 문서화

**Approach:** MCP는 structured-only를 유지하되, README/architecture/docs에서 CLI-only adaptive scope를 명시합니다.

**Pros:**
- 구현 변경이 작습니다
- 현재 MCP consumers를 깨지 않습니다

**Cons:**
- agent-native parity 문제는 해결되지 않습니다
- 대표 기능이 CLI 전용으로 남습니다

**Effort:** Small

**Risk:** High

---

### Option 3: MCP structured payload에 adaptive explain만 우선 노출

**Approach:** plain path 추가 전이라도 MCP structured query 결과에 `adaptive`/`explain` metadata를 포함합니다.

**Pros:**
- agent visibility는 일부 회복됩니다
- core ranking debugging이 쉬워집니다

**Cons:**
- plain adaptive path 부재 자체는 남습니다
- partial parity 상태가 됩니다

**Effort:** Small

**Risk:** Medium

## Recommended Action

MCP/HTTP `query`에 plain query string path를 추가하고, 결과 structured payload에 query/adaptive metadata를 함께 노출해 CLI adaptive semantics에 최대한 가깝게 맞춘다.

## Technical Details

**Affected files:**
- `src/mcp/server.ts`
- `src/commands/owned/query_core.ts`
- `src/commands/owned/query_ranking.ts`
- `test/mcp-server.test.ts`
- `test/mcp-http.test.ts`

**Related components:**
- MCP query tool
- HTTP `/query` alias
- CLI `query`

**Database changes (if any):**
- Migration needed? No

## Resources

- **Branch:** `feat/adaptive-korean-query-ranking`
- **Commit:** `99b4d2d`
- **Related documentation:** `docs/architecture/kqmd-command-boundary.md`
- **Related learning:** `docs/solutions/logic-errors/owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md`

## Acceptance Criteria

- [x] MCP `query`에 plain query path를 추가하거나, CLI-only adaptive scope를 explicit divergence로 문서화한다
- [x] agent가 adaptive query signals를 structured payload 또는 equivalent metadata로 확인할 수 있다
- [x] CLI plain query와 MCP query의 parity 범위가 README / architecture docs에서 명시된다
- [x] MCP query tests가 새 contract를 고정한다

## Work Log

### 2026-03-17 - Initial Review Finding

**By:** Codex

**Actions:**
- current branch `feat/adaptive-korean-query-ranking`를 `main...HEAD` 기준으로 검토
- `src/mcp/server.ts`, `src/commands/owned/query_core.ts`, `src/commands/owned/query_ranking.ts` 확인
- agent-native reviewer finding을 정리해 todo로 기록

**Learnings:**
- shared row shaping은 맞췄지만, adaptive plain-query semantics는 아직 MCP surface에 닿지 않는다
- explain visibility까지 함께 빠져 있어서 단순 transport parity보다 더 큰 gap이다

### 2026-03-17 - Resolved On Branch

**By:** Codex

**Actions:**
- MCP tool/HTTP `/query`에 `query` plain path를 추가하고 shared `QueryCommandInput` normalization으로 plain/structured 경로를 모두 `executeQueryCore()`로 보냈다
- MCP structured results에 query metadata와 row-level `adaptive` / `explain` fields를 포함하도록 확장했다
- MCP server/HTTP tests에 plain adaptive path contract를 추가해 회귀를 고정했다

**Learnings:**
- MCP가 plain query를 직접 받으면 adaptive classification, fetch window, rerank policy를 별도 우회 없이 그대로 재사용할 수 있다
- row metadata만이 아니라 top-level query metadata를 같이 주면 에이전트가 결과가 비어 있어도 현재 parity mode를 판단하기 쉬워진다

## Notes

- `docs/plans/*.md`와 `docs/solutions/*.md`는 protected artifacts이므로 삭제/정리 대상으로 다루지 않는다.
