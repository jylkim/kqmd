---
title: feat: Add adaptive Korean query ranking
type: feat
status: completed
date: 2026-03-16
origin: docs/brainstorms/2026-03-16-korean-query-ranking-adaptive-fusion-brainstorm.md
---

# feat: Add adaptive Korean query ranking

## Enhancement Summary

**Deepened on:** 2026-03-16  
**Sections enhanced:** 10  
**Research agents used:** `architecture-strategist`, `best-practices-researcher`, `framework-docs-researcher`, `performance-oracle`, `security-sentinel`, `pattern-recognition-specialist`  
**Additional primary sources:** SQLite FTS5 docs, Azure AI Search hybrid/vector/semantic ranking docs, Elasticsearch RRF/match phrase/nori docs, OpenSearch hybrid score explanation docs, Vespa phased ranking docs, Sourcegraph and GitHub developer search docs

### Key Improvements

1. affordable baseline을 “lexical-first + low-tuning fusion + bounded rerank budget”으로 더 구체화하고, `candidate-limit`/latency/memory budget을 정량 계약으로 끌어올렸다.
2. `query_core`, `query_runtime`, query classifier, shared query row shaping 경계를 정리해 adaptive ranking이 기존 K-QMD architecture를 침범하지 않도록 했다.
3. Korean phrase handling에서 whole-form + subterm evidence, phrase proximity, lexical snippet anchoring, `detail=full` guardrail 같은 SQLite/FTS5 근거를 계획에 반영했다.
4. explain contract를 opaque blended score가 아니라 named feature contribution 중심으로 확장하고, internal-only scoring data leak boundary를 추가했다.

## Overview

이번 계획의 목표는 K-QMD의 owned `query` 경로에 한국어 질의 유형에 적응하는 downstream ranking policy를 도입하는 것이다. 핵심 방향은 브레인스토밍에서 선택한 `Approach A: Query-Type Adaptive Fusion`을 그대로 구현 계약으로 번역하는 것이다. 즉 upstream `qmd` 구현은 건드리지 않고, K-QMD가 이미 소유한 `query` entrypoint에서만 질의 타입별 ranking 원칙을 다르게 적용한다 (see brainstorm: `docs/brainstorms/2026-03-16-korean-query-ranking-adaptive-fusion-brainstorm.md`).

이번 슬라이스의 우선순위는 명확하다. 첫째는 `지속 학습`, `문서 업로드 파싱` 같은 짧은 한국어 구 검색이다. 둘째는 `auth flow`, `agent orchestration`, `지속 learning` 같은 한영 혼합 기술어 검색이다. `지속` 같은 1단어 한국어 키워드는 지원하되 우선순위는 더 낮다. 자연어 질문형 검색은 이번 기준선의 핵심 타깃이 아니다 (see brainstorm: `docs/brainstorms/2026-03-16-korean-query-ranking-adaptive-fusion-brainstorm.md`).

이 작업은 단순히 점수 상수 몇 개를 바꾸는 일이 아니다. 현재 `query` 결과는 ranking, snippet anchoring, explain contract, MCP query response가 같은 core 위에서 묶여 있다. 따라서 이번 계획은 `query`의 최종 순서만이 아니라, 그 순서를 사용자가 이해하는 방식까지 함께 정리한다.

## Problem Statement / Motivation

현재 증상은 recall 부족보다 `query` ranking 품질 문제에 가깝다. 실제 예시에서 `node bin/qmd.js query --collection obsidian "지속"`는 관련성이 낮은 일간 노트들을 상단에 올렸지만, 같은 질의의 `search`는 더 자연스러운 결과를 보여 주었다. `query --explain`에서는 해당 결과들이 `vec=[none]`인 상태에서도 상단에 남아 있었으므로, 주된 문제는 “문서를 못 찾는다”보다 “`query`의 후보 결합과 최종 ranking이 한국어 단문 질의에서 어색하다”는 쪽이다.

로컬 조사에서 이 현상을 설명하는 구조적 원인도 확인됐다.

- upstream `hybridQuery()`와 `structuredSearch()`는 chunk 선택 시 `query.toLowerCase().split(/\s+/).filter(t => t.length > 2)`를 사용한다. 이 규칙은 `지속`, `학습`처럼 2글자 한국어 토큰을 chunk scoring에서 사실상 제거한다 ([`node_modules/@tobilu/qmd/dist/store.js`](../../node_modules/@tobilu/qmd/dist/store.js)).
- K-QMD의 [`normalizeHybridQueryResults()`](../../src/commands/owned/io/format.ts) 는 upstream `HybridQueryResult.body` 전체 문서 대신 `bestChunk`를 `row.body`로 내려보낸다. 따라서 upstream이 잘못 고른 chunk가 ranking 체감뿐 아니라 snippet anchoring, MCP query snippet, `--full` 출력 해석까지 함께 왜곡할 수 있다.
- upstream `rerank()`는 chunk text 기준 cache와 LLM reranker score를 사용하고, vector evidence가 없더라도 RRF 위치 점수와 reranker score를 blend 한다 ([`node_modules/@tobilu/qmd/dist/store.js`](../../node_modules/@tobilu/qmd/dist/store.js)). 이 때문에 한국어 단문 질의에서 lexical evidence보다 opaque rerank score가 체감상 과하게 강하게 보일 수 있다.

브레인스토밍에서 이미 “특정 코퍼스나 문서 타입 패널티로 푸는 것이 아니라, phrase/근접 매치, 제목/헤더 구조 신호, 핵심 문맥 집중도를 더 잘 반영하는 일반 ranking 원칙을 세운다”는 방향을 택했다. 이번 계획은 그 결정을 `query`의 실제 execution contract와 verification contract로 옮기는 것이다 (see brainstorm: `docs/brainstorms/2026-03-16-korean-query-ranking-adaptive-fusion-brainstorm.md`).

## Local Research Findings

- [`docs/brainstorms/2026-03-16-korean-query-ranking-adaptive-fusion-brainstorm.md`](../../docs/brainstorms/2026-03-16-korean-query-ranking-adaptive-fusion-brainstorm.md)
  이번 계획의 origin 문서다. ownership boundary, priority query classes, non-goal, success criteria, corpus-agnostic guardrail이 이미 합의되어 있다.
- [`docs/architecture/kqmd-command-boundary.md`](../../docs/architecture/kqmd-command-boundary.md)
  K-QMD는 replacement distribution이며, upstream path/config compatibility와 owned command contract를 함께 지켜야 한다. `query` 개선도 같은 boundary 안에서 downstream-only policy로 닫혀야 한다.
- [`docs/architecture/upstream-compatibility-policy.md`](../../docs/architecture/upstream-compatibility-policy.md)
  upstream private CLI formatter를 직접 import하지 않고 local adapter로 semantics를 반영하는 원칙이 이미 있다. 이번 작업은 이 원칙을 유지해야 한다.
- [`src/commands/owned/query_core.ts`](../../src/commands/owned/query_core.ts), [`src/commands/owned/query_runtime.ts`](../../src/commands/owned/query_runtime.ts), [`src/commands/owned/query.ts`](../../src/commands/owned/query.ts)
  owned `query`는 collection resolution, embedding advisory, hybrid runtime dispatch, CLI output shaping을 이미 분리하고 있다. adaptive ranking은 이 분리 위에 얹는 편이 자연스럽다.
