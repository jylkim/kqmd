---
module: K-QMD CLI
date: 2026-03-16
problem_type: logic_error
component: tooling
symptoms:
  - "Static owned help duplicated runtime-owned `query` constraints, `embed` recovery guidance, and `mcp` validation rules"
  - "Rule changes would have required synchronized edits across help text, fixtures, docs, and release checklist entries"
  - "Owned help risked becoming a shell-specific mini spec instead of a minimal command contract"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [cli, qmd, help, query, embed, mcp, validation, maintainability, parity, typescript]
---

# Troubleshooting: static owned help duplicated runtime-owned rules in K-QMD CLI

## Problem

K-QMD의 owned help boundary를 다듬는 과정에서 `query` 문법/제약, `embed` recovery guidance, `mcp` validation rules를 [`src/commands/owned/help.ts`](../../src/commands/owned/help.ts) 의 정적 문자열 안에 다시 써 넣었다. 이 정보들은 이미 parser/runtime/execution layer가 canonical source로 소유하고 있었기 때문에, help가 점점 “사용법 안내”를 넘어서 “mini spec” 역할을 하게 됐다.

핵심 문제는 도움말이 자세해졌다는 사실 자체가 아니라, 같은 규칙이 두 군데 이상 존재하게 되면서 drift surface가 커졌다는 점이다. 이후 규칙이 바뀌면 parser/runtime뿐 아니라 help 문자열, snapshot fixture, 개발 문서, upstream version bump checklist까지 함께 맞춰야 하므로, 실제 런타임은 올바른데 도움말만 stale해지는 경로가 다시 열리게 된다.

## Environment

- Module: K-QMD CLI
- Affected area: owned help contract / parity fixtures / release checklist
- Date: 2026-03-16
- Relevant files:
  - `src/commands/owned/help.ts`
  - `src/commands/owned/io/validate.ts`
  - `src/commands/owned/io/parse.ts`
  - `src/commands/owned/query_core.ts`
  - `src/commands/owned/embed.ts`
  - `src/commands/owned/mcp.ts`
  - `test/owned-command-parity/help-output.test.ts`
  - `test/cli-routing.test.ts`
  - `test/bin-smoke.test.ts`
  - `docs/development.md`

## Symptoms

- `query --help`에 structured query grammar, `--candidate-limit` bound, collection restriction 같은 런타임 규칙이 다시 적혀 있었다.
- `embed --help`에 `qmd embed --force` recovery guidance가 추가돼 runtime validation과 같은 사실을 또 설명하게 됐다.
- `mcp --help`에 `--daemon requires --http`, `--port` range 같은 validation copy가 추가됐다.
- shell-specific `$'...'` 예시가 들어와 help 자체가 환경 의존적인 mini spec처럼 커질 위험이 생겼다.
- help snapshot과 version-bump checklist도 함께 넓어져, boundary change 하나가 더 넓은 maintenance surface로 번졌다.

## What Didn't Work

### Attempt 1: 자세한 help가 있으면 좋으니 runtime 규칙도 정적 help에 함께 적는다

- **Why it failed:** 규칙의 canonical source가 help와 runtime 두 군데로 갈라졌다.
- invalid combination, 숫자 상한, recovery path 같은 정보는 parser/runtime이 이미 정확히 알고 있는데, 정적 help까지 복제하면 stale text 위험만 커진다.

### Attempt 2: alias entrypoint마다 full snapshot을 늘려서 drift를 막는다

- **Why it failed:** alias coverage는 필요하지만, 같은 help 본문을 entrypoint마다 snapshot으로 반복 고정하면 help 한 줄 수정 시 maintenance cost만 커진다.
- 필요한 것은 “모든 alias가 canonical help와 byte-identical하다”는 계약이지, 같은 본문을 여러 fixture로 계속 복제하는 것이 아니었다.

## Solution

해결의 핵심은 help를 다시 얇게 만든 것이다.

1. owned help는 `usage + supported flags + stable modes`만 남겼다.
2. `query` grammar/constraints, `embed` recovery, `mcp` validation copy는 static help에서 제거했다.
3. parser/runtime가 invalid combinations, bounds, recovery paths의 canonical owner로 다시 남도록 되돌렸다.
4. help parity는 “canonical snapshot + alternate entrypoint equality” 구조로 정리했다.
5. `mcp` HTTP route surface(`/mcp`, `/health`, `/query`, `/search`)는 CLI help가 아니라 [`docs/development.md`](../../development.md) 에 기록해, terse help와 accurate docs를 같이 유지했다.

