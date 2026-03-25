import { createStore } from '@tobilu/qmd';

import { executeQueryCore } from '../src/commands/owned/query_core.js';
import {
  findFixture,
  installDeterministicLlmStub,
  toAllowlistedBenchmarkPath,
} from './query_cold_start_benchmark_lib.js';

function readArg(flag: string): string {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) {
    throw new Error(`Missing required argument: ${flag}`);
  }

  return value;
}

function readPeakRssBytes(): number {
  const maxRss = process.resourceUsage().maxRSS;
  return process.platform === 'darwin' ? maxRss : maxRss * 1024;
}

const fixture = findFixture(readArg('--fixture'));
const dbPath = readArg('--db-path');

const store = await createStore({ dbPath });

try {
  installDeterministicLlmStub(store);

  const result = await executeQueryCore(
    store,
    {
      query: fixture.query,
      displayQuery: fixture.query,
      format: 'json',
      limit: 5,
      minScore: 0,
      all: false,
      full: false,
      lineNumbers: false,
      collections: fixture.collections,
      explain: false,
      queryMode: 'plain',
    },
    process.env,
  );

  if ('kind' in result) {
    throw new Error(`Cold-start probe failed: ${result.stderr}`);
  }

  const top5Paths = result.rows
    .slice(0, 5)
    .map((row) => toAllowlistedBenchmarkPath(row.displayPath));

  const payload = {
    fixtureId: fixture.fixtureId,
    retrievalKind: result.query.execution.retrievalKind,
    heavyPathUsed: result.query.execution.heavyPathUsed,
    peakRssBytes: readPeakRssBytes(),
    targetHitAt5: top5Paths.includes(fixture.targetPath),
    top5Paths,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
} finally {
  await store.close();
}