- [`src/commands/owned/io/format.ts`](../../src/commands/owned/io/format.ts)
  `normalizeHybridQueryResults()`가 `bestChunk`를 `body`로 저장하고, formatter/MCP가 다시 `extractSnippet()`에 이 값을 넘긴다. ranking만이 아니라 snippet contract도 함께 다뤄야 한다.
- [`src/mcp/server.ts`](../../src/mcp/server.ts)
  MCP `query` tool과 HTTP `/query` route도 [`executeQueryCore()`](../../src/commands/owned/query_core.ts) 결과를 재사용한다. 따라서 CLI만 고치고 MCP를 두면 query surface가 다시 갈라진다.
- [`src/commands/owned/kiwi_tokenizer.ts`](../../src/commands/owned/kiwi_tokenizer.ts)
  Kiwi 기반 Hangul detection, token normalization, Korean-aware lexical text builder가 이미 있다. 이번 작업은 새로운 한국어 analyzer를 추가하기보다 이 기존 자산을 query-side signals에 재사용하는 편이 맞다.
- [`node_modules/@tobilu/qmd/dist/index.js`](../../node_modules/@tobilu/qmd/dist/index.js), [`node_modules/@tobilu/qmd/dist/store.d.ts`](../../node_modules/@tobilu/qmd/dist/store.d.ts)
  public `store.search()`는 `rerank: false`를 지원한다. plain query에서는 public surface를 우선 사용하고, 기존 private seam은 꼭 필요한 경로에만 국한하는 전략이 가능하다.
- [`docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`](../../docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md)
  `--explain`은 디버그 출력이 아니라 user-facing contract다. 조건부 formatter branch는 snapshot으로 고정해야 하며, 지원하지 않는 semantics는 success처럼 보이면 안 된다.
- [`docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md`](../../docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md)
  private upstream seam은 localized adapter와 dedicated guard test로 감싸야 한다. 이번 ranking 작업도 새 private import를 늘리지 말고, existing seam이 커지면 대응 guard를 함께 보강해야 한다.
- `docs/solutions/patterns/critical-patterns.md`
  learnings-researcher workflow가 권장하는 critical patterns file은 현재 저장소에 없다. 따라서 이번 계획은 architecture docs, solutions, tests를 primary institutional source로 사용한다.

## External Research Findings

### Affordable hybrid ranking and rerank budgets

- **Official docs: Elasticsearch / Azure AI Search.** Elastic은 RRF를 “서로 다른 relevance indicator를 결합하는 no-tuning baseline”으로 설명하고, Azure도 hybrid query 병합에 RRF를 사용하며 `maxTextRecallSize`, vector weighting, debug subscores를 노출한다. 이번 계획은 이 공통점을 따라 score calibration-heavy 설계보다 low-tuning fusion + explicit candidate budget을 기본값으로 둔다.
- **Official docs: Vespa / Azure AI Search.** Vespa는 `second-phase`를 `rerank-count` top hits에만 적용해 비용 상한을 고정하고, Azure semantic ranker도 상위 50개의 text-bearing 결과만 rerank 대상으로 올린다. 이번 계획은 short Korean phrase path를 rerank-free baseline으로 두고, mixed technical path도 heavier rerank가 필요하면 top-50 이하 bounded subset에만 허용한다.
- **Official docs: Azure AI Search.** vector query는 관련도가 약해도 `k`개의 nearest neighbors를 항상 반환할 수 있으며, 현재 문서는 weight와 low-score threshold를 hybrid control knob로 제시한다. 이번 계획은 weak/absent vector evidence를 positive prior로 취급하지 않고, threshold/backoff 또는 strength bucket으로만 사용한다.

### Adaptive query routing for developer search

- **Official docs: Sourcegraph / GitHub.** Sourcegraph는 keyword search를 기본값으로 유지하고, `"..."` exact phrase와 `type:symbol`/plain text heuristics를 별도 fast path로 둔다. GitHub code search도 n-gram index와 lazy postings intersection을 사용해 requested results만 읽는 literal-first architecture를 택한다. 이번 계획은 developer-style query에서 literal/substring search를 fallback이 아니라 first-class path로 본다.
- **Official docs: Sourcegraph architecture.** Sourcegraph는 search-based code navigation을 zero-config default로 두고, semantic/precise navigation은 별도 계층으로 분리한다. 이번 계획도 semantic evidence를 “항상 우선”으로 보지 않고, query trait에 따라 lexical-first 또는 hybrid path를 선택한다.

### Lexical-first phrase handling and Korean tokenization

- **Official docs: Elasticsearch.** `match_phrase`는 기본 `slop=0`이며, exact 또는 low-slop phrase window가 lexical quality의 핵심 primitive로 제시된다. 또한 Elastic RRF highlighting은 vector field가 아니라 text sub-query 기준으로 계산된다. 이번 계획은 short Korean phrase ranking과 snippet anchoring을 lexical phrase/window evidence에 anchored 하도록 강화한다.
- **Official docs: Elasticsearch nori tokenizer.** 공식 Korean tokenizer 예시는 `decompound_mode: mixed`와 user dictionary를 사용해 compound surface form과 decomposed parts를 함께 보존한다. 이번 계획은 Kiwi 기반 feature extraction에서도 whole-form과 normalized subterm evidence를 동시에 유지한다.

### Explainable ranking signals

- **Official docs: Elasticsearch / OpenSearch / Vespa.** Elastic RRF explain, OpenSearch `hybrid_score_explanation`, Vespa `match-features`/`summary-features`는 모두 “최종 점수”만이 아니라 sub-query 또는 per-signal contribution을 노출한다. 이번 계획은 `--explain`, JSON, MCP payload에 `phrase`, `title`, `heading`, `coverage`, `proximity`, `literal_anchor`, `vector_strength`, `candidate_source` 같은 named signals를 넣는 방향으로 구체화한다.

## Research Decision

이번 deepening에서는 로컬 codebase와 installed upstream package를 implementation boundary의 primary input으로 유지하되, ranking policy 자체는 2026-03-16 기준 current official search docs와 SQLite FTS5 문서로 보강한다. 검토한 RRF, hybrid search, semantic reranking, hybrid score explanation, symbol search 관련 공식 문서에서는 이번 계획에 직접 영향을 주는 deprecation/sunset blocker를 확인하지 못했다. 이번 문서는 특정 managed search product 도입을 권하는 문서가 아니라, 공식 문서에 반복적으로 드러나는 retrieval/ranking design pattern과 SQLite FTS5 제약을 K-QMD의 owned `query` 경로에 옮기는 문서다.

이번 계획이 외부 연구에서 직접 carry forward할 원칙은 다음과 같다.

- low-tuning fusion(RRF-style) + explicit candidate window를 affordable baseline으로 둔다
- expensive rerank/model stage는 top-N bounded subset에만 허용하고, short Korean phrase path는 기본적으로 rerank-free로 유지한다
- developer query routing은 literal phrase, symbol/path-like token, mixed Hangul/Latin signals를 먼저 본다
- weak vector evidence는 threshold/backoff 대상으로 취급하고, lexical snippet/explain contract를 덮지 못하게 한다
- explain payload는 named feature contribution을 드러내고, snippet은 lexical/structural anchor에서 추출한다
- phrase/NEAR는 tokenizer token distance 기준이므로, 한국어 proximity는 raw FTS만이 아니라 local structural window와 whole-form/subterm evidence로 보강한다
- public `store.search({ rerank: false })`는 no-model-work path가 아니므로, short Korean phrase baseline과 동일시하지 않는다
- current upstream lexical baseline은 title bias를 자동으로 주지 않으므로, title/header 우대는 downstream signal로 직접 정의한다

