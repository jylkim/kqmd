# 개발자 문서

이 문서는 K-QMD 저장소를 직접 수정하거나 스캐폴딩을 확장하려는 개발자를 위한 문서입니다.
사용자 개요는 [README.md](../README.md)를 기준으로 봅니다.

## 개발 환경

- Bun `1.3.10`
- Node.js `>=24`
- TypeScript
- Vitest
- Biome

## 시작하기

```bash
bun install
bun run build
bun run check
```

## 주요 스크립트

- `bun run lint`
- `bun run format`
- `bun run typecheck`
- `bun run test`
- `bun run test:parity`
- `bun run test:watch`
- `bun run test:coverage`
- `bun run build`
- `bun run check`

## 현재 구조

- [`bin/qmd.js`](../bin/qmd.js)
  published CLI entrypoint
- [`src/cli.ts`](../src/cli.ts)
  top-level routing과 실행 진입점
- [`src/commands/manifest.ts`](../src/commands/manifest.ts)
  owned/passthrough 명령 source of truth
- [`src/config/embedding_policy.ts`](../src/config/embedding_policy.ts)
  effective embedding model policy와 bootstrap helper
- [`src/config/search_policy.ts`](../src/config/search_policy.ts)
  Korean lexical search policy와 shadow FTS metadata key
- [`src/passthrough/delegate.ts`](../src/passthrough/delegate.ts)
  upstream `qmd` 위임 실행
- [`src/commands/owned/embedding_health.ts`](../src/commands/owned/embedding_health.ts)
  stored vector model mismatch / missing health 계산
- [`src/commands/owned/search_index_health.ts`](../src/commands/owned/search_index_health.ts)
  Korean shadow FTS policy health 계산
- [`src/commands/owned/search_shadow_index.ts`](../src/commands/owned/search_shadow_index.ts)
  same-DB shadow FTS rebuild / query helper
- [`src/commands/owned/kiwi_tokenizer.ts`](../src/commands/owned/kiwi_tokenizer.ts)
  Kiwi wasm/model cache bootstrap과 Korean token augmentation helper
- [`src/commands/owned/status.ts`](../src/commands/owned/status.ts)
  owned status output과 embedding/search health surface
- [`src/commands/owned/io/`](../src/commands/owned/io)
  owned command parse/validation/output parity contract
- [`src/config/qmd_paths.ts`](../src/config/qmd_paths.ts)
  upstream-compatible path helpers
- [`test/`](../test)
  routing, passthrough, path compatibility, bin smoke tests

## 패키징 계약

- 패키지 이름: `kqmd`
- 실행 명령: `qmd`
- `package.json#bin`이 [`bin/qmd.js`](../bin/qmd.js)를 가리킨다
- `bin/qmd.js`는 빌드 산출물인 `dist/cli.js`를 실행한다

## 검증 방법

### 전체 품질 게이트

```bash
bun run check
```

### owned command parity suite

```bash
bun run test:parity
```

이 suite는 `search/query/update/embed`의 parse/validation/output contract를 고정한다.
특히 `search/query` success snapshot, `update/embed` success shape, upstream version guard를 포함한다.

### embedding policy / mismatch checks

```bash
bun run test -- embedding-policy embedding-health owned-embedding-behavior status-command
```

이 suite는 default embed policy precedence, stored vector mismatch detection, owned `status`,
그리고 `query/embed/update`의 mismatch-aware UX를 고정한다.

### Korean search policy / shadow index checks

```bash
bun run test -- search-policy search-index-health kiwi-tokenizer search-shadow-index owned-search-behavior
```

이 suite는 canonical search policy, shadow index health classification, Kiwi token normalization,
same-DB shadow FTS rebuild/query, 그리고 stale policy warning + legacy fallback UX를 고정한다.

### publish 산출물 확인

```bash
bun pm pack --dry-run

TARBALL=$(bun pm pack --quiet)
tar -tf "$TARBALL" | rg '^(package/(bin|dist)/|package/README.md|package/LICENSE)'
```

### bin smoke 경로 확인

```bash
bun run build
node ./bin/qmd.js collection list
```

### upstream qmd version bump checklist

1. `package.json`에서 `@tobilu/qmd` 버전을 변경한다
2. `bun install`
3. `bun install --frozen-lockfile`
4. `bun pm untrusted`로 install/lifecycle trust surface가 달라졌는지 확인한다
5. `bun run test:parity`
6. `node_modules/@tobilu/qmd/dist/cli/qmd.js`의 parse/default/usage/output 변경 사항을 검토한다
7. intentional drift가 있으면 `test/fixtures/owned-command-parity/baseline.json`과 snapshot fixtures를 갱신한다
8. `documents`, `content`, `store_config`, `QMDStore.internal` contract가 shadow FTS helper와 여전히 맞는지 확인한다
9. `bun pm pack --dry-run`과 actual tarball smoke를 다시 확인한다
10. 관련 문서와 plan/work log를 함께 갱신한다

## 관련 문서

- [docs/architecture/kqmd-command-boundary.md](architecture/kqmd-command-boundary.md)
- [docs/architecture/upstream-compatibility-policy.md](architecture/upstream-compatibility-policy.md)
- [docs/plans/2026-03-11-feat-kqmd-replacement-distribution-scaffold-plan.md](plans/2026-03-11-feat-kqmd-replacement-distribution-scaffold-plan.md)
