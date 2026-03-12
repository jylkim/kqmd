---
status: complete
priority: p2
issue_id: "019"
tags: [code-review, security, supply-chain, kiwi, search, typescript]
dependencies: []
---

# Add integrity and operational guardrails for runtime Kiwi model downloads

## Problem Statement

현재 구현은 첫 Hangul search/update 시점에 Kiwi 모델 파일을 GitHub raw URL에서 직접 다운로드합니다. 버전 태그는 고정했지만 checksum 검증, partial file recovery, 명시적 offline 안내가 없어서, runtime behavior가 네트워크 상태와 third-party artifact availability에 강하게 의존합니다.

## Findings

- [`src/commands/owned/kiwi_tokenizer.ts:14`](../src/commands/owned/kiwi_tokenizer.ts) 는 raw GitHub URL을 model source로 사용합니다.
- [`src/commands/owned/kiwi_tokenizer.ts:74`](../src/commands/owned/kiwi_tokenizer.ts) 이후는 missing file이면 즉시 fetch 후 cache에 저장합니다.
- 다운로드한 파일에 대해 checksum/size/version manifest 검증이 없습니다.
- partial cache file, interrupted download, stale cache cleanup에 대한 명시적 처리도 없습니다.
- README와 status/update UX는 “첫 실행 시 network artifact fetch가 발생할 수 있다”는 operational reality를 충분히 설명하지 않습니다.

## Proposed Solutions

### Option 1: Add checksum manifest + atomic file write

**Approach:** expected hash manifest를 코드에 함께 두고, download는 temp file에 받은 뒤 검증 후 rename 합니다.

**Pros:**
- 현재 runtime download model을 유지하면서도 공급망/partial write 리스크를 줄일 수 있습니다

**Cons:**
- hash 관리 비용이 생깁니다

**Effort:** Medium

**Risk:** Low

### Option 2: Move model provisioning to install/build time

**Approach:** runtime fetch를 없애고, install/build 단계에서 model files를 준비하거나 vendored asset로 포함합니다.

**Pros:**
- production/runtime network dependency가 사라집니다

**Cons:**
- 패키징과 배포 계약이 커집니다
- 저장소/배포물 크기가 증가할 수 있습니다

**Effort:** Large

**Risk:** Medium

## Recommended Action

Triage 필요. 단기적으로는 Option 1, 장기적으로는 Option 2 검토가 적절합니다.

## Technical Details

**Affected files:**
- `src/commands/owned/kiwi_tokenizer.ts`
- `README.md`
- `docs/development.md`
- related runtime/download tests

## Acceptance Criteria

- [x] runtime model download에 checksum 또는 동등한 integrity guard가 있습니다
- [x] partial download/cache corruption이 clean하게 복구됩니다
- [x] offline or blocked-network failure mode가 user-facing 문서나 에러 메시지에 반영됩니다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- Reviewed commit `62728ef`
- Traced Kiwi model bootstrap from cache miss to raw GitHub download
- Identified missing integrity/offline guardrails around runtime artifact provisioning

**Learnings:**
- 버전 태그 pinning만으로는 runtime artifact integrity와 operational predictability를 충분히 설명하지 못합니다

### 2026-03-13 - Resolved

**By:** Codex

**Actions:**
- added pinned SHA-256 manifest for required Kiwi model files
- changed downloads to timeout + checksum verification + atomic temp-file rename
- added unit coverage for checksum mismatch triggering redownload

**Learnings:**
- checksum validation closes more of this gap than tag pinning alone
