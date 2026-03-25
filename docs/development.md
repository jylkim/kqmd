# Development

K-QMD를 직접 수정하거나 확장하려는 개발자를 위한 문서입니다.
사용자 관점의 개요는 [README.md](../README.md)를 참고하세요.

## 개발 환경

- Node.js >= 22
- Bun 1.3.10
- TypeScript
- Vitest
- Biome

## 시작하기

```bash
bun install
bun run build
bun run check
```

## 주요 스크립트

| 스크립트 | 설명 |
|---|---|
| `bun run lint` | Biome 린트 |
| `bun run format` | Biome 포매팅 |
| `bun run typecheck` | TypeScript 타입 검사 |
| `bun run test` | 전체 테스트 |
| `bun run test:parity` | owned command parity 테스트 |
| `bun run test:watch` | 테스트 watch 모드 |
| `bun run test:coverage` | 테스트 커버리지 |
| `bun run build` | TypeScript 빌드 |
| `bun run check` | lint + typecheck + test |
| `bun run measure:query-cold-start` | fresh child-process query cold-start benchmark |

## 프로젝트 구조

| 경로 | 설명 |
|---|---|
| `bin/qmd.js` | published CLI entrypoint |
| `src/cli.ts` | top-level routing과 실행 진입점 |
| `src/commands/manifest.ts` | owned/passthrough 명령 목록 |
| `src/commands/owned/` | K-QMD가 확장하는 명령 |
| `src/commands/owned/io/` | owned command의 parse/validation/output |
| `src/passthrough/delegate.ts` | QMD 위임 경로 |
| `src/config/embedding_policy.ts` | 임베딩 모델 정책과 bootstrap |
| `src/config/search_policy.ts` | 한국어 검색 정책 |
| `src/config/qmd_paths.ts` | QMD 호환 경로 |
| `src/mcp/server.ts` | MCP server, tool/resource 등록, HTTP transport |
| `src/mcp/daemon_state.ts` | daemon PID/log 관리 |

## 패키징

- 패키지 이름: `kqmd`
- 실행 명령: `qmd`
- `package.json#bin`이 `bin/qmd.js`를 가리키고, `bin/qmd.js`는 빌드 산출물인 `dist/cli.js`를 실행합니다.

## 검증

### 기본 품질 게이트

모든 변경은 아래 명령으로 확인합니다.

```bash
bun run check
```

### 변경 범위별 추가 검증

| 변경 범위 | 명령 |
|---|---|
| owned CLI 출력/파싱/도움말 | `bun run test:parity` |
| MCP 동작 | `bun run test -- mcp-command mcp-server mcp-http mcp-stdio mcp-runtime mcp-daemon-state` |
| 한국어 검색 정책/shadow index | `bun run test -- search-policy search-index-health kiwi-tokenizer search-shadow-index owned-search-behavior status-command` |
| query search-assist / MCP parity | `bun run test -- query-core query-output-security query-output mcp-query mcp-server mcp-http` |
| query fast-default policy / cold-start | `bun run test -- query-execution-policy query-lexical-candidates query-runtime query-core` |
| 임베딩 정책/mismatch | `bun run test -- embedding-policy embedding-health owned-embedding-behavior status-command` |

### 수동 검증

```bash
qmd update
qmd status
qmd search "형태소 분석"
```

- `qmd update`가 성공하면 Kiwi shadow index 동기화까지 완료된 상태여야 합니다.
- `qmd status`가 `clean`이면 `qmd search`는 warning 없이 shadow path를 사용해야 합니다.

릴리스 검증 절차는 [docs/release.md](release.md)를 참고하세요.

## 관련 문서

- [docs/architecture/kqmd-command-boundary.md](architecture/kqmd-command-boundary.md)
- [docs/architecture/upstream-compatibility-policy.md](architecture/upstream-compatibility-policy.md)
- [docs/architecture/mcp-divergence-registry.md](architecture/mcp-divergence-registry.md)
