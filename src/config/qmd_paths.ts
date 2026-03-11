import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

type Env = NodeJS.ProcessEnv;

export function getHomeDirectory(env: Env = process.env): string {
  return env.HOME || homedir();
}

export function getConfigDir(env: Env = process.env): string {
  if (env.QMD_CONFIG_DIR) {
    return env.QMD_CONFIG_DIR;
  }

  if (env.XDG_CONFIG_HOME) {
    return join(env.XDG_CONFIG_HOME, 'qmd');
  }

  return join(getHomeDirectory(env), '.config', 'qmd');
}

export function getConfigFilePath(indexName = 'index', env: Env = process.env): string {
  return join(getConfigDir(env), `${indexName}.yml`);
}

export function getCacheDir(env: Env = process.env): string {
  const baseCacheDir = env.XDG_CACHE_HOME || resolve(getHomeDirectory(env), '.cache');
  return resolve(baseCacheDir, 'qmd');
}

export function getDefaultDbPath(indexName = 'index', env: Env = process.env): string {
  if (env.INDEX_PATH) {
    return env.INDEX_PATH;
  }

  return resolve(getCacheDir(env), `${indexName}.sqlite`);
}

export function getModelCacheDir(env: Env = process.env): string {
  return join(getHomeDirectory(env), '.cache', 'qmd', 'models');
}

export function getMcpPidPath(env: Env = process.env): string {
  return resolve(getCacheDir(env), 'mcp.pid');
}

export function getMcpLogPath(env: Env = process.env): string {
  return resolve(getCacheDir(env), 'mcp.log');
}
