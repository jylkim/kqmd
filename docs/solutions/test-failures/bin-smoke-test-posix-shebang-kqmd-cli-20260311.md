---
module: K-QMD CLI
date: 2026-03-11
problem_type: test_failure
component: testing_framework
symptoms:
  - CLI smoke test depended on POSIX shebang execution to launch `bin/qmd.js`
  - The test would not be portable to Windows because `.js` files are not directly executable there
root_cause: wrong_api
resolution_type: test_fix
severity: medium
tags: [cli, smoke-test, cross-platform, shebang, windows, npm-bin]
---

# Troubleshooting: POSIX 전용 bin smoke test를 플랫폼 중립적으로 수정하기

## Problem

`bin` smoke test가 `bin/qmd.js` 파일을 직접 실행하고 있어서 POSIX shebang 동작에 기대고 있었다.
이 방식은 macOS/Linux에서는 통과할 수 있지만, Windows에서는 동일한 방식으로 실행되지 않아
published CLI contract를 신뢰성 있게 검증하지 못한다.

## Environment

- Module: K-QMD CLI
- Affected Component: published CLI smoke test
- Date: 2026-03-11

## Symptoms

- `test/bin-smoke.test.ts`가 `spawnSync(binPath, ...)`로 `bin/qmd.js`를 직접 실행하고 있었다
- 테스트 의도는 "배포된 `qmd` bin 경로 검증"인데, 실제로는 POSIX에서만 자연스럽게 통하는 실행 방식을 가정하고 있었다
- top-level bin만 감싸더라도 delegated upstream fixture가 raw script path면 같은 플랫폼 의존성이 다시 남는다

## What Didn't Work

**Attempted Solution 1:** `bin/qmd.js`를 파일 경로 그대로 직접 실행한다.
- **Why it failed:** `.js` 파일 직접 실행은 shebang을 해석하는 POSIX 환경에 의존한다. Windows에서는 같은 전제가 성립하지 않는다.

**Attempted Solution 2:** top-level bin만 `node bin/qmd.js`로 감싸고 upstream fixture는 기존 raw script path를 유지한다.
- **Why it failed:** `KQMD_UPSTREAM_BIN`으로 넘기는 fixture 실행 경로가 여전히 플랫폼별 script 실행 semantics에 기대게 되어, delegated path 쪽 portability 문제가 남는다.

## Solution

smoke test를 두 단계 모두 플랫폼 중립적으로 바꿨다.

1. top-level bin 실행은 `spawnSync(process.execPath, [binPath, ...])`로 변경했다
2. upstream fixture도 OS별 wrapper를 생성해서 `KQMD_UPSTREAM_BIN`이 직접 script file을 가리키지 않게 했다

**Code changes**:

```ts
// Before
const result = spawnSync(binPath, ['status', '--json'], {
  env: {
    ...process.env,
    KQMD_UPSTREAM_BIN: fixturePath,
  },
});

// After
const result = spawnSync(process.execPath, [binPath, 'status', '--json'], {
  env: {
    ...process.env,
    KQMD_UPSTREAM_BIN: wrapperPath,
  },
});
```

```ts
// POSIX wrapper
writeFileSync(
  wrapperPath,
  `#!/bin/sh\nexec "${process.execPath}" "${fixturePath}" "$@"\n`,
  'utf8',
);

// Windows wrapper
writeFileSync(
  wrapperPath,
  `@echo off\r\n"${process.execPath}" "${fixturePath}" %*\r\n`,
  'utf8',
);
```

**Commands run**:

```bash
npm run format
npm run check
```

## Why This Works

문제의 핵심은 테스트가 "Node가 실행해야 하는 JavaScript 파일"을 "운영체제가 직접 실행 가능한 바이너리"처럼 다뤘다는 점이다.

1. **Root cause**
   `spawnSync(binPath, ...)`는 `bin/qmd.js`가 운영체제에서 직접 실행 가능하다는 가정을 깔고 있다.
   이 가정은 POSIX shebang 환경에서는 맞을 수 있지만, Windows에서는 맞지 않는다.

2. **Why the fix addresses it**
   `process.execPath`를 통해 Node 런타임을 명시적으로 호출하면, 테스트는 shebang 해석 여부와 무관하게 같은 실행 경로를 사용하게 된다.

3. **Why the wrapper is necessary**
   top-level bin만 고치면 반쪽짜리 수정이 된다. delegated upstream fixture도 여전히 raw script file이면 같은 플랫폼 문제가 fixture 경로에서 다시 발생한다.
   그래서 fixture 역시 OS별 wrapper를 만들어 Node 실행 경로를 명시적으로 통일해야 한다.

## Prevention

- CLI smoke test에서 `.js` 파일을 직접 실행하지 말고 항상 `process.execPath` 기반 실행을 우선 고려한다
- "bin contract" 테스트는 top-level executable만 보지 말고, 내부 delegation fixture 경로까지 같이 점검한다
- POSIX에서 통과한다고 cross-platform 테스트라고 가정하지 않는다
- code review에서 shebang, shell, 실행 파일 가정이 들어간 테스트는 Windows 관점으로 한 번 더 읽는다

## Related Issues

No related issues documented yet.
