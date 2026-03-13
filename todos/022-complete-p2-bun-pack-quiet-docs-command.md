---
status: complete
priority: p2
issue_id: "022"
tags: [code-review, documentation, bun, tooling]
dependencies: []
---

# Fix `bun pm pack --quiet` capture in development docs

`docs/development.md`의 tarball smoke 예제가 실제 `bun pm pack --quiet` 출력 형식과 맞지 않아 그대로 실행하면 실패합니다.

## Problem Statement

개발자 문서는 `TARBALL=$(bun pm pack --quiet)`로 tarball 이름만 받을 수 있다고 가정합니다. 하지만 현재 `package.json#prepack`이 `bun run build`를 실행하므로, 실제 출력에는 build 로그와 tarball 이름이 함께 섞여 들어옵니다. 그 결과 `TARBALL` 변수에 여러 줄이 들어가고 뒤의 `tar -tf "$TARBALL"` 명령이 실패합니다.

## Findings

- 재현 경로:
  - `bun pm pack --quiet | cat -vet`
- 실제 출력:
  - `$ bun run build`
  - `$ tsc -p tsconfig.build.json`
  - `kqmd-0.1.0.tgz`
- 문제 위치:
  - `docs/development.md:112`
- 영향:
  - 문서대로 actual tarball smoke를 수행하려는 개발자가 바로 실패합니다.
  - release rehearsal 문서 신뢰도가 떨어집니다.

## Proposed Solutions

### Option 1: Capture only the final line

**Approach:** `TARBALL=$(bun pm pack --quiet | tail -n 1)`로 tarball 파일명만 가져옵니다.

**Pros:**
- 가장 작은 수정입니다.
- 현재 `prepack` 로그 출력과 호환됩니다.

**Cons:**
- 출력 형식이 바뀌면 다시 손봐야 할 수 있습니다.

**Effort:** Small

**Risk:** Low

---

### Option 2: Write tarball to a known filename

**Approach:** `bun pm pack --filename kqmd-pack-smoke.tgz` 같이 파일명을 고정하고 그 경로를 사용합니다.

**Pros:**
- stdout 파싱에 의존하지 않습니다.
- smoke script가 더 결정적입니다.

**Cons:**
- 문서 예제가 조금 더 길어집니다.
- 기존 quick copy-paste 흐름이 바뀝니다.

**Effort:** Small

**Risk:** Low

## Recommended Action

`bun pm pack --quiet`의 stdout 전체를 신뢰하지 않고 마지막 줄만 취하는 최소 수정으로 문서를 고친다. 기존 `prepack` build 로그를 유지하면서도, actual tarball smoke 예제가 그대로 동작하는 방향이라 가장 안전하다.

## Technical Details

**Affected files:**
- `docs/development.md:109-113`
- `package.json:19-29`

## Resources

- Commit under review: `52cde2ad1b141b1132b02ea1a65703245678877a`
- Reproduction command: `bun pm pack --quiet | cat -vet`

## Acceptance Criteria

- [x] `docs/development.md`의 tarball smoke 예제가 현재 `prepack` 출력 형식에서도 그대로 동작한다
- [x] 복사한 명령을 실제로 실행해 tarball path capture와 `tar -tf` 확인이 성공한다

## Work Log

### 2026-03-13 - Review Finding Created

**By:** Codex

**Actions:**
- `git show HEAD`로 Bun-first 전환 커밋을 검토했다
- `bun pm pack --quiet | cat -vet`로 문서 예제를 실제 재현했다
- `docs/development.md:112`의 tarball capture가 multi-line output을 처리하지 못함을 확인했다

**Learnings:**
- `bun pm pack --quiet`는 tarball 이름만 출력한다고 가정하면 안 된다. `prepack` 로그가 앞에 섞일 수 있다.

### 2026-03-13 - Resolution Complete

**By:** Codex

**Actions:**
- `docs/development.md`의 tarball capture 예제를 `TARBALL=$(bun pm pack --quiet | tail -n 1)`로 수정했다
- 수정된 명령을 그대로 실행해 tarball path capture와 `tar -tf` 검증이 성공하는지 확인했다

**Learnings:**
- 이 케이스에서는 파일명 고정보다 마지막 줄만 취하는 방식이 더 작은 변경으로 현재 동작을 안정화한다
