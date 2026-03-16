# MCP Divergence Registry

이 문서는 owned MCP boundary에서 upstream baseline과 intentionally 다른 동작을 기록한다.

## Current Divergences

### `query` candidateLimit

- upstream MCP schema는 `candidateLimit`를 노출하지만, installed upstream `dist/mcp/server.js`는 `store.search(...)` 호출에 이를 전달하지 않는다
- K-QMD는 silent no-op를 허용하지 않으므로:
  - 지원 경로에서는 실제 execution semantics에 연결한다
  - 지원하지 않는 조합은 명시적 error로 닫는다

### `status` structured payload

- upstream MCP `status`는 flat summary 중심이다
- K-QMD는 `domain`, `transport`, `advisories`로 structured payload를 분리한다
- 이유:
  - owned status vocabulary 재사용
  - daemon state와 domain health의 source of truth 분리
  - future advisory 확장 경로 확보

### localhost-first HTTP bind

- K-QMD HTTP MCP는 `127.0.0.1` bind를 기본값으로 고정한다
- 이유:
  - local agent use-case 우선
  - DNS rebinding / accidental LAN exposure 방지

## Review Rule

upstream version bump 시 아래를 재검토한다.

- tool/resource names
- `/mcp`, `/health`, `/query`, `/search` route shape
- stdio/HTTP/daemon lifecycle semantics
- intentional divergence가 여전히 필요한지
