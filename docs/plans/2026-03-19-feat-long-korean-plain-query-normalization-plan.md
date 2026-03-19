---
title: feat: Add long Korean plain query normalization
type: feat
status: completed
date: 2026-03-19
origin: docs/brainstorms/2026-03-19-korean-query-question-normalization-brainstorm.md
---

# feat: Add long Korean plain query normalization

## Enhancement Summary

**Planned on:** 2026-03-19  
**Deepened on:** 2026-03-19  
**Sections enhanced:** 10  
**Research agents used:** `architecture-strategist`, `performance-oracle`, `security-sentinel`, `kieran-typescript-reviewer`, `learnings-researcher`, `spec-flow-analyzer`  
**Additional primary sources:** official SQLite FTS5 docs, official Vespa phased ranking docs

### Key Improvements

1. `QueryTraits`는 lexical facts만 유지하고, `QueryNormalizationPlan`/`QueryExecutionSummary`를 별도 계약으로 분리하는 방향을 명시해 core/transport drift를 줄이도록 강화했다.
2. `original + normalized` 이중 신호는 유지하되, `scope freeze`, `supplement fail-open`, `coarse summary allowlist`, `no new store reopen` 계약을 추가해 read-path 안정성을 더 명확히 했다.
3. normalized pass에는 `base-result dynamic gate`, `lower fetch window`, `normalized rescue cap`, `latency budget skip`를 추가해 hot path 비용 상한을 더 구체적으로 고정했다.
4. long-query/question benchmark는 recall만이 아니라 `overhead`, `skip rate`, `privacy-safe report shape`까지 함께 측정하도록 확장했다.

### New Considerations Discovered

- 현재 `queryClass`는 CLI explain, MCP response, benchmark JSON contract에서 재사용되므로 enum 자체를 바꾸면 user-visible surface가 넓게 흔들릴 수 있다 (`src/mcp/query.ts:63`, `test/query-recall-benchmark.test.ts:158`).
- `scripts/measure_query_recall.ts`에는 이미 question 시나리오가 존재하므로, 이번 작업은 완전한 greenfield보다 “exploratory path를 제품 계약으로 승격”하는 성격이 강하다 (`scripts/measure_query_recall.ts:239`).
- prior learnings상 query 출력/metadata는 local-only helper라고 해도 쉽게 drift 하므로, explain/JSON/MCP shaping을 explicit scope로 다뤄야 한다 (`docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`, `docs/solutions/logic-errors/korean-query-search-assist-rescue-kqmd-cli-20260319.md`).
- 현재 `query_core.ts`는 execution layer에서 formatter mapper를 가져다 쓰고, `mcp/query.ts`는 `queryClass`를 core 밖에서 다시 계산한다. normalization까지 같은 패턴으로 얹으면 execution/transport drift가 커질 수 있다 (`src/commands/owned/query_core.ts:9`, `src/mcp/query.ts:67`).
- `QueryTraits.normalized`는 이미 whitespace-normalized original을 뜻하므로, 새 feature의 “normalized query”와 이름이 충돌한다. terminology contract를 먼저 닫아 두는 편이 안전하다 (`src/commands/owned/query_classifier.ts:17`).

## Overview

K-QMD의 owned `query` 경로에 긴 한국어 plain query와 한국어 질문 + 영문 기술어 혼합 query를 더 잘 처리하기 위한 normalization 레이어를 추가한다. 핵심 목표는 브레인스토밍에서 합의한 그대로, 질문형 query를 별도 surface로 분리하지 않고 기존 plain query 경험 안에서 관련 문서가 top-5 안에 더 안정적으로 들어오게 만드는 것이다 (see brainstorm: `docs/brainstorms/2026-03-19-korean-query-question-normalization-brainstorm.md`).

이번 v1은 공격적인 의미 확장이나 자유로운 rewrite를 도입하지 않는다. 대신 원문 질문은 유지하고, 내부적으로는 조사, 의문 표현, 군더더기 표현을 걷어낸 normalized query를 보조 신호로 함께 사용한다. 적용 범위도 질문형처럼 보이는 query에만 국한하지 않고, 긴 한국어 plain query 전반과 한국어 + 영문 기술어 혼합 query까지 넓게 다룬다 (see brainstorm: `docs/brainstorms/2026-03-19-korean-query-question-normalization-brainstorm.md`).

## Problem Statement

현재 owned `query`는 `classifyQuery()`에서 `short-korean-phrase`, `mixed-technical`, `general`, `structured` 네 가지 클래스만 구분한다. 이 구조에서는 긴 한국어 plain query가 대부분 `general`로 분류되고, 질문형 한국어 + 영문 기술어 혼합 query는 일부만 `mixed-technical`로 잡힌다 (`src/commands/owned/query_classifier.ts:80`). 즉 현재 정책은 짧은 한국어 구와 mixed technical query에는 분명한 제품 원칙이 있지만, 긴 한국어 plain query 자체는 명시적 대상이 아니다.

`executeQueryCore()`도 같은 분류 결과를 기준으로 fetch window, rerank disable, search-assist eligibility를 결정한다 (`src/commands/owned/query_core.ts:92`). search-assist 역시 `short-korean-phrase` 또는 `mixed-technical`만 eligibility 대상으로 삼기 때문에, 긴 한국어 질문은 한국어 shadow index의 보조 신호에서도 쉽게 제외된다 (`src/commands/owned/query_search_assist_policy.ts:49`). 결과적으로 “질문을 던졌더니 관련 문서는 있는데 current query path가 top-5 안에 못 올리는” 틈이 남아 있다.

