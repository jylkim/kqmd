# K-QMD

Drop-in [QMD](https://github.com/tobi/qmd) replacement with Korean-aware search.

[![npm](https://img.shields.io/npm/v/kqmd)](https://www.npmjs.com/package/kqmd)
[![license](https://img.shields.io/npm/l/kqmd)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

## Why K-QMD

QMD가 사용하는 토크나이저는 한글 검색률이 떨어집니다. 복합어, 한영 혼합 붙여쓰기, 긴 한국어 질문에서 문서를 찾지 못하는 경우가 많습니다. K-QMD는 QMD에 [Kiwi](https://github.com/bab2min/Kiwi) 형태소 분석을 결합해 이 문제를 해결합니다.

| 패턴 | 쿼리 | 문서 텍스트 | QMD | K-QMD |
|---|---|---|:---:|:---:|
| 복합어 | 분석 | 형태소**분석**기와 거대언어모델을... | miss | **hit** |
| 복합어 | 오케스트레이션 | 컨테이너**오케스트레이션** 환경에서... | miss | **hit** |
| 한영 혼합 | 연동 | API**연동** 가이드와 OAuth인증... | miss | **hit** |
| 한영 혼합 | schema 마이그레이션 | **Schema마이그레이션** 절차와 rollback... | miss | **hit** |
| 긴 쿼리 | 문서 업로드 파싱은 어떻게 동작해? | 문서 업로드 파싱 단계와 indexing 흐름을... | miss | **hit** |

> **Search recall: QMD 43% → K-QMD 100%** — 30개 search benchmark ([상세 결과](docs/benchmarks/search-recall.md))
> **Query recall: QMD 33% → K-QMD 100%** — 9개 query benchmark ([상세 결과](docs/benchmarks/query-recall.md))

## Quick Start

### Prerequisites

- Node.js >= 22
- macOS의 경우 Homebrew SQLite 필요 (extension 지원): `brew install sqlite3`
- RAM 16GB 이상 (`query` 사용 시), 8GB 이상 (`search`만 사용 시)
- GGUF 모델 자동 다운로드 (~2GB): embedding, re-ranker, query expansion
- Kiwi 형태소 분석 모델 자동 다운로드 (~95MB)

```bash
npm install -g kqmd
```

설치하면 기존 `qmd` 명령을 그대로 사용할 수 있습니다. `qmd mcp`도 그대로 동작합니다.
전체 명령어는 [QMD documentation](https://github.com/tobi/qmd)을 참고하세요.

## Features

### Korean-aware search

한국어 복합어, 붙여쓰기, 한영 혼합 검색에서 QMD가 놓치는 결과를 찾아줍니다. 인덱스가 준비되지 않은 경우 기존 검색 경로로 fallback합니다.

### Adaptive query ranking

짧은 한국어 구, 한영 혼합 기술 용어 등 쿼리 유형에 따라 ranking 전략을 다르게 적용하고, 이에 맞춰 벡터 검색 경로도 최적화했습니다. `--explain`으로 ranking 근거를 확인할 수 있습니다.

### Search-assist query rescue

owned `query`는 짧은 한글 구와 한영 혼합 plain query에서 clean Korean shadow index를 보조 신호로 사용해, hybrid query가 놓친 한국어 문서를 소수 rescue candidate로 보강합니다. quoted/negated Hangul query나 stale search health에서는 보수적으로 skip 하여 기존 semantics를 유지합니다.

### QMD SDK 기반

QMD를 SDK로 사용합니다. 한국어 검색 품질에 영향을 주는 명령(`search`, `query`, `update`, `embed`, `status`, `mcp`)만 확장하고, 나머지는 QMD에 그대로 위임합니다.

### Zero setup

Kiwi 형태소 분석 모델과 Qwen3 임베딩 모델은 최초 실행 시 자동으로 다운로드됩니다.
임베딩 모델은 QMD가 제공하는 모델 중 한국어 품질이 나은 Qwen3로 고정됩니다.

## OpenClaw에서 사용하기

OpenClaw 메모리 백엔드로 QMD 대신 K-QMD를 사용할 수 있습니다. 새로 설치하거나 기존 QMD에서 마이그레이션하는 방법은 [OpenClaw에서 K-QMD 사용하기](docs/openclaw.md)를 참고하세요.

## Built by AI Agents

이 프로젝트는 설계, 구현, 테스트, 리뷰까지 Codex / Claude Code와 함께 만들었습니다.

> "Is this much better than I could do by hand? Sure is." — [Linus Torvalds](https://github.com/torvalds/AudioNoise/commit/93a72563cba609a414297b558cb46ddd3ce9d6b5)

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md)와 [docs/development.md](docs/development.md)를 참고하세요.

## License

[MIT](LICENSE)