대신 이번 계획은 내부 증거를 더 엄격하게 해석한다.

- public upstream surface로 해결 가능한 곳은 public API를 우선 사용한다
- private upstream seam이 남는 곳은 explicit tradeoff로 문서화하고 test failure가 runtime failure보다 먼저 나게 한다
- explain, snippet, MCP response 같은 user-visible contract는 구현보다 먼저 acceptance criteria로 고정한다
- `query` adaptive policy는 `search`가 소유한 Korean shadow index health semantics와 분리한다

## SpecFlow Analysis

### User Flow Overview

1. **CLI short Korean phrase query**
   사용자가 `qmd query "지속 학습"` 같은 plain 한국어 구를 실행한다. 기대 결과는 phrase/근접 매치, 제목/헤더, 핵심 문맥 집중도가 높은 문서가 우연한 흩어진 언급보다 위에 오는 것이다.
2. **CLI mixed technical query**
   사용자가 `qmd query "agent orchestration"` 또는 `qmd query "지속 learning"`을 실행한다. 기대 결과는 exact literal evidence와 hybrid evidence가 서로를 보완하되, literal anchor가 약한 문서가 설명 불가능하게 치고 올라오지 않는 것이다.
3. **Structured query document**
   사용자가 `lex:`, `vec:`, `hyde:`가 섞인 structured query를 실행한다. 이 경로는 사용자가 명시적으로 search type을 제어한 것이므로, plain query처럼 공격적으로 재해석하면 안 된다.
4. **MCP query tool / HTTP route**
   MCP client가 `query` tool 또는 `/query` route를 사용한다. CLI와 다른 row order나 snippet policy가 나오면 same-core contract가 깨진다.
5. **Explain / machine-readable output**
   사용자가 `--explain`, `--json`, `--full`을 함께 사용하거나 MCP structured output을 소비한다. adaptive policy가 최종 순서를 바꿨다면 explain과 payload도 그 사실을 숨기면 안 된다.

### Flow Permutations Matrix

| Dimension | Cases |
|---|---|
| Query mode | plain, structured |
| Query type | short Korean phrase, mixed technical, lower-priority one-word Korean |
| Retrieval evidence | lexical strong, lexical weak, vector absent, vector present |
| Output surface | CLI, JSON, MCP tool, HTTP route |
| Runtime options | default candidate pool, explicit `--candidate-limit`, `--explain`, `--full` |
| Collection scope | default collections, single collection, multiple collections |

### Missing Elements & Gaps

- **Category**: Query classification
  - **Gap Description**: short Korean phrase와 mixed technical query를 어떤 기준으로 나눌지 현재 계약이 없다.
  - **Impact**: adaptive fusion이 overfit 또는 underfit 되기 쉽다.
  - **Current Ambiguity**: structured query에도 같은 분류기를 적용할지, plain query만 대상으로 할지 아직 코드 계약이 없다.
- **Category**: Ranking vs snippet data model
  - **Gap Description**: 현재 query row는 `bestChunk`만 유지해 full-body 기반 structural scoring과 snippet 재앵커링이 어렵다.
  - **Impact**: ranking을 고쳐도 snippet과 MCP response가 계속 이상할 수 있다.
  - **Current Ambiguity**: display body와 scoring source body를 분리할지, `--full` 계약을 어떻게 유지할지 정리돼 있지 않다.
- **Category**: Explain truthfulness
  - **Gap Description**: local adaptive scoring을 도입하면 기존 upstream explain block만으로는 최종 순서를 설명할 수 없다.
  - **Impact**: `--explain`이 오히려 misleading contract가 된다.
  - **Current Ambiguity**: adaptive signals를 stderr/CLI line/JSON field/MCP structured metadata 중 어디에 실을지 정해야 한다.
- **Category**: Private seam growth
  - **Gap Description**: `candidateLimit` 경로는 이미 upstream private helper seam을 사용한다.
  - **Impact**: adaptive policy가 같은 seam을 넓히면 drift risk가 커질 수 있다.
  - **Current Ambiguity**: plain default path는 public `store.search({ rerank: false })`를 우선 쓸지, helper 확장을 먼저 할지 결정이 필요하다.
- **Category**: Performance budget
  - **Gap Description**: affordable baseline이라면서 classification, token extraction, local rerank를 추가하면 latency가 늘 수 있다.
  - **Impact**: 품질 개선이 체감 속도 회귀로 상쇄될 수 있다.
  - **Current Ambiguity**: short Korean phrase path에서 rerank/expand/model calls를 줄일지 그대로 둘지 명시돼 있지 않다.
- **Category**: Surface capability mismatch
  - **Gap Description**: plan은 CLI와 MCP가 같은 adaptive semantics를 공유한다고 읽히지만, 현재 MCP `query`와 `/query`는 structured `searches[]` 입력만 받는다.
  - **Impact**: plain short Korean phrase adaptive path를 MCP에도 바로 보장한다고 오해할 수 있다.
  - **Current Ambiguity**: v1 parity를 “same-core for same input mode”로 볼지, “same surface”로 볼지 더 명확히 적어야 한다.
- **Category**: Input envelope / resource caps
  - **Gap Description**: adaptive ranking이 full-body scoring, snippet re-anchoring, MCP/HTTP same-core reuse를 도입하지만 raw query 길이, structured line 수, normalized token 수, inspected body bytes, request body size 상한이 없다.
  - **Impact**: oversized query 또는 반복 MCP 호출이 local DoS와 memory/CPU amplification을 만들 수 있다.
  - **Current Ambiguity**: CLI/MCP/HTTP가 같은 상한과 같은 rejection/fallback policy를 가질지 정해지지 않았다.
- **Category**: Explain / machine-readable leak boundary
  - **Gap Description**: adaptive metadata를 추가하려 하지만 어떤 필드가 serialize 가능하고 어떤 내부 scoring source는 절대 노출되면 안 되는지 계약이 없다.
  - **Impact**: `--json`/MCP structured output에 full-body, raw tokens, candidate windows, heuristic weights, debug traces가 섞일 수 있다.
  - **Current Ambiguity**: `scoringSourceBody`, raw normalized terms, candidate windows, cache/debug data를 internal-only로 둘지 명시가 없다.
- **Category**: SQLite / FTS query safety
  - **Gap Description**: local ranking/helper가 추가 SQLite lookup 또는 MATCH shaping을 수행할 때 parameterization과 FTS sanitization contract가 문서화돼 있지 않다.
  - **Impact**: dynamic SQL/FTS assembly, malformed query, excessive placeholder expansion risk가 생긴다.
  - **Current Ambiguity**: prepared statement only policy, bounded `IN (...)` size, reused sanitizer 여부가 정해지지 않았다.
- **Category**: Adaptive reuse / cross-session abuse
  - **Gap Description**: adaptive ranking이 request-local heuristics인지, query history/result cache를 학습 또는 재사용하지 않는지 계약이 없다.
  - **Impact**: MCP 세션 간 query intent leakage, cache poisoning, repeated-query gaming risk가 생긴다.
  - **Current Ambiguity**: query text/query class/adaptive scores를 로그/DB/cache에 남기지 않을지 명시가 없다.

### Planning Assumptions