한편 benchmark 관점에서도 long-query path는 아직 제품 계약으로 닫히지 않았다. `scripts/measure_query_recall.ts`는 이미 `QUESTION_CASES`를 통해 문장형/긴 query를 실험하지만, 기존 report는 이를 exploratory bucket으로만 다루고 core aggregate와 분리한다 (`scripts/measure_query_recall.ts:239`, `docs/benchmarks/2026-03-19-query-recall-metrics.md:47`). 즉 구현/검증 양쪽 모두에서 “실험은 하고 있지만 아직 정식 제품 약속은 아니다”라는 상태다.

## Local Research Findings

- [`docs/brainstorms/2026-03-19-korean-query-question-normalization-brainstorm.md`](../brainstorms/2026-03-19-korean-query-question-normalization-brainstorm.md)
  origin 문서다. long Korean plain query 전반을 대상으로 하고, 원문 query를 유지하면서 normalized query를 보조 신호로 쓰며, 둘을 비슷한 비중으로 섞는다는 결정이 이미 내려져 있다.
- [`docs/architecture/kqmd-command-boundary.md`](../architecture/kqmd-command-boundary.md)
  K-QMD는 replacement distribution이며 owned `query`는 downstream-only policy 확장으로 닫혀야 한다. 이번 작업도 upstream `qmd` 수정이나 별도 parallel CLI가 아니라 existing owned `query` core 안에서 해결해야 한다.
- [`src/commands/owned/query_classifier.ts`](../../src/commands/owned/query_classifier.ts)
  현재 `QueryTraits`와 `QueryClass`는 short Korean phrase / mixed technical 최적화에 맞춰져 있다. 긴 한국어 plain query를 새 target으로 삼으려면 enum을 바꾸기보다 eligibility/helper 층을 더하는 편이 현재 contract에 덜 파괴적이다 (`src/commands/owned/query_classifier.ts:15`, `src/commands/owned/query_classifier.ts:80`).
- [`src/commands/owned/query_core.ts`](../../src/commands/owned/query_core.ts)
  collection resolution, embedding advisory, retrieval, assist merge, final ranking이 이미 orchestration layer로 정리돼 있다. normalization을 넣는 가장 자연스러운 자리는 `executeOwnedQuerySearch()` 앞뒤의 candidate orchestration seam이다 (`src/commands/owned/query_core.ts:52`).
- [`src/mcp/query.ts`](../../src/mcp/query.ts)
  MCP plain query도 결국 `QueryCommandInput`을 만들어 same core로 들어간다. 따라서 normalization이 `query_core` 또는 classifier/helper layer에 들어가면 CLI와 MCP plain surface가 같이 개선될 수 있다 (`src/mcp/query.ts:151`).
- [`scripts/measure_query_recall.ts`](../../scripts/measure_query_recall.ts)
  기존 benchmark는 이미 `QUESTION_CASES`와 injected question showcase를 갖고 있다. 이 케이스들은 새 feature를 측정하는 데 바로 재사용 가능하며, 추가 케이스와 aggregate만 정리하면 된다 (`scripts/measure_query_recall.ts:239`).
- [`docs/development.md`](../development.md)
  query-related change는 `query-core`, `query-output-security`, `query-output`, `mcp-query`, `mcp-server`, `mcp-http` 검증을 같이 묶어 보는 것이 current repo convention이다 (`docs/development.md:75`).

## Institutional Learnings Search Results

### Search Context

- **Feature/Task**: 긴 한국어 plain query normalization을 owned `query`에 도입
- **Keywords Used**: `query`, `korean`, `search-assist`, `parity`, `mcp`, `benchmark`, `explain`
- **Files Scanned**: 10
- **Relevant Matches**: 4

### Critical Patterns

- `docs/solutions/patterns/critical-patterns.md`는 현재 저장소에 없다. 따라서 이번 계획은 architecture docs, tests, existing solution docs를 primary institutional source로 사용한다.

### Relevant Learnings

#### 1. Korean query search-assist rescue hardening
- **File**: `docs/solutions/logic-errors/korean-query-search-assist-rescue-kqmd-cli-20260319.md`
- **Module**: K-QMD CLI
- **Relevance**: query hot path에 새 보강 레이어를 넣을 때 eligibility gate, health read 순서, benchmark scope parity, explain coverage를 명시적으로 닫아야 한다.
- **Key Insight**: expensive read path는 early skip 이후에만 타야 하고, formatter/MCP/benchmark는 부수효과가 아니라 first-class scope로 계획에 포함해야 한다.

#### 2. Query explain output parity drift
- **File**: `docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`
- **Module**: K-QMD CLI
- **Relevance**: normalization provenance를 explain/JSON에 드러내려면 별도 snapshot/contract test가 필요하다.
- **Key Insight**: 조건부 formatter branch는 일반 success snapshot만으로는 보호되지 않는다. user-visible explain block은 dedicated snapshot으로 고정해야 한다.

#### 3. Kiwi shadow index hardening
- **File**: `docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md`
- **Module**: K-QMD CLI
- **Relevance**: query read path에 새 한국어 처리 로직을 넣더라도 live bootstrap/network/runtime dependency를 만들면 안 된다.
- **Key Insight**: read-path correctness는 “clean health가 말하는 것”과 “실제 실행 가능성”이 어긋나지 않도록 해야 하며, conservative syntax fallback을 유지해야 한다.

