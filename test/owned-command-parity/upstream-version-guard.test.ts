import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

describe('upstream qmd parity baseline', () => {
  test('matches the pinned upstream dependency version', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
    };
    const baseline = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'test/fixtures/owned-command-parity/baseline.json'),
        'utf8',
      ),
    ) as {
      upstreamVersion: string;
    };

    expect(packageJson.dependencies['@tobilu/qmd']).toBe(baseline.upstreamVersion);
  });
});
