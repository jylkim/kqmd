# Korean Query Recall Metrics

Date: 2026-03-20
Command: `bun run measure:query-recall`

이 문서는 upstream-compatible base query 대비 current kqmd query의 한국어 recall correctness 비교 벤치마크다.
synthetic fixture에서 띄어쓰기 변형, 복합어 분해, 한영 혼합 기술어, 긴 한국어 plain query를 비교하고, control/diagnostic case는 별도 표로 분리한다.

## Method

- 비교 레이어:
  - `base`: upstream-compatible base query
  - `adaptive`: base candidate set에 adaptive rerank만 적용한 결과
  - `current`: current kqmd query path (`adaptive+assist`)
- 핵심 카테고리:
  - `spacing`: 띄어쓰기 변형
  - `compound`: 복합어 분해
  - `mixed`: 한영 혼합 기술어
  - `long-query`: native long Korean plain query guardrail
- control 카테고리:
  - `conservative-syntax`, `weak-hit`, `ineligible`, `collection-isolation`, `no-target miss`
- aggregate 범위: core 카테고리에는 native `long-query`가 포함되며, diagnostic injected case와 control은 제외한다
- persisted surface: benchmark markdown/raw JSON은 synthetic label만 남기고 raw query와 intent는 남기지 않는다
- hit 정의: target 문서의 displayPath가 top-5 결과에 존재
- miss 정의: target 문서가 top-5에 없으면 통과하며, empty top-5 purity는 별도 signal로 본다
- fixture/runtime: deterministic synthetic fixture, temp HOME/XDG/INDEX isolation, deterministic LLM stub, deterministic timing seam, single-pass serial execution

## Results

| Category | Case | Target | base | adaptive | current | Delta |
|---|---|---|---|---|---|---|
| spacing | spacing-adaptive | docs/spacing-adaptive-target.md | hit@2 | hit@2 | hit@2 | 0 |
| spacing | spacing-rescue-upload | docs/spacing-rescue-upload.md | miss | miss | hit@3 | +1 |
| compound | compound-orchestration | docs/compound-orchestration.md | miss | miss | hit@2 | +1 |
| compound | compound-analysis | docs/compound-analysis.md | hit@1 | hit@1 | hit@1 | 0 |
| mixed | mixed-schema | docs/mixed-schema.md | miss | miss | hit@2 | +1 |
| mixed | mixed-auth | docs/mixed-auth.md | miss | miss | hit@1 | +1 |
| long-query | long-query-question-upload | docs/question-upload.md | miss | miss | hit@3 | +1 |
| long-query | long-query-descriptive-upload | docs/long-query-upload-overview.md | hit@1 | hit@1 | hit@1 | 0 |
| long-query | long-query-normalization-rescue | docs/long-query-normalized-upload.md | miss | miss | hit@1 | +1 |

## Controls

| Case | Expected | base | current | Assist | Reason |
|---|---|---|---|---|---|
| control-quoted | hit | hit@1 | hit@1 | no | conservative-syntax |
| control-negated | hit | hit@2 | hit@2 | no | ineligible |
| control-ineligible | hit | hit@1 | hit@1 | no | ineligible |
| control-collection-isolation | miss | miss | miss | no | weak-hit |
| control-no-target | miss | miss | miss | no | weak-hit |
| control-weak-hit | miss | miss | miss | no | weak-hit |

## Long Query

| Case | Target | base | current | In Core |
|---|---|---|---|---|
| long-query-question-upload | docs/question-upload.md | miss | hit@3 | yes |
| long-query-descriptive-upload | docs/long-query-upload-overview.md | hit@1 | hit@1 | yes |
| long-query-normalization-rescue | docs/long-query-normalized-upload.md | miss | hit@1 | yes |

## Diagnostics

| Case | Current | Mode |
|---|---|---|
| diagnostic-long-query-adaptive-showcase | hit@1 | injected-control |

## Aggregate

| Scope | Side | Hits | Total | Recall |
|---|---|---:|---:|---:|
| core | upstream-compatible-base | 3 | 9 | 33.33% |
| core | current-kqmd | 9 | 9 | 100% |
| long-query | upstream-compatible-base | 1 | 3 | 33.33% |
| long-query | current-kqmd | 3 | 3 | 100% |

## Derived Signals

- core current recall uplift vs upstream-compatible base: 66.67%
- long-query current recall uplift vs upstream-compatible base: 66.67%
- native long-query count: 3
- diagnostic long-query count: 1
- adaptive-only gain count: 0
- assist-rescue gain count: 4
- normalization applied count: 2
- negative control pass rate: 100%
- negative control empty-top5 rate: 100%
- unresolved core miss count: 0

## Notes

- upstream baseline은 실제 upstream CLI subprocess가 아니라 upstream-compatible seam이다.
- core aggregate는 native `long-query`를 포함하고 control/diagnostic case는 제외한다.
- benchmark markdown/raw JSON은 synthetic label만 persisted surface로 사용한다.
- assist score normalization은 raw base score-domain과 동치가 아니다.
- rescue dedupe는 `docid || displayPath`, rescue cap은 downstream policy 계약을 따른다.
- 이 리포트는 recall correctness만 다루며, wall-clock latency/overhead나 production representativeness 주장은 하지 않는다.
- negative control pass rate는 `expected=miss` control만 포함하며, noise-only 반환은 empty-top5 rate로 따로 본다.
- deterministic fixture를 사용하므로 real vault 일반화에는 제한이 있다.
- raw JSON below is the source-of-truth; markdown tables are derived views.