#### 4. Owned MCP boundary hardening
- **File**: `docs/solutions/logic-errors/owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md`
- **Module**: K-QMD CLI
- **Relevance**: CLI에서만 normalization semantics를 넣고 MCP plain query를 놓치면 surface parity가 다시 갈라진다.
- **Key Insight**: 같은 input mode가 같은 domain core를 재사용하도록 경계를 잡아야 하며, transport별 validation/response shaping drift를 explicit test로 닫아야 한다.

### Recommendations

- normalization은 pure helper + `query_core` orchestration으로 분리하고, new runtime dependency를 만들지 않는다.
- `QueryClass`를 새 enum 값으로 늘리기보다 separate eligibility/metadata를 먼저 도입한다.
- query recall benchmark는 question/long-query category를 first-class로 올리되, 기존 core aggregate와는 분리해 제품 메시지 과장을 막는다.
- CLI explain, JSON output, MCP response는 allowlisted normalization summary만 노출하고 raw dropped terms/debug traces는 숨긴다.
- `docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`와 `docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`까지 함께 참고해, read path가 새 store open/reopen이나 duplicate health read를 만들지 않도록 못박는다.

## External Research Findings

이번 주제는 외부 API 연동은 아니지만, `conservative syntax`와 `bounded rerank` 쪽은 공식 검색 문서에서 추가로 근거를 보강할 수 있었다. Context7은 이번 세션에서 quota 문제로 사용하지 못해, official web docs를 fallback source로 사용한다.

