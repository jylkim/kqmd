---
title: feat: Add owned command I/O parity contract
type: feat
status: completed
date: 2026-03-11
origin: docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md
---

# feat: Add owned command I/O parity contract

## Enhancement Summary

**Deepened on:** 2026-03-12  
**Research inputs:** `repo-research-analyst`, `learnings-researcher`, `spec-flow-analyzer`, `architecture-strategist`, `kieran-typescript-reviewer`, `security-sentinel`, `performance-oracle`, `code-simplicity-reviewer`, `pattern-recognition-specialist`, installed `@tobilu/qmd@2.0.1` CLI source and README, official Node.js `util.parseArgs` documentation, official Vitest snapshot and parameterized test documentation, current K-QMD architecture/docs/tests

### Key Improvements

1. `search`, `query`, `update`, `embed` 전체를 하나의 `strict parity` 기준선 위에 올리는 방향으로 범위를 고정했다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).
2. top-level routing parse와 owned command 전용 parse/validation/output contract를 분리해 현재 `src/cli.ts`의 “옵션을 읽지만 handler에는 거의 전달하지 않는” 상태를 끝내는 방향으로 구체화했다.
3. upstream `@tobilu/qmd` 버전 bump 시 자동으로 검증 절차를 강제하는 `parity test suite + checklist + version guard` 흐름을 포함했다.
4. upstream CLI private formatter 경로를 직접 import하지 않고, 공개 export surface와 local formatter semantics를 기준으로 contract를 유지하는 방향을 명확히 했다.

### New Considerations Discovered

- upstream CLI는 `util.parseArgs({ strict: false })`를 사용하고, format precedence를 CLI 입력 순서가 아니라 고정된 우선순위로 해석한다 (`node_modules/@tobilu/qmd/dist/cli/qmd.js:1961`). parity contract도 이 permissive parse policy를 의도적으로 따라야 한다.
- Node 공식 문서상 `util.parseArgs()`는 `tokens: true`를 통해 토큰 순서와 raw option 사용 형태를 보존한다. 이 기능을 쓰면 custom grammar와 repeated flag precedence를 수동 argv 파싱 없이 다룰 수 있다.
- empty-result output은 format마다 다르다. JSON은 `[]`, CSV는 header only, XML은 `<results></results>`, CLI는 human-readable text, Markdown/files는 조용히 비어 있는 출력이다 (`node_modules/@tobilu/qmd/dist/cli/qmd.js:1494`).
- Vitest 공식 문서상 긴 출력 계약은 inline snapshot보다 `toMatchFileSnapshot()`이 더 읽기 쉽고 syntax-highlight friendly하다. CLI parity output도 file snapshot으로 관리하는 편이 낫다.
- `update`와 `embed`는 progress/time/model 상태가 섞여 있어 raw snapshot이 불안정하다. 첫 슬라이스는 success summary shape를 고정하고, progress-level parity는 후속 단계로 미루는 것이 적절하다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).
- upstream package는 `exports`에서 root entrypoint만 public API로 열고 있으므로, `dist/cli/formatter.js` 같은 private path import는 버전 bump 때 깨질 가능성이 높다 (`node_modules/@tobilu/qmd/package.json`). formatter semantics는 참고하되 local contract로 소유하는 편이 더 안전하다.

## Overview

K-QMD의 다음 내부 기반 슬라이스는 `search`, `query`, `update`, `embed` 전체에 공통으로 적용되는 `owned command I/O parity contract`를 추가하는 것이다. 목표는 네 handler가 제각각 raw argv를 해석하고 임시 stderr를 반환하는 상태를 끝내고, upstream `@tobilu/qmd` CLI와 같은 입력/출력 계약 위에서 동작하게 만드는 것이다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).

이번 작업은 단순 타입 선언이나 문서화로 끝나지 않는다. contract를 실제 handler 경로에 연결하고, parse/validation/error output parity를 네 명령 모두에 대해 고정한다. 또한 `search/query`는 정상 출력 snapshot까지 포함하고, `update/embed`는 validation/error parity와 success envelope shape를 우선 고정한다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).

## Problem Statement / Motivation

현재 저장소는 replacement distribution의 뼈대와 owned runtime까지는 갖췄지만, owned command의 실제 CLI 계약은 비어 있다.

