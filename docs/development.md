# 개발자 문서

이 문서는 K-QMD 저장소를 직접 수정하거나 스캐폴딩을 확장하려는 개발자를 위한 문서입니다.
사용자 개요는 [README.md](../README.md)를 기준으로 봅니다.

## 개발 환경

- Node.js `>=24`
- npm `>=11`
- TypeScript
- Vitest
- Biome

## 시작하기

```bash
npm install
npm run build
npm run check
```

## 주요 스크립트

- `npm run lint`
- `npm run format`
- `npm run typecheck`
- `npm run test`
- `npm run test:watch`
- `npm run test:coverage`
- `npm run build`
- `npm run check`

## 현재 구조

- [`bin/qmd.js`](../bin/qmd.js)
  published CLI entrypoint
- [`src/cli.ts`](../src/cli.ts)
  top-level routing과 실행 진입점
- [`src/commands/manifest.ts`](../src/commands/manifest.ts)
  owned/passthrough 명령 source of truth
- [`src/passthrough/delegate.ts`](../src/passthrough/delegate.ts)
  upstream `qmd` 위임 실행
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
npm run check
```

### publish 산출물 확인

```bash
npm pack --dry-run
```

### bin smoke 경로 확인

```bash
npm run build
node ./bin/qmd.js status
```

## 관련 문서

- [docs/architecture/kqmd-command-boundary.md](architecture/kqmd-command-boundary.md)
- [docs/architecture/upstream-compatibility-policy.md](architecture/upstream-compatibility-policy.md)
- [docs/plans/2026-03-11-feat-kqmd-replacement-distribution-scaffold-plan.md](plans/2026-03-11-feat-kqmd-replacement-distribution-scaffold-plan.md)
