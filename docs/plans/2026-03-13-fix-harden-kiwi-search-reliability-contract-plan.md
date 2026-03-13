---
title: fix: Harden Kiwi search reliability contract
type: fix
status: completed
date: 2026-03-13
origin: docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md
---

# fix: Harden Kiwi search reliability contract

## Enhancement Summary

**Deepened on:** 2026-03-13  
**Sections enhanced:** 7  
**Research agents used:** `architecture-strategist`, `kieran-typescript-reviewer`, `performance-oracle`, `security-sentinel`, `pattern-recognition-specialist`, `deployment-verification-agent`  
**Additional primary sources:** SQLite official transaction docs, SQLite official FTS5 docs

### Key Improvements

1. `search/update/status` 공동 계약을 “단일 health contract + update success gate” 구조로 더 명확히 정리했다.
2. SQLite write-lock budget, reader impact policy, small/medium/large fixture internal helper/probe benchmark를 추가해 성능과 확장성 기준을 정량화했다.
3. Kiwi model download/cache 무결성, SQLite query safety, stdout/stderr 민감 정보 노출 방지 등 보안 경계를 acceptance criteria와 risks에 끌어올렸다.

### New Considerations Discovered

- SQLite는 동시에 하나의 writer만 허용하고, `BEGIN IMMEDIATE`와 `COMMIT` 모두 `SQLITE_BUSY`를 만날 수 있으므로 write-lock budget과 reader impact policy를 plan 수준에서 못 박아야 한다.
- `status`와 `search`가 같은 health vocabulary를 공유하지 않으면 “clean” 의미가 다시 갈라질 수 있으므로, canonical contract owner를 명시하는 것이 중요하다.
- verification은 기능 시나리오만으로 부족하고, mutation output parity, lock contention, rollback/go-no-go checklist까지 함께 고정해야 릴리스 판단에 쓸 수 있다.

## Overview

이번 계획의 목적은 K-QMD의 Kiwi 기반 한국어 검색이 “기능이 있다” 수준을 넘어, `qmd update`, `qmd status`, `qmd search` 사이의 계약이 실제로 신뢰 가능한 상태인지 검증하고 보강하는 것이다. 브레인스토밍에서 합의한 범위는 `search` 단독이 아니라 `search/update/status`를 하나의 운영 계약으로 보는 것이며, 이번 슬라이스에서는 `embed` owned 여부와 `query` ownership 재조정은 의도적으로 제외한다 (see brainstorm: `docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md`).

핵심 제품 기준은 세 가지다. 첫째, `qmd update`가 성공했다고 말하려면 Kiwi shadow index도 같은 세대로 맞춰져 있어야 한다. 둘째, `qmd status`가 clean이라고 말하면 실제 `qmd search`도 그 전제를 만족해야 한다. 셋째, 이 계약은 단위 테스트만이 아니라 실제 CLI 흐름 검증으로도 증명되어야 한다 (see brainstorm: `docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md`).

이번 deepening 단계에서는 이 세 기준을 “세 command가 각자 의미를 정의한다”가 아니라, **`search_index_health` 계열 state vocabulary를 canonical health contract로 두고, `status`와 `search`는 이를 해석하며 `update`는 성공 게이트를 여기에 연결한다**는 구조로 더 좁혔다. 이 framing이 있어야 clean/stale 의미가 장기적으로 다시 벌어지지 않는다.

## Problem Statement / Motivation

현재 저장소에는 Kiwi tokenizer, same-DB shadow FTS, search index health helper, `status` 출력, stale fallback, hardening 회고까지 이미 존재한다. 따라서 이번 작업은 greenfield feature 구현이 아니라, 이미 들어온 경로가 진짜 제품 계약을 충족하는지 확인하고 남은 틈을 닫는 hardening/verification 작업에 가깝다.

로컬 연구상 이미 해결된 문제와 아직 계획으로 고정해야 할 문제가 섞여 있다.

