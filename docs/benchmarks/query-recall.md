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
| 띄어쓰기 | 보안 취약점 | seccomp필터와 Landlock LSM을 결합한 다층 방어를 구현합니다. | miss | **hit@2** |
| 띄어쓰기 | 테스트 커버리지 | 리팩토링이 완료된 모듈의 테스트커버리지를 확인했습니다. | miss | **hit@2** |
| 복합어 | 프롬프트 | 시스템**프롬프트** 주입 기능과 맥락 관리가 핵심 요구사항입니다. | miss | **hit@2** |
| 복합어 | 추적 | 분산**추적** 설정과 메트릭수집 파이프라인을 구축합니다. | miss | **hit@1** |
| 복합어 | 소싱 | SQLite에 이벤트**소싱** 패턴을 적용하여 상태를 관리합니다. | miss | **hit@1** |
| 한영 혼합 | 파이프라인 | Jenkins**파이프라인**에서 GitHub Actions로 전환을 진행했습니다. | miss | **hit@2** |
| 한영 혼합 | 대시보드 | Grafana**대시보드**에 API 레이턴시와 에러율 패널을 추가합니다. | miss | **hit@2** |
| 한영 혼합 | 바인딩 | PyO3**바인딩**으로 Python에서 Rust 코어를 호출합니다. | miss | **hit@1** |
| 긴 쿼리 | 보안 취약점 스캔은 어떻게 동작해? | 보안 취약점 스캔 동작 단계와 결과 해석 방법을 설명합니다. | miss | **hit@1** |
| 긴 쿼리 | Grafana 대시보드 설정 방법을 정리한 문서 | Grafana 대시보드 설정 방법과 패널 구성을 정리한 가이드입니다. | miss | miss |
| 긴 쿼리 | pytest 실행 환경은 어떻게 설정해줘? | pytest 실행 환경 설정 단계와 conftest 구성을 설명합니다. | miss | miss |

## 검증용 테스트

| 쿼리 | 예상 | QMD | K-QMD | 설명 |
|---|---|:---:|:---:|---|
| "보안 취약점" | hit | hit@1 | hit@1 | conservative-syntax |
| 보안 취약점 -파이프라인 | hit | hit@1 | hit@1 | ineligible |
| what's new | hit | hit@1 | hit@1 | ineligible |
| 추적 | miss | miss | miss | weak-hit |
| 양자 방화벽 | miss | miss | miss | weak-hit |
| 분산 추론 | miss | miss | miss | weak-hit |

## 요약

| | Hits | Total | Recall |
|---|---:|---:|---:|
| QMD | 0 | 11 | 0% |
| K-QMD | 9 | 11 | 81.82% |

## Notes

- deterministic synthetic fixture를 사용하므로 실제 vault와 결과가 다를 수 있습니다.
- 이 벤치마크는 recall correctness만 다루며, 응답 시간은 측정하지 않습니다.
- 아래 JSON은 전체 측정 데이터입니다.

