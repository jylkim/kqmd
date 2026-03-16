---
title: feat: Add MCP compatibility ownership boundary
type: feat
status: completed
date: 2026-03-16
origin: docs/brainstorms/2026-03-16-mcp-passthrough-compatibility-brainstorm.md
---

# feat: Add MCP compatibility ownership boundary

## Enhancement Summary

**Deepened on:** 2026-03-16  
**Sections enhanced:** 12  
**Research agents used:** `architecture-strategist`, `security-sentinel`, `performance-oracle`, `kieran-typescript-reviewer`, `code-simplicity-reviewer`, `agent-native-architecture`  
**Additional primary sources:** Model Context Protocol TypeScript SDK server docs, MCP security best practices, MCP debugging guide

### Key Improvements

1. v1 범위를 더 강하게 닫았습니다.
   - `qmd mcp` ownership boundary와 `query/status` policy 연결을 핵심으로 두고, retrieval ownership 확대와 과한 shared abstraction은 비범위로 못 박았습니다.
2. core/adapter/transport 경계를 더 엄격히 정의했습니다.
   - `transport adapter -> shared domain core -> owned runtime/config policy -> store` 단방향 layering과 typed normalization 규칙을 추가했습니다.
3. 보안·성능·agent usability 요구를 acceptance criteria로 올렸습니다.
   - stdio stdout 오염 금지, localhost bind 기본값, session/PID/log safety, store reuse policy, capability parity map, natural-language parity tests를 계획에 포함했습니다.

### New Considerations Discovered

- MCP는 일반 CLI보다 반복 호출과 장수 세션이 많아, `store lifetime`과 `session lifetime`을 분리해서 설계해야 합니다.
- upstream-facing surface parity와 K-QMD-owned semantic divergence를 한 문장으로만 두면 drift 판단이 어려우므로, `must match / may diverge / must document` 분류가 필요합니다.
- MCP tool 설계는 “tool names를 맞춘다”만으로 충분하지 않고, 에이전트가 실제로 올바른 tool을 고를 수 있는 설명/입력 이름/응답 shape까지 포함해야 합니다.
- 공식 MCP 문서는 stdio에서 stdout 오염 금지, Streamable HTTP에서 session handling과 `Origin` 검증, 그리고 Inspector 기반 invalid input/concurrency 테스트를 직접 권장합니다.

## Overview

이번 계획의 목표는 K-QMD가 `qmd mcp`를 단순 passthrough surface로 둘 수 있는지 평가한 결과를 실제 구현 전략으로 연결하는 것입니다. 브레인스토밍에서 합의한 성공 기준은 분명합니다. `qmd mcp`는 “서버가 뜬다”로 끝나는 기능이 아니라, upstream entrypoint를 유지한 채 MCP tool surface 전체가 K-QMD의 owned runtime/policy와 일관되게 동작해야 합니다 (see brainstorm: `docs/brainstorms/2026-03-16-mcp-passthrough-compatibility-brainstorm.md`).

현재 조사 결과는 pure passthrough 쪽보다 thin owned boundary 쪽으로 무게가 실립니다. installed upstream `@tobilu/qmd@2.0.1`의 MCP server는 CLI를 재호출하지 않고 직접 `createStore()`와 store methods를 사용하므로, 지금 구조만으로는 K-QMD의 owned `search/query/status` 정책이 자연스럽게 개입하지 않습니다. 따라서 이 계획은 `mcp`를 여전히 upstream drift baseline으로 삼되, user-facing entrypoint와 transport contract는 유지하면서 execution path는 K-QMD가 소유하는 방향을 제안합니다.

## Problem Statement / Motivation

현재 저장소의 명령 경계는 CLI 기준으로는 명확합니다. `search/query/update/embed/status`는 owned surface이고, `collection/ls/get/multi-get/mcp`는 passthrough surface입니다 ([`src/commands/manifest.ts:3`](../../src/commands/manifest.ts), [`src/commands/manifest.ts:5`](../../src/commands/manifest.ts)). top-level router도 이 경계를 그대로 따르며, passthrough 명령은 upstream binary를 `shell: false`와 inherited stdio로 실행합니다 ([`src/cli.ts:109`](../../src/cli.ts), [`src/passthrough/delegate.ts:29`](../../src/passthrough/delegate.ts)).

하지만 upstream MCP는 같은 구조가 아닙니다.

- `qmd mcp` CLI entry는 `dist/mcp/server.js`를 직접 띄웁니다 ([`node_modules/@tobilu/qmd/dist/cli/qmd.js:2584`](../../node_modules/@tobilu/qmd/dist/cli/qmd.js)).
- stdio/HTTP transport 모두 `createStore({ dbPath: getDefaultDbPath() })`로 upstream store를 직접 열고, tool handler는 `store.search`, `store.get`, `store.multiGet`, `store.getStatus`를 곧바로 호출합니다 ([`node_modules/@tobilu/qmd/dist/mcp/server.js:402`](../../node_modules/@tobilu/qmd/dist/mcp/server.js), [`node_modules/@tobilu/qmd/dist/mcp/server.js:412`](../../node_modules/@tobilu/qmd/dist/mcp/server.js)).
- 즉, 현재 K-QMD의 CLI replacement-distribution 경계만으로는 MCP tool 호출이 owned query/search/status policy를 타지 않습니다.