- [`src/commands/owned/update.ts`](/Users/jylkim/kqmd/src/commands/owned/update.ts) 는 Kiwi preflight 뒤에 upstream update와 shadow rebuild를 연결하지만, upstream mutation과 shadow sync를 하나의 제품 성공 조건으로 어떻게 보장할지 acceptance 기준이 아직 문서로 고정돼 있지 않다.
- [`src/commands/owned/status.ts`](/Users/jylkim/kqmd/src/commands/owned/status.ts) 와 [`src/commands/owned/search_index_health.ts`](/Users/jylkim/kqmd/src/commands/owned/search_index_health.ts) 는 search health를 surface 하지만, “clean = 실제 검색 가능”이라는 stronger contract를 release-quality 기준으로 명문화한 계획은 없다.
- [`src/commands/owned/search.ts`](/Users/jylkim/kqmd/src/commands/owned/search.ts) 는 clean shadow path, conservative fallback, stderr advisory를 갖고 있으나, `update -> status -> search` 전체 흐름을 한 세트로 증명하는 end-to-end verification 요구는 아직 비어 있다.

브레인스토밍에서 이미 “Kiwi shadow index는 `qmd update`의 본업 일부이고, 준비가 안 되면 성공처럼 끝나면 안 된다”는 방향을 택했기 때문에, 이번 계획은 그 stronger contract를 구현과 검증 항목으로 번역해야 한다 (see brainstorm: `docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md`).

## Local Research Findings

- [`docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md`](/Users/jylkim/kqmd/docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md)
  이번 계획의 origin 문서다. 범위는 `search/update/status`, 성공 조건은 운영 안정성, 실패 정책은 “성공처럼 끝나지 않음”, 검증 수단은 자동화 테스트 + 실제 CLI proof로 이미 합의되어 있다.
- [`docs/architecture/kqmd-command-boundary.md`](/Users/jylkim/kqmd/docs/architecture/kqmd-command-boundary.md)
  K-QMD는 replacement distribution이며, same-DB shadow FTS ownership, read-path reopen policy, owned/passthrough 경계를 guardrail로 명시한다. 이번 계획은 이 문서의 “search는 clean shadow index만 사용” 가드레일과 일치해야 한다.
- [`docs/development.md`](/Users/jylkim/kqmd/docs/development.md)
  이미 `search-policy`, `search-index-health`, `kiwi-tokenizer`, `search-shadow-index`, `owned-search-behavior`, `status-command` test suite가 핵심 품질 게이트로 분리돼 있다. 이번 계획은 새 작업을 이 suite 위에 얹는 방식이어야 하며, 별도 ad hoc 검증으로 흩어지면 안 된다.
- [`docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md`](/Users/jylkim/kqmd/docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md)
  이미 드러난 failure mode를 잘 정리한다. 특히 “preflight는 mutation 이전으로”, “clean health와 실제 search availability를 맞춘다”, “quoted/negated Hangul query는 보수적으로 fallback 한다”, “download/bootstrap failure는 retry 가능하게 만든다”는 패턴이 이번 계획의 필수 입력이다.
- [`docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md`](/Users/jylkim/kqmd/docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md)
  `status`는 일반 read command와 다른 entrypoint 성격을 갖고, advisory scope는 실제 실행 범위와 같아야 한다는 교훈을 준다. search reliability 계획에서도 `status`가 말하는 health 범위와 실제 `search` 동작 범위를 맞춰야 한다.
