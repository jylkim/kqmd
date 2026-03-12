---
title: feat: Add Kiwi-backed Korean lexical recall for search
type: feat
status: completed
date: 2026-03-12
origin: docs/brainstorms/2026-03-12-korean-search-recall-brainstorm.md
---

# feat: Add Kiwi-backed Korean lexical recall for search

## Enhancement Summary

**Deepened on:** 2026-03-12  
**Sections enhanced:** 6  
**Research inputs:** local repo architecture/docs/tests, `docs/solutions/*` institutional learnings, official SQLite FTS5 documentation, official Kiwi repository/WASM binding docs, `kiwi-nlp` package metadata

### Key Improvements

1. upstream `documents_fts` 직접 재작성안을 버리고, same-DB shadow FTS ownership으로 계획을 조정했다.
2. `search` clean/stale path를 명확히 나눠, shadow index와 legacy `searchLex()` fallback의 기준을 plan에 고정했다.
3. SQLite transaction, rowid coupling, drift detection, benchmark 항목을 명시해 구현 리스크를 더 구체화했다.

### New Considerations Discovered

- SQLite FTS5 문서상 external content/sync model은 consistency drift 위험이 분명해서, upstream-owned FTS를 직접 덮어쓰는 안은 생각보다 더 취약하다.
- separate shadow DB file은 isolation은 강하지만, 현재 K-QMD의 zero-config path와 단일 source-of-truth 성격에는 same-DB shadow table보다 불리하다.
- query grammar parity는 한국어 recall 확대보다 우선순위가 높아서, quoted/negated edge case는 local adapter나 conservative fallback으로 다뤄야 한다.

## Overview

K-QMD의 다음 구현 슬라이스는 `qmd search`의 한국어 lexical recall 미탐을 줄이기 위해, Kiwi 기반 한국어 토큰화를 owned `search`와 `update`에 도입하는 것이다. 이번 작업의 목적은 vector DB나 `query`를 더 손보는 것이 아니라, 현재 whitespace 기반 lexical indexing 때문에 `형태소 분석`/`형태소분석기`, `모델`/`거대언어모델`처럼 아예 찾지 못하는 문서를 찾게 만드는 데 있다 (see brainstorm: `docs/brainstorms/2026-03-12-korean-search-recall-brainstorm.md`).

이 계획은 새 한국어 검색 엔진을 만드는 작업이 아니다. 기존 upstream FTS5 기반 lexical search를 유지하되, K-QMD가 소유한 `search`, `update`, `status` 경계 안에서 한국어 토큰 정책과 인덱스 정책 mismatch UX를 추가하는 작업이다. 사용자 사전, 랭킹 전면 재설계, 별도 Korean-only index는 첫 릴리스 범위 밖으로 남긴다 (see brainstorm: `docs/brainstorms/2026-03-12-korean-search-recall-brainstorm.md`).

## Problem Statement / Motivation

현재 owned `search`는 `session.store.searchLex()`를 그대로 호출하는 lexical-only 경로이며, query preprocessing이나 Korean-aware indexing이 없다 (`src/commands/owned/search.ts`). upstream `@tobilu/qmd`는 `documents_fts`를 `tokenize='porter unicode61'`로 생성하고, `documents`/`content`에서 raw text를 그대로 넣는다 (`node_modules/@tobilu/qmd/dist/store.js`). 이 구조는 영어와 prefix match에는 충분하지만, 한국어 붙여쓰기, 복합명사, 합성어 경계에는 취약하다.

또한 current `update`는 upstream `session.store.update()`만 수행하므로, lexical 인덱스 정책을 K-QMD product policy로 관리할 진입점이 없다 (`src/commands/owned/update.ts`). 기존 embedding rollout은 `src/config/embedding_policy.ts`, `src/commands/owned/embedding_health.ts`, `src/commands/owned/status.ts`를 통해 "canonical policy + health classification + status/advisory UX" 패턴을 이미 만들었다. 이번 기능은 그 패턴을 검색 인덱스에도 적용해야 한다. 사용자가 이미 agreed한 방향은 "재색인은 허용하되, 조용한 fallback이나 과도한 구조 변경은 피한다"는 것이다 (see brainstorm: `docs/brainstorms/2026-03-12-korean-search-recall-brainstorm.md`).

이번 계획의 핵심 동기는 세 가지다.

- 한국어 lexical recall 문제를 vector path와 분리해서 가장 작은 고리부터 닫는다.
- 기존 `manifest -> runtime -> handler -> formatter` 구조를 유지하면서 K-QMD product policy를 추가한다.
- 기존 embedding mismatch UX처럼, legacy index와 current policy가 어긋날 때 조용히 품질이 흔들리지 않게 상태와 복구 경로를 명확히 드러낸다.

## Local Research Findings

