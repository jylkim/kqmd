# Release

릴리스 후보를 검증하고 publish하는 절차를 정리한 문서입니다.

## 릴리스 검증

### 전체 릴리스 게이트

```bash
bun run release:verify
```

lint, typecheck, release contract 테스트, Kiwi reliability 측정을 순서대로 실행합니다.

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

## 벤치마크

| 벤치마크 | 명령 | 결과 |
|---|---|---|
| Kiwi reliability | `bun run measure:kiwi-reliability` | [metrics](benchmarks/2026-03-13-kiwi-search-reliability-metrics.md) |
| MCP contract | `bun run measure:mcp-contract` | [metrics](benchmarks/2026-03-16-mcp-contract-metrics.md) |
| Adaptive query ranking | `bun run measure:query-adaptive` | [metrics](benchmarks/2026-03-17-query-adaptive-ranking-metrics.md) |
| Adaptive query E2E | `bun run measure:query-adaptive-e2e` | [metrics](benchmarks/2026-03-17-query-adaptive-e2e-metrics.md) |
| Recall comparison | `bun run measure:recall-comparison` | [metrics](benchmarks/2026-03-17-recall-comparison-metrics.md) |

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
