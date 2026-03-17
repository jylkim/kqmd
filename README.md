# K-QMD

Better Korean search for `qmd`, without changing how you use `qmd`.

K-QMD는 기존 `qmd` 워크플로를 유지한 채 한국어 검색 경험을 개선하는 `qmd` 호환 배포판입니다. 새 CLI 이름을 배우게 하거나 저장 경로를 옮기게 하기보다, 한국어 지원이 중요한 명령만 선택적으로 소유하는 방향을 택합니다.

## Problem & Solution

한국어 문서는 복합어와 띄어쓰기 차이 때문에 plain lexical search만으로는 recall이 쉽게 떨어질 수 있습니다. `qmd`가 사용하는 SQLite FTS5 `unicode61` 토크나이저는 "형태소분석기"를 하나의 토큰으로 취급하기 때문에, "분석"으로 검색하면 해당 문서를 찾지 못합니다.

| 카테고리 | 쿼리 | 문서 텍스트 | upstream `qmd` | K-QMD |
|---|---|---|:---:|:---:|
| 복합어 | 분석 | 형태소**분석**기 | miss | **hit** |
| 복합어 | 에이전트 | 서브**에이전트** | miss | **hit** |
| 한영 혼합 | 연동 | API**연동** | miss | **hit** |
| 한영 혼합 | 컨테이너 | Docker**컨테이너** | miss | **hit** |
| 기준 | 형태소분석기 | 형태소분석기 | hit | hit |

> **upstream recall 43% vs K-QMD recall 100%** — 30개 쿼리 synthetic 벤치마크 ([전체 결과](docs/benchmarks/2026-03-17-recall-comparison-metrics.md))

K-QMD는 Kiwi 형태소 분석 토큰을 shadow FTS 인덱스에 투영해서 이 문제를 해결합니다. 그렇다고 CLI 이름, 인덱스 위치, 기존 스크립트까지 모두 바꾸게 만들지 않습니다. 사용자는 계속 `qmd`를 실행하고, 설정·캐시·DB 경로도 upstream `qmd`와 같은 자리를 쓰면서, 한국어 검색 품질에 직접 영향을 주는 명령만 K-QMD가 직접 구현합니다. 나머지 표면은 upstream `qmd`에 그대로 위임합니다.

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

- `qmd --help`, `qmd -h`는 upstream `qmd`의 전체 도움말을 보여줍니다.
- `qmd <owned-command> --help`, `qmd <owned-command> -h`, `qmd help <owned-command>`, `qmd --help <owned-command>`는 K-QMD가 직접 소유하는 명령의 도움말을 보여줍니다.
- bare `qmd help`는 upstream passthrough 경로를 그대로 타므로 top-level 도움말 alias로 지원하지 않습니다. 전체 도움말이 필요하면 `qmd --help`를 사용하세요.

## Features

### Korean-aware search without a workflow reset

- `search`는 Kiwi 기반 shadow FTS 경로를 사용해 한국어 복합어와 붙여쓰기 차이에서 오는 recall 손실을 줄입니다.
- shadow index가 없거나 현재 policy와 맞지 않으면 경고를 출력하고 legacy lexical path로 fallback 합니다.
- quoted query나 negation처럼 보수적으로 다뤄야 하는 문법은 shadow path 대신 legacy path를 유지할 수 있습니다.

### Adaptive query ranking for Korean and mixed technical queries

- `query`는 plain query에서 질의 타입을 구분해 `short Korean phrase`, `mixed technical`, `structured compatibility` 경로를 다르게 다룹니다.
- MCP tool `query`와 HTTP `/query`도 이제 plain `query` string 또는 structured `searches[]`를 모두 받아 같은 adaptive plain-query policy를 공유합니다.
- 짧은 한국어 구와 quoted/path-like query는 lexical-first로 처리하고, snippet도 lexical anchor를 우선 반영합니다.
- 한영 혼합 기술어 query는 hybrid retrieval을 유지하되 title/header/literal anchor 신호를 추가로 반영해 상위 결과를 더 설명 가능하게 만듭니다.
- `--explain`과 JSON output은 upstream explain block 위에 local adaptive signals를 함께 드러냅니다.

### Drop-in compatibility where it matters

- 실행 명령은 계속 `qmd`입니다.
- 설정, 캐시, 인덱스 DB 경로는 upstream `qmd`와 공유합니다.
- top-level `qmd --help`, `qmd --version`, `qmd --skill`은 upstream 동작을 그대로 유지합니다.
- 전체 CLI를 다시 구현하지 않고 필요한 표면만 교체합니다.

### Owned runtime for the commands that shape search quality

- 직접 소유하는 명령: `search`, `query`, `update`, `embed`, `status`, `mcp`
- upstream passthrough 명령: `collection`, `ls`, `get`, `multi-get`
- `query`는 owned runtime에서 hybrid query를 실행하며 `--candidate-limit`, `--intent`, `--explain`를 지원합니다.
- plain mixed-technical query에서 `--candidate-limit`는 rerank cost를 bounded 하도록 `<= 50`까지만 허용합니다.
- `update`는 upstream 문서 스캔 뒤 Korean shadow index를 함께 동기화합니다.
- `status`는 인덱스 상태와 함께 embedding mismatch, Korean search index health를 보여줍니다.
- `embed`는 현재 effective model 기준으로 임베딩을 생성하며 `--force`를 지원합니다.
- `mcp`는 stdio, HTTP, background daemon 모드를 지원합니다.
- MCP/HTTP query 응답은 query mode/query class와 row-level `adaptive`/`explain` metadata를 함께 반환해 agent가 local ranking policy를 볼 수 있습니다.

### Safe defaults and explicit health signals

- 기본 embedding model은 `hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf`입니다.
- `QMD_EMBED_MODEL`을 지정하면 그 값이 effective model이 됩니다.
- 저장된 벡터와 현재 effective model이 어긋나면 `status`, `query`, `embed`, `update`에서 mismatch를 드러냅니다.
- 현재 Korean search policy ID는 `kiwi-cong-shadow-v1`입니다.
- `update --pull`는 현재 owned release surface에 포함되지 않습니다.

### Current scope

첫 릴리스 범위는 Korean-aware lexical recall, adaptive query ranking baseline, owned command boundary를 안정적으로 제공하는 데 맞춰져 있습니다. 사용자 사전, 동의어 정책, 대규모 domain-specific ranking policy, `query` 경로의 장기적인 한국어 semantic retrieval 재설계는 아직 범위 밖입니다.

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