- **SQLite FTS5 docs**: quoted phrase, `NOT`, `NEAR` 같은 문법이 query text semantics의 일부이며, trigram tokenizer 예시도 `"hij klm" NOT stuv`처럼 phrase/boolean syntax를 그대로 사용한다. 이 근거는 quoted/negated Hangul query를 normalization 대상에서 보수적으로 제외해야 한다는 현재 guardrail을 강화한다.  
  Reference: [SQLite FTS5 Extension](https://sqlite.org/fts5.html)
- **Vespa phased ranking docs**: expensive rerank는 global-phase에서 bounded `rerank-count`로 제한하는 것이 기본 패턴이며, 문서 예시도 `rerank-count: 50`를 사용한다. 이는 normalized supplement도 “추가 retrieval 1회”만이 아니라 더 낮은 candidate cap과 explicit rerank budget을 가져야 한다는 근거가 된다.  
  Reference: [Vespa Phased Ranking](https://docs.vespa.ai/en/ranking/phased-ranking.html)

## Spec Flow Findings

이번 feature는 UI flow보다 query execution flow가 핵심인 기능이지만, user journey와 domain flow를 따라가면 planning 전에 닫아야 할 모호성이 몇 가지 있었다.

1. **Trigger boundary**
   긴 한국어 plain query를 어디까지 normalization 대상으로 볼지 명확하지 않았다. v1에서는 `plain query`이면서 Hangul signal이 있고, conservative syntax가 아니며, 짧은 short-phrase path 바깥의 long Korean plain query 또는 long mixed question-like query를 대상으로 삼는다.

2. **Original vs normalized precedence**
   원문 query와 normalized query가 충돌할 때 어느 쪽을 더 믿을지 모호했다. 브레인스토밍 결정을 따라 둘을 비슷한 비중으로 섞되, base original result를 버리지 않고 normalized pass는 bounded supplement로만 추가한다 (see brainstorm: `docs/brainstorms/2026-03-19-korean-query-question-normalization-brainstorm.md`).

3. **Failure semantics**
   normalization helper가 빈 문자열이나 과도한 축약을 만들면 query 의미가 깨질 수 있다. v1에서는 uncertain/empty/same-as-original 결과는 모두 skip 하고, normalization failure는 전체 query를 실패시키지 않고 original-only path로 fail-open 한다.

4. **Search-assist ordering**
   normalization과 search-assist 둘 다 downstream 보강이므로 순서가 중요하다. v1에서는 original retrieval 후 normalized retrieval supplement를 합치고, search-assist는 current original-query semantics를 유지한 채 별도 단계로 둔다. 즉 assist query 자체를 normalization하지는 않는다.

5. **Output truthfulness**
   normalization이 개입했을 때 explain/JSON/MCP가 무엇을 보여 줄지 정의가 필요했다. v1에서는 query-level summary를 기본 계약으로 두고, explain path에서만 normalized query summary를 더 드러낸다. raw removed tokens, stopword list, heuristic weights는 internal-only로 남긴다.

6. **Benchmark promotion**
   기존 question bucket을 바로 기존 core aggregate에 합치면 숫자 해석이 흐려질 수 있다. 따라서 long-query/question category를 별도 aggregate로 승격하고, spacing/compound/mixed core aggregate는 유지한다.

7. **Path-like mixed query boundary**
   순수 path lookup과 “한국어 long query 안의 code/path token 보존”을 어떻게 구분할지가 모호했다. v1에서는 순수 path-like literal query는 normalization을 skip 하고, 한국어 long query 안에 포함된 path/code token은 immutable token으로만 보존한다.

8. **Applied-without-gain semantics**
   normalization이 적용됐지만 후보/순위 개선이 없는 케이스를 실패로 볼지 정의가 필요했다. v1에서는 `applied=true` 이고 `addedCandidates=0` 또는 top-5 불변이어도 정상 성공으로 본다.

## Chosen Approach

브레인스토밍에서 선택한 `Approach A: Question Normalization with Original+Normalized Signals`를 그대로 구현 계약으로 번역한다 (see brainstorm: `docs/brainstorms/2026-03-19-korean-query-question-normalization-brainstorm.md`).

구체 원칙은 다음과 같다.

1. 원문 query는 항상 유지한다. 이 feature는 rewrite-only path가 아니다.
2. normalization은 pure helper가 생성한 보조 query로만 사용한다.
3. normalized pass는 extra retrieval 1회만 허용하며, same collection scope와 bounded fetch window를 사용한다.
4. final candidate set은 `original retrieval + normalized retrieval + current search-assist` 순으로 결합한다.
5. ranking은 기존 adaptive ranker를 완전히 버리지 않고, normalized evidence를 bounded bonus/provenance로 녹이는 방향을 택한다.
6. `QueryClass` enum은 v1에서 유지한다. 대신 `QueryTraits` 또는 별도 helper에 long-query/question-like eligibility를 추가한다.
7. normalized pass는 original input에서 한 번 결정한 collection scope, syntax mode, validation envelope를 그대로 재사용하고, 바꾸는 것은 검색 텍스트뿐이다.
8. query-level 외부 계약은 coarse summary만 노출하고, raw normalized query 문자열과 dropped/kept token 목록은 기본 비노출로 둔다.

이 방식은 브레인스토밍에서 기각한 두 접근을 의도적으로 피한다.

- `Internal Structured Expansion`처럼 full multi-lane structured engine으로 가면 explain/MCP/output contract가 한 번에 너무 커진다.
- `Question-Specific Rescue Only`는 지금 원하는 top-5 안정화 목표에 비해 개선 폭이 작다.

## Technical Approach

### Architecture

이번 작업은 `query` 경로에 새 “normalization supplement” 층을 추가하되, 기존 owned command 경계를 유지하는 방향이 좋다.

Research insights:

- `query_classifier.ts`는 generic lexical facts까지만 유지하고, feature policy는 `buildQueryNormalizationPlan()`으로 분리하는 편이 현재 command boundary와 더 잘 맞는다.
- `QueryTraits.normalized`는 기존 whitespace-normalized original을 뜻하므로, terminology collision을 피하기 위해 `normalizedWhitespace` rename 또는 equivalent clarification을 Phase 1에서 같이 닫는 편이 안전하다.
- `executeQueryCore()`가 canonical query summary를 반환하고, CLI/MCP/HTTP는 그 projection만 하도록 바꾸면 `classifyQuery()` 재실행에 따른 drift를 크게 줄일 수 있다.
- current `mergeRescueCandidates()`는 assist 전용 metadata를 주입하므로, normalization merge는 `src/commands/owned/query_candidate_merge.ts` 같은 중립 모듈로 분리하는 편이 provenance 경계가 더 선명하다.
- `normalizeHybridQueryResults()`/`normalizeSearchResults()`는 formatter 계층보다 execution-layer mapper에 가깝다. normalization 기능을 넣는 시점에 이 경계를 명시적으로 정리해 두는 편이 장기적으로 깔끔하다.

권장 파일 단위는 다음과 같다.

- `src/commands/owned/query_classifier.ts`
  - current `QueryTraits`는 lexical facts만 유지한다
  - long-query/question-like eligibility는 새 `buildQueryNormalizationPlan()` helper에서 계산한다
  - `QueryTraits.normalized` terminology collision은 rename 또는 explicit comment로 정리한다
  - `QueryClass` enum은 유지한다
- `src/commands/owned/query_normalization.ts`
  - 새 pure helper
  - raw query -> `QueryNormalizationPlan` discriminated union을 계산한다
  - `skip` / `apply`를 명확히 구분하고 impossible state를 허용하지 않는다
  - runtime bootstrap, DB, network, Kiwi model load에 의존하지 않는다
- `src/commands/owned/query_candidate_merge.ts`
  - normalization supplement merge/dedupe를 담당하는 중립 helper
  - assist metadata injection과 분리해 provenance 경계를 유지한다
- `src/commands/owned/query_core.ts`
  - original retrieval + normalized retrieval supplement orchestration 추가
  - `PlainQuerySearchRequest` 기반 search request 생성
  - dedupe/merge ordering과 `QueryExecutionSummary` 생성
  - current search-assist와 final ranking 연결 유지
- `src/commands/owned/query_ranking.ts`
  - normalized evidence를 bounded contribution으로 반영하되, orchestration plan 전체가 아니라 row-level provenance만 입력으로 받는다
  - original-only 강한 hit를 explain 불가능하게 덮지 않도록 상한을 둔다
- `src/commands/owned/io/types.ts`
  - `QueryNormalizationPlan`, `QueryNormalizationSummary`, `QueryExecutionSummary`, `PlainQuerySearchRequest` 추가
  - row-level free-form normalization metadata는 v1에서 피하고 query-level summary를 우선한다
- `src/commands/owned/io/format.ts`
  - CLI explain/JSON output에 normalization summary 추가
- `src/commands/owned/io/query_rows.ts`
  - query-level summary projection을 우선 사용한다
  - row-level normalization provenance는 꼭 필요할 때만 작은 닫힌 union으로 제한한다
- `src/mcp/query.ts`
  - `classifyQuery(input)` 재실행 대신 `QueryCoreSuccess.query` projection만 사용한다
- `scripts/measure_query_recall.ts`
  - question/long-query category를 정식 aggregate로 승격
  - 현재 exploratory case를 deterministic acceptance bucket으로 재분류
- `test/query-classifier.test.ts`
  - eligibility/question-like/long-query helper contract 고정
- `test/query-core.test.ts`
  - original+normalized supplement merge, fail-open, collection parity, assist ordering 검증
- `test/query-output-security.test.ts`
  - raw dropped tokens/debug traces가 JSON/MCP에 leak 되지 않음을 검증
- `test/owned-command-parity/query-output.test.ts`
  - explain snapshot 보강
- `test/mcp-query.test.ts`, `test/mcp-http.test.ts`, `test/mcp-server.test.ts`
  - CLI와 MCP plain query parity 보강

### Recommended Execution Contract

```ts
// src/commands/owned/query_core.ts
const traits = classifyQuery(input);
const normalizationPlan = buildQueryNormalizationPlan(input, traits);
const baseRequest = buildPlainQuerySearchRequest(input, traits, selectedCollections);

const baseRows = normalizeHybridQueryResults(
  await executeOwnedQuerySearch(store, baseRequest, selectedCollections, deps),
);

const normalizationRun = await maybeRunNormalizedSupplement({
  plan: normalizationPlan,
  baseRows,
  baseRequest,
  selectedCollections,
  deps,
  budget,
});

const mergedOriginalRows = mergeNormalizedCandidates(baseRows, normalizationRun.rows);

const assist = await maybeResolveQuerySearchAssist(store, input, traits, selectedCollections, deps);
const mergedRows = mergeRescueCandidates(mergedOriginalRows, assist.rows, rescueCap);

return {
  rows: rankQueryRows(mergedRows, traits, {
    normalizedCandidateKeys: normalizationRun.candidateKeys,
  }),
  query: buildQueryExecutionSummary({
    input,
    traits,
    normalization: summarizeQueryNormalization(normalizationPlan, normalizationRun),
    searchAssist: summarizeSearchAssist(assist),
  }),
};
```

핵심 제약:

- input size budget (`maxBytes`, `maxChars`, `maxTokens`)은 classification 전에 공통 validation으로 강제한다
- normalization은 `plain` input에만 적용한다
- quoted/negated syntax, path-like literal query, structured query는 skip 한다
- URL, 이메일, UUID, hash, base64/hex 긴 문자열, API-key 같은 민감 토큰이 보이면 normalization은 skip 하거나 해당 토큰을 immutable로 둔다
- normalized query가 original과 같거나 너무 비어 있거나 retained token 수가 과도하게 줄면 skip 한다
- selected collections, syntax mode, query mode는 original input 기준으로 한 번만 결정하고 normalized pass에서도 그대로 재사용한다
- normalized supplement는 `base` top-3에 strong whole-form/full-term hit가 있으면 아예 시작하지 않는다
- normalized supplement fetch window는 `min(baseFetchLimit / 2, limit + 8)` 이하의 lower bound를 사용하고, `normalizedRescueCap`도 별도로 둔다
- normalized retrieval/runtime error와 assist error는 모두 sanitized summary만 남기고 original-only success로 fail-open 한다
- synchronous SQLite/FTS path에는 pseudo-timeout을 붙이지 않는다
- query read path는 no-network/no-bootstrap/no-persistent-memory를 유지하며, 새 store open/config-file reopen/config sync side effect를 만들지 않는다
- external output은 coarse reason enum + count 정도만 노출하고 raw normalized query와 dropped/kept tokens는 기본 비노출로 둔다

### Phase 1: Normalization Foundation

Deliverables:

- `src/commands/owned/query_normalization.ts` 추가
- `src/commands/owned/query_classifier.ts` terminology contract 정리
- pure normalization rules 문서화
- `QueryNormalizationPlan` discriminated union과 skip reason enum 정의
- input size budget과 민감 토큰 hard-skip contract 정의

Normalization v1 rules:

- trailing `?`, `요`, `나요`, `해?`, `동작해?`, `설명해줘` 같은 question tail을 보수적으로 제거
- 한국어 조사/보조어와 검색에 덜 중요한 glue phrase를 bounded allowlist로만 제거
- 영문 기술어와 한국어 long query 안의 code/path token은 immutable token으로 보존
- 순수 path-like lookup, URL, 이메일, UUID, hash, base64/hex 긴 문자열, secret-like token은 normalization 대상에서 제외한다
- dropped-term history나 debug traces는 runtime output에 노출하지 않음

Success criteria:

- `QueryClass` enum은 바뀌지 않는다
- `QueryTraits`는 lexical facts만 유지하고, feature policy는 `QueryNormalizationPlan`으로 분리된다
- normalization helper는 pure function이며 I/O, DB, network, Kiwi bootstrap을 호출하지 않는다
- `QueryNormalizationPlan`은 `kind: 'skip' | 'apply'` discriminated union으로 닫힌다
- uncertain/empty/same-as-original normalization은 모두 skip reason으로 닫힌다
- retained token 수가 과도하게 줄어드는 over-normalized case도 skip reason으로 닫힌다
- quoted/negated/path-like/structured input은 current semantics를 유지한다
- input size budget 초과 시 normalization skipped 또는 explicit validation error로 처리한다
- normalization path는 기존 owned store session만 재사용하고, 새 store open/reopen을 만들지 않는다

Estimated effort:

- Medium

### Phase 2: Query Core Integration

Deliverables:

- `src/commands/owned/query_core.ts`에 original+normalized dual-pass supplement 추가
- `src/commands/owned/query_candidate_merge.ts` 추가
- `QueryExecutionSummary`와 query-level normalization summary shape 추가
- `PlainQuerySearchRequest` 기반 request shaping 추가
- adaptive ranking이 normalized evidence를 bounded signal로 사용하도록 조정

Key decisions for this phase:

- original retrieval가 언제나 first-class baseline이다
- normalized retrieval는 supplement일 뿐 base replacement가 아니다
- normalized pass는 original input에서 한 번 결정한 collection scope, syntax mode, query mode를 그대로 재사용한다
- normalized pass는 base top-3 strong hit 존재 시 skip 하는 dynamic gate를 가진다
- normalized retrieval는 base보다 더 낮은 fetch window와 별도 `normalizedRescueCap`을 사용한다
- dedupe key는 current rescue path와 맞춰 `docid || displayPath`를 사용한다
- current search-assist ordering과 shadow-health gating은 유지한다
- search-assist query text는 v1에서 normalization하지 않는다

Success criteria:

- original rows는 항상 유지된다
- normalized supplement는 기존 candidate에 없던 relevant row를 top-5에 올리는 데만 bounded 도움을 준다
- selected collection resolution은 original/normalized/assist 전부 같은 scope를 사용한다
- eligibility/skip를 먼저 계산하고, expensive health/read path는 그 뒤에만 실행한다
- normalized retrieval timeout/runtime error는 original-only success로 fail-open 한다
- `applied=true`이지만 added-candidate가 0이거나 top-5가 그대로인 케이스도 정상 성공으로 간주한다
- 같은 문서가 original/normalized/assist에서 동시에 잡혀도 결과에는 한 번만 나타나고 provenance만 요약된다
- normalization unavailable 시 query는 original-only path로 성공한다

Estimated effort:

- Medium

### Phase 3: Explain, MCP, and Benchmark Hardening

Deliverables:

- CLI explain/JSON/MCP normalization summary 계약 추가
- `scripts/measure_query_recall.ts`의 question bucket을 정식 aggregate로 승격
- long-query deterministic fixtures 추가
- overhead/privacy counters 추가
- docs/development/release/architecture/README gate 업데이트

Success criteria:

- CLI, JSON, MCP plain query와 HTTP alias가 같은 core summary semantics를 공유한다
- explain path는 dedicated snapshot으로 보호된다
- long-query/question aggregate는 same dataset, same collection scope, same explain mode에서 deterministic benchmark로 측정된다
- benchmark report는 `normalizedApplied`, `normalizedSkipReason`, `normalizedFetchLimit`, `normalizedAddedCandidates`, `overheadMs`, `latencyBudgetSkipRate`를 해석 가능하게 기록한다
- synthetic fixture/aggregate/report는 raw original/normalized query 로그를 남기지 않는다
- existing spacing/compound/mixed core aggregate와 controls는 regress 하지 않는다
- release-contract 수준의 transport parity 검증이 추가된다

Estimated effort:

- Medium

## Alternative Approaches Considered

### Approach A: Original + Normalized Signal Blending

선택안이다. 원문 query를 버리지 않고 normalized supplement를 bounded retrieval/score signal로 추가한다. 브레인스토밍에서 합의한 “원문 유지, 내부 보정 허용, 둘을 비슷한 비중으로 섞는다”는 결정과 가장 잘 맞는다 (see brainstorm: `docs/brainstorms/2026-03-19-korean-query-question-normalization-brainstorm.md`).

### Approach B: Internal Structured Expansion

plain query를 내부적으로 multi-lane structured query처럼 확장하는 안이다. recall 잠재력은 더 크지만, 현재 surface 대비 explain/MCP/parity 계약이 너무 커진다. v1 목표에 비해 공격적이어서 보류한다 (see brainstorm: `docs/brainstorms/2026-03-19-korean-query-question-normalization-brainstorm.md`).

### Approach C: Question-Specific Rescue Only

기존 base query를 그대로 두고 question-like input에서만 post-hoc rescue를 추가하는 안이다. 가장 안전하지만 개선 폭이 작고, 사용자가 원한 “긴 한국어 plain query 전반” 범위에 비해 지나치게 소극적이다 (see brainstorm: `docs/brainstorms/2026-03-19-korean-query-question-normalization-brainstorm.md`).

## System-Wide Impact

### Interaction Graph

- CLI path:
  `handleQueryCommand()` -> `parseOwnedQueryInput()` -> `executeQueryCore()` -> `classifyQuery()` -> `buildQueryNormalizationPlan()` -> `buildPlainQuerySearchRequest()` -> `executeOwnedQuerySearch(original)` -> `maybeRunNormalizedSupplement()` -> `resolveQuerySearchAssist()` -> `rankQueryRows()` -> `formatSearchExecutionResult()`
- MCP path:
  `buildQueryInputFromRequest()` -> `executeQueryCore()` -> `buildQueryResponse()`
- Benchmark path:
  `scripts/measure_query_recall.ts` -> `resolveBenchmarkContext()` -> `executeOwnedQuerySearch()` / `executeQueryCore()` -> report generation

Normalization은 새 storage/state write를 만들지 않지만, query orchestration과 output shaping, benchmark semantics를 모두 건드리므로 read-path 전체 surface에 파급된다.
또한 ordering guardrail은 `collection resolution -> classification -> normalization plan -> base retrieval -> normalized supplement -> search-assist -> ranking -> transport shaping`으로 고정하는 편이 이후 drift를 줄인다.

### Error & Failure Propagation

- normalization helper failure는 feature-local failure여야 하며, query 전체 runtime failure가 되어서는 안 된다
- original retrieval가 성공했다면 normalized retrieval/search-assist 에러는 query 전체를 깨지 않고 original-only success로 degrade 해야 한다
- normalization skip reason은 validation error가 아니라 advisory/debug metadata 수준으로 다룬다
- explain/MCP shaping error는 결과 row leak보다 fail-closed가 낫다. allowlist 밖 필드는 serialize하지 않는다
- synchronous SQLite/FTS path에는 pseudo-timeout을 의미 보호장치처럼 붙이지 않는다

### State Lifecycle Risks

- 이 feature는 read-only 경로다. DB schema, shadow index, metadata write는 추가하지 않는다
- persistent adaptive memory나 query-history cache를 도입하지 않는다
- normalization path는 새 store open, config-file reopen, config sync side effect를 만들지 않는다
- state risk의 중심은 persistent corruption이 아니라 query latency amplification, output drift, benchmark claim drift다

### API Surface Parity

- CLI plain `query`
- MCP tool `query`
- HTTP `/query` alias
- HTTP `/search` alias가 같은 helper를 재사용하는지 여부도 확인 대상에 포함한다
- `--json` / CLI explain / MCP structured payload
- benchmark JSON schema

이 중 하나라도 normalization summary나 skip reason을 다르게 다루면, 바로 parity drift가 생긴다. 따라서 same input mode에서 same core semantics를 공유해야 하고, validation/response shaping helper도 transport별로 분리하지 않는다.

### Integration Test Scenarios

1. 긴 한국어 plain question이 original-only path에서는 miss 또는 low rank였지만, normalization supplement 이후 top-5 hit가 되는 native fixture
2. 한국어 질문 + 영문 기술어 혼합 query에서 영어 literal token이 normalization 이후에도 유지되는 fixture
3. quoted/negated Hangul question이 normalization을 skip 하고 current semantics를 유지하는 control case
4. MCP plain query가 CLI와 같은 normalization summary/queryClass/searchAssist 조합을 반환하는 transport parity case
5. normalization helper가 empty/same-as-original를 반환할 때 original-only query가 current와 동일한 결과를 내는 fail-open case
6. path-like literal query는 전체 skip 되지만, 한국어 long query 안의 path/code token은 preserve 되는 fixture
7. normalized retrieval가 runtime error를 내도 original-only success로 돌아오는 fixture
8. normalization applied이지만 added-candidate 0 / top-5 unchanged인 정상 성공 fixture
9. input size budget 초과로 normalization skip 또는 validation error가 발생하는 fixture

## Acceptance Criteria

### Functional Requirements

- [x] owned `query`는 긴 한국어 plain query와 한국어 + 영문 기술어 혼합 long query에서 normalization eligibility를 계산한다
- [x] v1은 원문 query를 유지하고, normalized query를 bounded supplement로만 사용한다
- [x] `QueryClass` enum 값은 v1에서 유지되고, long-query contract는 별도 `QueryNormalizationPlan`/summary로 표현된다
- [x] structured query, quoted query, negated query, path-like literal query, general English query는 normalization 대상에서 제외된다
- [x] URL, 이메일, UUID, hash, base64/hex 긴 문자열, secret-like token이 감지되면 normalization은 skip 하거나 해당 토큰을 immutable로 둔다
- [x] normalized pass는 original과 같은 collection resolution, syntax mode, query mode를 사용하고 바꾸는 것은 검색 텍스트뿐이다
- [x] normalized supplement와 current search-assist는 dedupe/ordering contract 아래 함께 동작한다
- [x] normalization helper failure, empty normalization, same-as-original normalization, normalized retrieval runtime error는 original-only success로 fail-open 한다
- [x] `applied=true`지만 결과 개선이 없는 경우도 정상 성공으로 간주한다
- [x] normalization summary는 `not_eligible`, `applied`, `skipped_guard`, `skipped_same_or_empty`, `failed_open`, `latency_budget` 수준의 coarse enum으로 닫힌다

### Non-Functional Requirements

- [x] normalization helper는 pure function이며 no-network/no-bootstrap/no-persistent-memory를 유지하고 기존 owned store session만 재사용한다
- [x] input size budget (`maxBytes`, `maxChars`, `maxTokens`)과 regex/tokenizer work budget을 CLI/MCP/HTTP 공통으로 강제한다
- [x] extra retrieval는 1회로 제한하고, normalized fetch window는 `min(baseFetchLimit / 2, limit + 8)` 이하의 bounded max를 가진다
- [x] base top-3 strong hit가 있거나 latency budget이 이미 소진되면 normalized pass를 자동 skip 한다
- [x] JSON/MCP/CLI explain은 allowlisted coarse normalization summary만 노출하며 raw normalized query, dropped terms, debug traces는 숨긴다
- [x] existing spacing/compound/mixed core cases와 control cases는 regression 없이 유지된다

### Quality Gates

- [x] `bun run test -- query-classifier query-core query-ranking query-output-security query-output mcp-query mcp-server mcp-http`
- [x] `bun run test:release-contract`
- [x] `bun run measure:query-recall`
- [x] long-query/question aggregate가 deterministic fixture와 stable JSON schema를 가진다
- [x] explain snapshot이 normalization branch를 포함해 dedicated fixture로 고정된다
- [x] benchmark는 same dataset, same collection scope, same explain mode 비교 계약을 따른다

## Success Metrics

- long-query/question aggregate에서 top-5 recall이 current baseline보다 개선된다
- new long-query category의 unresolved miss count가 문서에 그대로 드러난다
- existing spacing/compound/mixed core aggregate는 non-regression을 유지한다
- negative control pass rate는 100%를 유지한다
- normalized supplement가 켜지는 eligible case 수와 added-candidate count가 benchmark에서 해석 가능하게 기록된다
- eligible long-query case 기준 `overheadMs` p50/p95와 `latencyBudgetSkipRate`가 기록된다

## Dependencies & Risks

### Risk 1: Over-normalization erases user intent

질문 tail이나 조사 제거가 과하면 original query의 중요한 의미를 잃을 수 있다.

Mitigation:

- original query는 항상 baseline으로 유지한다
- normalized query가 empty/too-short/same-as-original이면 skip 한다
- retained token 수가 과도하게 줄어드는 case도 skip 한다
- dropped-token history를 external contract로 노출하지 않고, explain은 summary 수준으로만 유지한다

### Risk 2: QueryClass contract drift

새 long-query class를 enum에 추가하면 MCP/benchmark/fixtures가 광범위하게 흔들릴 수 있다.

Mitigation:

- v1은 `QueryClass`를 유지한다
- eligibility/summary는 별도 metadata로 표현한다
- 필요하면 future consideration에서 new class를 재평가한다

### Risk 3: Hot-path latency amplification

extra retrieval 1회가 query latency를 체감적으로 늘릴 수 있다.

Mitigation:

- eligibility gate를 엄격히 둔다
- base-result dynamic gate를 추가한다
- normalized retrieval는 1회만 허용하고 더 낮은 fetch window와 `normalizedRescueCap`을 사용한다
- latency budget이 부족하면 normalized pass를 skip 한다
- current controls와 함께 benchmark에 long-query latency/overhead 해석 메모를 남긴다

### Risk 4: Explain/MCP payload drift

normalization provenance를 어디에 어떻게 싣는지 명확하지 않으면 user-visible contract가 쉽게 어긋난다.

Mitigation:

- query-level summary allowlist를 먼저 고정한다
- CLI explain snapshot과 MCP contract tests를 같이 추가한다
- internal debug data는 절대 broad object spread로 serialize하지 않는다

### Risk 5: Input-size / DoS amplification

긴 query와 추가 retrieval 조합이 regex/tokenizer 비용과 DB search 비용을 함께 키울 수 있다.

Mitigation:

- `maxBytes`, `maxChars`, `maxTokens`를 공통 validation으로 둔다
- request deadline/latency budget을 기준으로 normalized pass를 자동 skip 한다
- MCP/HTTP request concurrency cap과 supplement budget을 함께 정의한다
- synchronous path에 pseudo-timeout을 의미 보호장치처럼 쓰지 않는다

### Risk 6: Output/privacy leakage

normalized query나 dropped token 목록이 JSON/MCP/benchmark/telemetry에 남으면 불필요한 query transformation detail이 외부로 새어 나갈 수 있다.

Mitigation:

- external schema는 coarse enum + count 수준으로 최소화한다
- raw original/normalized query는 benchmark fixture와 report에서 synthetic/redacted sample만 허용한다
- query text 자체를 telemetry/aggregate 지표에 저장하지 않는다

### Risk 7: Benchmark claim inflation

question bucket을 기존 core aggregate에 섞으면 이전 recall 숫자와 새 feature 숫자가 뒤섞여 해석이 흐려질 수 있다.

Mitigation:

- long-query/question aggregate는 별도 섹션으로 승격한다
- 기존 spacing/compound/mixed core aggregate는 유지한다
- README claim은 별도 gate를 통과할 때만 확장한다

## Future Considerations

- normalization pass를 내부 structured expansion으로 일반화하는 후속 작업
- long-query/question category를 main product recall aggregate에 포함할지 재평가
- query normalization rules를 corpus-independent stop-phrase registry로 정리하는 후속 작업
- question-like input에 대한 explicit `intent` or `why/how` semantic rewrite 연구

## Documentation Plan

- `docs/plans/2026-03-19-feat-long-korean-plain-query-normalization-plan.md`
  - 이번 구현 계획의 canonical source
- `docs/architecture/kqmd-command-boundary.md`
  - owned `query`의 long Korean plain query normalization guardrail 추가
  - `collection resolution -> classification -> normalization plan -> base retrieval -> normalized supplement -> search-assist -> ranking -> transport shaping` ordering guardrail 문서화
- `docs/development.md`
  - query-related verification command 표에 long-query benchmark guidance 반영
- `docs/benchmarks/2026-03-19-query-recall-metrics.md`
  - question/long-query aggregate, overhead metrics, privacy-safe interpretation note 추가
- `README.md`
  - 안정적인 claim gate를 통과한 경우에만 query description 확장

## Sources & References

### Origin

- **Brainstorm document:** `docs/brainstorms/2026-03-19-korean-query-question-normalization-brainstorm.md`
  - Carried-forward decisions:
    - 긴 한국어 plain query 전반과 한국어 + 영문 기술어 혼합 query를 다룬다
    - 원문 query를 유지하면서 normalized query를 보조 신호로 함께 쓴다
    - original과 normalized는 비슷한 비중으로 섞되, 공격적인 rewrite는 v1에서 제외한다

### Internal References

- Architecture boundary: `docs/architecture/kqmd-command-boundary.md`
- Query classifier contract: `src/commands/owned/query_classifier.ts:15`
- Query core orchestration: `src/commands/owned/query_core.ts:52`
- Search-assist eligibility boundary: `src/commands/owned/query_search_assist_policy.ts:49`
- MCP plain query shaping: `src/mcp/query.ts:151`
- Existing question benchmark cases: `scripts/measure_query_recall.ts:239`

### Institutional Learnings

- `docs/solutions/logic-errors/korean-query-search-assist-rescue-kqmd-cli-20260319.md`
- `docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`
- `docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md`
- `docs/solutions/logic-errors/owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md`
- `docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`
- `docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`

### External References

- SQLite FTS5 query syntax and tokenizer semantics: [https://sqlite.org/fts5.html](https://sqlite.org/fts5.html)
- Vespa phased ranking and bounded `rerank-count`: [https://docs.vespa.ai/en/ranking/phased-ranking.html](https://docs.vespa.ai/en/ranking/phased-ranking.html)
