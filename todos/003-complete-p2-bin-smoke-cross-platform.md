---
status: complete
priority: p2
issue_id: "003"
tags: [code-review, testing, quality, cross-platform]
dependencies: []
---

# bin smoke test를 플랫폼 중립적으로 변경

현재 bin smoke test는 `spawnSync(binPath, ...)`로 `bin/qmd.js` 파일 자체를 직접 실행한다. 이 방식은 POSIX shebang 환경에서는 동작하지만, Windows처럼 `.js` 파일을 직접 실행하지 않는 환경에서는 실패할 수 있다.

## Problem Statement

이 테스트의 목적은 published bin contract를 검증하는 것이다. 그런데 현재 구현은 npm이 실제로 만들어 주는 플랫폼별 shim을 검증하는 것이 아니라, POSIX shebang에 기대어 원본 파일을 직접 실행한다. 따라서 Windows CI에서는 테스트가 깨질 수 있고, 반대로 npm 설치 경로의 실제 bin 동작과 어긋날 수도 있다.

## Findings

- `test/bin-smoke.test.ts:19-28`에서 `spawnSync(binPath, ...)`로 `bin/qmd.js`를 직접 실행한다.
- 이 테스트는 `npm run build` 이후 `bin/qmd.js`가 POSIX executable이라는 가정에 의존한다.
- npm 패키지의 실제 사용자 실행 경로는 플랫폼별 shim/npm bin resolution을 거치므로, 현재 테스트는 "published CLI contract"를 완전히 같은 방식으로 검증하지 않는다.

## Proposed Solutions

### Option 1: `node bin/qmd.js`로 실행

**Approach:** smoke test에서 `spawnSync(process.execPath, [binPath, ...])`를 사용한다.

**Pros:**
- 플랫폼 중립적이다
- 현재 구조를 크게 바꾸지 않아도 된다

**Cons:**
- npm이 생성하는 실제 shim 자체를 검증하지는 않는다

**Effort:** Small

**Risk:** Low

---

### Option 2: `npm pack` + 임시 설치 디렉터리에서 실제 bin 검증

**Approach:** tarball을 만든 뒤 임시 디렉터리에 설치하고, 설치된 `qmd` shim을 실행한다.

**Pros:**
- 실제 사용자 설치 경로와 가장 가깝다
- publish contract 검증 범위가 넓다

**Cons:**
- 테스트가 느려진다
- 구현이 더 복잡하다

**Effort:** Medium

**Risk:** Medium

## Recommended Action

smoke test를 `process.execPath` 기반 실행으로 바꾸고, upstream fixture도 플랫폼별 wrapper를 통해 실행되도록 수정한다. 이렇게 하면 POSIX shebang 유무에 의존하지 않고 동일한 테스트 의도를 유지할 수 있다.

## Technical Details

**Affected files:**
- `test/bin-smoke.test.ts`

**Related components:**
- npm package bin contract
- cross-platform CI reliability
- release verification workflow

## Resources

- Review branch: `feat/kqmd-replacement-distribution-scaffold`
- Review target commit: `4151362`

## Acceptance Criteria

- [x] bin smoke test가 POSIX shebang에만 의존하지 않는다
- [x] Windows/macOS/Linux에서 동일하게 통과 가능한 실행 경로를 사용한다
- [x] published CLI contract를 현재보다 더 정확하게 검증한다

## Work Log

### 2026-03-11 - Code Review Finding

**By:** Codex

**Actions:**
- Reviewed smoke test execution path for published CLI verification
- Identified direct JS file execution as a platform-specific assumption
- Classified as P2 because it can break CI portability without touching production code

**Learnings:**
- "bin이 동작한다"는 테스트는 파일 실행이 아니라 설치된 실행 경로를 기준으로 봐야 한다
- POSIX에서 통과하는 CLI smoke test가 곧 cross-platform 테스트는 아니다

### 2026-03-11 - Todo Resolved

**By:** Codex

**Actions:**
- `test/bin-smoke.test.ts`에서 top-level bin 실행을 `spawnSync(process.execPath, [binPath, ...])`로 변경
- upstream fixture 호출도 플랫폼별 wrapper를 생성해 direct shebang execution 의존성을 제거
- `npm run check`로 smoke test 포함 전체 검증 재실행

**Learnings:**
- cross-platform CLI smoke test는 top-level bin 뿐 아니라 delegated fixture 실행 경로까지 같이 중립화해야 한다
- 단순히 `node bin/qmd.js`로 감싸는 것만으로는 delegate 경로의 플랫폼 의존성이 남을 수 있다
