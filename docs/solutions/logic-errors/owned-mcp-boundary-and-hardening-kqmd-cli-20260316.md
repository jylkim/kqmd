---
module: K-QMD CLI
date: 2026-03-16
problem_type: logic_error
component: tooling
symptoms:
  - "`qmd mcp` was still passthrough, so MCP `query`/`status` did not use K-QMD-owned semantics"
  - "`qmd --index <name> mcp` opened the default `index.sqlite` instead of the selected index"
  - "Config-only environments behaved differently in MCP than in owned CLI commands"
  - "HTTP MCP had origin, daemon, session, and response-shaping gaps that weakened the contract"
  - "`/mcp` query tool and `/query`/`/search` alias paths drifted in validation and snippet shaping"
  - "Initialize instructions under-described the retrieval and status workflow exposed to agents"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [mcp, cli, qmd, compatibility, http, daemon, security, typescript, runtime, integration]
---

# Troubleshooting: Owning and hardening the MCP boundary in K-QMD CLI

## Problem

K-QMD는 `qmd-compatible replacement distribution`이지만, `qmd mcp`는 한동안 upstream CLI로 그대로 passthrough 되었다. 이 구조에서는 MCP client가 `query`, `status`, `get`, `multi_get` 같은 tool을 호출해도 K-QMD가 이미 CLI에서 소유하던 runtime/query/search/health 정책이 적용되지 않았다.

핵심 이유는 upstream MCP가 CLI 재호출이 아니라 자체 `createStore()`와 store methods를 직접 사용하기 때문이다. 즉, replacement-distribution 경계만으로는 `mcp` surface를 통제할 수 없었다.

이후 `mcp`를 owned surface로 옮긴 뒤에도 여러 hardening 문제가 연쇄적으로 드러났다.

- `--index`와 config bootstrap이 MCP startup에 반영되지 않음
- HTTP origin 검증이 hostname 수준으로 너무 느슨함
- daemon PID/log path hardening이 leaf file까지만 적용됨
- daemon startup이 readiness 전에 false success를 반환함
- HTTP session lifecycle이 무기한이고 initialize-time control-plane 조회를 반복함
- `/mcp` query tool과 `/query`/`/search` alias가 validation/response shaping에서 drift함
- initialize instructions가 `get`/`multi_get`/`status` action flow를 충분히 드러내지 못함

문제는 단순 기능 추가가 아니라, “MCP는 CLI passthrough와 다른 execution surface다”라는 사실을 제품/런타임 경계에 반영하지 못한 데 있었다.

## Environment

- Module: K-QMD CLI
- Affected Component: owned MCP boundary / runtime selection / HTTP transport / daemon lifecycle
- Date: 2026-03-16
- Relevant files:
  - `src/commands/owned/mcp.ts`
  - `src/mcp/server.ts`
  - `src/mcp/daemon_state.ts`
  - `src/commands/owned/query_core.ts`
  - `src/commands/owned/status_core.ts`
  - `scripts/verify_release_artifact.ts`
  - `test/mcp-command.test.ts`
  - `test/mcp-http.test.ts`
  - `test/mcp-stdio.test.ts`
  - `test/mcp-runtime.test.ts`
  - `test/mcp-daemon-state.test.ts`
  - `test/mcp-upstream-guard.test.ts`

## Symptoms

- `qmd mcp`가 upstream passthrough라서 MCP `query/status`가 K-QMD-owned semantics를 타지 않았다
- `qmd --index work mcp`가 `work.sqlite`가 아니라 기본 `index.sqlite`를 사용했다
- config만 있고 DB가 아직 없는 환경에서 owned CLI와 MCP startup 의미가 달랐다
- HTTP MCP가 cross-port localhost origin을 넓게 허용했다
- daemon start가 실제 server readiness 전에 “Started ...”를 반환할 수 있었다
- `mcp.pid`/`mcp.log` hardening이 상위 cache directory symlink까지 막지 못했다
- HTTP session이 TTL 없이 누적될 수 있었고, session마다 instructions/control-plane 조회를 반복했다
- `/mcp` query tool과 `/query` alias가 `intent`와 snippet shaping에서 서로 달랐다
- initialize instructions가 retrieval/status action flow를 충분히 설명하지 않았다

