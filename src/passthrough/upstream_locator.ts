/**
 * Upstream qmd 패키지 탐색.
 *
 * kqmd는 @tobilu/qmd 패키지를 래핑하여 한국어 검색을 추가한다.
 * upstream의 바이너리와 내부 모듈을 사용하기 위해 node_modules에서
 * @tobilu/qmd의 설치 위치를 찾아야 한다.
 *
 * 탐색 경로 (상위 디렉토리를 순회):
 *   1. {dir}/node_modules/@tobilu/qmd/package.json — 일반적인 npm install 구조
 *   2. {dir}/@tobilu/qmd/package.json — pnpm/yarn PnP 등 flat 구조
 *
 * KQMD_UPSTREAM_BIN 환경변수로 바이너리 경로를 직접 지정할 수도 있다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface UpstreamBinary {
  readonly path: string;
  readonly source: 'env' | 'package-bin';
}

function findInstalledPackageRoot(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    const nodeModulesCandidate = resolve(
      currentDir,
      'node_modules',
      '@tobilu',
      'qmd',
      'package.json',
    );
    if (existsSync(nodeModulesCandidate)) {
      return dirname(nodeModulesCandidate);
    }

    const directNodeModulesCandidate = resolve(currentDir, '@tobilu', 'qmd', 'package.json');
    if (existsSync(directNodeModulesCandidate)) {
      return dirname(directNodeModulesCandidate);
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  throw new Error('Unable to locate installed @tobilu/qmd package root.');
}

export function findUpstreamPackageRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return findInstalledPackageRoot(moduleDir);
}

export function locateUpstreamBinary(env: NodeJS.ProcessEnv = process.env): UpstreamBinary {
  if (env.KQMD_UPSTREAM_BIN) {
    return {
      path: env.KQMD_UPSTREAM_BIN,
      source: 'env',
    };
  }

  const packageRoot = findUpstreamPackageRoot();
  const packageJsonPath = resolve(packageRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };

  const packageBin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.qmd;

  if (!packageBin) {
    throw new Error('Unable to locate upstream `qmd` bin from @tobilu/qmd package metadata.');
  }

  return {
    path: resolve(packageRoot, packageBin),
    source: 'package-bin',
  };
}
