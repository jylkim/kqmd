# Korean Query Recall Benchmark

Date: 2026-03-20
Command: `bun run benchmark:query-recall`

QMD의 query 명령에서 한국어 검색 품질을 비교한 벤치마크입니다.
띄어쓰기 변형, 복합어, 한영 혼합, 긴 한국어 질문에서 QMD 대비 K-QMD의 검색 결과를 비교합니다.

## 테스트 방법

- synthetic fixture 문서에 대해 QMD와 K-QMD의 query 결과를 비교합니다.
- hit: target 문서가 상위 5개 결과에 포함되면 검색 성공입니다.
- miss: target 문서가 상위 5개 결과에 없으면 검색 실패입니다.

## 결과

| 패턴 | 쿼리 | 문서 내용 | QMD | K-QMD |
|---|---|---|:---:|:---:|
| 띄어쓰기 | 지속 학습 | **지속 학습** 워크플로우를 짧게 정리합니다. | hit@2 | hit@2 |
| 띄어쓰기 | 문서 업로드 파싱 | 문서업로드파서와 업로드파싱기 동작을 설명합니다. | miss | **hit@3** |
| 복합어 | 오케스트레이션 | 컨테이너**오케스트레이션** 환경에서 shadow index를 운영합니다. | miss | **hit@2** |
| 복합어 | 분석 | 형태소**분석**기와 텍스트정규화기를 비교합니다. | hit@1 | hit@1 |
| 한영 혼합 | schema 마이그레이션 | Schema마이그레이션 절차와 rollback 전략을 문서화합니다. | miss | **hit@2** |
| 한영 혼합 | oauth 인증 | OAuth인증 flow와 callback 정책을 설명합니다. | miss | **hit@1** |
| 긴 쿼리 | 문서 업로드 파싱은 어떻게 동작해? | 문서 업로드 파싱 단계와 indexing 흐름을 설명합니다. | miss | **hit@3** |
| 긴 쿼리 | 문서 업로드 파싱 동작 단계를 정리한 문서 | 문서 업로드 파싱 동작 단계를 정리한 개요 문서입니다. | hit@1 | hit@1 |
| 긴 쿼리 | 문서 업로드 파싱은 어떻게 설명해줘? | 문서 업로드 파싱 단계와 parser 흐름을 설명합니다. | miss | **hit@1** |

## 검증용 테스트

| 쿼리 | 예상 | QMD | K-QMD | 설명 |
|---|---|:---:|:---:|---|
| "지속 학습" | hit | hit@1 | hit@1 | conservative-syntax |
| 지속 학습 -파이프라인 | hit | hit@2 | hit@2 | ineligible |
| what's new | hit | hit@1 | hit@1 | ineligible |
| 오케스트레이션 | miss | miss | miss | weak-hit |
| 양자 방화벽 | miss | miss | miss | weak-hit |
| 분산 추론 | miss | miss | miss | weak-hit |

## 요약

| | Hits | Total | Recall |
|---|---:|---:|---:|
| QMD | 3 | 9 | 33.33% |
| K-QMD | 9 | 9 | **100%** |

## Notes

- deterministic synthetic fixture를 사용하므로 실제 vault와 결과가 다를 수 있습니다.
- 이 벤치마크는 recall correctness만 다루며, 응답 시간은 측정하지 않습니다.
- 아래 JSON은 전체 측정 데이터입니다.

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