- [`docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`](/Users/jylkim/kqmd/docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
  runtime contract는 command별로 분리하고, read-path와 mutation-path를 같은 reopen policy로 다루지 말아야 한다는 교훈이 있다. 이번 계획에서도 `update`의 stronger mutation contract를 별도 acceptance criteria로 고정해야 한다.
- [`test/owned-search-behavior.test.ts`](/Users/jylkim/kqmd/test/owned-search-behavior.test.ts), [`test/status-command.test.ts`](/Users/jylkim/kqmd/test/status-command.test.ts), [`test/owned-embedding-behavior.test.ts`](/Users/jylkim/kqmd/test/owned-embedding-behavior.test.ts)
  개별 command behavior는 이미 어느 정도 고정돼 있다. 특히 stale fallback, clean shadow path, quoted fallback, zero-config status, Kiwi preflight failure가 있다. 반면 `update -> status -> search`를 하나의 contract로 묶는 cross-layer verification은 아직 얇다.

## Research Decision

로컬 컨텍스트가 충분히 강하므로 broad external research는 생략한다. 이 작업은 새 라이브러리 평가나 외부 API 도입이 아니라, 이미 들어온 K-QMD-owned Kiwi 경로를 codebase conventions와 기존 learnings에 맞춰 안정화하는 문제다. 따라서 이번 계획은 내부 아키텍처 문서, 테스트 패턴, `docs/solutions/*` 학습 문서를 primary source로 삼는다.

다만 deepening 과정에서는 두 가지 official reference만 추가로 확인한다.

- SQLite transaction docs: SQLite는 동시에 하나의 writer만 허용하며, `BEGIN IMMEDIATE`와 `COMMIT` 모두 `SQLITE_BUSY`를 만날 수 있다. 따라서 write-lock budget, reader impact policy, retry/rollback expectation을 plan에 직접 넣는다.
- SQLite FTS5 docs: shadow FTS는 write amplification과 sync drift를 만들 수 있으므로, projection 계산과 commit/swap 단계를 분리하고 metadata owner를 명확히 두는 방향이 더 안전하다.

## SpecFlow Analysis

### User Flow Overview

1. **정상 갱신 흐름**
   사용자가 `qmd update`를 실행한다. upstream 문서 scan이 끝나고 Kiwi shadow index가 같은 세대로 재동기화된다. 이후 `qmd status`는 clean을 보여 주고, plain Hangul `qmd search`는 shadow path를 사용한다.
2. **사전 조건 실패 흐름**
   사용자가 `qmd update`를 실행했지만 Kiwi bootstrap/model readiness가 충족되지 않는다. 이 경우 mutation 이전에 실패해야 하며, 사용자는 성공 요약이 아니라 복구 가능한 실패를 본다.
3. **비정상/불일치 상태 관찰 흐름**
   어떤 이유로 shadow index가 current policy와 어긋난다. `qmd status`는 clean이 아닌 상태를 보여 주고, `qmd search`는 false clean path 대신 fallback 또는 explicit failure semantics를 사용한다.
4. **보수적 검색 의미 보존 흐름**
   사용자가 quoted 또는 negated Hangul query를 실행한다. 이 경로에서는 recall 확대보다 upstream lexical semantics 보존이 우선이다.
5. **실사용 검증 흐름**
   개발자가 fixture collection 또는 샘플 repo에서 `qmd update -> qmd status -> qmd search`를 직접 실행해, automation과 실제 CLI UX가 같은 계약을 보여 주는지 확인한다.

### Gaps To Close

- 현재 테스트는 개별 command의 regression을 잘 잡지만, update success와 status clean과 search clean path를 하나의 시나리오로 증명하는 흐름이 약하다.
- “기존 검색 상태를 지킨다”는 브레인스토밍 결정은 upstream `store.update()`의 opaque mutation 경계 때문에 구현 feasibility를 먼저 확인해야 한다.
- machine-readable output을 보존하면서 advisory를 주는 규칙은 `search`에 존재하지만, CLI proof와 acceptance criteria에 명시적으로 연결돼 있지 않다.

## Chosen Approach

브레인스토밍에서 선택한 `Approach A: search reliability milestone`을 그대로 따른다. 즉, Kiwi search를 독립 기능처럼 다루지 않고 `search/update/status`를 하나의 제품 계약으로 묶어 hardening과 verification을 수행한다 (see brainstorm: `docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md`).

해결 방향은 네 축이다.

1. **Canonical health contract 고정**
   `clean`, `stale-shadow-index`, `untracked-index`, `policy-mismatch`는 [`src/commands/owned/search_index_health.ts`](/Users/jylkim/kqmd/src/commands/owned/search_index_health.ts)의 vocabulary를 source of truth로 삼고, `status`와 `search`는 이를 해석만 한다.
2. **Update success gate 연결**
   `qmd update`의 성공은 upstream 문서 갱신과 Kiwi shadow index 동기화가 함께 끝났을 때만 허용한다.
3. **Cross-layer verification 추가**
   개별 unit/handler test 위에 command-level, parity snapshot, CLI-level proof를 추가해 실제 사용자 흐름을 고정한다.
4. **Sub-policy 분리**
   quoted/negated Hangul fallback은 reliability 계약 안에 포함하되, update/status alignment와는 다른 보수적 search semantics 축으로 분리해 다룬다.
5. **Non-goal 경계 유지**
   `embed` ownership, `query` redesign, ranking 개선은 이번 plan에 포함하지 않는다.

## Technical Approach

### Architecture

이번 작업은 새 command surface를 만드는 것이 아니라, 이미 존재하는 경계를 더 단단하게 묶는 것이다. 주요 수정 후보는 아래와 같다.

- [`src/commands/owned/update.ts`](/Users/jylkim/kqmd/src/commands/owned/update.ts)
  Kiwi preflight, upstream mutation, shadow rebuild, follow-up message 사이의 성공/실패 의미를 더 엄격히 다듬되, orchestration만 담당하도록 둔다.
- [`src/commands/owned/search_shadow_index.ts`](/Users/jylkim/kqmd/src/commands/owned/search_shadow_index.ts)
  rebuild primitive는 이 모듈에 두되, write transaction과 projection 계산을 어떻게 나누는지, shadow state를 어떻게 preserve/swap 하는지 검토한다.
- [`src/commands/owned/search_index_health.ts`](/Users/jylkim/kqmd/src/commands/owned/search_index_health.ts)
  canonical health vocabulary와 metadata owner를 이 모듈에 두고, clean/stale/untracked/policy-mismatch가 실제 availability semantics와 일치하는지 확인한다.
- [`src/commands/owned/status.ts`](/Users/jylkim/kqmd/src/commands/owned/status.ts) 및 [`src/commands/owned/io/format.ts`](/Users/jylkim/kqmd/src/commands/owned/io/format.ts)
  status가 사용자에게 보여 주는 health label과 recovery next step을 reliability contract에 맞춰 조정하되, advisory copy와 stdout/stderr policy는 formatter 레이어에 모은다.
- [`src/commands/owned/search.ts`](/Users/jylkim/kqmd/src/commands/owned/search.ts)
  clean shadow path, conservative syntax fallback, stderr advisory, machine-readable stdout preservation을 release-quality 기준으로 다듬는다.
- `test/*`
  새 umbrella suite를 만들기보다 existing `behavior`, `health`, `parity` suites를 확장하면서 cross-layer verification fixture와 CLI proof를 추가한다.

기술 구조를 더 명확히 하기 위해 아래 네 가지도 plan 범위에 포함한다.

- **Shared contract owner**
  `search_index_health.ts`는 read-side helper가 아니라 canonical health contract owner다. `status`와 `search`가 의미를 따로 재정의하지 않게 한다.
- **Explicit contract types**
  `SearchIndexHealth`, `UpdateOutcome`, `SearchExecutionPath`는 discriminated union 또는 동등한 명시적 계약 타입으로 고정하고 exhaustiveness gate를 둔다.
- **Health interpretation seam**
  `status`와 `search`가 같은 판정 규칙을 공유할 수 있도록, health를 user-facing decision으로 바꾸는 해석 seam을 둔다.
- **Formatter/advisory policy**
  recovery copy, stdout/stderr purity, mutation output parity는 command handler가 아니라 formatter/advisory policy 경계에서 통제한다.

### Implementation Phases

#### Phase 1: Contract audit and feasibility gate

목표는 브레인스토밍에서 선택한 stronger contract가 현재 upstream integration boundary 안에서 어디까지 가능한지 먼저 고정하는 것이다.

- `session.store.update()`가 어느 시점에 어떤 SQLite state를 mutate하는지 로컬 코드 기준으로 확인한다.
- SQLite 공식 transaction semantics를 바탕으로 write-lock budget과 reader impact policy를 정의한다.
  - SQLite는 동시에 하나의 writer만 허용하므로, write phase가 길어질수록 `status/search` contention risk가 커진다.
  - `BEGIN IMMEDIATE` / `COMMIT` busy behavior를 기준으로 block, stale-read, retry 실패 중 어떤 동작을 허용할지 정한다.
- “기존 검색 상태를 지킨다”는 목표를 구현할 수 있는 최소 전략을 정한다.
  후보는 아래 둘 중 하나다.
  - mutation 이전 preflight + post-update stage/swap shadow rebuild
  - stronger guarantee가 불가능한 경우, no-false-success + explicit stale state로 contract를 재정의할지 구현 전에 다시 검토
- acceptance criteria를 `store.update()` opaque 경계를 반영해 구체 문장으로 작성한다.
- 이 단계 종료 조건은 두 층으로 분리한다.
  - **Preferred contract:** transactional preservation 또는 동등한 stage/swap guarantee
  - **Fallback contract:** atomic preservation이 불가능할 때에도 `no false success + deterministic stale surfacing`는 반드시 보장

이 단계의 산출물은 코드가 아니라 **명시적인 mutation contract**다. 구현이 이 계약을 만족할 수 없으면, 다음 단계로 무작정 진행하지 않는다.

#### Phase 2: Update success semantics hardening

목표는 `qmd update`가 “성공처럼 보였지만 search contract는 깨진 상태”를 남기지 않게 하는 것이다.

- Kiwi/model/bootstrap/download preflight는 mutation 이전에 끝나야 한다.
- shadow rebuild는 가능한 한 stage-then-commit 성격을 갖게 해, partial projection이나 half-written metadata가 남지 않도록 한다.
- projection 계산과 SQLite write phase를 분리하고, write-lock 보유 시간은 측정 가능해야 한다.
- reader impact policy를 구현 수준에서 명시한다.
  - update 중 `status/search`가 block되는지
  - stale read를 허용하는지
  - busy timeout/retry를 허용하는지
- 성공 요약 stdout은 shadow sync까지 끝난 경우에만 출력한다.
- 실패 시 stderr는 recovery action을 분명히 주되, 실제 state를 과장하지 않는다.
- existing follow-up UX와 충돌하지 않도록 embedding follow-up copy와 search reliability copy의 우선순위를 정리한다.
- recovery/advisory copy priority는 가능하면 formatter policy에 모은다.

#### Phase 3: Status and search alignment

목표는 `status`가 말하는 것과 `search`가 실제로 하는 일이 동일한 뜻을 갖게 만드는 것이다.

- `clean` health는 plain Hangul search가 live Kiwi bootstrap/network availability에 다시 의존하지 않는 상태만 의미해야 한다.
- `status`는 health contract를 읽어 보여 주고, `search`는 같은 contract를 실행 시점에 소비한다. 둘이 서로의 의미를 정의하지 않는다.
- `stale-shadow-index`, `untracked-index`, `policy-mismatch`는 각각 recovery step이 다르면 status 문구도 그 차이를 드러내야 한다.
- quoted/negated Hangul query는 recall 확대보다 lexical grammar parity를 우선한다.
- `search --json` 같은 machine-readable output은 advisory가 stdout을 오염시키지 않아야 한다.
- `status`의 기본 health 판정은 constant-time metadata read를 우선하고, expensive full-table validation은 explicit verify/debug 경로로 분리한다.
- plain Hangul `search` clean path의 readiness 판단은 network/bootstrap 재확인 없이 local metadata read만으로 끝나야 한다.

#### Phase 4: Verification harness and documentation

목표는 이번 작업의 완료 기준을 코드와 문서 둘 다에서 재사용 가능하게 만드는 것이다.

- 기존 unit/handler test에 더해, `update -> status -> search` 연쇄를 검증하는 command-level test를 추가한다.
- 기존 패턴을 재사용한다.
  - `test/owned-embedding-behavior.test.ts`의 preflight-before-mutation regression 패턴
  - `test/owned-search-behavior.test.ts`, `test/search-index-health.test.ts`, `test/status-command.test.ts`의 focused suite 패턴
  - `test/owned-command-parity/mutation-output.test.ts`의 output parity snapshot 패턴
- 실제 CLI proof를 위한 fixture workflow를 정의한다.
  예:
  - fresh or existing index에서 `qmd update`
  - 곧바로 `qmd status`
  - plain Hangul `qmd search`
  - quoted Hangul `qmd search`
- fixture 규모를 small / medium / large로 나누고 아래 정량 지표를 기록한다.
  - upstream `store.update()` 시간
  - shadow rebuild 시간
  - SQLite write-lock 보유 시간
  - `readSearchIndexHealth()` metadata read cold/hot 시간
  - `searchShadowIndex()` helper와 `store.searchLex()` proxy p50, p95 latency
  - primary connection이 `BEGIN IMMEDIATE`를 보유한 동안 secondary helper probe 시간
- `docs/development.md`의 Korean search validation 섹션에 이번 reliability gate를 추가한다.
- 필요하면 README의 “현재 상태” 또는 “다음 단계” 표현을 현재 계약에 맞게 갱신한다.
- 릴리스 판단에 쓸 Go / No-Go checklist와 rollback 절차를 함께 문서화한다. 테스트는 계약 보호, 문서는 운영 절차 보호라는 역할을 분리한다.

## System-Wide Impact

### Interaction Graph

- `qmd update`
  `src/cli.ts` -> owned dispatch -> `src/commands/owned/update.ts` -> runtime open -> Kiwi readiness check -> upstream `store.update()` -> `search_shadow_index` rebuild -> formatter output
- `qmd status`
  `src/cli.ts` -> owned dispatch -> `src/commands/owned/status.ts` -> `store.getStatus()` + `readSearchIndexHealth()` -> formatter output
- `qmd search`
  `src/cli.ts` -> owned dispatch -> `src/commands/owned/search.ts` -> collection resolution -> `readSearchIndexHealth()` -> clean이면 `searchShadowIndex()`, 아니면 legacy `searchLex()`

### Shared Contract Owner

- canonical health state는 [`src/commands/owned/search_index_health.ts`](/Users/jylkim/kqmd/src/commands/owned/search_index_health.ts) 가 소유한다
- `status`는 이 contract를 화면에 surface 한다
- `search`는 같은 contract를 read-path decision으로 소비한다
- `update`는 success gate와 stale surfacing을 이 contract에 연결한다
- formatter 레이어는 이 contract를 user-facing copy로 변환한다

### Error & Failure Propagation

- Kiwi bootstrap/download failure는 `update` mutation 이전에 surface 되어야 한다.
- shadow rebuild failure는 success summary를 허용하지 않으며, primary failure를 masking하는 secondary cleanup error가 있으면 안 된다.
- `status`는 diagnostic surface이므로, health rendering과 unrelated best-effort information은 command 전체를 깨지 않도록 분리해야 한다.
- `search` warning은 stderr로만 나가야 하며 stdout format contract를 침범하면 안 된다.

### State Lifecycle Risks

- upstream `store.update()`와 shadow rebuild 사이에 cross-layer atomicity가 보장되지 않으면 docs/content와 shadow FTS가 다른 세대에 머물 수 있다.
- `store_config` metadata와 `kqmd_documents_fts` row count가 따로 움직이면 status clean이 거짓이 될 수 있다.
- stage-and-swap 없이 direct rebuild만 하면 crash window에서 stale or empty shadow table risk가 남을 수 있다.

### API Surface Parity

- `search`, `status`, `update`의 parse/validation/output shape는 upstream-compatible owned I/O contract를 유지해야 한다.
- `status --json` 같은 command-specific flags는 upstream-compatible no-op semantics를 깨지 않아야 한다.
- passthrough surface(`collection`, `ls`, `get`, `multi-get`, `mcp`)는 이번 작업의 비범위다. published bin smoke behavior는 supporting evidence로만 유지하고, 핵심 acceptance 기준과는 분리한다.

### Integration Test Scenarios

- `qmd update` success 직후 `qmd status`가 clean이고 plain Hangul `qmd search`가 warning 없이 shadow path를 쓰는 시나리오
- Kiwi preflight failure 시 `store.update()`가 호출되지 않고 이전 state가 유지되는 시나리오
- stale or untracked shadow state에서 `qmd status`가 non-clean을 보고하고 `qmd search --json`은 stdout을 유지한 채 stderr warning만 내는 시나리오
- quoted Hangul query가 clean shadow state에서도 conservative fallback을 타는 시나리오
- first-run Kiwi bootstrap failure 이후 retry path가 회복되는 시나리오

## Acceptance Criteria

### Functional Requirements

- [x] `qmd update`는 Kiwi shadow index 동기화까지 끝난 경우에만 성공으로 종료한다 (see brainstorm: `docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md`)
- [x] Kiwi/bootstrap readiness failure는 upstream mutation 이전에 surface 되어, 성공 요약이나 half-success UX를 남기지 않는다
- [x] `qmd status`가 `clean`을 출력할 때는 plain Hangul `qmd search`가 same-policy clean path를 실제로 사용할 수 있다
- [x] stale/untracked/policy-mismatch 상태에서 `qmd search`는 false clean path를 사용하지 않고, recovery command를 포함한 stderr advisory만 추가한다
- [x] quoted/negated Hangul query는 clean shadow index가 있어도 upstream lexical semantics 보존을 우선한다
- [x] 이번 슬라이스는 `embed` ownership과 `query` redesign을 건드리지 않는다 (see brainstorm: `docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md`)

### Engineering Safeguards

- [x] `clean`, `stale-shadow-index`, `untracked-index`, `policy-mismatch`는 [`src/commands/owned/search_index_health.ts`](/Users/jylkim/kqmd/src/commands/owned/search_index_health.ts)의 canonical vocabulary를 재사용하며, command별 ad hoc 상태명을 새로 만들지 않는다
- [x] `SearchIndexHealth`, `UpdateOutcome`, `SearchExecutionPath`는 discriminated union 또는 동등한 명시적 계약 타입으로 고정되고 exhaustiveness handling을 가진다
- [x] shadow projection 계산과 SQLite write phase는 분리되며, write-lock 보유 시간은 측정 가능해야 한다
- [x] `status` 기본 health 판정은 constant-time metadata read를 우선하고, expensive full validation은 기본 경로가 아니다
- [x] plain Hangul `search` clean path readiness는 local metadata read만으로 판정되며 network/bootstrap 재확인을 hot path에서 반복하지 않는다
- [x] Kiwi 모델 다운로드는 허용된 소스와 무결성 검증을 통과해야 하며, checksum mismatch 또는 partial download는 재사용되지 않는다
- [x] Kiwi cache/model 경로는 untrusted input으로 취급하며, 심볼릭 링크/예상 밖 경로/불안전한 cache artifact를 명시적으로 거부하거나 실패한다
- [x] SQLite/FTS 동적 값은 파라미터 바인딩을 사용하고 raw SQL 문자열 결합을 추가하지 않는다
- [x] 런타임 경로에서 사용자 입력이 셸 문자열로 실행되지 않으며, stdout/stderr는 민감한 로컬 경로나 raw internal error를 과다 노출하지 않는다

### Quality Gates

- [x] `test/owned-search-behavior.test.ts`, `test/search-index-health.test.ts`, `test/status-command.test.ts`에 reliability contract 관련 regression이 추가된다
- [x] `test/owned-embedding-behavior.test.ts` 또는 새 update-focused test 파일에 preflight/mutation ordering regression이 고정된다
- [x] mutation output 변화가 없거나, 변화가 생기면 `test/owned-command-parity/mutation-output.test.ts`와 관련 fixture snapshot을 함께 갱신한다
- [x] `any`는 추가하지 않고, `unknown`은 type guard 없이 사용하지 않는다
- [x] health/status/path union에 대한 exhaustiveness test가 추가된다
- [x] formatter contract regression이 별도 snapshot 또는 구조 검증으로 고정되어 `--json` stdout purity를 보장한다
- [x] 실제 CLI proof 절차가 `docs/development.md` 또는 동등한 developer-facing 문서에 기록된다
- [x] `bun run test -- search-policy search-index-health kiwi-tokenizer search-shadow-index owned-search-behavior status-command`가 핵심 verification path로 유지되고, 검증은 기존 `behavior`, `health`, `parity` suite를 확장하는 방식으로 추가된다
- [x] small / medium / large fixture에서 `update/status/search` latency와 lock contention 결과가 기록된다
- [x] Go / No-Go checklist와 rollback 절차가 릴리스 후보 검증 문서로 정리된다

## Success Metrics

- `status clean`과 `search clean path` 사이의 의미 불일치 재현 케이스가 남지 않는다
- failure/recovery CLI 흐름에서 “성공처럼 보였지만 stale” 상태가 acceptance 기준상 금지된다
- 실제 CLI proof가 최소 3개 핵심 시나리오를 통과한다
  - update success -> status clean -> search clean
  - preflight failure -> no success summary
  - stale state -> status non-clean + stderr-only warning
- 개발자 문서만 읽어도 Kiwi search reliability를 검증하는 기본 커맨드와 기대 결과를 알 수 있다
- small / medium / large fixture 기준으로 `store.update()`, shadow rebuild, search health read, shadow/legacy helper search proxy 지표가 기록되고 회귀 비교가 가능하다
- `qmd update` 중 동시 `status/search` 실행에서 허용된 동작(block, stale read, retry failure) 외의 예기치 않은 busy/error가 남지 않는다
- `status` 기본 health 판정의 DB read cost와 `search` clean path readiness 판단 비용이 hot path에서 예측 가능하게 유지된다

## Dependencies & Risks

- **Opaque upstream mutation risk**
  `@tobilu/qmd`의 update boundary를 K-QMD가 완전히 transactionally 제어하지 못할 수 있다. 이 경우 “기존 검색 상태 보존”을 구현하는 전략을 먼저 검증해야 한다.
- **Fallback architecture risk**
  atomic preservation이 불가능할 경우 최상위 계약을 `no false success + deterministic stale surfacing`으로 다운그레이드할지 명시적으로 결정해야 한다.
- **Kiwi runtime variability**
  model download/cache/bootstrap은 환경 영향을 받으므로, tests는 dependency injection을 써서 네트워크 의존성을 제거해야 한다.
- **Model download and cache integrity risk**
  corrupted model file, partial download, insecure cache artifact, 심볼릭 링크 기반 cache poisoning이 preflight를 속일 수 있다.
- **SQL / FTS query safety risk**
  검색어나 컬렉션 필터가 raw SQL/FTS string concatenation으로 흘러가면 SQL injection 또는 parser abuse 성격의 오류가 생길 수 있다.
- **Stringly-typed state drift**
  여러 파일에서 health state를 문자열로 복제하면 `clean` 의미가 조금씩 갈라질 수 있다.
- **Test double drift**
  fake store / fake Kiwi가 실제 반환 shape와 어긋나면 테스트가 녹색이어도 계약이 이미 깨져 있을 수 있다.
- **God-module creep**
  `update.ts`, `search.ts`, formatter가 계약 판정, I/O formatting, recovery copy, orchestration을 한곳에서 모두 떠안으면 유지보수성이 급격히 떨어진다.
- **UX copy collision**
  update follow-up이 embedding guidance와 search reliability guidance를 동시에 보여 줄 수 있다. 우선순위와 메시지 조합 규칙이 필요하다.
- **Verification drift**
  unit tests만 늘고 실제 CLI proof가 빠지면 이번 계획의 핵심 목적을 놓칠 수 있다. 문서화된 manual proof를 필수 산출물로 둔다.

## Alternative Approaches Considered

- `Approach B: readiness/status gate 중심 정리`
  상태 표현 개선에는 유리하지만, 브레인스토밍에서 선택한 핵심 실패 유형인 “update success인데 shadow index stale”를 직접 닫지 못하므로 배제했다 (see brainstorm: `docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md`).
- `Approach C: command boundary 재검토 동시 진행`
  장기적으로는 의미가 있지만, 이번에는 `embed/query` ownership 논의가 reliability milestone을 흐릴 수 있어 제외했다 (see brainstorm: `docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md`).

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md](/Users/jylkim/kqmd/docs/brainstorms/2026-03-13-kiwi-search-reliability-brainstorm.md)
  Carried-forward decisions: `search/update/status` 공동 범위, `qmd update` success에 Kiwi shadow sync 포함, 실패 시 성공처럼 끝나지 않음, 테스트 + 실제 CLI proof 병행, `embed`/`query` 경계는 이번 범위에서 제외

