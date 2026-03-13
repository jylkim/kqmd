---
module: K-QMD CLI
date: 2026-03-13
problem_type: security_issue
component: tooling
symptoms:
  - "`trustedDependencies` allowlist drift could pass silently after dependency updates"
  - "`bun run test` and `bun run check` did not fail when new untrusted lifecycle-script packages appeared"
  - "Maintainers had to rely on manual `bun pm untrusted` review during version bumps"
root_cause: missing_workflow_step
resolution_type: tooling_addition
severity: medium
tags: [cli, bun, tooling, supply-chain, trusted-dependencies, lifecycle-scripts, verification, typescript]
---

# Troubleshooting: `trustedDependencies` drift를 guardrail test로 고정하기

## Problem

K-QMD를 Bun-first toolchain으로 전환하면서 `package.json`에 `trustedDependencies`를 추가해 install을 안정화했다. 하지만 그 상태만으로는 이후 dependency update에서 trust surface가 바뀌어도 이를 자동으로 막을 수 없었다.

즉, `bun pm untrusted` 결과가 달라져도 maintainer가 version bump checklist를 수동으로 놓치면 install-time script 실행 범위가 조용히 넓어질 수 있었다. exact allowlist를 기록하는 것과 allowlist drift를 실제 검증 경로에서 막는 것은 다른 문제였다.

## Environment

- Module: K-QMD CLI
- Affected Component: Bun-first toolchain verification / trusted dependency guardrail
- Date: 2026-03-13
- Relevant files:
  - `package.json`
  - `docs/development.md`
  - `test/trusted-dependencies.test.ts`
  - `todos/023-complete-p2-trusted-dependencies-drift-check.md`

## Symptoms

- `trustedDependencies`에 `better-sqlite3`, `esbuild`, `node-llama-cpp`를 기록해도 future drift를 자동으로 막지 못했다
- `bun pm untrusted`는 사람이 보면 알 수 있었지만, `bun run test`와 `bun run check`는 그대로 green일 수 있었다
- dependency update 뒤 install/postinstall surface가 달라져도 문서상의 checklist 외에는 즉시 신호가 없었다

## What Didn't Work

**Attempted Solution 1:** `trustedDependencies` exact allowlist를 `package.json`에 남기는 것만으로 충분하다고 본다.
- **Why it failed:** allowlist는 현재 상태를 기록할 뿐이고, 이후 dependency graph 변화나 lifecycle script 추가를 자동으로 감지하지는 않는다.

**Attempted Solution 2:** version bump checklist에 `bun pm untrusted`를 적어 두는 것만으로 충분하다고 본다.
- **Why it failed:** 문서는 advisory일 뿐 enforcement가 아니다. maintainer가 놓치면 trust drift는 그대로 통과할 수 있다.

## Solution

작고 결정적인 integration test를 추가했다.

1. `test/trusted-dependencies.test.ts`를 새로 만들었다
2. 테스트는 `bun pm untrusted`를 직접 실행한다
3. stdout에서 `./node_modules/...` 또는 `.\\node_modules\\...` 형태의 untrusted package path가 하나라도 남아 있으면 실패한다
4. Bun binary 해석은 `KQMD_BUN_BIN` override 또는 `which`/`where` fallback으로 안정화했다

**Code changes**:

```ts
import { execFileSync } from 'node:child_process';

const output = execFileSync(resolveBunBinary(process.env.KQMD_BUN_BIN), ['pm', 'untrusted'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: 'pipe',
});

const untrustedPackages = output
  .split(/\r?\n/)
  .filter((line) => /^(?:\.\/|\.\\)node_modules[\\/]/.test(line.trim()));

expect(untrustedPackages).toEqual([]);
```

## Why This Works

1. **Trust surface를 문서가 아니라 test로 고정한다.**  
   `trustedDependencies` 변경이나 transitive dependency drift가 생기면 바로 `bun pm untrusted` 결과가 달라지고, test suite가 red가 된다.

2. **기존 검증 경로에 자연스럽게 붙는다.**  
   별도 snapshot 파일이나 복잡한 스크립트 없이 `bun run test`와 `bun run check`에 바로 포함된다.

3. **Install-time 공급망 리스크를 실행 가능한 계약으로 바꾼다.**  
   “다음 version bump 때 확인하자” 수준에서 멈추지 않고, 현재 repo verification이 실제로 drift를 막게 만든다.

## Prevention

- `trustedDependencies`는 “일단 넣고 유지”가 아니라 “현재 install surface를 통과시키는 최소 allowlist”로 관리한다
- dependency version을 바꾼 뒤에는 `bun pm untrusted`를 사람이 확인하는 것에서 끝내지 말고, guardrail test가 여전히 green인지 본다
- `trustedDependencies`를 바꿀 때는 반드시 이유를 함께 남긴다
  - `better-sqlite3`: native install script 필요
  - `esbuild`: postinstall binary setup 필요
  - `node-llama-cpp`: postinstall bootstrap 필요
- 새 dependency를 추가할 때는 “기본 trusted인가”보다 “현재 repo install에서 실제로 untrusted로 남는가”를 기준으로 판단한다

## Validation Commands

```bash
bun install --frozen-lockfile
bun pm untrusted
bun run test -- trusted-dependencies
bun run check
```

dependency bump 직후 권장 순서:

```bash
bun install
bun install --frozen-lockfile
bun pm untrusted
bun run test -- trusted-dependencies
bun run test:parity
bun run check
```

## Related Issues

- See also: [bin-smoke-test-posix-shebang-kqmd-cli-20260311.md](../test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md)
- See also: [owned-runtime-bootstrap-safety-kqmd-cli-20260311.md](../logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
- See also: [query-explain-output-parity-kqmd-cli-20260312.md](../logic-errors/query-explain-output-parity-kqmd-cli-20260312.md)
- See also: [status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md](../logic-errors/status-zero-config-and-embedding-health-scope-kqmd-cli-20260312.md)
- See also: [kiwi-shadow-index-hardening-kqmd-cli-20260313.md](../logic-errors/kiwi-shadow-index-hardening-kqmd-cli-20260313.md)
- Related todo resolved: `todos/023-complete-p2-trusted-dependencies-drift-check.md`