이 차이는 사용자 계약 관점에서 중요합니다. 브레인스토밍에서 합의했듯, 일부 tool만 downstream 로직을 타는 혼합 상태는 제품 계약으로 부적절합니다. `qmd mcp`를 지원한다고 말하려면 최소한 stdio/HTTP/daemon lifecycle, `query/get/multi_get/status`, `qmd://` resource, 그리고 관련 상태/문서가 같은 세계관을 보여야 합니다 (see brainstorm: `docs/brainstorms/2026-03-16-mcp-passthrough-compatibility-brainstorm.md`).

## Local Research Findings

### Repository patterns

- K-QMD는 `upstream runtime source를 vendoring하지 않고`, local manifest와 compatibility policy로 owned/passthrough 경계를 관리합니다 ([`docs/architecture/upstream-compatibility-policy.md:3`](../../docs/architecture/upstream-compatibility-policy.md), [`docs/architecture/upstream-compatibility-policy.md:25`](../../docs/architecture/upstream-compatibility-policy.md)).
- read-path correctness는 이미 “upstream helper를 그대로 믿지 않고 local policy를 얹는” 방식으로 구현돼 있습니다. 예를 들어 owned runtime은 DB-only reopen policy를 별도로 관리합니다 ([`src/commands/owned/runtime.ts:91`](../../src/commands/owned/runtime.ts), [`docs/architecture/upstream-compatibility-policy.md:30`](../../docs/architecture/upstream-compatibility-policy.md)).
- `status`, `query`, `search`는 이미 K-QMD-specific health/policy를 surface 합니다. `status`는 embedding/search health를 함께 보여 주고 ([`src/commands/owned/status.ts:33`](../../src/commands/owned/status.ts)), `query`는 collection-aware embedding mismatch UX를 갖고 있으며 ([`src/commands/owned/query.ts:57`](../../src/commands/owned/query.ts)), `search`는 Hangul query에서 shadow index readiness에 따라 local policy를 적용합니다 ([`src/commands/owned/search.ts:57`](../../src/commands/owned/search.ts)).
- path compatibility 관점에서는 MCP daemon 운영 흔적이 이미 일부 준비돼 있습니다. `mcp.pid`, `mcp.log` path는 upstream와 맞추는 dedicated test가 있습니다 ([`test/path-compatibility.test.ts:66`](../../test/path-compatibility.test.ts)).

### Installed upstream MCP facts

- upstream README는 `qmd mcp` stdio transport와 `qmd mcp --http`, `qmd mcp --http --daemon`, `qmd mcp stop`, `GET /health`를 명시적으로 문서화합니다 ([`node_modules/@tobilu/qmd/README.md:115`](../../node_modules/@tobilu/qmd/README.md)).
- upstream MCP server는 `query`, `get`, `multi_get`, `status` tool과 `qmd://{path}` resource를 직접 등록합니다 ([`node_modules/@tobilu/qmd/dist/mcp/server.js:118`](../../node_modules/@tobilu/qmd/dist/mcp/server.js), [`node_modules/@tobilu/qmd/dist/mcp/server.js:154`](../../node_modules/@tobilu/qmd/dist/mcp/server.js), [`node_modules/@tobilu/qmd/dist/mcp/server.js:260`](../../node_modules/@tobilu/qmd/dist/mcp/server.js), [`node_modules/@tobilu/qmd/dist/mcp/server.js:315`](../../node_modules/@tobilu/qmd/dist/mcp/server.js), [`node_modules/@tobilu/qmd/dist/mcp/server.js:375`](../../node_modules/@tobilu/qmd/dist/mcp/server.js)).
- upstream `query` tool schema는 `candidateLimit`를 노출하지만, 실제 `store.search(...)` 호출에는 그 값을 넘기지 않습니다 ([`node_modules/@tobilu/qmd/dist/mcp/server.js:218`](../../node_modules/@tobilu/qmd/dist/mcp/server.js), [`node_modules/@tobilu/qmd/dist/mcp/server.js:230`](../../node_modules/@tobilu/qmd/dist/mcp/server.js)). K-QMD는 이 지점을 “upstream 그대로의 no-op를 보존할 것인가”가 아니라 “owned query semantics와 맞출 것인가”라는 제품 결정으로 다시 판단해야 합니다.

### Institutional learnings

- [`docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md`](../../docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md)
  - non-exported upstream seam이 필요하면 adapter에 고립시키고 dedicated guard test로 drift를 먼저 터뜨려야 합니다.