- plain query만 adaptive fusion의 1차 대상이고, structured query는 conservative compatibility path로 둔다
- short Korean phrase path는 한국어 구조 신호를 더 강하게 보고, mixed technical path는 기존 hybrid evidence를 더 많이 유지한다
- document-type priors는 넣지 않고, 제목/헤더/phrase/proximity/match concentration 같은 corpus-agnostic signals만 사용한다
- vector evidence가 없을 때는 opaque rerank score가 lexical/structural evidence를 설명 불가능하게 덮지 않도록 한다
- explicit phrase, symbol/path-like token, mixed Hangul/Latin token이 보이면 semantic보다 developer-literal fast path를 먼저 고려한다
- v1 parity는 `CLI plain adaptive + MCP structured conservative parity`다. same-core는 같은 input mode에서 같은 domain core를 쓴다는 뜻이지, CLI/MCP surface가 완전히 같다는 뜻은 아니다.
- `query` adaptive policy는 `kqmd_documents_fts`나 search health semantics에 의존하지 않는다. 그 테이블과 health vocabulary는 `search` surface ownership으로 유지한다.
- `query` read path는 Kiwi model download/bootstrap, network access, persistent adaptive memory에 의존하지 않는다. side-effect-free Kiwi term reuse가 불가능하면 Hangul/Latin/token-count heuristics로 보수적으로 fallback 한다.

## Chosen Approach

브레인스토밍에서 선택한 `Approach A: Query-Type Adaptive Fusion`을 그대로 따른다 (see brainstorm: `docs/brainstorms/2026-03-16-korean-query-ranking-adaptive-fusion-brainstorm.md`).

핵심은 “새 무거운 리랭커를 붙인다”가 아니라, **질의 타입에 따라 candidate retrieval와 final score blending의 규칙을 다르게 적용하는 local ranking policy layer**를 owned `query`에 추가하는 것이다.

이 접근의 구체 기준은 다음과 같다.

1. **Plain short Korean phrase**
   - lexical-first와 structural evidence를 우선한다
   - Kiwi 기반 normalized terms에 whole-form + subterm evidence를 함께 유지한다
   - phrase/근접/title/header/match concentration 신호를 더 강하게 보고, exact 또는 low-slop window를 우선한다
   - vector evidence는 recall backoff일 뿐 ranking prior가 아니며, weak/absent vector hit가 strong lexical anchor를 leapfrog하지 못하게 한다
   - 가능한 경우 rerank 의존을 줄여 affordable baseline을 유지하고, heavier rerank가 필요해도 top-50 이하 bounded subset 밖으로 확장하지 않는다
2. **Plain mixed technical query**
   - 기존 hybrid retrieval과 rerank를 유지하되, literal anchor와 structural evidence를 local tie-breaker 이상으로 반영한다
   - explicit phrase, identifier, symbol/path-like token, mixed-script anchor가 보이면 lexical evidence를 first-class signal로 취급한다
   - exact literal evidence가 약한 문서가 설명 불가능하게 상단을 차지하지 않게 하고, weak vector-only hit는 bounded backoff로만 허용한다
   - heavier rerank가 남더라도 final expensive stage는 top-20~50 candidate slice에만 적용한다
3. **Structured query**
   - 사용자가 explicit `lex:/vec:/hyde:`를 준 경우는 compatibility-first로 둔다
   - aggressive query-type adaptation보다 conservative final shaping과 snippet/explain truthfulness를 우선한다

이 방식은 브레인스토밍에서 기각한 두 방향을 피한다.

- `Structure-First Ranking`처럼 모든 질의를 같은 규칙으로 눌러서 mixed technical query의 특성을 잃지 않는다
- `Conservative Korean Lexical Gate + Hybrid Backoff`처럼 short Korean phrase 안정화만 하고 mixed technical query를 지나치게 보수적으로 만들지 않는다

## Technical Approach

### Architecture

이번 작업은 `query`를 세 층으로 더 분명하게 쪼개는 방향이 좋다.

1. **Query classification**
   - candidate file: `src/commands/owned/query_classifier.ts`
   - plain vs structured를 먼저 나누고, plain query는 `short-korean-phrase`, `mixed-technical`, `general` 같은 분류를 만든다
   - 분류는 whitespace-only가 아니라 structured syntax 여부, explicit quote, Hangul presence, Latin token mix, symbol/path-like token (`/`, `.`, `_`, `-`, camelCase), token count를 함께 본다
   - side-effect-free Kiwi term reuse가 가능할 때만 이를 추가 signal로 사용하고, query read path에서 model bootstrap이나 network를 유발하지 않는다
2. **Adaptive ranking signals**
   - candidate file: `src/commands/owned/query_ranking.ts`
   - local signals는 문서 타입이 아니라 구조와 문맥으로 제한한다
   - signal examples:
     - exact phrase match / low-slop phrase window
     - title match
     - heading / section label match
     - token coverage
     - phrase proximity
     - match concentration within a small window
     - mixed-script literal anchor
     - symbol / path-like literal anchor
     - vector evidence strength bucket (`strong`, `weak`, `absent`)
     - upstream RRF position confidence
3. **Query row data model split**
   - affected files: `src/commands/owned/io/types.ts`, `src/commands/owned/io/query_rows.ts`, `src/commands/owned/io/format.ts`, `src/mcp/server.ts`
   - 공용 `SearchOutputRow`의 `body` 의미는 뒤집지 않는다
   - 대신 query 전용 `QueryCoreRow` 또는 동등한 internal contract가 `displayBody`와 `sourceBody`/`snippetBody`를 분리해 가진다
   - `HybridQueryResult.body` 전체 문서를 보존하면서, current `bestChunk` 기반 display contract를 필요한 곳에만 유지한다
   - goal은 full-body structural scoring과 correct lexical snippet anchoring을 가능하게 하되, `--full`과 snapshots를 무심코 깨지 않는 것이다
4. **Explain / payload truthfulness**
   - affected files: `src/commands/owned/io/format.ts`, `src/mcp/server.ts`, `src/commands/owned/io/query_rows.ts`
   - upstream explain block은 유지하되, K-QMD adaptive policy가 final ordering에 미친 영향을 named feature metadata로 드러낸다
   - expose 가능한 explain fields는 allowlist로만 노출하고, raw tokens, candidate windows, heuristic weights, debug blobs, scoring source body는 숨긴다
   - CLI, JSON, MCP structured payload가 서로 다른 진실을 말하지 않게 한다
5. **Core / adapter / presentation split**
   - `src/commands/owned/query_core.ts`는 classification, policy orchestration, row enrichment를 소유한다
   - `src/commands/owned/query_runtime.ts`는 retrieval adapter와 public/private execution path 선택만 소유한다
   - `src/commands/owned/query_ranking.ts`는 pure scoring helper로 유지한다
   - shared `io/query_rows.ts`가 CLI/MCP 공용 row normalization, snippet anchoring, internal-only body handling을 맡는다

### Research Insights

**Installed upstream constraints**
- public `store.search({ query, rerank: false })`는 rerank만 비활성화할 뿐 BM25 probe, query expansion, vector lookup을 계속 수행할 수 있다. 따라서 short Korean phrase의 “affordable baseline”은 public rerank-free hybrid path와 동일시하지 않는다.
- public simple-query path는 multi-collection과 `candidateLimit` semantics를 완전히 보장하지 않는다. plain adaptive path가 이 계약을 유지해야 하는 지점은 existing `query_runtime.ts` adapter seam에 남긴다.
- public `HybridQueryResult`는 이미 `body`와 `bestChunk`를 함께 준다. full-body scoring source와 display/snippet source를 분리하는 일은 우선 local normalize layer에서 해결할 수 있다.