```json
{
  "schemaVersion": "3",
  "fixtureVersion": "3",
  "datasetId": "kqmd-query-recall-v2",
  "rows": [
    {
      "caseId": "spacing-security",
      "syntheticLabel": "spacing-security",
      "category": "spacing",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/security-sandbox.md"
      ],
      "acceptableTargets": [
        "docs/security-sandbox.md"
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
          "docs/security-scan-faq.md",
          "docs/noise-001.md",
          "docs/noise-010.md"
        ],
        "unexpectedTop5Count": 3
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/security-scan-faq.md",
          "docs/noise-001.md",
          "docs/noise-010.md"
        ],
        "unexpectedTop5Count": 3
      },
      "current": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/security-scan-faq.md",
          "docs/security-sandbox.md",
          "docs/noise-001.md",
          "docs/noise-010.md"
        ],
        "unexpectedTop5Count": 3
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "spacing-coverage",
      "syntheticLabel": "spacing-coverage",
      "category": "spacing",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/meeting-review.md"
      ],
      "acceptableTargets": [
        "docs/meeting-review.md"
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
          "docs/noise-002.md"
        ],
        "unexpectedTop5Count": 1
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/noise-002.md"
        ],
        "unexpectedTop5Count": 1
      },
      "current": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/noise-002.md",
          "docs/meeting-review.md"
        ],
        "unexpectedTop5Count": 1
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "compound-prompt",
      "syntheticLabel": "compound-prompt",
      "category": "compound",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/agent-architecture.md"
      ],
      "acceptableTargets": [
        "docs/agent-architecture.md"
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
          "docs/noise-007.md"
        ],
        "unexpectedTop5Count": 1
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/noise-007.md"
        ],
        "unexpectedTop5Count": 1
      },
      "current": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/noise-007.md",
          "docs/agent-architecture.md"
        ],
        "unexpectedTop5Count": 1
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "compound-tracing",
      "syntheticLabel": "compound-tracing",
      "category": "compound",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/observability-guide.md"
      ],
      "acceptableTargets": [
        "docs/observability-guide.md"
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
          "docs/observability-guide.md"
        ],
        "unexpectedTop5Count": 0
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "compound-sourcing",
      "syntheticLabel": "compound-sourcing",
      "category": "compound",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/rust-sdk.md"
      ],
      "acceptableTargets": [
        "docs/rust-sdk.md"
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
          "docs/rust-sdk.md"
        ],
        "unexpectedTop5Count": 0
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "mixed-pipeline",
      "syntheticLabel": "mixed-pipeline",
      "category": "mixed",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/devops-deploy.md"
      ],
      "acceptableTargets": [
        "docs/devops-deploy.md"
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
          "docs/observability-guide.md"
        ],
        "unexpectedTop5Count": 1
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/observability-guide.md"
        ],
        "unexpectedTop5Count": 1
      },
      "current": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/observability-guide.md",
          "docs/devops-deploy.md"
        ],
        "unexpectedTop5Count": 1
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "mixed-dashboard",
      "syntheticLabel": "mixed-dashboard",
      "category": "mixed",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/observability-guide.md"
      ],
      "acceptableTargets": [
        "docs/observability-guide.md"
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
          "docs/observability-setup.md",
          "docs/noise-005.md"
        ],
        "unexpectedTop5Count": 2
      },
      "adaptive": {
        "hitStatus": "miss",
        "firstHitRank": null,
        "targetInTop5": false,
        "targetPresentAnyRank": false,
        "top5Paths": [
          "docs/observability-setup.md",
          "docs/noise-005.md"
        ],
        "unexpectedTop5Count": 2
      },
      "current": {
        "hitStatus": "hit@2",
        "firstHitRank": 2,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/observability-setup.md",
          "docs/observability-guide.md",
          "docs/noise-005.md"
        ],
        "unexpectedTop5Count": 2
      },
      "winningLayer": "assist-rescue"
    },
    {
      "caseId": "mixed-binding",
      "syntheticLabel": "mixed-binding",
      "category": "mixed",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/rust-sdk.md"
      ],
      "acceptableTargets": [
        "docs/rust-sdk.md"
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
          "docs/rust-sdk.md"
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
        "docs/security-scan-faq.md"
      ],
      "acceptableTargets": [
        "docs/security-scan-faq.md"
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
          "docs/security-scan-faq.md"
        ],
        "unexpectedTop5Count": 0
      },
      "adaptive": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/security-scan-faq.md"
        ],
        "unexpectedTop5Count": 0
      },
      "current": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/security-scan-faq.md"
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
        "docs/security-scan-faq.md"
      ],
      "acceptableTargets": [
        "docs/security-scan-faq.md"
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
          "docs/security-scan-faq.md",
          "docs/noise-001.md",
          "docs/noise-010.md"
        ],
        "unexpectedTop5Count": 2
      },
      "adaptive": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/security-scan-faq.md",
          "docs/noise-001.md",
          "docs/noise-010.md"
        ],
        "unexpectedTop5Count": 2
      },
      "current": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/security-scan-faq.md",
          "docs/noise-001.md",
          "docs/noise-010.md"
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
        "docs/observability-guide.md"
      ],
      "acceptableTargets": [
        "docs/observability-guide.md"
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
      "caseId": "long-query-security-scan",
      "syntheticLabel": "long-query-security-scan",
      "category": "long-query",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/security-scan-faq.md"
      ],
      "acceptableTargets": [
        "docs/security-scan-faq.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "general",
      "fetchLimit": 15,
      "runtimeMode": "native",
      "normalizationApplied": true,
      "normalizationReason": "applied",
      "normalizationAddedCandidates": 2,
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
          "docs/security-scan-faq.md",
          "docs/noise-010.md"
        ],
        "unexpectedTop5Count": 1
      },
      "winningLayer": "tie"
    },
    {
      "caseId": "long-query-dashboard-setup",
      "syntheticLabel": "long-query-dashboard-setup",
      "category": "long-query",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/observability-setup.md"
      ],
      "acceptableTargets": [
        "docs/observability-setup.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "mixed-technical",
      "fetchLimit": 20,
      "runtimeMode": "native",
      "normalizationApplied": true,
      "normalizationReason": "applied",
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
      "caseId": "long-query-test-env",
      "syntheticLabel": "long-query-test-env",
      "category": "long-query",
      "aggregateScope": "core",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/python-test-setup.md"
      ],
      "acceptableTargets": [
        "docs/python-test-setup.md"
      ],
      "selectedCollections": [
        "docs"
      ],
      "queryClass": "mixed-technical",
      "fetchLimit": 20,
      "runtimeMode": "native",
      "normalizationApplied": true,
      "normalizationReason": "applied",
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
      "caseId": "diagnostic-long-query-adaptive-showcase",
      "syntheticLabel": "diagnostic-long-query-adaptive-showcase",
      "category": "long-query",
      "aggregateScope": "excluded",
      "expectedOutcome": "hit",
      "targetDocs": [
        "docs/security-sandbox.md"
      ],
      "acceptableTargets": [
        "docs/security-sandbox.md"
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
          "docs/noise-001.md",
          "docs/security-sandbox.md"
        ],
        "unexpectedTop5Count": 1
      },
      "adaptive": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/security-sandbox.md",
          "docs/noise-001.md"
        ],
        "unexpectedTop5Count": 1
      },
      "current": {
        "hitStatus": "hit@1",
        "firstHitRank": 1,
        "targetInTop5": true,
        "targetPresentAnyRank": true,
        "top5Paths": [
          "docs/security-sandbox.md",
          "docs/noise-001.md"
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
      "hits": 0,
      "total": 11,
      "recall": 0
    },
    {
      "scope": "core",
      "side": "current-kqmd",
      "hits": 9,
      "total": 11,
      "recall": 81.82
    },
    {
      "scope": "long-query",
      "side": "upstream-compatible-base",
      "hits": 0,
      "total": 3,
      "recall": 0
    },
    {
      "scope": "long-query",
      "side": "current-kqmd",
      "hits": 1,
      "total": 3,
      "recall": 33.33
    }
  ],
  "derivedSignals": {
    "coreRecallUpliftPct": 81.82,
    "longQueryRecallUpliftPct": 33.33,
    "nativeLongQueryCount": 3,
    "diagnosticLongQueryCount": 1,
    "adaptiveOnlyGainCount": 0,
    "assistRescueGainCount": 8,
    "normalizationAppliedCount": 3,
    "negativeControlPassRate": 100,
    "negativeControlEmptyTop5Rate": 100,
    "unresolvedCoreMissCount": 2
  }
}
```