## What Didn't Work

**Attempted approach 1:** `mcp`를 passthrough surface로 유지한다.  
- **Why it failed:** tool/resource names는 유지되지만, actual execution은 upstream store 직행이라 K-QMD query/status/search policy가 적용되지 않는다.

**Attempted approach 2:** upstream MCP private module을 그대로 감싸거나 monkeypatch 한다.  
- **Why it failed:** `dist/mcp/server.js`는 private seam이고 public hook surface가 없다. drift risk가 너무 높다.

**Attempted approach 3:** owned MCP를 만들되 startup/runtime은 단순 `index.sqlite` open으로 둔다.  
- **Why it failed:** `--index`, config-file bootstrap, DB-only reopen policy가 사라져 다른 owned command와 의미가 달라진다.

**Attempted approach 4:** `/query`와 `/search`를 MCP tool과 별도로 구현한다.  
- **Why it failed:** validation, `intent`, snippet extraction, response shaping drift가 transport마다 생긴다.

**Attempted approach 5:** daemon spawn만 성공하면 바로 success를 반환한다.  
- **Why it failed:** 실제 HTTP server boot 실패 시 stale PID와 false-positive success가 남는다.

## Solution

해결은 “MCP를 별도 passthrough 예외가 아니라 owned boundary로 취급한다”는 원칙 아래 여럿의 작은 수정으로 이뤄졌다.

1. `mcp`를 owned command로 전환했다.
2. local MCP server를 추가해 stdio/HTTP/daemon lifecycle을 K-QMD가 직접 소유하게 했다.
3. `query_core` / `status_core`를 추출해 CLI와 MCP가 같은 domain decision을 재사용하게 했다.
4. MCP startup도 owned runtime selection 규칙을 따르도록 바꿔 `--index`, config bootstrap, db/config path semantics를 회복했다.
5. daemon safety를 별도 helper로 분리해 PID/log path safety, process shape 검증, stale PID cleanup을 고정했다.
6. HTTP path는 exact self-origin, session TTL, metadata cache, shared validation/response shaping으로 hardening 했다.
7. initialize instructions에 `query -> get/multi_get -> status` action map을 추가해 agent discoverability를 보강했다.
8. stdio/HTTP/daemon/tarball install 경로를 모두 테스트와 smoke로 닫았다.

**Code changes**:

```ts
// src/commands/manifest.ts
export const OWNED_COMMANDS = ['search', 'query', 'update', 'embed', 'status', 'mcp'] as const;
```

```ts
// src/commands/owned/mcp.ts
const startup = resolveMcpStartupOptions(context, env, existsSyncImpl);

if (http && daemon) {
  return startDaemon(port, {
    env,
    indexName: startup.indexName,
  });
}

if (http) {
  await startOwnedMcpHttpServer(port, {
    env,
    startup,
  });
  return { exitCode: 0, directIO: true };
}

await startOwnedMcpServer({
  env,
  startup,
});
return { exitCode: 0, directIO: true };
```

```ts
// src/mcp/server.ts
const queryRequestSchema = z.object({
  searches: z.array(querySubSearchSchema).min(1).max(10),
  limit: z.number().int().min(1).max(100).optional().default(10),
  minScore: z.number().min(0).max(1).optional().default(0),
  candidateLimit: z.number().int().min(1).max(100).optional(),
  collections: z.array(z.string()).max(20).optional(),
  intent: z.string().max(500).optional(),
});
```

