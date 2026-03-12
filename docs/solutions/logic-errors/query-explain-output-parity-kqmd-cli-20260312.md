---
module: K-QMD CLI
date: 2026-03-12
problem_type: logic_error
component: tooling
symptoms:
  - "CLI `qmd query --explain` showed only the first `Explain:` line while upstream CLI prints additional `RRF`, `Blend`, and contribution details"
  - "The parity suite passed without any explain-enabled CLI snapshot coverage, so formatter drift stayed invisible"
  - "`query --candidate-limit` and `update --pull` were accepted by parsing but did not actually affect execution semantics"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [cli, parity, explain, formatter, snapshots, qmd, typescript]
---

# Troubleshooting: `query --explain` parity drift in K-QMD CLI

## Problem

K-QMD의 owned CLI parity 레이어를 도입한 뒤, `qmd query --explain`의 CLI 출력이 upstream `qmd`보다 축약되어 있다는 review finding이 나왔다. 표면상 테스트는 모두 통과했지만, explain 전용 출력 branch를 snapshot으로 고정하지 않아 user-visible drift가 숨어 있었다.

## Environment

- Module: K-QMD CLI
- Affected Component: owned command formatter / parity tests
- Date: 2026-03-12
- Relevant files:
  - `src/commands/owned/io/format.ts`
  - `src/commands/owned/io/parse.ts`
  - `test/owned-command-parity/query-output.test.ts`
  - `test/owned-command-parity/parse.test.ts`
  - `test/owned-command-parity/mutation-output.test.ts`

## Symptoms

- `query --explain`에서 local CLI는 `Explain: fts=[...] vec=[...]` 한 줄만 출력했다
- upstream CLI는 추가로 `RRF`, `Blend`, `Top RRF contributions` 줄을 함께 출력했다
- explain path에 대한 snapshot test가 없어 parity suite는 green이었지만 drift를 잡지 못했다
- 같은 review에서 `query --candidate-limit`와 `update --pull`도 silent no-op 또는 misleading success message 상태였음이 드러났다

## What Didn't Work

**Attempted Solution 1:** 일반 `query` success snapshot과 empty output snapshot만으로 CLI parity를 커버한다고 본다.
- **Why it failed:** `--explain` 같은 debug-only formatter branch는 별도 snapshot이 없으면 쉽게 drift한다.

**Attempted Solution 2:** local formatter에서 첫 `Explain:` 줄만 출력해도 충분하다고 본다.
- **Why it failed:** upstream CLI는 explain block 전체를 user-facing debugging contract로 제공한다. 첫 줄만 남기면 strict parity 목표와 어긋난다.

**Attempted Solution 3:** `--candidate-limit`, `--pull`를 parse만 해도 괜찮다고 본다.
- **Why it failed:** 실행 경로가 값을 소비하지 않으면 flag가 조용한 no-op가 된다. 성공 출력이 이를 과장하면 더 위험하다.

## Solution

세 가지를 함께 바로잡았다.

1. `query --explain` CLI formatter를 upstream shape에 맞춰 `Explain`, `RRF`, `Blend`, `Top RRF contributions`까지 출력하도록 확장했다.
2. explain-enabled CLI snapshot fixture를 추가해 이후 drift를 테스트로 고정했다.
3. 아직 실행 경로에서 지원하지 않는 `query --candidate-limit`와 `update --pull`는 명시적 validation error로 바꿔 silent no-op를 제거했다.

**Code changes**:

```ts
// Before: only the first explain line was emitted
'explain' in input && input.explain && row.explain
  ? `${colors.dim}Explain: fts=[...] vec=[...]${colors.reset}`
  : undefined
```

