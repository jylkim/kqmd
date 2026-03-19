# Korean Query Recall Metrics

Date: 2026-03-19
Command: `bun run measure:query-recall`

이 문서는 upstream-compatible base query 대비 current kqmd query의 한국어 recall 비교 벤치마크다.
synthetic fixture에서 띄어쓰기 변형, 복합어 분해, 한영 혼합 세 가지 query 패턴의 hit/miss를 비교하고, control/exploratory case는 별도 표로 분리한다.

## Method

- 비교 레이어:
  - `base`: upstream-compatible base query
  - `adaptive`: base candidate set에 adaptive rerank만 적용한 결과
  - `current`: current kqmd query path (`adaptive+assist`)
- 핵심 카테고리:
  - `spacing`: 띄어쓰기 변형
  - `compound`: 복합어 분해
  - `mixed`: 한영 혼합 기술어
- control 카테고리:
  - `conservative-syntax`, `weak-hit`, `ineligible`, `collection-isolation`, `no-target miss`
- aggregate 범위: core 카테고리만 포함
- hit 정의: target 문서의 displayPath가 top-5 결과에 존재
- miss 정의: target 문서가 top-5에 없으면 통과하며, empty top-5 purity는 별도 signal로 본다
- fixture/runtime: deterministic synthetic fixture, temp HOME/XDG/INDEX isolation, deterministic LLM stub, single-pass serial execution

## Results

| Category | Query | Target | base | adaptive | current | Delta |
|---|---|---|---|---|---|---|
| spacing | 지속 학습 | docs/spacing-adaptive-target.md | hit@2 | hit@2 | hit@2 | 0 |
| spacing | 문서 업로드 파싱 | docs/spacing-rescue-upload.md | miss | miss | hit@2 | +1 |
| compound | 오케스트레이션 | docs/compound-orchestration.md | miss | miss | hit@2 | +1 |
| compound | 분석 | docs/compound-analysis.md | hit@1 | hit@1 | hit@1 | 0 |
| mixed | schema 마이그레이션 | docs/mixed-schema.md | miss | miss | hit@2 | +1 |
| mixed | oauth 인증 | docs/mixed-auth.md | miss | miss | hit@1 | +1 |

## Controls

| Query | Expected | base | current | Assist | Reason |
|---|---|---|---|---|---|
| "지속 학습" | hit | hit@1 | hit@1 | no | conservative-syntax |
| 지속 학습 -파이프라인 | hit | hit@2 | hit@2 | no | ineligible |
| what's new | hit | hit@1 | hit@1 | no | ineligible |
| 오케스트레이션 | miss | miss | miss | no | weak-hit |
| 양자 방화벽 | miss | miss | miss | no | weak-hit |
| 분산 추론 | miss | miss | miss | no | weak-hit |

## Exploratory

| Query | Expected | current | Note |
|---|---|---|---|
| 문서 업로드 파싱은 어떻게 동작해? | hit | hit@1 | exploratory |
| 지속 학습 질문 | hit | hit@1 | exploratory |

## Aggregate

| Scope | Side | Hits | Total | Recall |
|---|---|---:|---:|---:|
| core | upstream-compatible-base | 2 | 6 | 33.33% |
| core | current-kqmd | 6 | 6 | 100% |
| question | upstream-compatible-base | 1 | 1 | 100% |
| question | current-kqmd | 1 | 1 | 100% |

## Derived Signals

- core current recall uplift vs upstream-compatible base: 66.67%
- question current recall uplift vs upstream-compatible base: 0%
- adaptive-only gain count: 1
- assist-rescue gain count: 4
- normalization applied count: 1
- negative control pass rate: 100%
- negative control empty-top5 rate: 100%
- unresolved core miss count: 0

## Notes

- upstream baseline은 실제 upstream CLI subprocess가 아니라 upstream-compatible seam이다.
- aggregate는 core 카테고리만 포함하고 control/exploratory case는 제외한다.
- assist score normalization은 raw base score-domain과 동치가 아니다.
- rescue dedupe는 `docid || displayPath`, rescue cap은 downstream policy 계약을 따른다.
- 이 리포트는 recall correctness만 다루며, wall-clock latency/overhead 주장은 의도적으로 제외한다.
- negative control pass rate는 `expected=miss` control만 포함하며, noise-only 반환은 empty-top5 rate로 따로 본다.
- deterministic fixture를 사용하므로 real vault 일반화에는 제한이 있다.
- raw JSON below is the source-of-truth; markdown tables are derived views.

