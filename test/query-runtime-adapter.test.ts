import { pathToFileURL } from 'node:url';

import { describe, expect, test } from 'vitest';

import { findUpstreamPackageRoot } from '../src/passthrough/upstream_locator.js';

describe('query runtime adapter compatibility', () => {
  test('upstream store module still exports candidate-limit helpers', async () => {
    const storeUrl = pathToFileURL(`${findUpstreamPackageRoot()}/dist/store.js`).href;
    const module = (await import(storeUrl)) as {
      hybridQuery?: unknown;
      structuredSearch?: unknown;
    };

    expect(typeof module.hybridQuery).toBe('function');
    expect(typeof module.structuredSearch).toBe('function');
  });
});
