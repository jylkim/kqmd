---
title: "feat: Korean recall comparison benchmark"
type: feat
status: completed
date: 2026-03-17
origin: docs/brainstorms/2026-03-17-korean-recall-benchmark-brainstorm.md
---

# feat: Korean recall comparison benchmark

## Overview

upstream qmd FTS5 대비 kqmd shadow index의 한국어 recall 향상을 수치로 증명하는 벤치마크 스크립트.
기존 4개 벤치마크가 latency/memory만 측정하는 반면, 이 벤치마크는 프로젝트의 핵심 가치인 **recall rate 차이**를 측정한다.

**목적**:
1. 오픈소스 프로모션 — README/블로그에 넣을 직관적인 recall 비교표
2. 내부 회귀 감지 — CI regression signal

(see brainstorm: `docs/brainstorms/2026-03-17-korean-recall-benchmark-brainstorm.md`)

## Proposed Solution

`scripts/measure_recall_comparison.ts` 스크립트가 synthetic fixture를 생성하고, 동일한 쿼리를 upstream `store.searchLex()`와 kqmd `searchShadowIndex()`에 보내 hit/miss를 비교한다.

### Fixture 구조

**Target 문서 3개** (패턴 카테고리별 1개):

| 문서 | 포함 텍스트 | 테스트 대상 패턴 |
|------|-----------|---------------|
| `compound.md` | 형태소분석기, 거대언어모델, 서브에이전트, 데이터베이스 | 복합어 분리 |
| `particle.md` | 에이전트가 필요합니다, 미들웨어를 구성하고, 샌드박스는 격리하며 | 조사 붙여쓰기 |
| `mixed.md` | API연동 가이드, OAuth인증 설정 | 한영 혼합 붙여쓰기 |

**Noise 문서 10개**: target 용어를 포함하지 않는 한국어 기술 문서 (BM25 IDF에 의미 부여).

### Tokenize Stub 명세

Kiwi 모델 다운로드 없이 deterministic stub 사용. 입출력 매핑:

| 입력 (문서 텍스트 내 포함) | Stub 출력 (projection에 추가) |
|---|---|
| 형태소분석기 | 형태소 분석 |
| 거대언어모델 | 거대 언어 모델 |
| 서브에이전트 | 서브 에이전트 |
| 데이터베이스 | 데이터 베이스 |
| 에이전트가 | 에이전트 |
| 에이전트를 | 에이전트 |
| 미들웨어를 | 미들웨어 |
| 샌드박스는 | 샌드박스 |
| API연동 | API 연동 |
| OAuth인증 | OAuth 인증 |

Stub은 `text.includes(key)` 체크 후 decomposed token을 projection에 append. 기존 `measure_kiwi_search_reliability.ts`의 패턴과 동일.

### Query Matrix

**동일한 raw query**를 양쪽에 전달 (index-side recall 측정):

| Category | Query | Target 문서 | upstream 예상 | shadow 예상 |
|---|---|---|---|---|
| compound | 분석 | compound.md | miss | hit |
| compound | 모델 | compound.md | miss | hit |
| compound | 에이전트 | compound.md | miss | hit |
| compound | 데이터 | compound.md | miss | hit |
| compound | 형태소분석기 | compound.md | hit | hit |
| particle | 에이전트 | particle.md | miss | hit |
| particle | 미들웨어 | particle.md | miss | hit |
| particle | 샌드박스 | particle.md | miss | hit |
| mixed | 연동 | mixed.md | miss | hit |
| mixed | 인증 | mixed.md | miss | hit |
| mixed | API | mixed.md | hit | hit |
| baseline | 형태소분석기 | compound.md | hit | hit |
| baseline | 필요합니다 | particle.md | hit | hit |

> **Hit 정의**: target 문서의 `displayPath`가 결과 목록에 존재하면 hit. limit=20.

> **Query 전달 방식**: 양쪽 모두 동일한 raw string 사용. shadow 쪽에서 `buildLexicalSearchText`를 사용하지 않는다 — index-side projection의 효과만 격리 측정하기 위함.

### 출력 형식

기존 measure 스크립트 컨벤션 준수:

