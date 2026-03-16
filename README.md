# K-QMD

Better Korean search for `qmd`, without changing how you use `qmd`.

K-QMD는 기존 `qmd` 워크플로를 유지한 채 한국어 검색 경험을 개선하는 `qmd` 호환 배포판입니다. 새 CLI 이름을 배우게 하거나 저장 경로를 옮기게 하기보다, 한국어 지원이 중요한 명령만 선택적으로 소유하는 방향을 택합니다.

## Problem & Solution

한국어 문서는 복합어와 띄어쓰기 차이 때문에 plain lexical search만으로는 recall이 쉽게 떨어질 수 있습니다. 그렇다고 이 문제를 해결하려고 CLI 이름, 인덱스 위치, 기존 스크립트까지 모두 바꾸게 만들면 도입 비용이 너무 커집니다.

K-QMD는 이 사이를 메웁니다. 사용자는 계속 `qmd`를 실행하고, 설정·캐시·DB 경로도 upstream `qmd`와 같은 자리를 쓰면서, 한국어 검색 품질에 직접 영향을 주는 명령만 K-QMD가 직접 구현합니다. 나머지 표면은 upstream `qmd`에 그대로 위임합니다.

## Quick Start

### Requirements

- Node.js `>=24`
- Bun `1.3.10` for local development

### Run from a checkout

```bash
bun install
bun run build

node bin/qmd.js update
node bin/qmd.js search "형태소 분석"
node bin/qmd.js query --candidate-limit 20 "거대언어모델"
node bin/qmd.js status
node bin/qmd.js mcp --http --port 8181
```

패키지로 설치된 뒤에도 사용자가 실행하는 명령은 계속 `qmd`입니다.

```bash
qmd update
qmd search "형태소 분석"
qmd query --explain "auth flow"
qmd status
qmd mcp --http --daemon
```

### Help behavior

- `qmd --help`는 upstream `qmd`의 전체 도움말을 보여줍니다.
- `qmd <owned-command> --help`는 K-QMD가 직접 소유하는 명령의 도움말을 보여줍니다.

## Features

### Korean-aware search without a workflow reset

- `search`는 Kiwi 기반 shadow FTS 경로를 사용해 한국어 복합어와 붙여쓰기 차이에서 오는 recall 손실을 줄입니다.
- shadow index가 없거나 현재 policy와 맞지 않으면 경고를 출력하고 legacy lexical path로 fallback 합니다.
- quoted query나 negation처럼 보수적으로 다뤄야 하는 문법은 shadow path 대신 legacy path를 유지할 수 있습니다.

### Drop-in compatibility where it matters

- 실행 명령은 계속 `qmd`입니다.
- 설정, 캐시, 인덱스 DB 경로는 upstream `qmd`와 공유합니다.
- top-level `qmd --help`, `qmd --version`, `qmd --skill`은 upstream 동작을 그대로 유지합니다.
- 전체 CLI를 다시 구현하지 않고 필요한 표면만 교체합니다.

### Owned runtime for the commands that shape search quality

- 직접 소유하는 명령: `search`, `query`, `update`, `embed`, `status`, `mcp`
- upstream passthrough 명령: `collection`, `ls`, `get`, `multi-get`
- `query`는 owned runtime에서 hybrid query를 실행하며 `--candidate-limit`, `--intent`, `--explain`를 지원합니다.
- `update`는 upstream 문서 스캔 뒤 Korean shadow index를 함께 동기화합니다.
- `status`는 인덱스 상태와 함께 embedding mismatch, Korean search index health를 보여줍니다.
- `embed`는 현재 effective model 기준으로 임베딩을 생성하며 `--force`를 지원합니다.
- `mcp`는 stdio, HTTP, background daemon 모드를 지원합니다.

### Safe defaults and explicit health signals

- 기본 embedding model은 `hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf`입니다.
- `QMD_EMBED_MODEL`을 지정하면 그 값이 effective model이 됩니다.
- 저장된 벡터와 현재 effective model이 어긋나면 `status`, `query`, `embed`, `update`에서 mismatch를 드러냅니다.
- 현재 Korean search policy ID는 `kiwi-cong-shadow-v1`입니다.
- `update --pull`는 현재 owned release surface에 포함되지 않습니다.

### Current scope

첫 릴리스 범위는 Korean-aware lexical recall과 owned command boundary를 안정적으로 제공하는 데 맞춰져 있습니다. 사용자 사전, 동의어 정책, 한글 전용 ranking 조정, `query` 경로의 장기적인 한국어 의미 검색 개선은 아직 범위 밖입니다.

## Development & Contribution

로컬 개발의 기본 품질 게이트는 아래 명령입니다.

```bash
bun run check
```

릴리스 후보를 검증할 때는 아래 명령을 사용합니다.

```bash
bun run release:verify
bun run release:artifact
```

구현과 검증 기준은 아래 문서에 정리되어 있습니다.

- 기여 가이드: [CONTRIBUTING.md](CONTRIBUTING.md)
- 개발 환경과 스크립트: [docs/development.md](docs/development.md)
- 명령 소유 경계: [docs/architecture/kqmd-command-boundary.md](docs/architecture/kqmd-command-boundary.md)
- upstream 호환 정책: [docs/architecture/upstream-compatibility-policy.md](docs/architecture/upstream-compatibility-policy.md)
- MCP divergence 메모: [docs/architecture/mcp-divergence-registry.md](docs/architecture/mcp-divergence-registry.md)

이슈와 PR은 환영합니다. 변경 전에 빠르게 맥락을 잡고 싶다면 위 문서들부터 읽으시면 됩니다.