**SQLite FTS5 constraints**
- raw SQLite FTS5는 phrase/NEAR, column filter, boolean syntax를 지원하지만, public lex path는 upstream sanitizer 제약을 받는다. 그래서 `NEAR(...)`, `title : ...`, `OR` 같은 raw FTS syntax를 v1 public lex baseline으로 가정하지 않는다.
- phrase/NEAR는 tokenizer token distance 기준이므로, 한국어 proximity는 raw FTS만이 아니라 local structural window와 whole-form/subterm evidence로 보강한다.
- phrase/NEAR signal을 유지할 계획이면 `documents_fts`와 `kqmd_documents_fts`는 `detail=full` invariant를 유지해야 한다.

### Execution Policy By Query Type

#### Plain short Korean phrase

- lexical-first candidate generation과 local structural scoring을 우선한다
- public `store.search({ query, rerank: false })`는 compatibility fallback일 수는 있지만, “no extra model work” baseline으로 가정하지 않는다
- Kiwi normalized terms로 whole-form + subterm evidence를 함께 만들고, exact phrase/low-slop proximity/title/header matches를 first-class local features로 사용한다
- short Korean phrase path에서는 “추가 모델 추론 없이도 더 나은 상단 품질”이 목표이므로, 현재보다 더 많은 rerank/model call을 허용하지 않는다
- strong lexical signal이 있으면 additional `expandQuery`/`embedBatch`/rerank를 금지한다
- lexical coverage가 충분할 때는 vector evidence를 neutral backoff로 취급하고, vector-only hit가 strong phrase/title/header evidence를 넘지 못하게 한다
- explicit `--candidate-limit`가 있는 경우에는 existing helper seam을 재사용하되, same adaptive policy가 candidate slice 이후에 적용되도록 닫는다

#### Plain mixed technical query

- current hybrid query path를 유지한다
- explicit phrase, identifier, symbol/path-like token, mixed Hangul/Latin anchor가 있으면 lexical evidence를 first-class signal로 본다
- vector/rerank evidence는 계속 사용하지만, title/header/literal anchor가 local downstream score에 반영되어 final ordering이 더 설명 가능해지도록 한다
- weak vector-only hit는 threshold/backoff 대상으로만 사용하고, short Korean phrase path보다 보수적으로 조정하되 “literal anchor가 약한 문서의 inexplicable jump”는 줄인다
- expensive rerank stage가 남더라도 top-20~50 candidate slice 바깥까지 확장하지 않는다

#### Structured query

- `parseStructuredQueryDocument()` semantics를 유지한다
- typed query ordering을 다시 해석하지 않는다
- 다만 snippet anchoring, row data model split, explain truthfulness는 동일하게 적용한다
- structured query의 `primaryQuery`/`displayQuery` 축약은 v1에서는 explicit compatibility rule로 유지하고, 별도 snippet-anchor metadata는 follow-up slice로 둔다

#### Candidate-Limit Contract

- local structural scoring은 최대 `min(candidateLimit, 40)`개 문서까지만 수행한다
- full-body snippet re-anchor는 최종 상위 `min(limit * 2, 10)`개 문서까지만 수행한다
- `--candidate-limit`의 user-facing 의미는 보존해야 한다. 내부적으로 더 넓은 pool이 필요하면 별도 internal constant나 explicit field를 도입하고 `candidate-limit`를 조용히 무시하지 않는다
- public simple-query path가 multi-collection 또는 `candidateLimit` semantics를 온전히 제공하지 못하는 경우, 그 계약은 existing `query_runtime.ts` adapter seam에 남긴다

### Implementation Phases

#### Phase 1: Define adaptive query contract

대상:
- `docs/plans/2026-03-16-feat-adaptive-korean-query-ranking-plan.md`
- `src/commands/owned/query_core.ts`
- `src/commands/owned/io/types.ts`
- `src/commands/owned/query_runtime.ts`

작업:
- adaptive fusion의 적용 범위를 `plain query 우선, structured query conservative`로 못 박는다
- query classification enum과 per-class policy를 정의하고, quoted phrase / symbol-path-like / mixed-script trait를 명시한다
- `query_classifier.ts`, `query_ranking.ts`, `query_core.ts`, `query_runtime.ts`, shared `io/query_rows.ts`의 단방향 책임 경계를 문서와 타입으로 고정한다
- ranking source body와 display body를 분리하는 query 전용 internal row contract를 설계한다
- explain payload에 adaptive metadata와 named feature contribution을 어디에 둘지 결정한다
- `candidateLimit` path와 default path가 어떤 public/private seam을 쓰는지 정리한다
- MCP parity를 `structured` 입력 범위로 명시하고, plain adaptive semantics를 MCP에 바로 약속하지 않는다
- query read path가 Kiwi bootstrap/network/persistent memory에 의존하지 않는다는 guardrail을 acceptance criteria로 올린다

완료 기준:
- query class별 execution policy가 문서와 타입으로 고정된다
- ranking data vs display data 경계가 명시된다
- explain truthfulness를 훼손하지 않는 payload shape가 결정된다

#### Phase 2: Implement local adaptive ranking and snippet anchoring

대상:
- `src/commands/owned/query_core.ts`
- `src/commands/owned/query_runtime.ts`
- `src/commands/owned/query_classifier.ts`
- `src/commands/owned/query_ranking.ts`
- `src/commands/owned/io/query_rows.ts`
- `src/commands/owned/io/format.ts`
- `src/commands/owned/io/types.ts`
- `src/mcp/server.ts`

작업:
- plain short Korean phrase용 query classifier와 side-effect-free signal extraction을 추가한다
- whole-form + subterm evidence, exact/low-slop phrase window, heading/title concentration feature를 추가한다
- `HybridQueryResult.body` 전체 문서를 보존하는 normalize path를 만든다
- snippet anchor를 upstream `bestChunk`에만 고정하지 않고 full-body lexical evidence로 재정렬할 수 있게 한다
- short Korean phrase path는 rerank-free 또는 equivalent affordable path를 우선 사용한다
- mixed technical path는 existing hybrid path 위에 light downstream structural score를 얹고, weak vector evidence bucket을 적용한다
- structured query는 conservative compatibility path로 유지한다
- query row shaper가 snippet text 또는 snippet anchor를 미리 계산해 formatter가 full body를 재스캔하지 않게 한다

완료 기준:
- short Korean phrase와 mixed technical query가 서로 다른 정책으로 실행된다
- query snippet이 first chunk fallback에 과도하게 의존하지 않는다
- CLI와 MCP가 같은 최종 row order와 snippet source를 소비한다

#### Phase 3: Explain, parity, and guardrail hardening

대상:
- `src/commands/owned/io/format.ts`
- `src/mcp/server.ts`
- `test/query-runtime.test.ts`
- `test/query-runtime-adapter.test.ts`
- `test/owned-command-parity/query-output.test.ts`
- relevant MCP tests

작업:
- `--explain`에 adaptive ranking metadata와 per-signal contribution을 추가한다
- JSON/CLI/MCP machine-readable payload가 같은 ranking truth를 말하게 한다
- public API로 해결 가능한 plain path는 public surface를 쓰고, private seam은 existing adapter에만 남긴다
- private seam이 넓어지면 guard test도 함께 보강한다
- `query --candidate-limit`가 adaptive path에서도 silent no-op가 되지 않게 한다
- adaptive metadata는 allowlist로만 serialize하고, scoring source body/raw tokens/window text/debug traces는 internal-only로 유지한다
- any new SQLite/FTS query는 prepared statements, bounded placeholders, existing sanitizer 재사용으로 제한한다