- [`docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`](../../docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
  - read-path는 side effect를 최소화해야 하고 lifecycle ownership은 단일 wrapper가 가져야 합니다.
- [`docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`](../../docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md)
  - `status`는 zero-config entrypoint 성격이 강하며, advisory 범위는 실제 실행 범위와 같아야 합니다.
- `docs/solutions/patterns/critical-patterns.md`
  - learnings-researcher workflow상 확인했지만 현재 저장소에는 없습니다. 따라서 이번 계획은 개별 solution 문서 패턴을 직접 carry forward 합니다.

## Research Decision

광범위한 외부 연구는 생략합니다. 이번 작업은 새 프레임워크 도입이나 표준 논쟁보다 installed upstream package와 현재 K-QMD architecture seam이 핵심이기 때문입니다.

대신 다음을 primary input으로 삼습니다.

- 브레인스토밍 원문
- 현재 저장소 architecture/docs/tests
- installed `@tobilu/qmd@2.0.1` source/README

즉, 이번 계획은 “외부 best practice 탐색”보다 “upstream baseline을 로컬에서 black-box + source 수준으로 추적하는 계획”에 가깝습니다.

다만 MCP transport/security/testing 자체는 공식 문서가 직접적인 가치가 있으므로 한정적으로 반영합니다.

- MCP TypeScript SDK server docs는 stdio에서 stdout이 protocol 전용이며, Streamable HTTP transport는 session reuse와 cleanup hook을 전제로 설계할 것을 보여 줍니다.
- MCP security best practices는 local server의 localhost bind, `Origin` 검증, remote deployment 시 인증/인가와 DNS rebinding 방어를 강조합니다.
- MCP debugging guide는 Inspector 기반 도구 검증, invalid input, concurrent operations, protocol compliance 테스트를 권장합니다.

## Chosen Approach

### Adopted: thin owned MCP boundary with upstream surface parity

브레인스토밍 결론대로 pure passthrough가 행복 경로였지만, 구조상 그 경로는 성립 가능성이 낮습니다. 따라서 채택안은 다음과 같습니다.

1. user-facing entrypoint는 계속 `qmd mcp`로 유지합니다.
2. 하지만 route ownership은 K-QMD가 가져갑니다. 즉 `mcp`는 더 이상 단순 passthrough가 아닙니다.
3. transport와 tool/resource shape는 upstream를 기준선으로 맞춥니다.
4. execution semantics는 K-QMD owned runtime/policy를 타도록 재구성합니다.
5. upstream drift는 version-pinned guard와 black-box contract tests로 관리합니다.

이 접근은 “heavy fork”가 아니라 local adapter ownership입니다. `mcp` 전체를 임의로 새로 설계하는 것이 아니라, upstream MCP surface를 계속 추적 기준선으로 삼되 실행 경계만 K-QMD로 이동시키는 방식입니다 (see brainstorm: `docs/brainstorms/2026-03-16-mcp-passthrough-compatibility-brainstorm.md`).

### v1 Non-Goals

이번 v1은 범위를 아래처럼 명시적으로 제한합니다.

- CLI `get/multi-get` ownership 확대
- retrieval semantics 재정의
- 새로운 범용 retrieval/domain layer 설계
- MCP 전용 richer metadata 또는 bespoke workflow tool 추가
- upstream response의 byte-for-byte 재현
- 고급 daemon supervision, auto-restart, 운영용 부가 endpoint

v1의 책임은 `upstream-compatible MCP surface + K-QMD-owned query/status policy 연결`까지입니다.

### MCP Ownership Matrix

| Slice | Source of truth | Owner |
|---|---|---|
| command route name `mcp` | local manifest | K-QMD |
| tool/resource names | upstream MCP baseline | upstream-compatible |
| HTTP route paths `/mcp`, `/health`, `/query`, `/search` | upstream MCP baseline | upstream-compatible |
| pid/log path conventions | existing path helpers | K-QMD-owned, upstream-compatible |
| `query/status` semantics | owned runtime + owned policy | K-QMD |
| `get/multi_get` retrieval semantics | upstream baseline behavior | upstream-compatible via thin adapter |
| daemon lifecycle implementation | local adapter | K-QMD |
| drift detection and version policy | tests + docs + checklist | K-QMD |

### Layering Rules

허용 의존 방향은 아래 한 방향으로만 둡니다.

`CLI/MCP adapters -> shared domain core -> owned runtime/config policy -> store`

금지하는 의존은 다음과 같습니다.

- domain core -> MCP transport/session/HTTP
- domain core -> CLI formatter or stderr policy
- runtime/config policy -> MCP protocol objects
- existing owned CLI handlers -> MCP-specific branching

### Semantic Parity Policy

| Category | Policy |
|---|---|
| tool/resource names, route paths, pid/log conventions | must match upstream baseline |
| stdio/HTTP transport semantics | must match public contract, may differ internally |
| Hangul lexical behavior, embedding advisory, daemon-visible status fields | may diverge, but must be documented and tested |
| `candidateLimit` support | must not be silent no-op; implement or explicitly de-surface |

### Ownership Expansion Guardrail

이번 슬라이스는 MCP adapter ownership만 허용합니다. retrieval ownership 확대나 CLI `get/multi-get` owned 전환은 별도 계획 없이는 착수하지 않습니다.

## Alternative Approaches Considered

### Approach A: keep `mcp` passthrough and claim only entrypoint compatibility

기각합니다. `qmd mcp`가 뜨는 것만으로는 K-QMD의 owned `query/search/status` 정책이 MCP tool 호출에 반영되지 않기 때문입니다. 브레인스토밍에서 합의한 all-or-nothing 기준과도 맞지 않습니다 (see brainstorm: `docs/brainstorms/2026-03-16-mcp-passthrough-compatibility-brainstorm.md`).

### Approach B: monkeypatch or directly wrap upstream `dist/mcp/server.js`

권장하지 않습니다. `createMcpServer()`는 export되지 않고, exported `startMcpServer()` / `startMcpHttpServer()`는 lexical import로 고정된 upstream `createStore`를 사용합니다 ([`node_modules/@tobilu/qmd/dist/mcp/server.js:110`](../../node_modules/@tobilu/qmd/dist/mcp/server.js), [`node_modules/@tobilu/qmd/dist/mcp/server.js:402`](../../node_modules/@tobilu/qmd/dist/mcp/server.js)). 이 경로는 private seam 의존과 loader/mocking 계열 hack을 강하게 유도합니다.

### Approach C: heavy fork of upstream MCP and CLI

기각합니다. K-QMD의 compatibility policy는 upstream vendoring과 heavy fork를 의도적으로 피합니다 ([`docs/architecture/upstream-compatibility-policy.md:17`](../../docs/architecture/upstream-compatibility-policy.md)).

## SpecFlow Analysis

### User flow overview

1. **stdio agent flow**
   사용자는 Claude Desktop/Claude Code 같은 MCP client에서 `command: "qmd", args: ["mcp"]`로 K-QMD를 등록합니다. initialize 후 tools/resources를 보고 `query/get/multi_get/status`를 호출합니다.
2. **HTTP shared-server flow**
   사용자는 `qmd mcp --http` 또는 `qmd mcp --http --daemon`으로 장수 서버를 띄우고, `POST /mcp` 또는 `POST /query`/`POST /search`로 접근합니다.
3. **retrieval flow**
   `query` 결과에서 얻은 path/docid를 `get`, `multi_get`, `qmd://{path}` resource read에 연결합니다.
4. **status/operations flow**
   사용자는 daemon 실행 여부, pid/log path, health 상태를 `qmd mcp stop` 또는 `qmd status`에서 확인합니다.

### Capability Parity Map

| User Action | Surface | Agent Tool/Resource | Shared Core | Expected status | Test |
|---|---|---|---|---|---|
| 문서 검색 | CLI/MCP | `query` | query policy core | supported | Hangul/natural-language parity |
| 단일 문서 읽기 | MCP | `get`, `qmd://{path}` | thin retrieval adapter | supported | path/docid/fromLine parity |
| 여러 문서 읽기 | MCP | `multi_get` | thin retrieval adapter | supported | glob/list/maxBytes parity |
| 인덱스 상태 확인 | CLI/MCP | `status` | status core | supported | health vocabulary parity |
| 서버 생존 확인 | HTTP | `/health` | fast path | supported | health endpoint smoke |
| daemon 시작/정지 | CLI | `qmd mcp --http --daemon`, `qmd mcp stop` | daemon lifecycle adapter | supported | PID/log/stop idempotency |

### Gaps and edge cases to cover

- stdio transport는 protocol stream이므로 stderr/log contamination이 없어야 합니다.
- HTTP mode는 session lifecycle, missing session ID, stale session, `/health`, `/query`, `/search`, `/mcp`를 함께 검증해야 합니다.
- daemon mode는 stale PID cleanup, port-in-use, log truncation, stop idempotency가 필요합니다.
- `query`는 Hangul shadow index policy, embedding mismatch advisory, collection resolution, candidateLimit semantics를 K-QMD 쪽에서 어떻게 표현할지 결정해야 합니다.
- `status`는 current owned status vocabulary와 MCP daemon state를 함께 surface 할 수 있어야 합니다.
- `get`/`multi_get`는 CLI에서는 아직 passthrough surface지만, MCP에서는 local ownership으로 들어오더라도 retrieval semantics가 바뀌지 않아야 합니다.

### Assumptions carried into this plan

- MCP compatibility claim 범위는 `stdio`, `HTTP`, `daemon lifecycle`, `query/get/multi_get/status`, `qmd://` resource, `/health`, `/query|/search`, status-level daemon visibility까지 포함합니다.
- CLI `collection/ls/get/multi-get` 자체는 이번 슬라이스에서 계속 passthrough로 둡니다. 이번 계획은 “CLI 전체 ownership 확대”가 아니라 “MCP boundary ownership 추가”입니다.

## Technical Approach

### Architecture

#### 1. Route `mcp` as an owned boundary

`src/commands/manifest.ts`와 `src/cli.ts`에서 `mcp`를 passthrough list에서 분리하고 local handler로 보냅니다 ([`src/commands/manifest.ts:5`](../../src/commands/manifest.ts), [`src/cli.ts:122`](../../src/cli.ts)). 이 전환은 public claim을 바꾸는 순간이므로 Phase 3 전까지는 숨은 implementation branch나 draft PR 단계로 다루고, support matrix/documentation 업데이트와 함께 landing 해야 합니다.

예상 파일:

- `src/commands/manifest.ts`
- `src/cli.ts`
- `src/types/command.ts`
- `src/commands/owned/mcp.ts` 또는 `src/mcp/cli.ts`

가드레일:

- [`src/cli.ts`](../../src/cli.ts) 에는 routing과 `handleMcpCommand` 진입만 추가합니다.
- transport bootstrapping, daemon/session handling, MCP SDK registration은 모두 `src/mcp/*` 아래로 밀어냅니다.
- 기존 [`src/commands/owned/query.ts`](../../src/commands/owned/query.ts), [`src/commands/owned/status.ts`](../../src/commands/owned/status.ts) 에 MCP-specific 분기문을 넣지 않습니다.

#### 2. Extract a shared MCP execution core

현재 owned CLI handlers는 parse/format이 섞여 있어 MCP tool handler가 그대로 재사용하기 어렵습니다. 특히 `query`는 CLI query document 입력을 받고, `status`는 CLI formatter를 반환합니다 ([`src/commands/owned/query.ts:104`](../../src/commands/owned/query.ts), [`src/commands/owned/status.ts:59`](../../src/commands/owned/status.ts)).

MCP용으로는 다음 shared service layer를 분리하는 편이 적절합니다.

- `src/mcp/core/query_tool.ts`
  - typed `searches[]`, `limit`, `minScore`, `candidateLimit`, `collections`, `intent`
  - K-QMD query/search policy와 health advisory를 structured response용 데이터로 반환
- `src/mcp/core/status_tool.ts`
  - current owned status data + MCP daemon state

v1에서는 shared core를 최소화합니다.

- `query/status`만 shared domain core로 올립니다.
- `get/multi_get`는 retrieval semantics 변경이 없으므로, 별도 domain layer를 만들기보다 thin adapter에서 upstream-compatible behavior를 유지합니다.
- shared core는 “tool별 파일”이라기보다 transport-agnostic domain decision layer여야 하며, MCP response shape를 직접 알면 안 됩니다.

원칙은 “CLI formatter를 MCP에 억지로 재사용”이 아니라, “같은 domain decision을 shared core에서 내리고 CLI/MCP가 각자 포맷만 다르게 한다”입니다.

추가 타입 규칙:

- MCP-facing schema 타입과 internal resolved input 타입을 분리합니다.
- 예: `McpQueryRequest -> ResolvedQueryInput`, `McpGetRequest -> ResolvedGetInput`
- validation 이후 core에는 optional/nullable가 최소화된 내부 타입만 넘깁니다.
- core result는 문자열이 아니라 discriminated union으로 닫습니다.
  - 예: `success | validation_error | runtime_error | advisory`
- tool manifest, alias mapping, schema descriptors는 `as const` + `satisfies`로 선언하고 default export는 피합니다.

#### 3. Build a local MCP server with upstream-compatible surface

새 `src/mcp/server.ts`는 `@modelcontextprotocol/sdk`를 직접 사용하되, upstream MCP의 public surface를 기준선으로 맞춥니다.

포함 범위:

- stdio server
- HTTP streamable server
- `qmd://{path}` resource
- `query`, `get`, `multi_get`, `status` tools
- `POST /mcp`
- `GET /health`
- `POST /query`, `POST /search` REST aliases

주의점:

- stdio mode에서는 stdout을 protocol 전용으로 유지하고 diagnostic output은 stderr 또는 daemon log로 분리합니다.
- HTTP/REST shape는 upstream names를 유지하되, local implementation details는 응답 body에 섞지 않습니다.
- SDK가 제공하는 transport/session lifecycle hooks를 우선 사용하고, bespoke protocol framing은 피합니다.
- default HTTP bind는 `127.0.0.1`로 고정하고, 외부 bind는 명시적 opt-in 없이는 허용하지 않습니다.
- Streamable HTTP path에서는 session ID 생성, reuse, cleanup을 transport hook 기준으로 관리합니다.

예상 파일:

- `src/mcp/server.ts`
- `src/mcp/http.ts`
- `src/mcp/resources.ts`
- `src/mcp/schema.ts`

#### 4. Reuse existing K-QMD policy seams intentionally

`query` tool은 upstream raw `store.search(...)`를 그대로 감싸기보다 K-QMD-owned query/search policy를 우선합니다.

- collection resolution: existing owned validation rules 재사용
- Hangul lexical behavior: shadow index readiness와 legacy fallback policy 반영
- embedding mismatch: CLI처럼 stderr warning은 없으므로 MCP content/structured metadata에 product-consistent advisory shape를 정의
- `candidateLimit`: K-QMD가 실제로 지원할지 명확히 결정하고, 지원한다면 no-op 없이 실제 execution path에 연결

tool 설계 규칙:

- upstream-facing MCP tool은 parity-facing surface이고, 내부 구현은 가능한 primitive capability 조합으로 분해합니다.
- 예: `resolveCollectionScope`, `openQueryRuntime`, `runQueryPolicy`, `shapeStatusSnapshot`, `readDocumentSlice`
- `daemon lifecycle + health + status`를 한 handler에 섞지 않고 read/lifecycle primitive를 분리합니다.
- tool 설명, 파라미터 이름, 결과 구조는 agent가 추가 호출 없이 다음 행동을 정할 수 있을 만큼 충분히 명확해야 합니다.

`status` tool은 current owned status의 embedding/search health vocabulary를 이어받아야 하며, HTTP daemon이 떠 있을 때는 MCP daemon running state도 best-effort로 포함합니다.

`status` ownership line은 세 층으로 분리합니다.

- `domain health`: embedding/search policy health
- `transport/daemon health`: running PID, bind, port, stop state
- `advisory`: action guidance and intentional divergence notes

#### 5. Preserve daemon lifecycle parity

이미 path helper와 path compatibility test가 있으므로 ([`test/path-compatibility.test.ts:66`](../../test/path-compatibility.test.ts)), daemon lifecycle는 local ownership으로 옮겨도 기존 path contract를 유지해야 합니다.

필수 surface:

- `qmd mcp --http`
- `qmd mcp --http --port <n>`
- `qmd mcp --http --daemon`
- `qmd mcp stop`
- PID/log paths under `getMcpPidPath()` / `getMcpLogPath()`

추가로 owned `status`는 daemon running info를 보여 줄 수 있도록 확장합니다.

보안/운영 규칙:

- PID 파일은 stale state와 cross-process confusion에 안전해야 합니다.
- symlink/hardlink 경로 오용이 감지되면 실패합니다.
- 기본 로그는 최소화하며, query text나 document body를 남기지 않습니다.
- stop은 PID 숫자만 믿지 않고 기대 프로세스 metadata를 교차 확인합니다.

#### 6. Runtime/store reuse policy

MCP는 반복 호출과 장수 연결이 기본이므로, transport session과 store lifetime을 분리합니다.

- stdio: process lifetime 동안 shared read store 1개
- HTTP foreground/daemon: server lifetime 동안 shared store 1개
- session: protocol bookkeeping only
- `status/query/get/multi_get`는 같은 read session/store를 재사용

동시성 규칙:

- HTTP는 `session map`과 `shared read store`를 분리합니다.
- daemon stop 진행 중에는 신규 요청을 거부합니다.
- stdio는 단일 연결이지만 tool 호출 중첩으로 protocol stream이 꼬이지 않도록 보호합니다.

성능 가드레일:

- `tools/list`, `resources/list`, `/health`는 fast path 또는 immutable descriptor cache를 우선합니다.
- `status`는 daemon 상태와 expensive health 계산을 분리해 hot path에서 cheap snapshot을 우선합니다.
- single request context 안에서는 status snapshot/collection metadata를 공유해 중복 DB work를 줄입니다.

### Implementation Phases

#### Phase 1: Define the MCP support matrix and extract seams

- `docs/plans/2026-03-16-feat-mcp-compatibility-ownership-boundary-plan.md`
  - 최종 support matrix와 claim boundary를 유지
- `src/mcp/core/`
  - query/status/get/multi_get shared output model 초안 생성
- `test/mcp/`
  - upstream baseline probe helpers 추가

Deliverables:

- MCP support matrix 문서화
- shared core type definitions
- upstream MCP surface를 black-box로 고정하는 baseline fixture
- `candidateLimit` 지원 여부를 phase 1에서 확정
- intentional divergence registry와 version-bump checklist 초안

#### Phase 2: Implement stdio MCP ownership and tool parity

- `src/commands/manifest.ts`
  - `mcp` ownership 전환
- `src/cli.ts`
  - `handleMcpCommand` 진입점 추가
- `src/mcp/server.ts`
  - stdio MCP server + tools/resources 구현
- `src/mcp/core/query_tool.ts`
  - K-QMD query/search policy 연결
- `src/mcp/core/status_tool.ts`
  - owned status health 연결

Deliverables:

- stdio `qmd mcp`가 local server를 띄움
- `tools/list`, `resources/read`, `query/get/multi_get/status` parity baseline 통과
- MCP query가 K-QMD-owned semantics를 타는 evidence 확보
- core unit tests + adapter contract tests 분리
- 자연어 parity test 초안 확보

#### Phase 3: Add HTTP/daemon lifecycle, status visibility, and release gates

- `src/mcp/http.ts`
  - `/mcp`, `/health`, `/query`, `/search`
- `src/mcp/daemon.ts`
  - daemon spawn/stop/log/PID handling
- `src/commands/owned/status.ts`
  - MCP daemon visibility 추가
- `package.json`
  - MCP contract tests를 canonical gate에 포함
- `README.md`, `docs/development.md`, `docs/architecture/*.md`
  - owned MCP claim 문서화

Deliverables:

- HTTP foreground/daemon mode 동작
- `qmd mcp stop` cleanup
- release-contract / artifact smoke에 MCP 포함
- 문서/지원 매트릭스 갱신
- architecture decision record 수준의 경계 문서 반영

## System-Wide Impact

### Interaction Graph

`qmd mcp`는 다음 체인을 탑니다.

`src/cli.ts` routing  
→ `handleMcpCommand`  
→ stdio 또는 HTTP/daemon bootstrap  
→ MCP tool/resource registration  
→ shared MCP core  
→ owned runtime open policy  
→ store access / search policy / embedding health  
→ MCP response shaping

기존 owned CLI와 공통으로 묶여야 하는 축은 `runtime open policy`, `collection resolution`, `search/embedding health`, `path compatibility`입니다.

### Error & Failure Propagation

- startup errors
  - missing/corrupt DB
  - port already in use
  - stale PID file
  - permission/log file failure
- transport errors
  - missing session ID
  - unknown session
  - malformed JSON
- tool errors
  - invalid collection filter
  - document not found
  - model/bootstrap failure
  - unsupported or invalid candidateLimit

원칙:

- stdio MCP protocol output은 stdout만 사용
- diagnostics는 stderr/log로 분리
- machine-readable HTTP body에 local stack trace를 넣지 않음

### State Lifecycle Risks

- read-only tool 호출이 config-file open을 통해 shared DB metadata를 예상보다 많이 바꾸는 위험
- daemon start 후 PID file은 남았는데 실제 child는 죽은 상태
- stop 실패 시 stale PID cleanup이 일관되지 않는 위험
- HTTP session map 누수
- local MCP가 owned status/query core를 직접 재사용하면서 CLI/MCP 결과가 다시 갈라질 위험

Mitigation:

- runtime seam을 shared helper 하나에 고립
- daemon stop/idempotency tests
- session cleanup tests
- CLI/MCP contract comparison tests

### API Surface Parity

이번 슬라이스에서 parity 기준은 byte-for-byte upstream 재현이 아닙니다. 대신 아래를 public contract로 맞춥니다.

- same entrypoint names
- same tool/resource names
- same transport names and route paths
- same pid/log path conventions
- K-QMD-specific policy가 필요한 곳에서는 silent drift 대신 intentional divergence + tests + docs

특히 `candidateLimit`처럼 upstream MCP가 schema는 열어 두고 execution은 no-op인 부분은 그대로 복제하지 않습니다. K-QMD는 no-op를 허용하지 않는 저장소 철학을 이미 갖고 있으므로, 이 필드는 “실제 지원” 또는 “명시적 비지원” 중 하나로 닫아야 합니다.

### Integration Test Scenarios

1. stdio initialize → tools/list → `query` on Hangul input → K-QMD shadow policy evidence 확인
2. stdio `status` → embedding/search health vocabulary + MCP daemon state 일관성 확인
3. HTTP `/health` → `/mcp` initialize → `tools/call query` → session reuse/cleanup 확인
4. daemon start → PID/log file 생성 → `qmd mcp stop` cleanup → stale PID idempotency 확인
5. `get` + `multi_get` + `qmd://{path}` resource read가 path/docid/line offsets에서 같은 retrieval semantics를 보이는지 확인
6. stdio mode에서 DB/bootstrap/validation failure가 나도 stdout protocol stream이 깨지지 않음
7. default HTTP bind에서 LAN IP 접근이 거부되고, `Origin` 검증이 기대대로 작동함
8. malformed JSON, unknown session, stale session, large session churn이 redacted generic 4xx로 정리됨
9. 자연어 parity test: “내 문서에서 상태 보여줘”, “이 경로 문서 일부 읽어줘”, “한글 질의로 찾아줘”를 agent가 올바른 tool 조합으로 수행함
10. Inspector 기반 invalid input / concurrent operations / protocol compliance 점검이 통과함

## Acceptance Criteria

### Functional Requirements

- [x] `qmd mcp` route가 local ownership으로 전환되고, 더 이상 plain passthrough에 의존하지 않습니다.
- [x] stdio MCP server가 `query`, `get`, `multi_get`, `status` tools와 `qmd://{path}` resource를 제공합니다.
- [x] MCP `query` tool은 upstream raw `store.search(...)` 직행이 아니라 K-QMD-owned search/query policy를 반영합니다.
- [x] MCP `status` tool은 current owned status vocabulary를 반영하고, HTTP daemon 실행 시 running state를 best-effort로 드러냅니다.
- [x] HTTP mode가 `POST /mcp`, `GET /health`, `POST /query`, `POST /search`, `--daemon`, `stop`까지 동작합니다.
- [x] PID/log path는 현재 path compatibility contract를 유지합니다.
- [x] `candidateLimit`는 no-op가 아니어야 합니다. 지원한다면 실제로 동작하고, 아니면 schema/help/docs/tests에서 명시적으로 닫힙니다.
- [x] `status` payload는 `domain health`, `transport/daemon health`, `advisory`를 구분해 확장됩니다.
- [x] capability parity map이 `query/get/multi_get/status/qmd:// /health/daemon start/stop`를 모두 포함합니다.

### Non-Functional Requirements

- [x] stdio protocol stream은 diagnostic text로 오염되지 않으며, stdout은 MCP protocol 바이트 외 어떤 로그도 내보내지 않습니다.
- [x] new MCP boundary는 upstream private CLI formatter나 private MCP module monkeypatch에 의존하지 않습니다.
- [x] read-path session open은 기존 owned runtime safety principles와 충돌하지 않습니다.
- [x] drift-sensitive seam은 dedicated compatibility guard test를 가집니다.
- [x] default HTTP bind는 `127.0.0.1`이며, 외부 노출은 명시적 opt-in 없이는 허용하지 않습니다.
- [x] session ID는 추측 불가능하고, unknown/stale/missing session은 generic 4xx로 처리되며 내부 상태를 노출하지 않습니다.
- [x] PID/log lifecycle은 symlink/path confusion과 stale process confusion에 안전합니다.
- [x] path/resource/body inputs는 길이 제한, 배열 크기 제한, normalization, maxBytes/fromLine 상한을 가집니다.
- [x] HTTP/stdio 오류 응답에는 stack trace, absolute path, env/config 값, raw exception cause를 포함하지 않습니다.
- [x] `store lifetime`과 `session lifetime`이 분리되고, shared store reuse policy가 명시적으로 구현됩니다.
- [x] cold start와 warm steady-state에 대해 별도 측정 기준을 가집니다.

### Quality Gates

- [x] `test:release-contract` 또는 동급 canonical gate에 MCP contract tests가 포함됩니다.
- [x] actual tarball install smoke에 MCP stdio/HTTP/daemon proof가 포함됩니다.
- [x] README, architecture docs, development docs, support matrix가 MCP ownership 전환을 반영합니다.
- [x] upstream version bump 시 MCP surface drift가 늦지 않게 실패하는 baseline/guard가 존재합니다.
- [x] core unit tests와 adapter contract tests가 분리되어 있고 둘 다 canonical gate에 포함됩니다.
- [x] Inspector 기반 protocol smoke, invalid input, concurrent operations 점검이 포함됩니다.
- [x] intentional divergence registry와 version-bump checklist가 문서로 남습니다.
- [x] performance verification은 cold start, warm query, warm status, repeated control-plane calls, daemon soak의 다섯 축으로 측정됩니다.

## Success Metrics

- `qmd mcp`를 Claude/Claude Code에 연결했을 때 tools/resources surface가 기대대로 노출됩니다.
- Hangul query와 status health가 CLI와 MCP 사이에서 product-consistent합니다.
- `bun run test:release-contract`와 artifact smoke만으로 MCP claim의 go/no-go를 재판단할 수 있습니다.
- upstream `@tobilu/qmd` 버전 변화가 생기면 MCP drift가 runtime bug보다 먼저 test failure로 드러납니다.
- cold `qmd mcp --http` startup, first `tools/list`, warm `query`, warm `status`, daemonized repeated `query`에 대해 p50/p95 기준을 추적합니다.

## Dependencies & Risks

- **Risk:** local MCP adapter가 upstream surface에서 drift 합니다.  
  **Mitigation:** black-box MCP contract tests + version-pinned baseline fixture를 둡니다.
- **Risk:** CLI와 MCP가 서로 다른 core를 쓰며 결과가 다시 갈라집니다.  
  **Mitigation:** query/status 중심 decision logic을 shared service layer로 먼저 분리합니다.
- **Risk:** daemon lifecycle가 cross-platform smoke에서 불안정합니다.  
  **Mitigation:** existing bin smoke/pid path patterns을 재사용하고 stop/idempotency tests를 추가합니다.
- **Risk:** all-or-nothing 범위가 커서 halfway support가 섞입니다.  
  **Mitigation:** Phase 2 산출물만으로 public claim을 바꾸지 않고, Phase 3 docs/tests까지 닫힌 뒤에만 supported로 옮깁니다.
- **Risk:** stdio transport가 dependency 또는 local logging 때문에 protocol stream을 오염합니다.  
  **Mitigation:** stdout-zero-contamination gate와 error-path smoke를 둡니다.
- **Risk:** HTTP session/PID/log state가 stale or hostile local state에 취약합니다.  
  **Mitigation:** session cleanup, localhost bind default, redacted error policy, PID/log safety checks를 계획 단계에서 닫습니다.

## Future Considerations

- upstream가 injectable MCP builder 또는 public hook surface를 제공하면 local adapter를 줄일 수 있습니다.
- CLI `get/multi-get` owned retrieval layer 흡수는 별도 계획 없이는 시작하지 않습니다.
- richer structured metadata, extended REST ergonomics, advanced daemon supervision은 v1 구현 중에는 착수하지 않습니다.

## Documentation Plan

- `README.md`
  - MCP setup, transport, daemon, support statement 갱신
- `docs/architecture/kqmd-command-boundary.md`
  - `mcp` ownership 전환 반영
- `docs/architecture/upstream-compatibility-policy.md`
  - MCP drift 대응 원칙과 local adapter policy 반영
- `docs/development.md`
  - MCP contract verification commands, artifact smoke, version-bump checklist 반영
- support matrix / intentional divergence registry
  - tool descriptions, parity map, intentional divergence를 단일 source of truth로 연결
- capability disclosure
  - tool descriptions, agent-facing ergonomics, parity map, testing policy를 함께 문서화

## Sources & References

### Origin

- **Brainstorm document:** [`docs/brainstorms/2026-03-16-mcp-passthrough-compatibility-brainstorm.md`](../../docs/brainstorms/2026-03-16-mcp-passthrough-compatibility-brainstorm.md)
  - carried-forward decisions:
  - success 기준은 server boot가 아니라 전체 tool surface 정합성
  - 평가는 all-or-nothing
  - pure passthrough는 현재 구조상 성립 가능성이 낮음

### Internal References

- [`src/commands/manifest.ts:3`](../../src/commands/manifest.ts)
- [`src/cli.ts:109`](../../src/cli.ts)
- [`src/passthrough/delegate.ts:29`](../../src/passthrough/delegate.ts)
- [`src/commands/owned/runtime.ts:91`](../../src/commands/owned/runtime.ts)
- [`src/commands/owned/query.ts:52`](../../src/commands/owned/query.ts)
- [`src/commands/owned/search.ts:57`](../../src/commands/owned/search.ts)
- [`src/commands/owned/status.ts:28`](../../src/commands/owned/status.ts)
- [`docs/architecture/upstream-compatibility-policy.md:23`](../../docs/architecture/upstream-compatibility-policy.md)
- [`test/path-compatibility.test.ts:66`](../../test/path-compatibility.test.ts)
- [`package.json:25`](../../package.json)

### Upstream Baseline

- [`node_modules/@tobilu/qmd/README.md:115`](../../node_modules/@tobilu/qmd/README.md)
- [`node_modules/@tobilu/qmd/dist/cli/qmd.js:2584`](../../node_modules/@tobilu/qmd/dist/cli/qmd.js)
- [`node_modules/@tobilu/qmd/dist/mcp/server.js:110`](../../node_modules/@tobilu/qmd/dist/mcp/server.js)
- [`node_modules/@tobilu/qmd/dist/mcp/server.js:154`](../../node_modules/@tobilu/qmd/dist/mcp/server.js)
- [`node_modules/@tobilu/qmd/dist/mcp/server.js:260`](../../node_modules/@tobilu/qmd/dist/mcp/server.js)
- [`node_modules/@tobilu/qmd/dist/mcp/server.js:315`](../../node_modules/@tobilu/qmd/dist/mcp/server.js)
- [`node_modules/@tobilu/qmd/dist/mcp/server.js:375`](../../node_modules/@tobilu/qmd/dist/mcp/server.js)
- [`node_modules/@tobilu/qmd/dist/mcp/server.js:402`](../../node_modules/@tobilu/qmd/dist/mcp/server.js)
- [`node_modules/@tobilu/qmd/dist/mcp/server.js:412`](../../node_modules/@tobilu/qmd/dist/mcp/server.js)

### External References

- [MCP SDKs](https://modelcontextprotocol.io/docs/sdk)
- [MCP Transports Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP Security Best Practices](https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices)
- [MCP Debugging Guide](https://modelcontextprotocol.io/docs/tools/debugging)
- [MCP TypeScript SDK Server Docs](https://ts.sdk.modelcontextprotocol.io/documents/server.html)

### Institutional Learnings

- [`docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md`](../../docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md)
- [`docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`](../../docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
- [`docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`](../../docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md)