- `src/cli.ts`는 upstream와 유사한 전역 옵션 집합을 알고 있지만, 최종적으로 handler에는 `commandArgs`와 `indexName`만 전달한다 (`src/cli.ts:17`, `src/cli.ts:86`).
- `search`, `query`, `update`, `embed`는 모두 고정된 scaffold message만 출력한다 (`src/commands/owned/search.ts:3`, `src/commands/owned/query.ts:3`, `src/commands/owned/update.ts:3`, `src/commands/owned/embed.ts:3`).
- 반면 upstream CLI는 이미 명확한 parse/default/format/usage contract를 구현하고 있다 (`node_modules/@tobilu/qmd/dist/cli/qmd.js:1959`, `node_modules/@tobilu/qmd/dist/cli/qmd.js:2233`, `node_modules/@tobilu/qmd/dist/cli/qmd.js:2557`).

이 상태를 그대로 두면 이후 owned 기능을 구현할 때마다 다음 문제가 반복된다.

- 각 handler가 옵션 해석을 다시 구현한다
- format precedence와 기본값이 명령마다 drift한다
- validation/error message/exit code가 upstream와 다르게 굳는다
- upstream `@tobilu/qmd` 버전을 올릴 때 무엇을 다시 확인해야 하는지 기준이 없다

즉, 지금 필요한 것은 “다음 검색 기능”보다 먼저, owned command 전체가 공유할 CLI contract layer다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).

### Local Research Findings

- K-QMD는 이미 `manifest + runtime + path parity` 구조를 갖고 있어, 이번 작업은 새 아키텍처를 여는 것이 아니라 CLI entry path를 그 구조 위에 올리는 작업이다 (`src/commands/manifest.ts:3`, `src/commands/owned/runtime.ts:91`, `test/path-compatibility.test.ts:11`).
- `docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`는 runtime contract는 consumer가 붙기 전에 직접 테스트로 고정해야 한다는 학습을 남겼다. 이번 parity layer도 같은 원칙을 따라야 한다.
- `docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md`는 CLI contract 검증은 platform-neutral하고 deterministic해야 한다는 학습을 남겼다. parity suite도 `NO_COLOR`, fixed fixtures, injected execution results를 기준으로 안정화해야 한다.

## Chosen Approach

### Adopted: strict parity contract for all owned commands

브레인스토밍에서 합의한 `Approach A`를 따른다. 네 개 owned 명령 전체를 대상으로 upstream `@tobilu/qmd` CLI의 옵션 이름, validation, stdout/stderr shape, exit code를 기준선으로 고정한다. 첫 parity suite는 subprocess parity보다 `parse`, `validation`, `output snapshot`을 우선하고, `search/query`의 성공 출력과 `update/embed`의 success envelope까지 범위를 제한한다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).

### Rejected Alternatives

- `Approach B: read-command parity first`
  `search/query`만 먼저 다루는 방식은 빠를 수 있지만, 네 개 owned 명령이 같은 contract를 쓴다는 이번 슬라이스의 목적을 절반만 달성한다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).
- `Approach C: parser-only foundation`
  parse/validation 타입만 만들고 handler 경로를 그대로 두는 방식은 실제 drift를 막지 못한다. 사용자가 지적했듯이 handler가 stub로 남으면 이번 작업의 실효성이 약하다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).

## Scope For This Sprint

### In Scope

- `search`, `query`, `update`, `embed` 전용 typed parse/validation contract 추가
- upstream `@tobilu/qmd@2.0.1` 기준의 option defaults, format precedence, usage errors 반영
- format-specific empty output과 error output을 공통 formatter로 정리
- 네 handler를 공통 contract 경로에 연결
- `search/query`의 deterministic success snapshot 테스트 추가
- `update/embed`의 success summary shape 테스트 추가
- `@tobilu/qmd` 버전 bump 시 parity 재검증을 강제하는 version guard test와 checklist 추가
- `docs/development.md`, `docs/architecture/upstream-compatibility-policy.md` 업데이트

### Explicitly Out Of Scope

- 한국어 tokenization, ranking, embeddings 기본값 같은 제품 차별화 로직
- `collection`, `status`, `ls`, `get`, `multi-get`, `mcp`의 owned 전환
- full subprocess parity harness
- `update/embed`의 progress bar, time estimate, terminal control sequence까지의 완전 snapshot parity
- `vsearch` 또는 기타 passthrough/unsupported command 재설계

## SpecFlow Findings

이번 feature는 “사용자-facing product flow”보다 “CLI contract flow”가 핵심이다. SpecFlow 관점에서 중요한 흐름은 다음 네 가지다.

### Flow 1: Owned command invocation

`runCli()` → route 결정 → command-specific parse → validation → runtime/executor → formatter → `writeResult()` 흐름이 모든 owned command에서 동일해야 한다 (`src/cli.ts:123`).

### Flow 2: Validation failure