```json
{
  "schemaVersion": "2",
  "fixtureVersion": "1",
  "datasetId": "kqmd-query-recall-v1",
  "rows": [
    {
      "caseId": "spacing-adaptive",
      "category": "spacing",
      "expectedOutcome": "hit",
      "query": "지속 학습",
      "targetDocs": [
        "docs/spacing-adaptive-target.md"
      ],
      "acceptableTargets": [
        "docs/spacing-adaptive-target.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "short-korean-phrase",
      "fetchLimit": 20,
      "runtimeMode": "native",
      "includedInCoreAggregate": true,
      "normalizationApplied": false,
      "normalizationReason": "not-eligible",
      "normalizationAddedCandidates": 0,
      "assistApplied": false,
      "assistReason": "strong-hit",
      "addedCandidates": 0,
      "base": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/noise-000.md",
          "docs/spacing-adaptive-target.md",
          "docs/noise-001.md"
        ],
        "unexpectedTop5Count": 2
      },
      "adaptive": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/noise-000.md",
          "docs/spacing-adaptive-target.md",
          "docs/noise-001.md"
        ],
        "unexpectedTop5Count": 2
      },
      "current": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/noise-000.md",
          "docs/spacing-adaptive-target.md",
          "docs/noise-001.md"
        ],
        "unexpectedTop5Count": 2
      },
      "winningLayer": "base"
    },
    {
      "caseId": "spacing-rescue-upload",
      "category": "spacing",
      "expectedOutcome": "hit",
      "query": "문서 업로드 파싱",
      "targetDocs": [
        "docs/spacing-rescue-upload.md"
      ],
      "acceptableTargets": [
        "docs/spacing-rescue-upload.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "short-korean-phrase",
      "fetchLimit": 20,
      "runtimeMode": "native",
      "includedInCoreAggregate": true,
      "normalizationApplied": false,
      "normalizationReason": "not-eligible",
      "normalizationAddedCandidates": 0,
      "assistApplied": true,
      "assistReason": "strong-hit",
      "addedCandidates": 1,
      "base": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/question-upload.md"
        ],
        "unexpectedTop5Count": 1
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/question-upload.md"
        ],
        "unexpectedTop5Count": 1
      },
      "current": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/question-upload.md",
          "docs/spacing-rescue-upload.md"
        ],
        "unexpectedTop5Count": 1
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "compound-orchestration",
      "category": "compound",
      "expectedOutcome": "hit",
      "query": "오케스트레이션",
      "targetDocs": [
        "docs/compound-orchestration.md"
      ],
      "acceptableTargets": [
        "docs/compound-orchestration.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "short-korean-phrase",
      "fetchLimit": 20,
      "runtimeMode": "native",
      "includedInCoreAggregate": true,
      "normalizationApplied": false,
      "normalizationReason": "not-eligible",
      "normalizationAddedCandidates": 0,
      "assistApplied": true,
      "assistReason": "strong-hit",
      "addedCandidates": 1,
      "base": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/noise-003.md"
        ],
        "unexpectedTop5Count": 1
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/noise-003.md"
        ],
        "unexpectedTop5Count": 1
      },
      "current": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/noise-003.md",
          "docs/compound-orchestration.md"
        ],
        "unexpectedTop5Count": 1
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "compound-analysis",
      "category": "compound",
      "expectedOutcome": "hit",
      "query": "분석",
      "targetDocs": [
        "docs/compound-analysis.md"
      ],
      "acceptableTargets": [
        "docs/compound-analysis.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "short-korean-phrase",
      "fetchLimit": 20,
      "runtimeMode": "native",
      "includedInCoreAggregate": true,
      "normalizationApplied": false,
      "normalizationReason": "not-eligible",
      "normalizationAddedCandidates": 0,
      "assistApplied": false,
      "assistReason": "strong-hit",
      "addedCandidates": 0,
      "base": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/compound-analysis.md"
        ],
        "unexpectedTop5Count": 0
      },
      "adaptive": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/compound-analysis.md"
        ],
        "unexpectedTop5Count": 0
      },
      "current": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/compound-analysis.md"
        ],
        "unexpectedTop5Count": 0
      },
      "winningLayer": "base"
    },
    {
      "caseId": "mixed-schema",
      "category": "mixed",
      "expectedOutcome": "hit",
      "query": "schema 마이그레이션",
      "targetDocs": [
        "docs/mixed-schema.md"
      ],
      "acceptableTargets": [
        "docs/mixed-schema.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "mixed-technical",
      "fetchLimit": 20,
      "runtimeMode": "native",
      "includedInCoreAggregate": true,
      "normalizationApplied": false,
      "normalizationReason": "not-eligible",
      "normalizationAddedCandidates": 0,
      "assistApplied": true,
      "assistReason": "strong-hit",
      "addedCandidates": 1,
      "base": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/noise-004.md"
        ],
        "unexpectedTop5Count": 1
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/noise-004.md"
        ],
        "unexpectedTop5Count": 1
      },
      "current": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/noise-004.md",
          "docs/mixed-schema.md"
        ],
        "unexpectedTop5Count": 1
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "mixed-auth",
      "category": "mixed",
      "expectedOutcome": "hit",
      "query": "oauth 인증",
      "targetDocs": [
        "docs/mixed-auth.md"
      ],
      "acceptableTargets": [
        "docs/mixed-auth.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "mixed-technical",
      "fetchLimit": 20,
      "runtimeMode": "native",
      "includedInCoreAggregate": true,
      "normalizationApplied": false,
      "normalizationReason": "not-eligible",
      "normalizationAddedCandidates": 0,
      "assistApplied": true,
      "assistReason": "strong-hit",
      "addedCandidates": 1,
      "base": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [],
        "unexpectedTop5Count": 0
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [],
        "unexpectedTop5Count": 0
      },
      "current": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/mixed-auth.md"
        ],
        "unexpectedTop5Count": 0
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "control-quoted",
      "category": "control",
      "expectedOutcome": "hit",
      "query": "\"지속 학습\"",
      "targetDocs": [
        "docs/spacing-adaptive-target.md"
      ],
      "acceptableTargets": [
        "docs/spacing-adaptive-target.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "short-korean-phrase",
      "fetchLimit": 20,
      "runtimeMode": "native",
      "includedInCoreAggregate": false,
      "normalizationApplied": false,
      "normalizationReason": "skipped-guard",
      "normalizationAddedCandidates": 0,
      "assistApplied": false,
      "assistReason": "conservative-syntax",
      "addedCandidates": 0,
      "base": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/spacing-adaptive-target.md"
        ],
        "unexpectedTop5Count": 0
      },
      "adaptive": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/spacing-adaptive-target.md"
        ],
        "unexpectedTop5Count": 0
      },
      "current": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/spacing-adaptive-target.md"
        ],
        "unexpectedTop5Count": 0
      },
      "winningLayer": "base"
    },
    {
      "caseId": "control-negated",
      "category": "control",
      "expectedOutcome": "hit",
      "query": "지속 학습 -파이프라인",
      "targetDocs": [
        "docs/spacing-adaptive-target.md"
      ],
      "acceptableTargets": [
        "docs/spacing-adaptive-target.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "general",
      "fetchLimit": 15,
      "runtimeMode": "native",
      "includedInCoreAggregate": false,
      "normalizationApplied": false,
      "normalizationReason": "skipped-guard",
      "normalizationAddedCandidates": 0,
      "assistApplied": false,
      "assistReason": "ineligible",
      "addedCandidates": 0,
      "base": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/noise-000.md",
          "docs/spacing-adaptive-target.md",
          "docs/noise-001.md"
        ],
        "unexpectedTop5Count": 2
      },
      "adaptive": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/noise-000.md",
          "docs/spacing-adaptive-target.md",
          "docs/noise-001.md"
        ],
        "unexpectedTop5Count": 2
      },
      "current": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/noise-000.md",
          "docs/spacing-adaptive-target.md",
          "docs/noise-001.md"
        ],
        "unexpectedTop5Count": 2
      },
      "winningLayer": "base"
    },
    {
      "caseId": "control-ineligible",
      "category": "control",
      "expectedOutcome": "hit",
      "query": "what's new",
      "targetDocs": [
        "notes/team-notes.md"
      ],
      "acceptableTargets": [
        "notes/team-notes.md"
      ],
      "selectedCollections": [
        "notes"
      ],
      "queryClass": "general",
      "fetchLimit": 15,
      "runtimeMode": "native",
      "includedInCoreAggregate": false,
      "normalizationApplied": false,
      "normalizationReason": "not-eligible",
      "normalizationAddedCandidates": 0,
      "assistApplied": false,
      "assistReason": "ineligible",
      "addedCandidates": 0,
      "base": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "notes/team-notes.md"
        ],
        "unexpectedTop5Count": 0
      },
      "adaptive": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "notes/team-notes.md"
        ],
        "unexpectedTop5Count": 0
      },
      "current": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "notes/team-notes.md"
        ],
        "unexpectedTop5Count": 0
      },
      "winningLayer": "base"
    },
    {
      "caseId": "control-collection-isolation",
      "category": "control",
      "expectedOutcome": "miss",
      "query": "오케스트레이션",
      "targetDocs": [
        "docs/compound-orchestration.md"
      ],
      "acceptableTargets": [
        "docs/compound-orchestration.md"
      ],
      "selectedCollections": [
        "notes"
      ],
      "queryClass": "short-korean-phrase",
      "fetchLimit": 20,
      "runtimeMode": "native",
      "includedInCoreAggregate": false,
      "normalizationApplied": false,
      "normalizationReason": "not-eligible",
      "normalizationAddedCandidates": 0,
      "assistApplied": false,
      "assistReason": "weak-hit",
      "addedCandidates": 0,
      "base": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [],
        "unexpectedTop5Count": 0
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [],
        "unexpectedTop5Count": 0
      },
      "current": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [],
        "unexpectedTop5Count": 0
      },
      "winningLayer": "none"
    },
    {
      "caseId": "control-no-target",
      "category": "control",
      "expectedOutcome": "miss",
      "query": "양자 방화벽",
      "targetDocs": [],
      "acceptableTargets": [],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "short-korean-phrase",
      "fetchLimit": 20,
      "runtimeMode": "native",
      "includedInCoreAggregate": false,
      "normalizationApplied": false,
      "normalizationReason": "not-eligible",
      "normalizationAddedCandidates": 0,
      "assistApplied": false,
      "assistReason": "weak-hit",
      "addedCandidates": 0,
      "base": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [],
        "unexpectedTop5Count": 0
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [],
        "unexpectedTop5Count": 0
      },
      "current": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [],
        "unexpectedTop5Count": 0
      },
      "winningLayer": "none"
    },
    {
      "caseId": "control-weak-hit",
      "category": "control",
      "expectedOutcome": "miss",
      "query": "분산 추론",
      "targetDocs": [],
      "acceptableTargets": [],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "short-korean-phrase",
      "fetchLimit": 20,
      "runtimeMode": "injected-control",
      "includedInCoreAggregate": false,
      "normalizationApplied": false,
      "normalizationReason": "not-eligible",
      "normalizationAddedCandidates": 0,
      "assistApplied": false,
      "assistReason": "weak-hit",
      "addedCandidates": 0,
      "base": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [],
        "unexpectedTop5Count": 0
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [],
        "unexpectedTop5Count": 0
      },
      "current": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [],
        "unexpectedTop5Count": 0
      },
      "winningLayer": "none"
    },
    {
      "caseId": "question-upload",
      "category": "question",
      "expectedOutcome": "hit",
      "query": "문서 업로드 파싱은 어떻게 동작해?",
      "targetDocs": [
        "docs/question-upload.md"
      ],
      "acceptableTargets": [
        "docs/question-upload.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "general",
      "fetchLimit": 15,
      "runtimeMode": "native",
      "includedInCoreAggregate": false,
      "normalizationApplied": false,
      "normalizationReason": "skipped-guard",
      "normalizationAddedCandidates": 0,
      "assistApplied": false,
      "assistReason": "ineligible",
      "addedCandidates": 0,
      "base": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/question-upload.md"
        ],
        "unexpectedTop5Count": 0
      },
      "adaptive": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/question-upload.md"
        ],
        "unexpectedTop5Count": 0
      },
      "current": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/question-upload.md"
        ],
        "unexpectedTop5Count": 0
      },
      "winningLayer": "base"
    },
    {
      "caseId": "question-adaptive-showcase",
      "category": "question",
      "expectedOutcome": "hit",
      "query": "지속 학습 질문",
      "targetDocs": [
        "docs/spacing-adaptive-target.md"
      ],
      "acceptableTargets": [
        "docs/spacing-adaptive-target.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "short-korean-phrase",
      "fetchLimit": 20,
      "runtimeMode": "injected-control",
      "includedInCoreAggregate": false,
      "normalizationApplied": true,
      "normalizationReason": "applied",
      "normalizationAddedCandidates": 0,
      "assistApplied": false,
      "assistReason": "weak-hit",
      "addedCandidates": 0,
      "base": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/noise-000.md",
          "docs/spacing-adaptive-target.md"
        ],
        "unexpectedTop5Count": 1
      },
      "adaptive": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/spacing-adaptive-target.md",
          "docs/noise-000.md"
        ],
        "unexpectedTop5Count": 1
      },
      "current": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/spacing-adaptive-target.md",
          "docs/noise-000.md"
        ],
        "unexpectedTop5Count": 1
      },
      "winningLayer": "adaptive-rank-only"
    }
  ],
  "aggregate": [
    {
      "scope": "core",
      "side": "upstream-compatible-base",
      "hits": 2,
      "total": 6,
      "recall": 33.33
    },
    {
      "scope": "core",
      "side": "current-kqmd",
      "hits": 6,
      "total": 6,
      "recall": 100
    },
    {
      "scope": "question",
      "side": "upstream-compatible-base",
      "hits": 1,
      "total": 1,
      "recall": 100
    },
    {
      "scope": "question",
      "side": "current-kqmd",
      "hits": 1,
      "total": 1,
      "recall": 100
    }
  ],
  "derivedSignals": {
    "coreRecallUpliftPct": 66.67,
    "questionRecallUpliftPct": 0,
    "adaptiveOnlyGainCount": 1,
    "assistRescueGainCount": 4,
    "normalizationAppliedCount": 1,
    "negativeControlPassRate": 100,
    "negativeControlEmptyTop5Rate": 100,
    "unresolvedCoreMissCount": 0
  }
}
```