```json
{
  "schemaVersion": "3",
  "fixtureVersion": "2",
  "datasetId": "kqmd-query-recall-v2",
  "rows": [
    {
      "caseId": "spacing-adaptive",
      "syntheticLabel": "spacing-adaptive",
      "category": "spacing",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
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
      "syntheticLabel": "spacing-rescue-upload",
      "category": "spacing",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
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
          "docs/long-query-normalized-upload.md",
          "docs/long-query-upload-overview.md",
          "docs/question-upload.md"
        ],
        "unexpectedTop5Count": 3
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/long-query-normalized-upload.md",
          "docs/long-query-upload-overview.md",
          "docs/question-upload.md"
        ],
        "unexpectedTop5Count": 3
      },
      "current": {
        "hitStatus": "hit@3",
        "firstHitRank": 3,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/long-query-normalized-upload.md",
          "docs/long-query-upload-overview.md",
          "docs/spacing-rescue-upload.md",
          "docs/question-upload.md"
        ],
        "unexpectedTop5Count": 3
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "compound-orchestration",
      "syntheticLabel": "compound-orchestration",
      "category": "compound",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
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
      "syntheticLabel": "compound-analysis",
      "category": "compound",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
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
      "syntheticLabel": "mixed-schema",
      "category": "mixed",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
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
      "syntheticLabel": "mixed-auth",
      "category": "mixed",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
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
      "syntheticLabel": "control-quoted",
      "category": "control",
      "aggregateScope": "excluded",
      "expectedOutcome": "hit",
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
      "syntheticLabel": "control-negated",
      "category": "control",
      "aggregateScope": "excluded",
      "expectedOutcome": "hit",
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
      "syntheticLabel": "control-ineligible",
      "category": "control",
      "aggregateScope": "excluded",
      "expectedOutcome": "hit",
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
      "syntheticLabel": "control-collection-isolation",
      "category": "control",
      "aggregateScope": "excluded",
      "expectedOutcome": "miss",
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
      "syntheticLabel": "control-no-target",
      "category": "control",
      "aggregateScope": "excluded",
      "expectedOutcome": "miss",
      "targetDocs": [],
      "acceptableTargets": [],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "short-korean-phrase",
      "fetchLimit": 20,
      "runtimeMode": "native",
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
      "syntheticLabel": "control-weak-hit",
      "category": "control",
      "aggregateScope": "excluded",
      "expectedOutcome": "miss",
      "targetDocs": [],
      "acceptableTargets": [],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "short-korean-phrase",
      "fetchLimit": 20,
      "runtimeMode": "injected-control",
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
      "caseId": "long-query-question-upload",
      "syntheticLabel": "long-query-question-upload",
      "category": "long-query",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
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
      "normalizationApplied": true,
      "normalizationReason": "applied",
      "normalizationAddedCandidates": 3,
      "assistApplied": false,
      "assistReason": "ineligible",
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
        "hitStatus": "hit@3",
        "firstHitRank": 3,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/long-query-normalized-upload.md",
          "docs/long-query-upload-overview.md",
          "docs/question-upload.md"
        ],
        "unexpectedTop5Count": 2
      },
      "winningLayer": "tie"
    },
    {
      "caseId": "long-query-descriptive-upload",
      "syntheticLabel": "long-query-descriptive-upload",
      "category": "long-query",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/long-query-upload-overview.md"
      ],
      "acceptableTargets": [
        "docs/long-query-upload-overview.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "general",
      "fetchLimit": 15,
      "runtimeMode": "native",
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
          "docs/long-query-upload-overview.md"
        ],
        "unexpectedTop5Count": 0
      },
      "adaptive": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/long-query-upload-overview.md"
        ],
        "unexpectedTop5Count": 0
      },
      "current": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/long-query-upload-overview.md"
        ],
        "unexpectedTop5Count": 0
      },
      "winningLayer": "base"
    },
    {
      "caseId": "long-query-normalization-rescue",
      "syntheticLabel": "long-query-normalization-rescue",
      "category": "long-query",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/long-query-normalized-upload.md"
      ],
      "acceptableTargets": [
        "docs/long-query-normalized-upload.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "general",
      "fetchLimit": 15,
      "runtimeMode": "native",
      "normalizationApplied": true,
      "normalizationReason": "applied",
      "normalizationAddedCandidates": 3,
      "assistApplied": false,
      "assistReason": "ineligible",
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
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/long-query-normalized-upload.md",
          "docs/long-query-upload-overview.md",
          "docs/question-upload.md"
        ],
        "unexpectedTop5Count": 2
      },
      "winningLayer": "tie"
    },
    {
      "caseId": "diagnostic-long-query-adaptive-showcase",
      "syntheticLabel": "diagnostic-long-query-adaptive-showcase",
      "category": "long-query",
      "aggregateScope": "excluded",
      "expectedOutcome": "hit",
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
      "hits": 3,
      "total": 9,
      "recall": 33.33
    },
    {
      "scope": "core",
      "side": "current-kqmd",
      "hits": 9,
      "total": 9,
      "recall": 100
    },
    {
      "scope": "long-query",
      "side": "upstream-compatible-base",
      "hits": 1,
      "total": 3,
      "recall": 33.33
    },
    {
      "scope": "long-query",
      "side": "current-kqmd",
      "hits": 3,
      "total": 3,
      "recall": 100
    }
  ],
  "derivedSignals": {
    "coreRecallUpliftPct": 66.67,
    "longQueryRecallUpliftPct": 66.67,
    "nativeLongQueryCount": 3,
    "diagnosticLongQueryCount": 1,
    "adaptiveOnlyGainCount": 0,
    "assistRescueGainCount": 4,
    "normalizationAppliedCount": 2,
    "negativeControlPassRate": 100,
    "negativeControlEmptyTop5Rate": 100,
    "unresolvedCoreMissCount": 0
  }
}
```