입력이 부족하거나 문법이 틀리면 runtime을 열기 전에 deterministic usage error가 나가야 한다. 특히 `search/query`의 missing query, `query`의 structured query grammar, `update/embed`의 unexpected positional argument는 early failure가 맞다.

### Flow 3: Format selection and empty-result rendering

사용자가 `--json`, `--csv`, `--md`, `--xml`, `--files`를 어떤 조합으로 주더라도 format precedence는 고정이어야 하고, empty-result shape도 포맷마다 달라야 한다 (`node_modules/@tobilu/qmd/dist/cli/qmd.js:1494`, `node_modules/@tobilu/qmd/dist/cli/qmd.js:2030`).

### Flow 4: Upstream version bump

`@tobilu/qmd` dependency version이 바뀌면 기존 snapshot과 parser assumptions가 더 이상 안전하지 않을 수 있다. 버전 변경 자체가 parity revalidation workflow를 트리거해야 한다.

### Gaps To Close

- format precedence를 top-level parser가 아니라 command contract에서 명시적으로 소유해야 한다
- output snapshot은 `NO_COLOR=1` 같은 deterministic environment guard가 필요하다
- `query`의 structured query grammar는 SDK가 아니라 CLI contract concern이므로 local parser가 필요하다
- dependency version 변경이 일어나도 개발자가 checklist를 건너뛰지 못하도록 guard test가 필요하다

## Proposed Solution

### 1. Split routing parse from owned command parity parse

현재 `parseCliInvocation()`은 “어느 command로 route할지”와 “옵션 의미를 완전히 해석할지”를 동시에 조금씩 수행하고 있다. 이번 슬라이스에서는 top-level parse를 route discovery와 global `--index` 확보까지만 유지하고, owned command 의미 해석은 별도의 parity module로 옮긴다.

권장 구조는 다음과 같다.

```text
src/cli.ts
src/commands/owned/io/types.ts
src/commands/owned/io/parse.ts
src/commands/owned/io/validate.ts
src/commands/owned/io/format.ts
src/commands/owned/io/errors.ts
src/commands/owned/search.ts
src/commands/owned/query.ts
src/commands/owned/update.ts
src/commands/owned/embed.ts
```

이렇게 하면 passthrough routing 정책은 유지하면서, owned commands만 upstream-compatible CLI contract를 따로 가질 수 있다.

### Research Insights

**Best Practices:**
- architecture 관점에서는 top-level routing과 command-specific contract를 분리해 import 방향을 단순하게 유지하는 편이 장기적으로 안전하다.
- pattern 관점에서는 `manifest.ts`처럼 data-driven source of truth를 이미 쓰고 있으므로, command option metadata도 테이블 기반으로 두는 편이 기존 저장소 패턴과 더 잘 맞는다.
- simplicity 관점에서는 “초거대 generic parser”보다 per-command parser + shared primitives가 더 읽기 쉽고 유지보수도 쉽다.

**Implementation Details:**

```ts
// src/commands/owned/io/parse.ts
import { parseArgs } from 'node:util';

const OWNED_SEARCH_OPTIONS = {
  n: { type: 'string' },
  'min-score': { type: 'string' },
  all: { type: 'boolean' },
  full: { type: 'boolean' },
  csv: { type: 'boolean' },
  md: { type: 'boolean' },
  xml: { type: 'boolean' },
  files: { type: 'boolean' },
  json: { type: 'boolean' },
  collection: { type: 'string', short: 'c', multiple: true },
  'line-numbers': { type: 'boolean' },
} as const;

const { values, positionals, tokens } = parseArgs({
  args: context.argv,
  options: OWNED_SEARCH_OPTIONS,
  allowPositionals: true,
  strict: false,
  tokens: true,
});
```

**Edge Cases:**
- repeated format flags는 CLI 입력 순서가 아니라 upstream의 고정 precedence를 따라야 한다.
- query document가 multi-line일 때 raw `commandArgs.join(' ')`는 line boundary를 잃을 수 있으므로, parser input normalization 규칙을 명시해야 한다.
- `tokens: true`를 쓰더라도 top-level routing parse와 동일한 argv를 다시 볼 때 `--index` 같은 global option 중복 해석을 피해야 한다.

### 2. Add typed input contracts for all four commands

각 command는 명시적인 typed input을 가져야 한다. raw `commandArgs: string[]`만 넘기는 구조로는 parity drift를 막기 어렵다.

예상 shape:

```ts
// src/commands/owned/io/types.ts
export interface SearchCommandInput {
  query: string;
  format: 'cli' | 'json' | 'csv' | 'md' | 'xml' | 'files';
  limit: number;
  minScore: number;
  all: boolean;
  full: boolean;
  lineNumbers: boolean;
  collections?: string[];
}

export interface QueryCommandInput extends SearchCommandInput {
  candidateLimit?: number;
  explain: boolean;
  intent?: string;
  queryMode: 'plain' | 'structured';
}

export interface UpdateCommandInput {
  pull: boolean;
}

export interface EmbedCommandInput {
  force: boolean;
}
```