완료 기준:
- explain output이 final ordering의 근거를 숨기지 않는다
- `query --json` stdout purity가 유지된다
- private upstream seam이 새 파일로 퍼지지 않는다

#### Phase 4: Verification fixtures and docs

대상:
- `test/`
- `README.md`
- `docs/development.md`
- 필요 시 `docs/architecture/upstream-compatibility-policy.md`

작업:
- ranking quality를 deterministic하게 검증할 synthetic fixture corpus를 추가한다
- query class별 focused tests를 추가한다
- exact phrase, symbol/path-like, weak-vector-only false positive fixture를 추가한다
- CLI/MCP shared-core regression tests를 추가한다
- README의 current scope에서 “`query` 경로의 장기적인 한국어 의미 검색 개선은 아직 범위 밖” 문장을 이번 release surface에 맞게 갱신한다
- 개발 문서에 ranking validation gate를 추가한다
- benchmark matrix와 security caps를 query validation gate에 포함한다

완료 기준:
- seeded fixture 기반 ranking contract tests가 존재한다
- README와 development docs가 새 query contract를 같은 말로 설명한다
- `search`와 `query`의 역할 차이가 문서상 더 분명해진다

## Alternative Approaches Considered

### Option 1: Global structure-first ranking only

모든 질의를 제목/헤더/phrase/proximity 규칙으로만 다루는 접근이다.

**Pros**

- 규칙이 단순하다
- explain이 쉽다

**Cons**

- mixed technical query에서 hybrid evidence를 충분히 활용하지 못한다
- 브레인스토밍에서 합의한 “query type adaptation”을 포기하게 된다

**Decision**

기각한다. 이번 작업의 핵심은 한국어 구와 mixed technical query를 같은 규칙으로 뭉개지 않는 것이다.

### Option 2: Korean lexical gate only

short Korean phrase에서 hybrid/rerank를 줄이고 lexical path만 강화하는 접근이다.

**Pros**

- short Korean phrase 안정화에는 효과적일 수 있다
- 구현이 비교적 단순하다

**Cons**

- mixed technical query를 제품 목표에서 사실상 후순위로 밀어낸다
- 브레인스토밍에서 사용자가 우선순위 `2, 3, 1`로 정한 질의군을 충분히 포괄하지 못한다

**Decision**

기각한다. 이 방향은 임시 1단계가 되기 쉽고, 바로 다음 단계 요구를 다시 열 가능성이 높다.

### Option 3: Corpus-specific priors

일간 노트 같은 문서 타입을 직접 패널티 주는 접근이다.

**Pros**

- 특정 재현 케이스는 빠르게 고칠 수 있다

**Cons**

- 브레인스토밍에서 명시적으로 피한 지역 최적화다
- 다른 사용자/코퍼스에서는 오히려 부정확한 bias가 된다

**Decision**

기각한다. 문제는 문서 타입이 아니라 structural evidence를 일반적으로 잘 읽지 못하는 데 있다.

## System-Wide Impact

### Interaction Graph

- CLI `qmd query`
  - `src/cli.ts` -> owned dispatch -> `src/commands/owned/query.ts` -> `executeQueryCore()` -> query classification / policy orchestration -> runtime candidate retrieval -> adaptive ranking -> shared query row shaping -> formatter
- MCP `query` tool / HTTP `/query`
  - `src/mcp/server.ts` -> `executeQueryCore()` -> structured conservative ranking rows -> shared query row shaping -> MCP response shaping
- shared snippet/explain path
  - `src/commands/owned/io/query_rows.ts`, `src/commands/owned/io/format.ts`, `src/mcp/server.ts` 가 같은 query row contract를 소비한다

### Error & Failure Propagation

- query classification failure는 parse 단계가 아니라 runtime policy 결정 단계에서 deterministic fallback으로 처리해야 한다
- adaptive ranking helper 실패가 query 전체를 깨면 안 된다. local signal extraction이 실패하면 current baseline ranking으로 보수적으로 fallback 할 수 있어야 한다
- embedding mismatch advisory는 현재처럼 stderr 또는 structured advisory channel로만 나가고, ranking policy와 섞여 stdout/json을 오염시키면 안 된다

### State Lifecycle Risks

- 이번 작업은 read path라서 new persistent state mutation은 없어야 한다
- 다만 rerank-free path와 existing rerank path가 cache behavior를 다르게 만들 수 있으므로, “성능 캐시 miss”와 “정확도 회귀”를 혼동하지 않게 검증해야 한다
- query row contract가 full body와 display body를 함께 들고 가면 memory footprint가 늘 수 있으므로 limit/candidateLimit 범위 내에서 유지해야 한다
- adaptive ranking은 query text, query class, adaptive weights, prior query history를 persistence 또는 cross-session cache에 남기지 않는다
- query read path는 Kiwi model download/bootstrap, network access, `kqmd_documents_fts` mutation, search health mutation을 유발하지 않는다

### API Surface Parity

- CLI `query`, MCP `query` tool, HTTP `/query` route는 같은 input mode에 대해 같은 core ranking semantics를 공유해야 한다
- `search`는 이번 슬라이스에서 그대로 두고, `query`만 adaptive ranking을 소유한다
- `structured query`, `--candidate-limit`, `--explain`, `--json`, `--full`은 support model이 같은 방향을 말해야 한다
- v1 기본안은 `CLI plain adaptive + MCP structured conservative parity`다
- future MCP plain adaptive query가 필요하면 divergence registry에 명시적으로 기록한다
- adaptive `query` policy는 `kqmd_documents_fts`와 search policy health에 의존하지 않는다

### Integration Test Scenarios

- short Korean phrase query에서 title/heading/phrase 문서가 scattered mention 문서를 상회하는 시나리오
- mixed technical query에서 exact literal anchor가 있는 문서가 vague semantic hit보다 위에 오는 시나리오
- `vec=[none]` 또는 vectors table absent 상황에서도 short Korean phrase 결과가 설명 가능하게 정렬되는 시나리오
- quoted phrase 또는 symbol/path-like query가 lexical-first로 유지되는 시나리오
- weak vector-only hit가 strong literal/title/header anchor를 넘지 못하는 시나리오
- `query --candidate-limit`와 adaptive ranking이 동시에 적용될 때 user-facing semantics가 유지되는 시나리오
- CLI와 MCP query가 같은 row order와 snippet anchor를 보여 주는 시나리오
- current MCP structured query가 CLI structured query와 같은 conservative snippet/explain contract를 유지하는 시나리오
- public lex path에서 raw `NEAR(...)`, column filter, `OR` 같은 SQLite syntax를 v1 supported path로 가정하지 않는 시나리오

## Acceptance Criteria

### Functional Requirements