```ts
// src/mcp/server.ts
function assertLocalOrigin(req: IncomingMessage): boolean {
  const origin = getHeader(req, 'origin');
  if (!origin) return true;

  const host = getHeader(req, 'host');
  if (!host) return false;

  const parsedOrigin = new URL(origin);
  return parsedOrigin.origin === `http://${host}`;
}
```

```ts
// src/mcp/daemon_state.ts
export function ensureRegularPath(path: string): void {
  let current = path;

  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new UnsafeDaemonPathError(current);
    }

    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
```

```ts
// src/commands/owned/mcp.ts
const readiness = await waitForDaemonReady(child, port);
if (readiness !== true) {
  try {
    process.kill(child.pid ?? 0, 'SIGTERM');
  } catch {}
  closeSync(logFd);
  return readiness;
}

writeFileSync(daemonState.pidPath, String(child.pid));
```

```ts
// src/mcp/server.ts
const sessions = new Map<
  string,
  { transport: StreamableHTTPServerTransport; server: McpServer; expiresAt: number }
>();

function touchSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.expiresAt = Date.now() + sessionTtlMs;
  }
}
```

```ts
// src/mcp/server.ts
const response = buildQueryResponse(result, searches, intent);

return {
  content: [{ type: 'text', text: response.text }],
  structuredContent: {
    results: response.rows,
    advisories: response.advisories,
  },
};
```

```ts
// src/mcp/server.ts
structuredContent: {
  domain: {
    status: status.status,
    health: status.health,
    searchHealth: status.searchHealth,
    effectiveModel: status.effectiveModel.uri,
    searchPolicy: status.searchPolicy.id,
  },
  transport: {
    mcp: daemon,
  },
  advisories,
}
```

## Why This Works

이 해결책이 맞는 이유는 MCP를 “CLI 옆의 부가 기능”이 아니라 “같은 제품 계약을 다른 transport로 노출하는 표면”으로 다시 모델링했기 때문이다.

1. **Ownership restores semantic control**  
   `mcp`를 owned surface로 옮기면서 K-QMD가 runtime selection, query/status semantics, daemon lifecycle을 통제할 수 있게 됐다.

2. **Shared core reduces transport drift**  
   `query_core` / `status_core`를 추출해 CLI와 MCP가 같은 domain decision을 재사용하게 만들었다. `/mcp`와 `/query` alias drift도 shared helper로 정리할 수 있었다.

3. **Startup parity restores CLI compatibility**  
   `--index`, config bootstrap, db/config path selection을 MCP startup에 다시 연결하면서 owned CLI와 같은 index 의미를 회복했다.

4. **Service-style hardening closes operational gaps**  
   exact-origin, ancestor symlink rejection, readiness polling, session TTL, metadata cache로 MCP를 장기 실행 서비스처럼 다룰 수 있게 했다.

5. **Artifact-level proof closes the real release contract**  
   stdio/HTTP/daemon/tarball install 경로를 각각 따로 검증하면서 “코드가 있다”가 아니라 “배포 surface가 실제로 닫혔다”를 확인했다.

## Prevention

- `mcp`를 일반 passthrough 예외로 두지 말고, manifest 기준 owned/passthrough matrix에 항상 포함해 관리한다
- MCP startup은 `query/status`와 같은 owned runtime selection 규칙을 재사용하게 고정한다
- HTTP surface는 `tool/resource names parity`와 `execution semantics parity`를 분리해 관리한다
- daemon lifecycle은 `spawn 성공`이 아니라 `health readiness`를 성공 기준으로 삼는다
- PID/log path safety는 최종 파일뿐 아니라 상위 cache directory chain까지 검사한다
- HTTP session은 explicit cleanup 또는 TTL 없이 무기한 유지하지 않는다
- `/mcp` tool path와 `/query`/`/search` alias path는 validation과 response shaping을 단일 helper로 공유한다
- process-state가 개입하는 test는 항상 temp `HOME` / `XDG_CACHE_HOME`을 사용한다
- upstream-compatible surface를 새로 열 때는 dedicated guard test를 `release-contract`에 바로 넣는다
- docs에는 intentional divergence registry를 두고 upstream와 다른 점을 명시적으로 기록한다

## Recommended Tests

- routing regression
  - `mcp`가 passthrough로 되돌아가지 않는지
- startup/runtime regression
  - `qmd --index <name> mcp`
  - config-only bootstrap
  - DB-only reopen
- stdio contract
  - invalid input 이후에도 protocol stream이 깨지지 않는지
  - stdout contamination이 없는지
- HTTP contract
  - exact-origin allow
  - cross-port localhost deny
  - missing/unknown session 4xx
  - invalid alias body 400
- daemon lifecycle
  - port collision fails before false success
  - stale PID cleanup
  - symlinked ancestor path rejection
- parity regression
  - `/mcp` query와 `/query` alias가 같은 snippet shaping을 쓰는지
  - `intent`가 두 경로에서 동일하게 반영되는지
- session/perf regression
  - expired session rejection
  - metadata cache reuse
  - repeated reconnect soak
- environment isolation
  - daemon-related tests가 실제 user HOME에 의존하지 않는지
- artifact regression
  - tarball install 후 stdio MCP
  - HTTP MCP
  - daemon start/stop smoke

## Commands Run

```bash
bun run lint
bun run typecheck
bun run test:release-contract
bun run release:artifact
bun run release:verify
bun run measure:mcp-contract
```

## Related Issues

- Planning origin: [`docs/plans/2026-03-16-feat-mcp-compatibility-ownership-boundary-plan.md`](../../plans/2026-03-16-feat-mcp-compatibility-ownership-boundary-plan.md)
- Brainstorm origin: [`docs/brainstorms/2026-03-16-mcp-passthrough-compatibility-brainstorm.md`](../../brainstorms/2026-03-16-mcp-passthrough-compatibility-brainstorm.md)
- Command boundary: [`docs/architecture/kqmd-command-boundary.md`](../../architecture/kqmd-command-boundary.md)
- Compatibility policy: [`docs/architecture/upstream-compatibility-policy.md`](../../architecture/upstream-compatibility-policy.md)
- Divergence registry: [`docs/architecture/mcp-divergence-registry.md`](../../architecture/mcp-divergence-registry.md)
- Benchmark record: [`docs/benchmarks/2026-03-16-mcp-contract-metrics.md`](../../benchmarks/2026-03-16-mcp-contract-metrics.md)

See also:

- [`owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`](./owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
- [`non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md`](./non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md)
- [`query-explain-output-parity-kqmd-cli-20260312.md`](./query-explain-output-parity-kqmd-cli-20260312.md)
- [`status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`](./status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md)
- [`kiwi-shadow-index-hardening-kqmd-cli-20260313.md`](./kiwi-shadow-index-hardening-kqmd-cli-20260313.md)
- [`trusted-dependencies-drift-kqmd-cli-20260313.md`](../security-issues/trusted-dependencies-drift-kqmd-cli-20260313.md)

Related resolved work items:

- `todos/033-complete-p1-owned-mcp-boundary.md`
- `todos/034-complete-p1-mcp-ignores-index-and-config-bootstrap.md`
- `todos/035-complete-p1-http-origin-validation-bypasses-same-origin.md`
- `todos/036-complete-p2-daemon-cache-dir-symlink-clobber.md`
- `todos/037-complete-p2-http-session-lifecycle-and-control-plane-overhead.md`
- `todos/038-complete-p2-http-query-alias-snippet-drift.md`
- `todos/039-complete-p2-daemon-start-can-report-false-success.md`
- `todos/040-complete-p2-http-query-endpoint-missing-input-validation.md`
- `todos/041-complete-p3-mcp-command-test-uses-real-home-state.md`
- `todos/042-complete-p2-mcp-instructions-hide-retrieval-and-status-actions.md`