### Representative fix

```ts
// src/cli.ts
const helpAliasCommand = isHelpAlias(positionals[0]) ? positionals[1] : undefined;

if (helpAliasCommand && isOwnedCommand(helpAliasCommand)) {
  route = { mode: 'owned', command: helpAliasCommand };
} else if (values.help) {
  // generic --help handling
}
```

```ts
// test/owned-command-parity/help-output.test.ts
const canonical = await readHelpOutput(['query', '--help']);

await expect(readHelpOutput(['help', 'query'])).resolves.toBe(canonical);
await expect(readHelpOutput(['--help', 'query'])).resolves.toBe(canonical);
await expect(readHelpOutput(['help', 'query', '--help'])).resolves.toBe(canonical);
await expect(readHelpOutput(['help', 'query', '-h'])).resolves.toBe(canonical);
```

## Why This Works

이번 수정은 “문구를 더 잘 쓰는 것”이 아니라 “누가 무엇을 소유하는가”를 다시 나눈 것이다.

- **help** 는 무엇을 실행할 수 있는지와 stable surface를 소유한다.
- **parser/runtime** 는 무엇이 유효한지, 실패 시 어떻게 복구하는지를 소유한다.

이렇게 분리하면:

1. 규칙 변경 시 수정할 곳이 줄어든다.
2. stale help가 생길 가능성이 낮아진다.
3. alias path는 equality test로 잠그고, 규칙 자체는 validation/command tests가 잠가서 test responsibilities도 더 명확해진다.

## Prevention

### Authoring rules

- owned help에는 `usage`, 지원 플래그, stable entrypoint/surface만 넣는다.
- 숫자 상한, 조합 제약, invalid-input 규칙, recovery step은 runtime이 소유하게 둔다.
- 리뷰 기준은 단순하다.
  - “이 문장이 invalid input 없이도 항상 참인 stable contract인가?”
  - 아니라면 help가 아니라 runtime/validation 쪽 정보일 가능성이 높다.
- shell-specific quoting이나 환경 의존 예시는 꼭 필요하지 않으면 help에 넣지 않는다.

### Review heuristics

help diff에 아래 표현이 새로 들어오면 duplication을 의심한다.

- `requires`
- `cannot`
- `at most`
- `Recovery`
- `Run 'qmd ...'`
- `$'...'`

### Recommended validation

```bash
# help surface / entrypoint parity
bun run test -- test/owned-command-parity/help-output.test.ts test/cli-routing.test.ts test/bin-smoke.test.ts

# runtime-owned rules / recovery
bun run test -- test/owned-command-parity/validation.test.ts test/query-command.test.ts test/owned-embedding-behavior.test.ts test/mcp-command.test.ts test/mcp-http.test.ts

# canonical parity gate
bun run test:parity

# build artifact sanity
bun run build
```

### Version-bump reminder

upstream bump 시에는 help wording을 새 체계로 계속 검토한다.

- owned help entrypoint
- de-surfaced option leak
- help/output snapshot drift
- MCP route surface docs drift

## Related Issues

- See also: [query-explain-output-parity-kqmd-cli-20260312.md](./query-explain-output-parity-kqmd-cli-20260312.md)
- See also: [owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md](./owned-mcp-boundary-and-hardening-kqmd-cli-20260316.md)
- See also: [non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md](./non-exported-upstream-store-surface-guardrail-kqmd-cli-20260313.md)
- See also: [owned-runtime-bootstrap-safety-kqmd-cli-20260311.md](./owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)

Related context:

- [docs/architecture/kqmd-command-boundary.md](../../architecture/kqmd-command-boundary.md)
- [docs/plans/2026-03-16-fix-owned-help-upstream-reuse-boundary-plan.md](../../plans/2026-03-16-fix-owned-help-upstream-reuse-boundary-plan.md)
- [docs/plans/2026-03-13-fix-owned-cli-release-readiness-plan.md](../../plans/2026-03-13-fix-owned-cli-release-readiness-plan.md)