- [x] owned `query`는 plain query에서 query classification을 수행하고, 최소 `short-korean-phrase`, `mixed-technical`, `general/compatibility` 수준의 policy를 가진다
- [x] short Korean phrase fixture queries에서 phrase/title/header/core-context 문서가 scattered mention 문서보다 상위에 온다
- [x] mixed technical fixture queries에서 literal anchor와 hybrid evidence가 모두 반영되되, literal anchor가 약한 문서의 inexplicable jump가 줄어든다
- [x] structured query document path는 current typed semantics를 유지하며, aggressive adaptation 대상으로 취급하지 않는다
- [x] adaptive ranking은 document-type-specific hardcoding 없이 structural signals만으로 동작한다
- [x] explicit phrase 또는 symbol/path-like plain query는 lexical-first handling을 잃지 않는다
- [x] short Korean phrase path는 whole-form과 normalized subterm evidence를 함께 반영한다
- [x] weak vector-only hit는 strong phrase/title/header anchor를 앞지르지 못한다
- [x] `query_runtime.ts`는 retrieval adapter로만 남고, classification/scoring/row enrichment는 `query_core.ts`, `query_classifier.ts`, `query_ranking.ts`, shared `io/query_rows.ts`에 남는다
- [x] query row shaping은 full-body ranking/snippet source와 display body를 분리해 유지하되, 공용 `SearchOutputRow.body` 의미를 뒤집지 않는다
- [x] snippet anchoring은 lexical match span이 있을 때 이를 우선 사용하고, vector-only evidence에만 의존하지 않는다
- [x] CLI plain query와 MCP structured query는 각각의 input mode 안에서 같은 final row order와 snippet anchoring semantics를 공유한다
- [x] structured query의 `primaryQuery`/`displayQuery` 축약은 compatibility rule로 문서화되거나, 별도 snippet-anchor metadata가 있으면 그 계약이 명시된다
- [x] `--explain`은 upstream explain block에 더해 local adaptive adjustments와 named local signals를 truthfully 보여 주거나, 최소한 final ordering에 local policy가 개입했음을 숨기지 않는다
- [x] `--candidate-limit`가 존재할 때도 adaptive ranking contract는 silent no-op가 아니다
- [x] plain/structured query input은 CLI/MCP/HTTP에서 동일한 상한을 가진다: max query chars, max typed lines(10), max intent chars(500), max request body bytes, control-char rejection 또는 deterministic normalization
- [x] adaptive ranking은 row당 bounded body bytes/window count만 검사하고, cap 초과 시 baseline ranking으로 안전하게 fallback 한다
- [x] scoring/snippet source body는 internal-only이며 `--full`이 아닌 JSON/MCP payload에 serialize되지 않는다
- [x] adaptive metadata는 allowlist로만 노출되며 raw tokens, candidate windows, heuristic weights, cache keys, SQL/debug traces를 포함하지 않는다
- [x] any new SQLite/FTS query uses prepared statements or bounded placeholders only; raw user-derived SQL fragments are forbidden
- [x] adaptive ranking은 query text, query class, adaptive weights, prior query history를 persistence 또는 cross-session cache에 남기지 않는다

### Non-Functional Requirements

- [x] plain short Korean phrase path는 현재 query baseline보다 더 많은 model calls를 요구하지 않는다
- [x] mixed technical path에서 heavier rerank가 남더라도 expensive stage는 top-50 이하 bounded subset으로 제한된다
- [x] candidate window / rerank budget은 query class별로 문서화되고 테스트에서 고정된다
- [x] public upstream surface로 해결 가능한 plain path는 public API를 우선 사용하되, `store.search({ rerank: false })`를 no-model-work path로 오인하지 않는다
- [x] private upstream seam은 existing adapter에 localized 되고, 새 private import path를 추가하지 않는다
- [x] `query --json` stdout purity와 existing stderr advisory policy가 유지된다
- [x] current `search` behavior, Korean shadow index policy, embedding health advisory semantics는 이번 작업으로 회귀하지 않는다
- [x] short Korean phrase path의 downstream overhead(`classification + local scoring + snippet anchoring`)는 `candidateLimit=40` 기준 p95 `<= 25ms`를 목표로 한다
- [x] short Korean phrase path의 warm-cache, vectors-absent end-to-end p95는 `<= 200ms`를 목표로 한다
- [x] mixed technical path의 adaptive layer는 baseline 대비 p95 회귀를 `<= 10%`로 유지한다
- [x] `--explain` path의 latency overhead는 non-explain baseline 대비 `<= 20%`를 목표로 한다
- [x] query row shaping 추가로 인한 incremental heap budget은 `candidateLimit=40` 기준 요청당 `<= 8MB`를 목표로 한다
- [x] query read path는 Kiwi model download/bootstrap, network access, persistent adaptive memory, `kqmd_documents_fts` access에 의존하지 않는다

## Success Metrics

- short Korean phrase fixture set에서 top-3 relevance precision이 현재 baseline보다 개선된다
- short Korean phrase fixture set에서 top-1 exact-phrase relevance precision도 baseline보다 개선된다
- mixed technical fixture set에서 exact literal anchor가 있는 relevant docs의 평균 rank가 baseline보다 개선된다
- weak-vector/no-vector false positive가 top-3에 들어오는 비율이 baseline보다 감소한다
- explain-enabled output과 machine-readable output snapshot drift는 intentional fixture update 없이는 발생하지 않는다
- short Korean phrase path latency는 current query baseline 대비 의미 있는 악화를 만들지 않는다
- short Korean phrase / mixed technical benchmark matrix에서 model call count와 rerank count가 계획한 budget을 넘지 않는다
- JSON/MCP output security tests에서 internal-only scoring data serialization regressions가 발생하지 않는다

## Dependencies & Risks

- **Risk**: query classification이 너무 공격적이면 mixed technical query까지 short Korean phrase path로 밀어 넣을 수 있다  
  **Mitigation**: class 수를 작게 유지하고, plain/structured 경계를 먼저 고정한다
- **Risk**: full body를 다시 들고 가면 `--full` 또는 snapshot parity가 깨질 수 있다  
  **Mitigation**: `SearchOutputRow`를 직접 확장하기보다 query 전용 internal row contract와 shared row shaper로 분리한다
- **Risk**: adaptive policy가 existing private seam을 더 넓혀 upstream drift risk를 키울 수 있다  
  **Mitigation**: public surface는 가능한 한 유지하되, short Korean phrase 기본 경로는 lexical-first candidate generation으로 두고 private helper는 existing adapter에만 머물게 한다
- **Risk**: heuristic tuning이 fixture overfitting으로 흐를 수 있다  
  **Mitigation**: one-off corpus priors 대신 phrase/title/header/proximity/concentration 같은 structural signals만 허용한다
- **Risk**: exact phrase bias가 너무 강하면 한국어 복합명사 decompound recall을 잃을 수 있다  
  **Mitigation**: whole-form과 subterm evidence를 병렬로 유지하고, one-path-only gate 대신 weighted structural blend를 사용한다
- **Risk**: CLI와 MCP query semantics가 다시 갈라질 수 있다  
  **Mitigation**: 둘 다 `executeQueryCore()`를 사용하되, v1 parity를 same input mode 범위로 좁혀 문서화한다
- **Risk**: public `store.search({ rerank: false })`를 affordable baseline으로 오해하면 expansion/vector work가 계속 남을 수 있다  
  **Mitigation**: short Korean phrase 기본 경로는 lexical-first candidate generation을 사용하고, public rerank-free hybrid path는 compatibility fallback으로만 다룬다
- **Risk**: public simple-query path는 multi-collection과 `candidateLimit` semantics를 완전히 보장하지 않는다  
  **Mitigation**: 해당 계약은 existing `query_runtime.ts` seam에서 유지하고, 관련 limitations를 Phase 1에서 명시한다
- **Risk**: future FTS index-size optimization이 phrase/NEAR signal을 깨뜨릴 수 있다  
  **Mitigation**: `documents_fts`와 `kqmd_documents_fts`의 `detail=full` invariant를 문서와 tests로 고정한다
- **Risk**: adaptive ranking metadata가 JSON/MCP payload에 과도하게 노출될 수 있다  
  **Mitigation**: allowlist-only serialization과 output security tests를 둔다

