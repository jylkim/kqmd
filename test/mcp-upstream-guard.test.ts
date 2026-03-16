import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

describe('upstream mcp baseline guard', () => {
  test('tracks expected upstream MCP surface markers', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'node_modules/@tobilu/qmd/dist/mcp/server.js'),
      'utf8',
    );

    expect(source).toContain('server.registerTool("query"');
    expect(source).toContain('server.registerTool("get"');
    expect(source).toContain('server.registerTool("multi_get"');
    expect(source).toContain('server.registerTool("status"');
    expect(source).toContain('pathname === "/health"');
    expect(source).toContain('pathname === "/mcp"');
  });
});
