# Release

릴리스 후보를 검증하고 publish하는 절차를 정리한 문서입니다.

## 버전 정책

`{upstream_version}-kqmd.{rev}` 형식을 사용합니다.

```
2.0.1-kqmd.1   ← upstream 2.0.1 기반 첫 릴리즈
2.0.1-kqmd.2   ← K-QMD 자체 버그 픽스
2.1.0-kqmd.1   ← upstream 2.1.0으로 bump 시 rev 리셋
```

- 앞부분은 기반이 되는 `@tobilu/qmd` 버전을 그대로 반영합니다.
- `-kqmd.N` 부분은 해당 upstream 버전 위에서의 K-QMD 자체 리비전입니다.
- upstream 버전이 올라가면 rev를 1로 리셋합니다.
- SemVer prerelease 식별자 문법을 따르므로 npm/bun 생태계와 호환됩니다.

### Git tag

`v` prefix를 붙여 `package.json` 버전과 1:1로 대응시킵니다.

```
v2.0.1-kqmd.1
v2.0.1-kqmd.2
v2.1.0-kqmd.1
```

- 태그는 릴리스 커밋에만 생성합니다.
- annotated tag를 사용합니다: `git tag -a v2.0.1-kqmd.1 -m "v2.0.1-kqmd.1"`

## 릴리스 검증

### 전체 릴리스 게이트

```bash
bun run release:verify
```

아래 항목을 순서대로 실행합니다.

1. Biome lint
2. TypeScript typecheck
3. Release contract 테스트 (`test:release-contract` — owned command parity, passthrough contract 포함)
4. Kiwi search 안정성 측정 (`measure:kiwi-reliability`)
5. MCP contract 정합성 측정 (`measure:mcp-contract`)
6. query cold-start 측정 (`measure:query-cold-start`)
7. 산출물 검증 (`release:artifact`)

### 산출물 검증

```bash
bun run release:artifact
```

실제 pack, tarball 검사, 임시 설치 smoke test를 수행합니다.

포함 파일을 미리 확인하려면 아래 명령을 사용합니다.

```bash
bun pm pack --dry-run
```

publish 경로를 시뮬레이션하려면 아래 명령을 사용합니다.

```bash
bun publish --dry-run
```

`bun pm pack --dry-run`은 포함 파일 preview이고, `bun publish --dry-run`은 publish simulation입니다. 둘은 같은 검증이 아닙니다.

## Go / No-Go 기준

아래 조건이 모두 충족되어야 릴리스할 수 있습니다.

- `bun run release:verify`가 통과합니다.
- `qmd update` 이후 shadow index 동기화가 완료됩니다.
- `qmd status`가 `clean`이면 `qmd search`가 실제로 shadow path를 사용합니다.
- `search --json` stdout이 warning이나 advisory로 오염되지 않습니다.
- synthetic fixture 기준 `measure:query-cold-start`가 모든 fixture에서 target `hit@5`를 유지합니다.
- stale 또는 policy mismatch 상태에서 false clean path를 타지 않습니다.

### 즉시 중단 조건

- `qmd update`가 성공했는데 shadow index freshness를 설명할 수 없습니다.
- `qmd status`가 clean인데 `qmd search`가 fallback으로 흐릅니다.
- machine-readable stdout이 깨집니다.

### 롤백 절차

```bash
# 1. 이전 안정 커밋으로 되돌립니다.
# 2. 인덱스를 다시 동기화합니다.
qmd update
qmd status
qmd search "형태소 분석"
```

코드 롤백만으로 shadow metadata mismatch가 해소되지 않으면, 해당 인덱스를 rebuild 기준으로 다시 검증합니다.

## Changelog

[CHANGELOG.md](../CHANGELOG.md)에 모든 릴리스 변경사항을 기록합니다.

### 형식

[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 규약을 따릅니다.

```markdown
## [Unreleased]

### Added
- 새 기능

### Fixed
- 버그 수정

### Changed
- 기존 기능 변경

### Refactored
- 동작 변경 없는 코드 개선

## [2.0.1-kqmd.2] - 2026-03-18

### Added
- ...
```

### 작성 규칙

- 최상단에 `[Unreleased]` 섹션을 항상 유지합니다.
- 릴리스 시 `[Unreleased]` 내용을 버전 섹션으로 옮기고 날짜를 기입합니다.
- 카테고리: `Added`, `Fixed`, `Changed`, `Refactored`, `Removed`.
- `chore`, `docs`(외부 문서 제외) 등 사용자에게 영향이 없는 항목은 생략합니다.
- 각 항목은 사용자 관점에서 무엇이 달라졌는지 한 줄로 기술합니다.
- 하단에 버전 비교 링크를 유지합니다.

## 측정 스크립트

### 성능 프로파일링

| 항목 | 명령 |
|---|---|
| Query adaptive ranking (p50/p95, heap/rss) | `bun run measure:query-adaptive` |
| Query adaptive E2E (p50/p95, heap/rss) | `bun run measure:query-adaptive-e2e` |
| Query cold start (fresh child process, p50/p95/max, peak RSS) | `bun run measure:query-cold-start` |

### 벤치마크

| 항목 | 명령 |
|---|---|
| Query Korean recall 비교 | `bun run benchmark:query-recall` |
| Search recall 비교 | `bun run benchmark:search-recall` |

## Upstream QMD version bump checklist

`@tobilu/qmd` 버전을 올릴 때는 아래 순서를 따릅니다.

1. `package.json`에서 `@tobilu/qmd` 버전을 변경합니다.
2. `bun install`을 실행합니다.
3. `bun install --frozen-lockfile`로 lockfile 정합성을 확인합니다.
4. `bun pm untrusted`로 trust surface 변경을 확인합니다.
5. `bun run test:parity`로 parity 테스트를 실행합니다.
6. `node_modules/@tobilu/qmd/dist/cli/qmd.js`의 parse/default/usage/output 변경을 검토합니다.
7. owned help entrypoint(`qmd <owned> --help`, `qmd help <owned>`, `qmd --help <owned>`)를 검토합니다.
8. 변경이 있으면 `test/fixtures/owned-command-parity/baseline.json`과 snapshot fixture를 갱신합니다.
9. `documents`, `content`, `store_config`, `QMDStore.internal` contract가 shadow FTS helper와 맞는지 확인합니다.
10. `node_modules/@tobilu/qmd/dist/mcp/server.js`의 route shape, daemon lifecycle을 검토합니다.
11. `bun run test -- mcp-upstream-guard mcp-http mcp-stdio`로 MCP suite를 확인합니다.
12. [docs/architecture/mcp-divergence-registry.md](architecture/mcp-divergence-registry.md)의 intentional divergence를 재검토합니다.
13. `bun run release:artifact`와 `bun publish --dry-run`을 확인합니다.
14. 관련 문서를 함께 갱신합니다.