이 contract는 upstream CLI의 현재 defaults를 그대로 반영해야 한다.

- format precedence: `csv > md > xml > files > json > cli`
- default limit: `--files/--json`는 20, 나머지는 5
- `--all`은 limit을 100000으로 고정
- `query`만 `--candidate-limit`, `--intent`, `--explain`을 가진다
- `update`는 `--pull`, `embed`는 `--force`를 가진다

위 결정은 브레인스토밍의 “strict parity”와 “네 command 전체 coverage”를 그대로 계획으로 옮긴 것이다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).

### 3. Mirror upstream validation and usage failures

validation은 parser 다음 단계에서 command별로 명시적으로 처리한다.

- `search` / `query`
  - query text가 없으면 usage error
  - `query`는 structured query document grammar도 검사
- `update` / `embed`
  - positional query text를 받지 않는다
  - 현재 slice에서는 명령 의미상 허용되지 않는 extra positionals를 deterministic failure로 막는다

`query`의 structured grammar는 upstream CLI의 local concern이므로 K-QMD도 own해야 한다 (`node_modules/@tobilu/qmd/dist/cli/qmd.js:1686`). 이 parser는 `lex:`, `vec:`, `hyde:`, `intent:` line contract를 typed AST로 바꾸고, usage/grammar errors를 stable stderr로 변환해야 한다.

### 4. Add shared output formatters and error adapters

`search/query`의 출력은 공통 formatter로 모은다. 핵심은 “실제 검색 로직”보다 “format-specific rendering contract”를 먼저 고정하는 것이다.

필수 책임:

- empty-result rendering
- CLI/JSON/CSV/Markdown/XML/files format selection
- `NO_COLOR` 환경에서 deterministic snapshot 가능성 보장
- usage error, validation error, runtime failure를 `CommandExecutionResult`로 변환

특히 empty-result behavior는 upstream와 shape가 다르므로 반드시 helper로 공통화해야 한다.

```ts
// src/commands/owned/io/format.ts
export function formatEmptySearchResults(format: SearchOutputFormat, reason: 'no-results' | 'min-score'): string | undefined
```

### Research Insights

**Best Practices:**
- upstream formatter semantics를 참고하되, package private path를 import하지 않는 것이 API stability 측면에서 안전하다.
- error adapters는 parse/validation/runtime/execute failure를 한 shape로 몰아넣기보다, 각 failure kind를 보존한 뒤 마지막에만 `CommandExecutionResult`로 투영하는 편이 디버깅에 유리하다.
- file paths, colors, snippets처럼 noise가 많은 출력은 formatter layer에서 deterministic normalization 규칙을 명시해야 snapshot drift가 줄어든다.

**Implementation Details:**

```ts
// src/commands/owned/io/errors.ts
export type OwnedCommandError =
  | { kind: 'usage'; stderr: string; exitCode: 1 }
  | { kind: 'validation'; stderr: string; exitCode: 1 }
  | { kind: 'runtime'; stderr: string; exitCode: 1 }
  | { kind: 'execution'; stderr: string; exitCode: 1 };

export function toExecutionResult(
  result: string | { stdout?: string; stderr?: string; exitCode?: number } | OwnedCommandError,
): CommandExecutionResult {
  // normalize to a stable stdout/stderr/exitCode shape
}
```

**Edge Cases:**
- `--json` output은 trailing newline 차이도 snapshot noise가 되므로 formatter에서 newline policy를 고정해야 한다.
- `--files`/`--md` empty output은 “비어 있는 string”과 “undefined stdout” 차이를 명시적으로 결정해야 한다.
- snippet/body line numbering은 format별로 동일해 보여도 JSON/CSV/CLI에서 line number insertion 위치가 다를 수 있다.

### 5. Rewire handlers onto the real contract path

이번 슬라이스는 contract만 만들고 handler를 그대로 두지 않는다. 각 handler는 다음 구조를 따라야 한다.

1. command-specific parser 실행
2. validation 실행
3. owned runtime 또는 injected executor 호출
4. 공통 formatter로 결과를 `CommandExecutionResult`에 투영

추천 shape:

```ts
// src/commands/owned/search.ts
export async function handleSearchCommand(context: CommandExecutionContext): Promise<CommandExecutionResult> {
  const parsed = parseOwnedSearchInput(context);
  if (parsed.kind === 'validation-error') return toExecutionResult(parsed);

  return withOwnedStore('search', context, async (session) => {
    const results = await executeSearch(session, parsed.input);
    return formatSearchExecutionResult(results, parsed.input);
  });
}
```