- [`src/commands/owned/search.ts`](/Users/jylkim/kqmd/src/commands/owned/search.ts#L24) 는 현재 collection 해석 뒤 `session.store.searchLex()`만 호출하는 lexical-only read path다. 한국어 query expansion이나 Korean-aware indexing seam은 아직 없다.
- [`src/commands/owned/update.ts`](/Users/jylkim/kqmd/src/commands/owned/update.ts#L36) 는 지금 `session.store.update()`와 embedding follow-up guidance만 담당한다. lexical policy rollout을 붙이기 가장 자연스러운 mutation seam이 이미 여기에 있다.
- upstream QMD는 [`documents_fts`](/Users/jylkim/kqmd/node_modules/@tobilu/qmd/dist/store.js#L587) 를 `tokenize='porter unicode61'`로 만들고, [`documents`/`content` raw text를 trigger로 그대로 넣는다](/Users/jylkim/kqmd/node_modules/@tobilu/qmd/dist/store.js#L594). 따라서 한국어 recall 개선은 search 호출부만 바꿔서는 부족하고, update 이후 K-QMD-owned shadow projection을 다시 만들어야 한다.
- public SDK는 [`QMDStore.internal`](/Users/jylkim/kqmd/node_modules/@tobilu/qmd/dist/index.d.ts#L111) 를 advanced API로 노출하고 있고, upstream DB에는 이미 [`store_config`](/Users/jylkim/kqmd/node_modules/@tobilu/qmd/dist/store.js#L580) key-value metadata 경로가 있다. search policy metadata는 새 테이블보다 이 경로를 재사용하는 편이 현재 저장소 패턴과 더 잘 맞는다.
- 기존 embedding rollout은 [`src/config/embedding_policy.ts`](/Users/jylkim/kqmd/src/config/embedding_policy.ts), [`src/commands/owned/embedding_health.ts`](/Users/jylkim/kqmd/src/commands/owned/embedding_health.ts#L57), [`src/commands/owned/status.ts`](/Users/jylkim/kqmd/src/commands/owned/status.ts#L26) 조합으로 “canonical policy + health classification + status/advisory UX” 패턴을 이미 만들었다. 이번 search policy도 같은 shape로 두는 편이 일관적이다.
- institutional learnings 기준으로는 `runtime policy를 command별로 분리한다`, `warning scope는 실제 실행 범위와 같아야 한다`, `machine-readable stdout에 advisory를 섞지 않는다`는 패턴이 반복된다 (`docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`, `docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`, `docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`).

## Research Decision

로컬 컨텍스트는 충분히 강해서 broad한 external research는 생략한다. 다만 `Kiwi`는 저장소에 아직 없는 외부 의존성이므로, 공식 Kiwi 저장소와 WASM/JS 배포 경로만 확인해 “TypeScript CLI에 붙일 수 있는 공식 진입점이 존재하는가”를 검증한다. 그 결과 첫 계획은 `Kiwi` 도입 자체보다, 이를 현재 `search/update/status` 경계와 `store_config` metadata pattern 안에 어떻게 안전하게 넣을지에 집중한다.

## Chosen Approach

추천 구현은 `Approach A`를 그대로 따른다. 즉, Kiwi를 이용해 문서와 검색어에 동일한 한국어 토큰 정책을 적용하고, lexical index policy metadata를 DB에 기록해 `status/search/update`가 현재 인덱스 상태를 설명하도록 만든다 (see brainstorm: `docs/brainstorms/2026-03-12-korean-search-recall-brainstorm.md`).

해결책은 네 레이어로 나눈다.

1. **Canonical Korean search policy**
   `src/config/search_policy.ts` 같은 모듈에 현재 K-QMD가 채택한 Korean lexical policy ID를 정의한다. 첫 버전은 `Kiwi + no user dictionary + original text preserved + analyzed tokens appended` 같은 고정 정책으로 시작한다. embedding model처럼 env override는 두지 않고, K-QMD default product policy로만 둔다.

2. **Kiwi-backed shadow lexical projection**
   SQLite FTS tokenizer를 교체하지 않고, upstream `documents_fts`도 직접 덮어쓰지 않는다. 대신 K-QMD가 같은 SQLite 안에 별도 shadow FTS table을 소유하고, Hangul이 포함된 title/body/path를 Kiwi로 분석해 raw text + analyzed tokens projection을 여기에 저장한다. 검색어도 같은 규칙으로 확장하되, clean 상태에서만 K-QMD shadow index를 사용한다.

3. **Search index policy health / mismatch UX**
   `store_config` 같은 DB metadata에 current lexical policy ID를 저장하고, 이를 읽는 `search_index_health` helper를 추가한다. `status`는 search policy health를 보여 주고, `search`는 shadow index가 stale/missing일 때 stderr warning을 출력한 뒤 legacy `searchLex()` path로 fallback 한다. `update`는 mismatch나 최초 rollout 상태를 만나면 K-QMD shadow index를 full rebuild해 current policy로 정규화한다.

4. **YAGNI boundary preservation**
   첫 릴리스에서는 user dictionary, synonym dictionary, Korean-specific ranking, `query` path 변경, 별도 search engine migration을 하지 않는다. 또한 separate shadow DB file까지는 도입하지 않는다. Kiwi 초기화 실패 시 K-QMD shadow index clean path를 사용할 수 없으므로, policy가 clean이라고 보장되지 않는 상황에서는 명시적 오류 또는 legacy fallback warning으로 드러내고 조용히 성공한 척하지 않는다.

이 접근의 핵심 차별점은 “새 search engine을 추가하는 것”이 아니라 “upstream `documents_fts`는 손대지 않고, 같은 DB 안의 K-QMD-owned shadow FTS projection으로 한국어 recall을 올린다”는 점이다. 이렇게 하면 current `search` formatter, output precedence, collection filtering, score normalization은 크게 유지하면서도, upstream FTS schema drift가 곧바로 local data corruption으로 이어지는 위험을 줄일 수 있다.

### Research Insights

**Best Practices:**

- upstream-owned schema는 read-only baseline으로 두고, product-specific indexing은 별도 ownership boundary를 갖는 table로 분리하는 편이 drift 대응이 쉽다.
- policy metadata는 data table과 같은 transaction 안에서 기록해야 한다. 그렇지 않으면 `status`가 clean/stale를 잘못 말할 수 있다.
- fallback path는 availability를 위한 예외 경로로만 두고, clean path와 같은 성공처럼 보이게 만들면 안 된다.

**Implementation Details:**

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS kqmd_documents_fts USING fts5(
  filepath,
  title,
  body,
  tokenize = 'unicode61'
);

INSERT INTO kqmd_documents_fts(rowid, filepath, title, body)
VALUES (?, ?, ?, ?);
```

**Edge Cases:**

- shadow index가 clean이 아닌데도 search가 shadow path를 계속 쓰면 stale results가 user-visible regression으로 굳을 수 있다.
- rowid를 `documents.id`와 맞추지 않으면 documents/content join과 delete/update cleanup이 복잡해진다.
- policy가 바뀌었는데 rebuild가 안 된 상태를 `status`가 clean으로 보여 주면 recovery UX 전체가 무너진다.

**References:**

- SQLite FTS5 docs: <https://sqlite.org/fts5.html>
- Kiwi repository: <https://github.com/bab2min/Kiwi>

## Technical Approach

### Architecture

이번 슬라이스에서 추가 또는 수정될 핵심 파일은 아래와 같다.

- `src/config/search_policy.ts`
  - current Korean lexical policy ID와 display text를 정의한다.
  - 예: `KQMD_DEFAULT_SEARCH_POLICY = { id: 'kiwi-v1', tokenizer: 'kiwi', dictionary: 'none' }`
- `src/commands/owned/search_index_health.ts`
  - `store_config`에서 stored search policy를 읽어 `clean`, `untracked-index`, `policy-mismatch` 같은 상태를 계산한다.
  - `embedding_health.ts`와 naming / return-shape 패턴을 맞춘다.
- `src/commands/owned/kiwi_tokenizer.ts`
  - `kiwi-nlp` 초기화를 lazy singleton으로 감싼다.
  - Hangul 포함 여부를 보고 Korean analysis가 필요한 텍스트만 처리한다.
- `src/commands/owned/search_shadow_index.ts`
  - active documents를 읽어 `kqmd_documents_fts` shadow projection을 rebuild/query 한다.
  - policy metadata write까지 transaction 안에서 묶는다.
- `src/commands/owned/update.ts`
  - upstream `session.store.update()` 뒤에 shadow index rebuild pass를 붙인다.
  - stored policy mismatch 또는 최초 rollout이면 full rebuild를 수행한다.
- `src/commands/owned/search.ts`
  - query preprocessing과 search policy warning을 추가한다.
  - clean 상태면 shadow index query helper를 사용하고, stale/missing 상태면 legacy `searchLex()`로 fallback 한다.
  - stdout output contract는 유지하고, warning은 stderr에만 둔다.
- `src/commands/owned/status.ts`
  - embedding health와 별개로 search index policy health를 함께 surface 한다.
- `src/commands/owned/io/types.ts`, `src/commands/owned/io/format.ts`
  - status output model에 search policy section을 추가한다.
  - `search --json/--xml/...` stdout을 오염시키지 않도록 stderr warning branch를 유지한다.
- `test/*`
  - policy helper tests, update migration tests, search recall tests, status snapshot tests, parity and smoke regression tests를 추가/갱신한다.

### Data / DB Strategy

upstream `documents_fts`는 fallback/read-only baseline으로 유지하고, K-QMD는 같은 SQLite 파일 안에 별도 shadow FTS projection을 만든다. 첫 구현의 기본안은 `kqmd_documents_fts(filepath, title, body)` 같은 K-QMD-owned FTS virtual table이다.

- upstream DB schema facts:
  - `documents_fts(filepath, title, body)`는 FTS5 virtual table이다 (`node_modules/@tobilu/qmd/dist/store.js`).
  - upstream triggers는 `documents`/`content` raw text를 `documents_fts`에 동기화한다.
  - public SDK는 `QMDStore.internal`을 통해 advanced DB access를 허용한다 (`node_modules/@tobilu/qmd/dist/index.d.ts`).
- K-QMD policy:
  - `update` 직후, active docs 전체를 기준으로 `kqmd_documents_fts` projection을 재생성한다.
  - projection payload는 raw text + Korean analyzed tokens를 함께 포함한다.
  - `store_config`에 `kqmd_search_policy_id=<current-policy>`와 shadow index metadata를 기록한다.
  - shadow rebuild와 metadata write는 transaction으로 묶어 partial state를 줄인다.
  - upstream `documents_fts` 내용과 schema는 직접 변경하지 않는다.

separate shadow DB file도 대안으로 고려했지만, v1에서는 채택하지 않는다. 이유는 두 파일 사이의 atomicity 보장, zero-config path 관리, DB-only reopen semantics, status/update의 source-of-truth 분리가 한꺼번에 복잡해지기 때문이다. 현재 저장소 구조에서는 **same-DB shadow table**이 isolation과 운영 단순성의 균형점이다.

첫 릴리스의 기본 전략은 **partial incremental update보다 full shadow rebuild를 우선**하는 것이다. `session.store.update()`는 changed hash 목록을 주지 않으므로, policy-aware patch update를 억지로 만들면 state drift와 partial failure 위험이 커진다. 현재 요구는 recall correctness이며, performance micro-optimization은 이후 단계로 미룬다.

### Research Insights

**Best Practices:**

- SQLite FTS5 공식 문서는 content/external-content 모델의 sync 책임이 애플리케이션 쪽에 있음을 분명히 한다. K-QMD가 ownership을 가지려면 upstream-owned FTS를 덮어쓰기보다 별도 shadow table이 더 안전하다.
- 같은 DB 안의 shadow table은 `store_config` metadata와 rebuild를 하나의 transaction으로 묶을 수 있어서, separate DB보다 consistency 관리가 단순하다.
- full rebuild를 택하더라도 prepared statement와 단일 transaction을 쓰면 correctness-first v1로는 충분히 방어적이다.

**Performance Considerations:**

- 최소 benchmark 항목을 plan에 넣어야 한다.
- cold path: Kiwi lazy init latency
- warm path: 1k/10k documents shadow rebuild 시간
- read path: clean shadow search와 legacy fallback search latency 비교

**Implementation Details:**

```sql
BEGIN IMMEDIATE;
DELETE FROM kqmd_documents_fts;
-- batched INSERT INTO kqmd_documents_fts(rowid, filepath, title, body) ...
INSERT INTO store_config (key, value)
VALUES ('kqmd_search_policy_id', ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
COMMIT;
```

**Edge Cases:**

- rebuild 중 crash가 나면 shadow table과 metadata가 함께 rollback 되는지 검증해야 한다.
- no-doc index에서는 metadata 없음이 곧 mismatch를 뜻하지 않도록 zero-doc branch가 필요하다.
- selected collections search는 global metadata만 보지 말고, 최소한 shadow table 존재와 rebuild completeness를 collection filter와 함께 검토해야 한다.

**References:**

- SQLite FTS5 docs: <https://sqlite.org/fts5.html>

### Query / Token Strategy

첫 릴리스의 query preprocessing 기본값은 아래와 같다.

- Hangul이 없는 query는 기존 lexical query를 그대로 사용한다.
- Hangul이 있는 query는 Kiwi로 분석해 token expansion을 만든다.
- raw query를 버리지 않고, raw lex term과 analyzed tokens를 함께 넣는다.
- phrase/negation 같은 existing lexical syntax는 가능한 한 유지하되, Korean analysis는 plain term path에만 적용한다.

예시 방향:

```ts
// src/commands/owned/kiwi_tokenizer.ts
export function buildLexicalSearchText(raw: string, analyzedTokens: string[]): string {
  return [raw, ...analyzedTokens].filter(Boolean).join(' ');
}
```

```ts
// src/commands/owned/search.ts
const expandedQuery = containsHangul(input.query)
  ? await buildKoreanAwareLexQuery(input.query)
  : input.query;

const results = health.kind === 'clean'
  ? await searchKoreanShadowIndex(session.store.internal.db, expandedQuery, { ... })
  : await session.store.searchLex(input.query, { ... });
```

중요한 기본값은 "영어/코드 검색을 최대한 덜 흔드는 것"이다. 따라서 Korean-specific expansion은 Hangul presence가 있을 때만 적용하고, raw term도 계속 남겨 둔다.

### Research Insights

**Best Practices:**

- Korean expansion은 plain term path에 우선 적용하고, quoted/negated syntax는 current lexical semantics를 보존하는 쪽으로 더 보수적으로 다루는 편이 안전하다.
- raw query를 버리지 않고 analyzed tokens를 append하는 방식이 mixed Korean/English query regression을 줄이기 쉽다.
- `search --json/--csv/--xml`는 machine-readable contract가 더 중요하므로, warning copy는 formatter 밖 stderr branch로만 둬야 한다.

**Implementation Details:**

```ts
const health = await readSearchIndexHealth(session.store, currentPolicy);
const searchQuery = containsHangul(input.query)
  ? await buildKoreanAwareLexQuery(input.query)
  : input.query;

const rows = health.kind === 'clean'
  ? await searchKoreanShadowIndex(session.store.internal.db, searchQuery, selectedCollections, fetchLimit)
  : await session.store.searchLex(input.query, { limit: fetchLimit, collection: singleCollection });
```

**Edge Cases:**

- `"형태소 분석"` 같은 quoted query는 token expansion이 phrase semantics를 깨지 않는지 별도 fixture로 고정해야 한다.
- `-모델` 같은 negation query는 v1에서 Korean expansion보다 upstream semantics 보존을 우선해야 한다.
- query text에 Hangul/ASCII/code token이 섞일 때 token ordering이 bm25 결과를 과하게 흔들지 않는지 확인해야 한다.

**References:**

- SQLite FTS5 docs: <https://sqlite.org/fts5.html>
- Kiwi WASM binding README: <https://github.com/bab2min/Kiwi/tree/main/bindings/wasm>

## SpecFlow Findings

이번 기능의 핵심 흐름은 다섯 가지다.

### Flow 1: Fresh install / current policy happy path

1. 사용자가 `qmd update`를 실행한다.
2. owned `update`는 upstream 문서 스캔을 수행한 뒤, current Kiwi policy로 `kqmd_documents_fts` shadow projection을 재구성한다.
3. `store_config`에 current search policy ID가 기록된다.
4. 사용자가 `qmd search`를 실행하면 search는 추가 경고 없이 current shadow index를 사용한다.
5. `qmd status`는 embedding health와 search policy health를 함께 clean으로 보여 준다.

### Flow 2: Existing legacy index after rollout

1. 사용자가 policy metadata가 없는 기존 DB에서 `qmd status`를 실행한다.
2. `status`는 clean이라고 말하지 않고 `untracked-index` 또는 mismatch 상태를 드러낸다.
3. 사용자가 `qmd search`를 실행하면 결과는 계속 반환하되 stderr advisory가 같이 나온다.
4. 사용자가 `qmd update`를 실행하면 current policy payload와 metadata로 정규화된다.
5. 이후 `status`와 `search`는 clean path로 돌아간다.

### Flow 3: Machine-readable search output

1. 사용자가 `qmd search --json ...` 또는 `--csv/--xml`을 실행한다.
2. search policy mismatch나 advisory copy가 있어도 stdout shape는 기존 formatter contract를 유지한다.
3. warning은 stderr에만 출력된다.

### Flow 4: Kiwi initialization or rebuild failure

1. `search` 또는 `update`가 Kiwi runtime을 필요로 하는 시점에 초기화 실패가 발생한다.
2. `update`는 policy가 적용된 척 조용히 진행하지 않고 explicit execution error로 실패한다.
3. `search`는 clean shadow path를 못 쓰는 상황이면 warning과 함께 legacy fallback 여부를 health 기준으로 결정한다.
4. 이미 문서 갱신이 일어난 뒤 실패할 수 있는 경로는 transaction과 preflight로 최대한 줄인다.

### Flow 5: Query syntax edge cases

1. 사용자가 quoted phrase나 negation 같은 lexical syntax를 사용한다.
2. v1에서는 upstream search syntax 보존이 recall 확대보다 우선한다.
3. 따라서 Korean expansion이 exact phrase/negation semantics를 훼손할 가능성이 있으면 plain-term path에만 적용하거나, 해당 케이스는 current syntax semantics를 우선하는 fallback을 둔다.

### Defaults To Lock In

- 첫 릴리스의 remediation command는 새 flag가 아니라 `qmd update` 하나로 둔다.
- 첫 릴리스의 rebuild 범위는 changed-doc optimization보다 full shadow rebuild를 우선한다.
- `query` path는 lexical policy rollout과 분리하고, 이번 feature에서 behavior drift를 허용하지 않는다.
- Korean expansion은 Hangul presence가 있을 때만 적용하고, raw query/raw document text를 항상 보존한다.
- search policy warning은 availability를 위해 결과와 공존할 수 있지만, stdout formatter와 섞이면 안 된다.

### Mismatch / Recovery UX

이번 기능의 mismatch UX는 embedding rollout에서 이미 검증한 product policy를 따른다 (`src/config/embedding_policy.ts`, `src/commands/owned/embedding_health.ts`, `src/commands/owned/status.ts`, `docs/plans/2026-03-12-feat-qwen-default-embedding-rollout-plan.md`).

- `status`
  - search index policy health를 user-visible source of truth로 보여 준다.
  - zero-config environment에서도 status 자체는 깨지지 않아야 한다 (`docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`).
- `search`
  - shadow index mismatch가 있어도 결과는 반환한다.
  - warning은 stderr에만 출력한다.
  - fallback은 legacy `searchLex()`에만 한정하고, clean shadow path에서는 local shadow query helper를 사용한다.
  - `--json`, `--csv`, `--xml` 등 machine-readable stdout은 보존한다.
- `update`
  - current policy와 다르면 shadow projection full rebuild를 수행해 mismatch를 해소한다.
  - rebuild 후 stored policy metadata를 current policy로 갱신한다.
- `query`
  - 이번 슬라이스에서는 lexical search policy와 무관하므로 변경하지 않는다.

복구 명령은 `qmd update` 하나로 통일한다. embedding policy와 달리 별도 `--force` UX를 만들지 않는다. 이유는 lexical policy remediation path가 이미 `update`이기 때문이다. 새로운 flag를 추가하면 owned CLI parity 범위와 scope가 불필요하게 커진다.

### Implementation Phases

#### Phase 1: Policy and tokenizer foundation

- `kiwi-nlp` dependency를 추가하고 Node 24 환경에서 초기화 경로를 검증한다.
- `src/config/search_policy.ts`를 추가한다.
- `src/commands/owned/kiwi_tokenizer.ts`를 추가해 lazy singleton / Hangul detection / token augmentation helper를 정의한다.
- `src/commands/owned/search_index_health.ts`를 추가한다.
- initial unit tests:
  - Hangul detection
  - token augmentation shape
  - search policy health classification
  - zero-doc / no-metadata / mismatch 상태

#### Phase 2: Update-time lexical rebuild and metadata persistence

- `src/commands/owned/update.ts` 뒤에 shadow lexical rebuild helper를 연결한다.
- rebuild helper는 `documents`, `content`, `kqmd_documents_fts`, `store_config`를 transaction 안에서 다룬다.
- current policy mismatch 또는 untracked legacy index면 active docs 전체에 대해 full rebuild를 수행한다.
- current policy clean 상태에서도 `indexed/updated/removed > 0`가 있으면 shadow projection refresh를 수행한다.
- existing embed follow-up guidance와 충돌하지 않도록 update result formatting을 유지한다.
- tests:
  - legacy DB without policy metadata -> `qmd update` 후 policy metadata가 기록된다
  - policy mismatch -> `qmd update` 한 번으로 current policy clean이 된다
  - config-missing / DB-only runtime guardrail은 기존 규칙을 그대로 유지한다 (`src/commands/owned/runtime.ts`)

#### Phase 3: Search/status UX and recall verification

- `src/commands/owned/search.ts`에 Korean-aware query preprocessing과 shadow/legacy path selection을 넣는다.
- `src/commands/owned/status.ts` / formatter에 search policy section을 추가한다.
- search mismatch warning을 stderr branch로 추가한다.
- Korean recall fixture 또는 focused integration setup을 추가한다.
- docs / snapshots / architecture 문서를 갱신한다.
- tests:
  - `형태소 분석` query가 `형태소분석기` 문서를 찾는다
  - `모델` query가 `거대언어모델` 문서를 찾는다
  - `search --json` stdout is clean while warning goes to stderr
  - status snapshot shows embedding health + search policy health together

### Research Insights

**Best Practices:**

- rollout 순서는 `policy helper -> health helper -> shadow rebuild -> search read path -> status/docs/tests`가 가장 안전하다.
- drift risk가 있는 feature일수록 unit test보다 integration fixture DB가 더 중요하다.
- benchmark와 correctness를 같은 phase에 넣지 않으면, later optimization이 policy contract를 깨뜨려도 눈치채기 어렵다.

**Performance Considerations:**

- Phase 2 끝에서 작은 synthetic corpus benchmark를 추가해 rebuild cost를 수치로 남기는 편이 좋다.
- Phase 3 끝에서 search latency smoke를 한 번 더 남기면 shadow path regression을 빨리 잡을 수 있다.

**Edge Cases:**

- legacy index + embedding mismatch + search policy mismatch가 동시에 있는 fixture를 하나는 가져가야 한다.
- empty index, one-doc index, large compound noun doc fixture는 각각 따로 고정하는 편이 좋다.
- Kiwi init failure는 unit test보다 process-level execution test가 더 설득력 있다.

## Alternative Approaches Considered

### Approach A: Mutate upstream `documents_fts` in place

기각 이유:

- upstream trigger와 schema 변화에 직접 결합된다
- local rollout이 upstream-owned table contents를 바꾸는 순간 drift 원인 추적이 어려워진다
- rollback/debug 시 “legacy lexical baseline”을 같은 DB 안에 남겨 두기 어렵다

### Approach B: Same-DB K-QMD shadow FTS table

채택 이유:

- upstream `documents_fts`를 읽기 전용 baseline으로 남길 수 있다
- `store_config` metadata와 한 SQLite transaction 안에서 rebuild를 묶기 쉽다
- zero-config path, DB-only reopen, status source-of-truth를 기존 구조 안에서 유지할 수 있다
- 브레인스토밍의 `Approach A` 제품 방향을 가장 작게 구현하는 기술적 형태다 (see brainstorm: `docs/brainstorms/2026-03-12-korean-search-recall-brainstorm.md`)

### Approach C: Separate shadow DB file

기각 이유:

- 두 DB 사이 atomicity와 lifecycle 관리가 크게 복잡해진다
- `status`, `update`, DB-only reopen, path compatibility 문서/테스트가 모두 무거워진다
- 첫 릴리스의 목표인 recall correctness보다 운영 복잡도가 먼저 커진다

## System-Wide Impact

### Interaction Graph

- `qmd update`
  - CLI parse -> owned runtime (`config-file` required) -> `session.store.update()` -> K-QMD shadow rebuild helper -> `kqmd_documents_fts` refresh + `store_config` policy metadata write -> formatter -> existing embed follow-up guidance
- `qmd search`
  - CLI parse -> owned runtime (`db-only` preferred) -> search policy health read -> Korean-aware query preprocessing -> clean이면 shadow query helper, stale면 legacy `searchLex()` -> formatter -> optional stderr warning
- `qmd status`
  - CLI parse -> owned runtime (`status` zero-config semantics 유지) -> `store.getStatus()` + embedding health + search policy health -> owned formatter

### Error & Failure Propagation

- Kiwi initialization or model load failure
  - `update`는 explicit execution error로 실패한다
  - `search`는 health가 clean shadow path가 아닌 경우에만 legacy fallback warning을 허용한다
- lexical rebuild DB write failure
  - transaction rollback 후 `update`는 non-zero로 실패한다
  - partial metadata write 없이 실패해야 한다
- mismatch detection failure
  - `status`는 best-effort state를 보여 주되, helper bug가 command 전체를 깨지 않게 범위를 최소화한다
- stdout/stderr separation
  - warning/advisory는 stdout formatter 밖에서만 다룬다

### State Lifecycle Risks

- `kqmd_documents_fts`만 갱신되고 `store_config` policy metadata가 안 바뀌는 partial state
  - rebuild + metadata write를 transaction으로 묶어 방지한다
- `store.update()`는 성공했지만 lexical rebuild가 실패하는 partial state
  - update command는 final exit를 실패로 돌려야 하고, status에서 mismatch/untracked state를 계속 드러내야 한다
- legacy DB created before search policy metadata existed
  - 첫 `status/search`는 mismatch 또는 untracked warning을 보여 준다
  - 첫 `qmd update`가 remediation path가 된다

### API Surface Parity

- 새 top-level command나 flag를 추가하지 않는다
- `search` output format precedence (`csv > md > xml > files > json > cli`)는 유지한다 (`src/commands/owned/io/format.ts`)
- `status`는 existing owned surface 안에서만 확장한다
- `query`/`embed` parsing and execution semantics는 이번 feature에서 바꾸지 않는다

### Integration Test Scenarios

1. legacy index without search policy metadata에서 `qmd status`가 search policy mismatch/untracked를 보여 준다
2. 같은 legacy index에서 `qmd search --json 형태소 분석` 실행 시 stdout JSON은 깨지지 않고 stderr warning만 출력된다
3. 같은 index에서 `qmd update`를 실행하면 policy metadata가 기록되고 이후 `status`가 clean을 보여 준다
4. current policy clean index에서 `qmd search 모델`이 `거대언어모델` 문서를 찾는다
5. current policy clean index에서도 upstream `documents_fts`는 legacy baseline으로 남아 있고, search는 shadow helper를 통해 결과를 반환한다
6. embedding mismatch와 search policy mismatch가 동시에 있는 DB에서 `status`가 두 상태를 모두 일관되게 보여 준다

## Acceptance Criteria

### Functional Requirements

- [x] owned `search`는 Hangul query에 대해 Kiwi-backed token augmentation을 사용해 현재 브레인스토밍 예시 미탐을 줄인다
- [x] owned `update`는 current lexical search policy metadata를 DB에 기록하고 유지한다
- [x] legacy index 또는 mismatched policy index에서 `qmd update`는 current policy 기준으로 `kqmd_documents_fts` shadow projection을 rebuild한다
- [x] owned `status`는 embedding health와 별개로 search policy health를 보여 준다
- [x] owned `search`는 policy mismatch 상태에서 stderr warning을 출력하지만 검색 결과는 계속 반환한다
- [x] upstream `documents_fts` schema와 contents는 K-QMD rollout 때문에 직접 변경되지 않는다
- [x] `query` path는 이번 feature에서 behavior drift 없이 유지된다

### Non-Functional Requirements

- [x] Kiwi analyzer initialization은 process당 한 번만 수행된다
- [x] lexical rebuild와 metadata write는 atomic하게 수행된다
- [x] machine-readable search output은 warning 때문에 오염되지 않는다
- [x] Korean-aware expansion은 Hangul presence가 있을 때만 적용되어 기존 영어/코드 search regression을 최소화한다
- [x] silent fallback, silent no-op, hidden policy drift를 허용하지 않는다

### Quality Gates

- [x] `npm run check`
- [x] `npm run test:parity`
- [x] search policy helper unit tests
- [x] update migration / rebuild integration tests
- [x] search stderr warning + stdout coexistence tests
- [x] status snapshot update
- [x] README / architecture / development docs update

## Success Metrics

- 브레인스토밍에서 합의한 두 대표 예시(`형태소 분석`/`형태소분석기`, `모델`/`거대언어모델`)가 automated test로 고정된다
- legacy index -> `status` warning -> `update` remediation -> `status` clean 흐름이 통합 테스트로 검증된다
- 기존 parity suite와 smoke suite가 새 정책을 반영한 상태로 green을 유지한다
- vector/query path와 무관한 lexical feature가 `query` output drift를 만들지 않는다

## Dependencies & Risks

### Dependencies

- `kiwi-nlp` package and its WASM/runtime assets
- existing `@tobilu/qmd` store schema (`documents`, `content`, `store_config`) and `QMDStore.internal` access
- current owned command architecture (`src/commands/owned/runtime.ts`, `src/commands/owned/io/*`)

### Risks

- **Upstream schema drift**
  - `documents`, `content`, `store_config` shape 또는 `QMDStore.internal` contract가 upstream release에서 바뀌면 local shadow rebuild helper가 깨질 수 있다
  - mitigation: targeted tests + docs + version bump checklist에 schema check 추가
- **Search semantics drift**
  - local shadow query helper가 upstream `searchFTS()` scoring/query grammar와 멀어질 수 있다
  - mitigation: collection filtering, score normalization, stderr/stdout contract를 focused tests로 고정하고 quoted/negated edge case는 conservative fallback을 둔다
- **Whole-index rebuild cost**
  - full shadow rebuild는 large index에서 느릴 수 있다
  - mitigation: first release는 correctness 우선으로 두고, cost가 실제 문제로 드러나면 changed-doc optimization을 follow-up으로 뺀다
- **Kiwi initialization/runtime failures**
  - WASM init 또는 asset load failure가 search/update entrypoint를 깨뜨릴 수 있다
  - mitigation: lazy singleton + explicit recovery copy + tests
- **Search regression for non-Korean queries**
  - token augmentation이 영어/code search를 흔들 수 있다
  - mitigation: Hangul-gated expansion + raw query preservation + regression fixtures

## Documentation Plan

- `README.md`
  - project status를 "한국어 lexical recall 첫 기능 포함" 상태로 갱신한다
- `docs/development.md`
  - new dependency, tests, lexical policy helper modules를 문서화한다
- `docs/architecture/kqmd-command-boundary.md`
  - search/update/status가 lexical search policy를 어떻게 surface하는지 반영한다
- `docs/architecture/upstream-compatibility-policy.md`
  - upstream `documents_fts`는 baseline으로 유지하고, K-QMD는 same-DB shadow FTS를 소유한다는 원칙을 기록한다
- `docs/solutions/*`
  - 구현 완료 후 Kiwi rollout / search policy mismatch UX learnings를 남긴다

## Sources & References

### Origin

- **Brainstorm document:** `docs/brainstorms/2026-03-12-korean-search-recall-brainstorm.md`
  - carried-forward decisions:
    - first milestone는 `query`가 아니라 `search` recall이다
    - 형태소 분석기는 직접 개발하지 않고 Kiwi를 사용한다
    - 재색인은 허용하고, 검색 인덱스 정책 mismatch UX를 둔다

### Internal References

- `src/commands/owned/search.ts`
  - current lexical-only search entrypoint
- `src/commands/owned/update.ts`
  - current update seam that can host lexical rebuild
- `src/commands/owned/status.ts`
  - current owned status entrypoint
- `src/commands/owned/embedding_health.ts`
  - reusable pattern for policy health classification
- `src/config/embedding_policy.ts`
  - reusable pattern for canonical product policy helper
- `src/commands/owned/runtime.ts`
  - existing runtime guardrails for read vs write commands
- `src/commands/owned/io/format.ts`
  - stdout/stderr separation and output precedence to preserve
- `docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`
  - read-path side effects and cleanup ownership guardrails
- `docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`
  - zero-config status and scope-aware health calculation pattern
- `docs/solutions/logic-errors/query-explain-output-parity-kqmd-cli-20260312.md`
  - formatter drift / silent no-op avoidance pattern
- `docs/plans/2026-03-12-feat-qwen-default-embedding-rollout-plan.md`
  - prior policy rollout structure to mirror

### External References

- SQLite FTS5 documentation: `https://sqlite.org/fts5.html`
- Kiwi repository: `https://github.com/bab2min/Kiwi`
- Kiwi WASM binding README: `https://raw.githubusercontent.com/bab2min/Kiwi/main/bindings/wasm/README.md`
- `kiwi-nlp` npm package: `https://www.npmjs.com/package/kiwi-nlp`

### Related Work

- As of 2026-03-12, quick upstream issue/PR searches for Korean/CJK/tokenizer and multilingual/Qwen terms in `tobi/qmd` did not return directly relevant public issues or PRs.