### Internal References

- [docs/architecture/kqmd-command-boundary.md](/Users/jylkim/kqmd/docs/architecture/kqmd-command-boundary.md)
- [docs/development.md](/Users/jylkim/kqmd/docs/development.md)
- [src/commands/owned/update.ts](/Users/jylkim/kqmd/src/commands/owned/update.ts)
- [src/commands/owned/search.ts](/Users/jylkim/kqmd/src/commands/owned/search.ts)
- [src/commands/owned/status.ts](/Users/jylkim/kqmd/src/commands/owned/status.ts)
- [src/commands/owned/search_index_health.ts](/Users/jylkim/kqmd/src/commands/owned/search_index_health.ts)
- [src/commands/owned/search_shadow_index.ts](/Users/jylkim/kqmd/src/commands/owned/search_shadow_index.ts)
- [test/owned-search-behavior.test.ts](/Users/jylkim/kqmd/test/owned-search-behavior.test.ts)
- [test/status-command.test.ts](/Users/jylkim/kqmd/test/status-command.test.ts)
- [test/owned-embedding-behavior.test.ts](/Users/jylkim/kqmd/test/owned-embedding-behavior.test.ts)

### Institutional Learnings

- [docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md](/Users/jylkim/kqmd/docs/solutions/logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md)
- [docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md](/Users/jylkim/kqmd/docs/solutions/logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md)
- [docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md](/Users/jylkim/kqmd/docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)

### External References

- SQLite Transactions: [lang_transaction.html](https://sqlite.org/lang_transaction.html)
- SQLite FTS5: [fts5.html](https://sqlite.org/fts5.html)
