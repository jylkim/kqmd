# Contributing to K-QMD

K-QMD에 기여해 주셔서 감사합니다. 이 저장소는 `qmd` 호환성을 유지하면서 한국어 검색 품질을 개선하는 데 초점을 맞추고 있습니다. 변경을 제안하실 때는 새 기능을 추가하는 것만큼, 어떤 surface를 K-QMD가 직접 소유하고 무엇을 upstream `qmd`에 그대로 위임할지도 함께 생각해 주시면 좋겠습니다.

## Before you start

- 먼저 [README.md](README.md)를 읽고 프로젝트가 해결하려는 문제와 현재 범위를 확인해 주세요.
- 구현 경계가 중요한 변경이라면 [docs/architecture/kqmd-command-boundary.md](docs/architecture/kqmd-command-boundary.md)와 [docs/architecture/upstream-compatibility-policy.md](docs/architecture/upstream-compatibility-policy.md)를 같이 봐 주세요.
- 개발 환경과 세부 검증 흐름은 [docs/development.md](docs/development.md)에 정리되어 있습니다.

## Development setup

필수 환경:

- Node.js `>=24`
- Bun `1.3.10`

기본 시작 명령:

```bash
bun install
bun run build
bun run check
```

## Project map

- `src/commands/manifest.ts`: owned / passthrough 명령의 source of truth
- `src/commands/owned/`: K-QMD가 직접 구현하는 CLI surface
- `src/passthrough/`: upstream `qmd` 위임 경로
- `src/config/`: embedding/search policy와 upstream-compatible path helper
- `src/mcp/`: MCP server와 daemon state 관리
- `test/`: routing, parity, runtime, MCP, packaging 관련 계약 테스트

## Testing expectations

대부분의 변경은 아래 명령으로 확인해 주세요.

```bash
bun run check
```

아래 경우에는 추가 검증이 필요합니다.

- owned CLI 출력/파싱/도움말을 바꿨다면 `bun run test:parity`
- release surface를 건드렸다면 `bun run release:verify`
- artifact packaging을 건드렸다면 `bun run release:artifact`
- MCP 동작을 바꿨다면 `bun run test -- mcp-command mcp-server mcp-http mcp-stdio mcp-runtime mcp-daemon-state`
- Korean search 정책이나 shadow index를 바꿨다면 `bun run test -- search-policy search-index-health kiwi-tokenizer search-shadow-index owned-search-behavior status-command`

## Pull requests

- 무엇이 바뀌는지보다 먼저, 사용자에게 어떤 동작 변화가 생기는지 설명해 주세요.
- 명령 ownership을 바꾸는 PR이라면 owned / passthrough 경계를 본문에 분명히 적어 주세요.
- CLI help, README, 개발 문서, 테스트 중 함께 갱신되어야 할 것이 있다면 같이 맞춰 주세요.
- 새 동작을 주장한다면 그 주장을 뒷받침하는 테스트나 검증 경로를 함께 넣어 주세요.

## Issues

버그 리포트를 올릴 때는 아래 정보를 함께 주시면 재현이 빨라집니다.

- 실행한 명령
- 기대한 결과와 실제 결과
- 사용한 OS, Node 버전, Bun 버전
- 가능하다면 최소 재현 단계

## Questions and proposals

작은 문서 수정부터 구조적인 제안까지 모두 환영합니다. 구현 전에 방향이 애매하면 이슈나 PR 설명에서 문제 정의와 선택지부터 먼저 열어 주셔도 좋습니다.