```ts
// After: match upstream multi-line explain block
...('explain' in input && input.explain && row.explain
  ? (() => {
      const explain = row.explain;
      const contributionSummary = explain.rrf.contributions
        .slice()
        .sort((left, right) => right.rrfContribution - left.rrfContribution)
        .slice(0, 3)
        .map(
          (contribution) =>
            `${contribution.source}/${contribution.queryType}#${contribution.rank}:${formatExplainNumber(contribution.rrfContribution)}`,
        )
        .join(' | ');

      return [
        `${colors.dim}Explain: fts=[${ftsScores}] vec=[${vecScores}]${colors.reset}`,
        `${colors.dim}  RRF: total=${formatExplainNumber(explain.rrf.totalScore)} base=${formatExplainNumber(explain.rrf.baseScore)} bonus=${formatExplainNumber(explain.rrf.topRankBonus)} rank=${explain.rrf.rank}${colors.reset}`,
        `${colors.dim}  Blend: ${Math.round(explain.rrf.weight * 100)}%*${formatExplainNumber(explain.rrf.positionScore)} + ${Math.round((1 - explain.rrf.weight) * 100)}%*${formatExplainNumber(explain.rerankScore)} = ${formatExplainNumber(explain.blendedScore)}${colors.reset}`,
        contributionSummary.length > 0
          ? `${colors.dim}  Top RRF contributions: ${contributionSummary}${colors.reset}`
          : undefined,
      ].filter((line): line is string => Boolean(line));
    })()
  : [])
```

```ts
// Explicitly reject unsupported flags instead of accepting silent no-ops
if (candidateLimit !== undefined) {
  return validationError('The `query` command does not yet support --candidate-limit.');
}

if (values.pull) {
  return validationError('The `update` command does not yet support --pull.');
}
```

```ts
// New parity coverage for explain output
test('matches cli explain output snapshot', async () => {
  const result = await handleQueryCommand(createContext(['query', '--explain', 'auth flow']), {
    run: async () => queryRows,
  });

  await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
    resolve(process.cwd(), 'test/fixtures/owned-command-parity/query/query-explain.output.cli'),
  );
});
```

**Commands run**:

```bash
npm run typecheck
npm run test:parity
npm run test
npm run lint
```

## Why This Works

문제의 핵심은 “parse와 일반 snapshot은 맞았지만, formatter의 특수 branch가 테스트 밖에 있었다”는 점이다.

1. **Explain output is part of the CLI contract**
   `--explain`는 단순 내부 디버그 정보가 아니라 사용자가 결과 해석을 위해 직접 보는 출력이다. upstream가 여러 줄을 보여 준다면, strict parity를 표방하는 wrapper도 같은 구조를 가져야 한다.

2. **Silent no-op is worse than explicit non-support**
   `query --candidate-limit`나 `update --pull`를 parse만 하고 실행에서 버리면 사용자는 option이 적용되었다고 믿기 쉽다. 특히 성공 출력까지 그 믿음을 강화하면 contract drift가 더 심해진다. 명시적 validation error는 현재 scope를 솔직하게 보여 준다.

3. **Snapshot coverage must include debug branches**
   일반 성공/empty output만 snapshot으로 고정하면 `--explain`처럼 조건부 출력 path는 빠질 수 있다. explain 전용 fixture를 추가하면 이후 formatter drift가 바로 드러난다.

4. **Local adapters should stay honest about support**
   이번 수정은 upstream private formatter path를 import하지 않으면서도, user-visible semantics는 local code와 snapshot으로 다시 고정했다. 지원하지 못하는 flag는 숨기지 않고 명확히 드러내도록 했다.

## Prevention

- CLI parity를 말할 때는 happy path만이 아니라 `--explain`, `--json`, empty output 같은 조건부 branch도 각각 snapshot으로 고정한다
- parse layer가 값을 받았다면 execution layer가 실제로 소비하는지 반드시 같이 확인한다
- 아직 구현되지 않은 flag는 success output으로 과장하지 말고 explicit validation error 또는 documented non-support로 처리한다
- upstream CLI와 비교할 때는 help text뿐 아니라 실제 formatter branch까지 읽는다
- reviewer가 지적한 contract drift는 가능한 한 같은 세션에 test fixture까지 함께 추가해 재발을 막는다

## Related Issues

- See also: [owned-runtime-bootstrap-safety-kqmd-cli-20260311.md](./owned-runtime-bootstrap-safety-kqmd-cli-20260311.md)
- See also: [bin-smoke-test-posix-shebang-kqmd-cli-20260311.md](../test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md)
- Related review follow-ups resolved together:
  - `todos/008-complete-p2-query-candidate-limit-no-op.md`
  - `todos/009-complete-p2-update-pull-misleading-success.md`
  - `todos/010-complete-p2-query-explain-cli-output-incomplete.md`
