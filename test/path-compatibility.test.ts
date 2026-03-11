import { pathToFileURL } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  getCacheDir,
  getConfigFilePath,
  getDefaultDbPath,
  getMcpLogPath,
  getMcpPidPath,
} from '../src/config/qmd_paths.js';
import { findUpstreamPackageRoot } from '../src/passthrough/upstream_locator.js';

async function loadUpstreamModules() {
  const packageRoot = findUpstreamPackageRoot();
  const storeUrl = pathToFileURL(`${packageRoot}/dist/store.js`).href;
  const collectionsUrl = pathToFileURL(`${packageRoot}/dist/collections.js`).href;

  const store = (await import(storeUrl)) as {
    enableProductionMode: () => void;
    getDefaultDbPath: (indexName?: string) => string;
  };
  const collections = (await import(collectionsUrl)) as {
    getConfigPath: () => string;
    setConfigIndexName: (name: string) => void;
  };

  return { store, collections };
}

function withEnv<T>(patch: NodeJS.ProcessEnv, callback: () => T): T {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('path compatibility', () => {
  test('matches upstream db path when INDEX_PATH override is set', async () => {
    const { store } = await loadUpstreamModules();
    store.enableProductionMode();

    withEnv({ INDEX_PATH: '/tmp/kqmd-test.sqlite' }, () => {
      expect(getDefaultDbPath('index', process.env)).toBe(store.getDefaultDbPath('index'));
    });
  });

  test('matches upstream db path for named indexes under XDG cache', async () => {
    const { store } = await loadUpstreamModules();
    store.enableProductionMode();

    withEnv(
      {
        INDEX_PATH: undefined,
        XDG_CACHE_HOME: '/tmp/kqmd-cache-home',
      },
      () => {
        expect(getDefaultDbPath('work', process.env)).toBe(store.getDefaultDbPath('work'));
        expect(getCacheDir(process.env)).toBe('/tmp/kqmd-cache-home/qmd');
        expect(getMcpPidPath(process.env)).toBe('/tmp/kqmd-cache-home/qmd/mcp.pid');
        expect(getMcpLogPath(process.env)).toBe('/tmp/kqmd-cache-home/qmd/mcp.log');
      },
    );
  });

  test('matches upstream config path for override and named index', async () => {
    const { collections } = await loadUpstreamModules();

    withEnv({ QMD_CONFIG_DIR: '/tmp/kqmd-config-home' }, () => {
      collections.setConfigIndexName('docs');
      expect(getConfigFilePath('docs', process.env)).toBe(collections.getConfigPath());
    });
  });

  test('matches upstream config path for XDG config home fallback', async () => {
    const { collections } = await loadUpstreamModules();

    withEnv(
      {
        QMD_CONFIG_DIR: undefined,
        XDG_CONFIG_HOME: '/tmp/kqmd-xdg-config',
      },
      () => {
        collections.setConfigIndexName('notes');
        expect(getConfigFilePath('notes', process.env)).toBe(collections.getConfigPath());
      },
    );
  });
});
