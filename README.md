# K-QMD

Drop-in [QMD](https://github.com/tobi/qmd) replacement with Korean-aware search.

[![npm](https://img.shields.io/npm/v/kqmd)](https://www.npmjs.com/package/kqmd)
[![license](https://img.shields.io/npm/l/kqmd)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

## Why K-QMD

QMD가 사용하는 토크나이저는 한글 검색률이 떨어집니다. "형태소분석기"를 하나의 단어로 취급하기 때문에, "분석"으로 검색하면 해당 문서를 찾지 못합니다.

| 쿼리 | 문서 텍스트 | QMD | K-QMD |
|---|---|:---:|:---:|
| 분석 | 형태소**분석**기 | miss | **hit** |
| 에이전트 | 서브**에이전트** | miss | **hit** |
| 연동 | API**연동** | miss | **hit** |
| 컨테이너 | Docker**컨테이너** | miss | **hit** |

> **QMD recall 43% → K-QMD recall 100%** — 30개 쿼리 벤치마크 ([상세 결과](docs/benchmarks/2026-03-17-recall-comparison-metrics.md))

K-QMD는 QMD에 [Kiwi](https://github.com/bab2min/Kiwi) 형태소 분석을 결합해 이 문제를 해결합니다.

## Quick Start

### Prerequisites

- Node.js >= 22

```bash
npm install -g kqmd
```

설치하면 기존 `qmd` 명령을 그대로 사용할 수 있습니다. `qmd mcp`도 그대로 동작합니다.
전체 명령어는 [QMD documentation](https://github.com/tobi/qmd)을 참고하세요.

## Features

### Korean-aware search

한국어 복합어, 붙여쓰기, 한영 혼합 검색에서 QMD가 놓치는 결과를 찾아줍니다. 인덱스가 준비되지 않은 경우 기존 검색 경로로 fallback합니다.

### Adaptive query ranking

짧은 한국어 구, 한영 혼합 기술 용어 등 쿼리 유형에 따라 ranking 전략을 다르게 적용합니다. `--explain`으로 ranking 근거를 확인할 수 있습니다.

### Search-assist query rescue

owned `query`는 짧은 한글 구와 한영 혼합 plain query에서 clean Korean shadow index를 보조 신호로 사용해, hybrid query가 놓친 한국어 문서를 소수 rescue candidate로 보강합니다. quoted/negated Hangul query나 stale search health에서는 보수적으로 skip 하여 기존 semantics를 유지합니다.

### QMD SDK 기반

QMD를 SDK로 사용합니다. 한국어 검색 품질에 영향을 주는 명령(`search`, `query`, `update`, `embed`, `status`, `mcp`)만 확장하고, 나머지는 QMD에 그대로 위임합니다.

### Zero setup

Kiwi 형태소 분석 모델과 Qwen3 임베딩 모델은 최초 실행 시 자동으로 다운로드됩니다.
임베딩 모델은 QMD가 제공하는 모델 중 한국어 품질이 나은 Qwen3로 고정됩니다.

## OpenClaw에서 사용하기

OpenClaw 메모리 백엔드로 QMD 대신 K-QMD를 사용할 수 있습니다. 새로 설치하거나 기존 QMD에서 마이그레이션하는 방법은 [OpenClaw에서 K-QMD 사용하기](docs/openclaw.md)를 참고하세요.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md)와 [docs/development.md](docs/development.md)를 참고하세요.

## License

[MIT](LICENSE)