## Verification Plan

### Focused Tests

- `test/query-classifier.test.ts`
  - query classification
  - short Korean phrase vs mixed technical detection
  - quoted phrase / symbol-path-like / mixed-script trait detection
- `test/query-ranking.test.ts`
  - structural signals
  - phrase/title/header/proximity/concentration scoring
  - whole-form + subterm evidence blending
  - weak vector evidence backoff
  - no document-type priors regression
- `test/query-runtime.test.ts`
  - plain short Korean phrase path uses lexical-first or equivalent affordable execution
  - mixed technical path keeps current hybrid semantics
  - expensive rerank budget remains bounded
  - `candidate-limit` path remains real semantics
  - public simple-query multi-collection limitation is explicitly guarded or documented
- `test/query-core.test.ts`
  - query-only internal row contract
  - adaptive explain metadata
  - named feature contribution payload
  - vector absent / `vec=[none]` fallback quality
- `test/query-security.test.ts`
  - overlong plain query rejected
  - too-many structured lines rejected
  - control chars rejected or normalized deterministically
  - repeated adversarial queries do not affect later unrelated queries
- `test/query-output-security.test.ts`
  - JSON/MCP never serializes internal scoring source body
  - explain metadata stays within allowlist
  - error payloads contain no stack trace, SQL text, or internal debug blobs
- `test/query-runtime-sql-safety.test.ts`
  - quotes, negation, mixed-script punctuation do not trigger raw SQL assembly
  - placeholder count remains bounded by `candidateLimit`

### Parity / Output Tests

- `test/owned-command-parity/query-output.test.ts`
  - CLI explain snapshot
  - JSON snapshot
  - full-output snapshot
- MCP query tests
  - structured row ordering parity with CLI core
  - structured snippet anchoring parity
  - structured output contains adaptive metadata, named signals, or equivalent truth marker
  - request body above cap returns 413 or equivalent stable failure

### Benchmark Matrix

- axes:
  - `query class × vectors on/off × candidateLimit(5,10,20,40) × output(default,json,explain,full) × cache state(warm,cold)`
- metrics:
  - p50/p95 latency
  - model call count
  - rerank count
  - full-body scanned bytes
  - heap delta 또는 max RSS
- pass conditions:
  - short Korean phrase는 baseline보다 같거나 더 빠르다
  - mixed technical은 p95 회귀 `<= 10%`
  - `--explain` overhead `<= 20%`
  - memory budget 초과 없음

### Manual Proof

```bash
bun run test -- query-classifier query-ranking query-runtime query-core owned-command-parity/query-output
bun run test -- mcp-server mcp-http query-core

node bin/qmd.js query --explain --collection obsidian "지속 학습"
node bin/qmd.js query --explain --collection obsidian "normalizeHybridQueryResults"
node bin/qmd.js query --explain --collection obsidian "agent orchestration"
node bin/qmd.js query --json --collection obsidian "지속 learning"
```

manual checks:
- `qmd query --collection obsidian "지속 학습"`에서 title/header/phrase 문서가 filepath-heavy lexical baseline보다 위에 오는지 확인
- `qmd query --collection obsidian "지속 learning"`에서 literal anchor와 hybrid evidence가 named explain signal로 드러나는지 확인
- MCP `/query` 또는 tool path는 structured input에 대해서만 같은 conservative snippet/explain contract를 유지하는지 확인

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-16-korean-query-ranking-adaptive-fusion-brainstorm.md](../../docs/brainstorms/2026-03-16-korean-query-ranking-adaptive-fusion-brainstorm.md)
  carry-forward decisions: downstream-only ownership, adaptive fusion approach, priority query classes, corpus-agnostic guardrail, success criteria focused on short Korean phrases and mixed technical queries

### Internal References

- [`src/commands/owned/query.ts`](../../src/commands/owned/query.ts)
- [`src/commands/owned/query_core.ts`](../../src/commands/owned/query_core.ts)
- [`src/commands/owned/query_runtime.ts`](../../src/commands/owned/query_runtime.ts)
- [`src/commands/owned/io/format.ts`](../../src/commands/owned/io/format.ts)
- [`src/commands/owned/io/types.ts`](../../src/commands/owned/io/types.ts)
- [`src/commands/owned/io/parse.ts`](../../src/commands/owned/io/parse.ts)
- [`src/commands/owned/io/validate.ts`](../../src/commands/owned/io/validate.ts)
- [`src/commands/owned/kiwi_tokenizer.ts`](../../src/commands/owned/kiwi_tokenizer.ts)
- [`src/mcp/server.ts`](../../src/mcp/server.ts)
- [`docs/architecture/kqmd-command-boundary.md`](../../docs/architecture/kqmd-command-boundary.md)
- [`docs/architecture/upstream-compatibility-policy.md`](../../docs/architecture/upstream-compatibility-policy.md)
- [`docs/development.md`](../../docs/development.md)

### Institutional Learnings

- [`docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`](../../docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md)
- [`docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md`](../../docs/solutions/logic-errors/non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md)
- [`docs/solutions/logic-errors/owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md`](../../docs/solutions/logic-errors/owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md)
- [`docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`](../../docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)

### External Primary Sources

- [SQLite FTS5 documentation](https://sqlite.org/fts5.html)
- [Hybrid Search Scoring (RRF) - Azure AI Search](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking)
- [Create a Hybrid Query - Azure AI Search](https://learn.microsoft.com/en-us/azure/search/hybrid-search-how-to-query)
- [Semantic Ranking Overview - Azure AI Search](https://learn.microsoft.com/en-us/azure/search/semantic-search-overview)
- [Create a Vector Query - Azure AI Search](https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-query)
- [Reciprocal rank fusion - Elasticsearch Reference](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion)
- [Match phrase query - Elasticsearch Reference](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-match-query-phrase)
- [nori tokenizer - Elasticsearch Reference](https://www.elastic.co/docs/reference/elasticsearch/plugins/analysis-nori-tokenizer)
- [Hybrid search explain - OpenSearch Documentation](https://docs.opensearch.org/2.19/vector-search/ai-search/hybrid-search/explain/)
- [Phased Ranking - Vespa](https://docs.vespa.ai/en/ranking/phased-ranking.html)
- [Schema reference: match-features / summary-features - Vespa](https://docs.vespa.ai/en/reference/schemas/schemas.html)
- [Search query syntax - Sourcegraph docs](https://sourcegraph.com/docs/code-search/queries)
- [Search-based code navigation - Sourcegraph docs](https://6.9.sourcegraph.com/code-search/code-navigation/search_based_code_navigation)
- [Sourcegraph architecture - Search / Code Navigation](https://6.3.sourcegraph.com/admin/architecture)
- [The technology behind GitHub’s new code search - GitHub Blog](https://github.blog/engineering/architecture-optimization/the-technology-behind-githubs-new-code-search/)

### Upstream Evidence

- [`node_modules/@tobilu/qmd/dist/index.js`](../../node_modules/@tobilu/qmd/dist/index.js)
- [`node_modules/@tobilu/qmd/dist/index.d.ts`](../../node_modules/@tobilu/qmd/dist/index.d.ts)
- [`node_modules/@tobilu/qmd/dist/store.js`](../../node_modules/@tobilu/qmd/dist/store.js)
- [`node_modules/@tobilu/qmd/dist/store.d.ts`](../../node_modules/@tobilu/qmd/dist/store.d.ts)