구현 관점에서 이 slice는 “완전한 한국어 기능”이 아니라 “실제 handler 경로가 typed contract를 통과하도록 만드는 것”에 초점을 둔다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).

### 6. Add a focused parity test suite

첫 parity suite는 subprocess parity 대신 parse/validation/output snapshot에 집중한다.

권장 구조:

```text
test/owned-command-parity/parse.test.ts
test/owned-command-parity/validation.test.ts
test/owned-command-parity/search-output.test.ts
test/owned-command-parity/query-output.test.ts
test/owned-command-parity/mutation-output.test.ts
test/owned-command-parity/upstream-version-guard.test.ts
test/fixtures/owned-command-parity/search/
test/fixtures/owned-command-parity/query/
```

핵심 케이스:

- `search/query/update/embed` 각 command의 typed parse 결과
- multi-format flag precedence
- `--all`, `-n`, `--min-score`, `--candidate-limit`, `--line-numbers`, `--intent` default/override
- `search` missing query usage error
- `query` missing query usage error
- `query` structured grammar parse failure
- `search/query` empty-result format parity
- `search/query` success snapshot parity under `NO_COLOR=1`
- `update/embed` success summary shape parity

`update/embed`는 progress/time/model path가 불안정하므로 raw snapshot 대신 normalized summary assertions가 더 적절하다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).

### Research Insights

**Best Practices:**
- Vitest 공식 문서 기준으로 긴 문자열 출력은 `toMatchFileSnapshot()`으로 관리하는 편이 더 읽기 쉽다.
- parameterized parity matrix는 `test.each` 또는 `test.for`로 선언형으로 유지하면 command/format 조합을 늘려도 테스트가 퍼지지 않는다.
- concurrency가 필요 없는 snapshot suite는 standard test execution을 유지해 ordering noise를 줄이는 편이 낫다.

**Implementation Details:**

```ts
// test/owned-command-parity/search-output.test.ts
import { expect, test } from 'vitest';

test.each([
  ['json', 'search-empty.output.json'],
  ['csv', 'search-empty.output.csv'],
  ['xml', 'search-empty.output.xml'],
])('empty search output (%s)', async (format, snapshotFile) => {
  const output = await runOwnedSearchFixture({ format, query: 'hangul' });
  await expect(output.stdout ?? '').toMatchFileSnapshot(
    `./fixtures/owned-command-parity/search/${snapshotFile}`,
  );
});
```

**Edge Cases:**
- Windows/macOS/Linux line ending 차이는 file snapshot 전에 normalization이 필요할 수 있다.
- colored CLI output snapshot은 `NO_COLOR=1` 없이는 TTY 상태에 따라 달라질 수 있다.
- query success snapshot은 document ordering이 deterministic하지 않으면 flaky해진다. fixture data와 sorting rules를 먼저 고정해야 한다.

### 7. Add an upstream version guard and bump workflow

사용자가 지적한 대로, baseline을 현재 설치된 upstream version에 고정하면 version bump 프로세스가 반드시 필요하다. 이번 슬라이스에는 이를 코드와 문서 양쪽에 심어야 한다.

추천 방식:

- `test/owned-command-parity/upstream-version-guard.test.ts`
  - `package.json`의 `@tobilu/qmd` 버전이 parity baseline metadata와 다르면 실패
- `test/fixtures/owned-command-parity/baseline.json`
  - 현재 기준선 버전 `2.0.1`
  - 고정한 behaviors 요약
- `package.json` script 추가
  - `test:parity`
  - 필요하면 `check`에 포함 여부는 후속 결정
- `docs/development.md`
  - `Upstream qmd version bump` 섹션 추가
- `docs/architecture/upstream-compatibility-policy.md`
  - CLI I/O parity가 어떤 수준까지 현재 고정돼 있는지 명시

권장 checklist:

1. `package.json`에서 `@tobilu/qmd` 버전 변경
2. `npm install`
3. `npm run test:parity`
4. `node_modules/@tobilu/qmd/dist/cli/qmd.js`의 parse/default/usage/output changes review
5. intentional drift가 있으면 snapshots와 `baseline.json` 갱신
6. `docs/development.md`에 relevant notes 반영

### Research Insights