```markdown
# Korean Recall Comparison Metrics

Date: 2026-03-17
Command: `bun run measure:recall-comparison`

## Method
...

## Results

| Category | Query | Target | upstream | shadow | Delta |
|---|---|---|---|---|---|
| compound | 분석 | compound.md | miss | hit | +1 |
| ... | ... | ... | ... | ... | ... |

## Aggregate

| Side | Hits | Total | Recall |
|---|---|---|---|
| upstream | N | M | X% |
| shadow | N | M | Y% |

## Derived Signals

- Shadow recall uplift: +Z%

JSON
[...]
```

## Technical Considerations

### Porter Stemmer 비대칭

shadow table은 `tokenize='porter unicode61'`, upstream은 `unicode61`만 사용. 영어 토큰에서 porter stemming이 shadow에 유리하게 작용할 수 있다. 이 벤치마크는 **한국어 패턴에 집중**하므로 영어 전용 query는 baseline 확인용으로만 포함하고, aggregate recall 계산에서 별도 표기한다.

출력 markdown의 Notes 섹션에 이 confound를 명시한다.

### Store Lifecycle

```
createStore() → store.update() → rebuildSearchShadowIndex(store.internal.db, ...) → query loop → store.close() → rmSync()
```

`store.update()` 호출이 `rebuildSearchShadowIndex` 전에 반드시 필요 (documents 테이블 populate).

## Acceptance Criteria

- [x] `scripts/measure_recall_comparison.ts` 생성
- [x] 복합어/조사/한영혼합 3개 카테고리, 10+ 쿼리의 hit/miss 비교
- [x] noise 문서 10개로 BM25 IDF에 의미 부여
- [x] aggregate recall % 출력 (upstream vs shadow)
- [x] markdown table + JSON 출력 (기존 컨벤션 준수)
- [x] `package.json`에 `measure:recall-comparison` 스크립트 등록
- [x] Porter stemmer 비대칭을 Notes 섹션에 명시
- [x] `docs/benchmarks/` 에 결과 파일 생성

## MVP

### `scripts/measure_recall_comparison.ts`

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '@tobilu/qmd';
import {
  rebuildSearchShadowIndex,
  searchShadowIndex,
} from '../src/commands/owned/search_shadow_index.js';
import { describeEffectiveSearchPolicy } from '../src/config/search_policy.js';

// --- fixture setup ---
// createFixtureWorkspace(), createFixtureStore() — 기존 패턴 동일

// --- deterministic tokenize stub ---
// compound: 형태소분석기 → 형태소 분석, 거대언어모델 → 거대 언어 모델, ...
// particle: 에이전트가 → 에이전트, 미들웨어를 → 미들웨어, ...
// mixed: API연동 → API 연동, OAuth인증 → OAuth 인증

// --- query matrix ---
// { category, query, targetDoc, expectedUpstream, expectedShadow }

// --- measure loop ---
// for each case:
//   upstream: store.searchLex(query, { limit: 20 })
//   shadow: searchShadowIndex(store.internal, query, { limit: 20 })
//   hit = results.some(r => r.displayPath === targetDoc)

// --- output ---
// toMarkdown(results) + JSON.stringify(results)
```

### `package.json` 추가

```json
"measure:recall-comparison": "bun run scripts/measure_recall_comparison.ts > docs/benchmarks/2026-03-17-recall-comparison-metrics.md"
```

## Sources & References

- **Origin brainstorm**: [docs/brainstorms/2026-03-17-korean-recall-benchmark-brainstorm.md](docs/brainstorms/2026-03-17-korean-recall-benchmark-brainstorm.md) — synthetic fixture, recall rate 비교, deterministic stub, 프로모션+회귀감지 이중 목적
- Template script: `scripts/measure_kiwi_search_reliability.ts` — 가장 가까운 기존 패턴
- Shadow index API: `src/commands/owned/search_shadow_index.ts:337` — `searchShadowIndex()` 시그니처
- Upstream API: `store.searchLex(query, options)` — `@tobilu/qmd` FTS5 검색
- Institutional learning: `docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md` — shadow/legacy path 분리 원칙
