---
status: complete
priority: p2
issue_id: "023"
tags: [code-review, security, supply-chain, bun, tooling]
dependencies: []
---

# Add a guardrail for `trustedDependencies` drift

`package.json`에 `trustedDependencies`를 추가해 Bun install을 안정화했지만, 이후 dependency update에서 trust surface가 바뀌는지 자동으로 막는 검증은 아직 없습니다.

## Problem Statement

현재 레포는 `better-sqlite3`, `esbuild`, `node-llama-cpp`를 `trustedDependencies`에 영구 등록합니다. 이 자체는 이번 Bun-first 전환을 위해 필요하지만, 앞으로 버전 bump나 dependency 변경이 생겼을 때 install/postinstall 스크립트 surface가 달라져도 문서상의 재검토 checklist 외에는 강제 장치가 없습니다.

즉, maintainer가 `bun pm untrusted`를 수동으로 확인하지 않으면 supply-chain trust 범위가 조용히 넓어질 수 있습니다.

## Findings

- 문제 위치:
  - `package.json:31-35`
  - `docs/development.md:120-129`
- 현재 상태:
  - `trustedDependencies`는 exact allowlist로 기록되어 있다.
  - 하지만 CI/script/test 차원에서 allowlist drift를 실패로 만드는 자동 체크는 없다.
- 리스크:
  - upstream 또는 transitive dependency update로 install-time script behavior가 바뀌어도 수동 검토에만 의존하게 된다.
  - 문서와 실제 enforcement 사이에 간극이 남는다.

## Proposed Solutions

### Option 1: Add an automated `bun pm untrusted` verification step

**Approach:** `bun pm untrusted` 출력이 비어 있지 않으면 실패하는 검증 스크립트나 test를 추가합니다.

**Pros:**
- 가장 직접적인 guardrail입니다.
- 문서가 아니라 실행 결과로 trust drift를 막습니다.

**Cons:**
- Bun 출력 형식 변화에 민감할 수 있습니다.

**Effort:** Small

**Risk:** Low

---

### Option 2: Add a committed allowlist snapshot check

**Approach:** 현재 trusted package set을 별도 스냅샷 파일로 저장하고, install 후 결과와 비교합니다.

**Pros:**
- 변경 diff가 명시적으로 보입니다.
- review에서 drift를 읽기 쉽습니다.

**Cons:**
- 스냅샷 관리 비용이 생깁니다.
- 출력/포맷 normalizing 로직이 필요할 수 있습니다.

**Effort:** Medium

**Risk:** Low

## Recommended Action

`bun pm untrusted` 결과에서 untrusted package path가 하나라도 나오면 실패하는 integration test를 추가한다. 이렇게 하면 이후 dependency update나 trust surface 변화가 생겼을 때 `bun run test`와 `bun run check`가 바로 red가 되어 문서상의 수동 checklist에만 의존하지 않게 된다.

## Technical Details

**Affected files:**
- `package.json`
- `docs/development.md`
- `test/` 또는 `scripts/` 내 verification entrypoint

## Resources

- Commit under review: `52cde2ad1b141b1132b02ea1a65703245678877a`
- Review finding source: security review on Bun-first toolchain commit
- Verification command: `bun pm untrusted`

## Acceptance Criteria

- [x] install/lifecycle trust surface가 예상과 달라지면 local verification 또는 CI equivalent가 실패한다
- [x] `trustedDependencies` 변경은 명시적 review signal 없이는 조용히 통과하지 않는다
- [x] 문서의 version bump checklist와 실제 enforcement가 같은 방향을 가리킨다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- Bun-first 전환 커밋의 `package.json`과 개발 문서를 검토했다
- `trustedDependencies` allowlist가 추가된 반면, drift를 자동으로 막는 실행 검증은 없음을 확인했다
- supply-chain 관점의 follow-up todo를 생성했다

**Learnings:**
- exact allowlist만으로는 충분하지 않고, future dependency updates에서 trust surface drift를 실패로 만드는 guardrail이 필요하다

### 2026-03-13 - Implementation Complete

**By:** Codex

**Actions:**
- `test/trusted-dependencies.test.ts`를 추가해 `bun pm untrusted` 결과에 untrusted package path가 남아 있으면 테스트가 실패하도록 했다
- `KQMD_BUN_BIN` override와 cross-platform `which`/`where` fallback을 포함해 Bun binary 해석을 안정화했다
- `bun run test -- trusted-dependencies`로 새 guardrail이 green인지 검증했다

**Learnings:**
- `bun pm untrusted`는 exit code 대신 stdout에 상태를 표현하므로, path-like output line을 직접 파싱하는 쪽이 가장 단순한 drift guardrail이었다