**Best Practices:**
- version bump workflow는 “문서만 읽으세요”보다 failing test가 먼저 알려 주는 구조가 훨씬 잘 지켜진다.
- security 관점에서는 baseline metadata와 version guard가 “무심코 dependency 올리고 snapshot 안 보는” 경로를 막는 change-management guardrail 역할을 한다.
- architecture 관점에서는 version guard를 parse/output suite와 분리해, dependency mismatch와 behavior regression을 서로 다른 failure로 surface하는 편이 더 명확하다.

**Implementation Details:**

```ts
// test/owned-command-parity/upstream-version-guard.test.ts
import packageJson from '../../package.json';
import baseline from '../fixtures/owned-command-parity/baseline.json';

test('upstream qmd baseline version is still current', () => {
  expect(packageJson.dependencies['@tobilu/qmd']).toBe(baseline.upstreamVersion);
});
```

**Edge Cases:**
- semver range가 `^2.0.1` 같은 형태로 바뀌면 string equality guard가 약해질 수 있다. pinned version policy를 plan에서 명시하는 편이 낫다.
- snapshot을 일부만 갱신한 상태에서 baseline version까지 올리면 drift 원인이 흐려질 수 있으므로 checklist 순서를 고정해야 한다.

## Repository Shape & Deliverables

이 슬라이스 완료 시 최소한 아래 구조가 생기거나 갱신되어야 한다.

```text
src/commands/owned/io/types.ts
src/commands/owned/io/parse.ts
src/commands/owned/io/validate.ts
src/commands/owned/io/format.ts
src/commands/owned/io/errors.ts
src/commands/owned/search.ts
src/commands/owned/query.ts
src/commands/owned/update.ts
src/commands/owned/embed.ts
test/owned-command-parity/parse.test.ts
test/owned-command-parity/validation.test.ts
test/owned-command-parity/search-output.test.ts
test/owned-command-parity/query-output.test.ts
test/owned-command-parity/mutation-output.test.ts
test/owned-command-parity/upstream-version-guard.test.ts
test/fixtures/owned-command-parity/baseline.json
docs/development.md
docs/architecture/upstream-compatibility-policy.md
```

## Implementation Phases

### Phase 1: Contract foundation

- command-specific typed input/output types 추가
- format precedence/default limit parser 추가
- `query` structured grammar parser 추가
- usage/validation error adapter 추가

### Phase 2: Handler rewiring

- `search/query/update/embed`가 공통 contract를 사용하도록 전환
- runtime failure를 execution result로 변환하는 adapter 추가
- 기존 scaffold-only stderr 제거

### Phase 3: Parity tests and snapshots

- parse/validation tests 작성
- `search/query` success and empty-result snapshots 작성
- `update/embed` success summary assertions 작성
- snapshot environment를 `NO_COLOR=1`과 deterministic fixtures로 고정

### Phase 4: Upstream bump workflow

- version guard test 추가
- `test:parity` script 추가
- development/architecture docs에 bump checklist 추가

## Alternative Approaches Considered

### Rejected: parser-only contract without handler rewiring

브레인스토밍과 대화에서 이미 부적절하다고 드러난 접근이다. handler가 contract를 실제로 사용하지 않으면 drift는 여전히 handler layer에서 발생한다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).

### Rejected: full subprocess parity from day one

더 강한 검증이긴 하지만, 현재 저장소 단계에서는 cost가 크다. first slice는 parse/validation/output snapshot을 deterministic하게 고정하는 편이 더 작은 리스크로 높은 신뢰를 준다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).

### Rejected: search/query only

이번 목적은 네 owned command 전체를 같은 contract에 올리는 것이다. mutation commands를 남겨 두면 다시 별도 규약이 생긴다 (see brainstorm: `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`).

## Technical Considerations

- 아키텍처 영향
  top-level CLI는 계속 route selection을 맡고, owned command 전용 parse/validation/output은 별도 layer로 분리한다. passthrough path는 그대로 둔다.
- 런타임 영향
  `search/query/update/embed`는 이미 있는 owned runtime 정책을 재사용해야 하며, read-path guardrail을 깨면 안 된다 (`src/commands/owned/runtime.ts:91`).
- 테스트 안정성
  output snapshot은 `NO_COLOR`, fixed fixtures, deterministic ordering을 전제로 해야 한다.
- 보안 영향
  parse/validation layer는 shell command 조합이나 string-based execution을 새로 만들지 않아야 한다. 특히 `update --pull` 관련 입력은 기존 executor로만 전달하고, contract layer에서 shell semantics를 확장하지 않는다.
- 호환성
  기준선은 local `@tobilu/qmd@2.0.1`이다. 이 버전 고정 사실은 version guard와 docs 둘 다에 표현돼야 한다.
- 공개 API 경계
  `@tobilu/qmd`는 root export만 public API로 제공하므로, private `dist/cli/*` import는 피하고 local adapter에서 semantics를 복제하는 편이 안전하다.
- maintainability
  `src/cli.ts`에 command-specific branching을 더 쌓기보다, 각 command parser와 formatter를 data-driven helper로 빼는 편이 낫다.

### Research Insights

**Best Practices:**
- CLI contract는 “parse → validate → execute → format” 네 층으로 나누면 drift 지점을 찾기 쉽다.
- output parity는 full subprocess diff보다 deterministic snapshot부터 시작하는 편이 유지보수성이 높다.
- version bump workflow는 문서만으로는 잘 지켜지지 않으므로, dependency version mismatch를 테스트 실패로 surface하는 장치가 필요하다.

**Institutional Learnings Applied:**
- runtime contract는 첫 consumer가 붙기 전에 직접 테스트로 고정한다 (`docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`).
- CLI contract 검증은 shebang/TTY/platform에 덜 민감한 deterministic harness 위에 올린다 (`docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md`).

**Implementation Details:**

```ts
// src/commands/owned/io/parse.ts
export function parseOwnedSearchInput(context: CommandExecutionContext): ParseResult<SearchCommandInput>;
export function parseOwnedQueryInput(context: CommandExecutionContext): ParseResult<QueryCommandInput>;
export function parseOwnedUpdateInput(context: CommandExecutionContext): ParseResult<UpdateCommandInput>;
export function parseOwnedEmbedInput(context: CommandExecutionContext): ParseResult<EmbedCommandInput>;
```

```ts
// test/fixtures/owned-command-parity/baseline.json
{
  "upstreamVersion": "2.0.1",
  "ownedCommands": ["search", "query", "update", "embed"],
  "notes": [
    "format precedence is csv > md > xml > files > json > cli",
    "default limit is 20 for files/json and 5 otherwise",
    "search/query usage errors exit with code 1"
  ]
}
```

## System-Wide Impact

- **Interaction graph**: `runCli()`가 route를 결정하고, owned command는 per-command parser를 거쳐 typed input으로 바뀐다. 이후 validation을 통과한 요청만 runtime/executor로 내려가고, formatter가 최종 `CommandExecutionResult`를 만든다 (`src/cli.ts:123`, `src/commands/manifest.ts:16`, `src/commands/owned/runtime.ts:192`).
- **Error propagation**: parse/validation errors는 runtime open 전에 usage-style stderr와 exit code 1로 종료돼야 한다. runtime failure는 typed `OwnedRuntimeFailure`에서 formatter-friendly error로 변환돼야 하며, raw exception text가 기본 contract가 되어서는 안 된다.
- **State lifecycle risks**: `search/query`는 read path라서 existing DB reopen precedence를 유지해야 한다. `update/embed`는 shared state를 바꾸므로 success output을 formatter에 맞추더라도 runtime strict-config rule을 우회하면 안 된다.
- **API surface parity**: 네 개 owned command는 동일한 parse/validation/output helper를 공유해야 한다. 그렇지 않으면 format precedence나 usage text가 다시 drift한다.
- **Integration test scenarios**:
  1. `qmd search --json --files "foo"`가 upstream precedence대로 JSON이 아니라 files가 아닌, 고정 precedence 결과를 내는지 검증한다.
  2. `qmd query`가 plain query와 structured query document 두 경로 모두 deterministic parse를 통과하는지 검증한다.
  3. `qmd search --min-score 0.9 "foo"`에서 결과가 필터링될 때 format-specific empty output이 맞는지 검증한다.
  4. `qmd update --pull`이 typed input과 success summary shape를 모두 통과하는지 검증한다.
  5. `package.json`의 `@tobilu/qmd` 버전이 바뀌면 version guard test가 실패해 checklist 실행을 강제하는지 검증한다.

## Acceptance Criteria

- [x] `search`, `query`, `update`, `embed` 각각에 대한 typed parse contract가 존재한다
- [x] format precedence, default limit, collection parsing, command-specific flags가 upstream `@tobilu/qmd@2.0.1` 기준과 일치한다
- [x] `query` structured query grammar가 local parser로 표현되고 parse/validation test로 고정된다
- [x] validation/usage failure는 runtime open 전에 deterministic stderr + exit code로 반환된다
- [x] `search/query`는 empty-result behavior와 success output에 대해 deterministic snapshot 테스트를 가진다
- [x] `update/embed`는 success summary shape와 error parity 테스트를 가진다
- [x] 네 owned handler 모두 공통 contract를 실제로 사용한다
- [x] 기존 scaffold-only fixed stderr는 제거된다
- [x] private upstream CLI 경로(`@tobilu/qmd/dist/cli/*`)를 직접 import하지 않는다
- [x] parity suite를 위한 `npm run test:parity` 또는 동등한 script가 추가된다
- [x] upstream version guard test가 추가되고, version bump 시 checklist를 실행하지 않으면 테스트가 실패한다
- [x] `docs/development.md`와 `docs/architecture/upstream-compatibility-policy.md`가 새 parity workflow를 설명한다

## Success Metrics

- 새로운 owned command 구현이 들어와도 parse/default/format logic를 `src/cli.ts`나 handler마다 다시 쓰지 않는다
- `search/query`의 snapshot drift가 intentional change 없이는 발생하지 않는다
- dependency version bump가 checklist 없이 머지되기 어렵다
- CLI parity 관련 regressions가 runtime feature work보다 먼저 test suite에서 드러난다

## Dependencies & Risks

- **Dependency**: installed `@tobilu/qmd@2.0.1` CLI source가 이번 기준선이다. baseline version이 바뀌면 tests/docs/checklist를 같이 갱신해야 한다.
- **Risk**: `query`는 upstream CLI local grammar와 rerank-related output을 일부 own해야 하므로 `search`보다 scope가 넓다.
- **Risk**: `update/embed`의 full progress parity까지 욕심내면 이 슬라이스가 과도하게 커진다. first slice는 success envelope까지만 고정해야 한다.
- **Risk**: permissive parse(`strict: false`)를 따른다면 unknown flags 처리도 upstream와 같은 방향으로 유지해야 한다. 이 정책이 암묵적으로 바뀌면 parity drift가 생긴다.
- **Risk**: snapshot tests가 색상, 경로, 시간, document ordering에 의존하면 flaky해질 수 있다. fixture와 environment control이 필수다.

## Documentation Plan

- `docs/development.md`
  - `Owned command parity tests` 섹션 추가
  - `Upstream qmd version bump checklist` 섹션 추가
- `docs/architecture/upstream-compatibility-policy.md`
  - 현재 CLI parity가 어떤 수준까지 고정됐는지 명시
  - version guard와 checklist 존재 이유 추가

## Sources & References

### Origin

- **Brainstorm document:** `docs/brainstorms/2026-03-11-owned-command-io-parity-brainstorm.md`
  carried-forward decisions:
  - `strict parity`를 목표로 한다
  - 기준선은 현재 설치된 upstream `@tobilu/qmd` CLI 동작이다
  - 네 owned command 전체를 한 번에 contract 범위에 넣는다
  - first suite는 parse/validation/output snapshot 중심이다

### Internal References

- Current owned command boundary: `docs/architecture/kqmd-command-boundary.md:6`
- Upstream compatibility policy: `docs/architecture/upstream-compatibility-policy.md:3`
- Top-level CLI parse and dispatch: `src/cli.ts:17`
- Owned command manifest: `src/commands/manifest.ts:3`
- Owned runtime policy: `src/commands/owned/runtime.ts:91`
- Existing routing tests: `test/cli-routing.test.ts:6`
- Existing unknown-command handling: `test/unknown-command.test.ts:13`
- Existing published CLI contract test: `test/bin-smoke.test.ts:8`

### Upstream Baseline References

- Installed dependency version: `package.json`
- CLI parse/default contract: `node_modules/@tobilu/qmd/dist/cli/qmd.js:1959`
- Search/query output formatting: `node_modules/@tobilu/qmd/dist/cli/qmd.js:1494`
- Upstream package export surface: `node_modules/@tobilu/qmd/package.json`
- Help text and command option surface: `node_modules/@tobilu/qmd/dist/cli/qmd.js:2166`
- Search/query usage errors: `node_modules/@tobilu/qmd/dist/cli/qmd.js:2557`
- CLI documentation examples: `node_modules/@tobilu/qmd/README.md:620`

### Official References

- Node.js `util.parseArgs` docs: [https://nodejs.org/api/util.html#utilparseargsconfig](https://nodejs.org/api/util.html#utilparseargsconfig)
- Vitest snapshot guide: [https://vitest.dev/guide/snapshot.html](https://vitest.dev/guide/snapshot.html)
- Vitest test API (`test.each`, `test.for`): [https://vitest.dev/api/](https://vitest.dev/api/)

### Institutional Learnings

- `docs/solutions/logic-errors/owned-runtime-bootstrap-safety-kqmd-cli-20260311.md`
  runtime/contract changes는 first consumer 전에 직접 테스트로 고정해야 한다
- `docs/solutions/test-failures/bin-smoke-test-posix-shebang-kqmd-cli-20260311.md`
  CLI parity tests는 platform-neutral하고 deterministic해야 한다
