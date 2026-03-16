import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { startOwnedMcpHttpServer } from '../src/mcp/server.js';

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index] ?? 0;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function measure<T>(fn: () => Promise<T>): Promise<{ readonly durationMs: number; readonly result: T }> {
  const startedAt = performance.now();
  const result = await fn();
  return {
    durationMs: performance.now() - startedAt,
    result,
  };
}

const root = mkdtempSync(resolve(tmpdir(), 'kqmd-mcp-metrics-'));
mkdirSync(resolve(root, '.cache', 'qmd'), { recursive: true });

const env = {
  HOME: root,
  XDG_CACHE_HOME: resolve(root, '.cache'),
};

const coldStart = await measure(() =>
  startOwnedMcpHttpServer(0, {
    env,
    quiet: true,
  }),
);

const { httpServer, stop } = coldStart.result;
const address = httpServer.address();
if (!address || typeof address === 'string') {
  throw new Error('Unable to resolve HTTP server address during MCP contract measurement.');
}

const baseUrl = `http://127.0.0.1:${address.port}/mcp`;
const client = new Client({
  name: 'mcp-contract-metrics-client',
  version: '1.0.0',
});
const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
await client.connect(transport);

const firstToolsList = await measure(() => client.listTools());
const warmQuery = await measure(() =>
  client.callTool({
    name: 'query',
    arguments: {
      searches: [{ type: 'lex', query: 'metrics probe' }],
    },
  }),
);
const warmStatus = await measure(() =>
  client.callTool({
    name: 'status',
    arguments: {},
  }),
);

const controlPlaneDurations: number[] = [];
for (let attempt = 0; attempt < 100; attempt += 1) {
  const measured = await measure(() => client.listTools());
  controlPlaneDurations.push(measured.durationMs);
}

const daemonSoakDurations: number[] = [];
for (let attempt = 0; attempt < 50; attempt += 1) {
  const measured = await measure(async () => {
    await Promise.all([
      client.callTool({
        name: 'query',
        arguments: {
          searches: [{ type: 'lex', query: 'soak probe' }],
        },
      }),
      client.callTool({
        name: 'status',
        arguments: {},
      }),
    ]);
  });
  daemonSoakDurations.push(measured.durationMs);
}

await transport.close();
await client.close();
await stop();

const report = `# MCP Contract Metrics

Date: 2026-03-16
Command: \`bun run scripts/measure_mcp_contract.ts\`

이 문서는 owned MCP boundary 작업에서 측정한 HTTP transport 기준의 로컬 contract metrics 기록이다.
수치는 developer laptop 참고값이며, absolute SLA보다는 regression 비교 기준으로 사용한다.

## Method

- environment:
  - temporary HOME / XDG cache
  - empty local index bootstrap
- transport:
  - local owned \`qmd mcp --http\` equivalent via \`startOwnedMcpHttpServer()\`
- measured axes:
  - cold start (HTTP server bootstrap)
  - first \`tools/list\`
  - warm \`query\`
  - warm \`status\`
  - repeated control-plane call (\`tools/list\` x100)
  - daemon soak proxy (\`query + status\` in parallel x50)

## Results

| Metric | Value (ms) |
|---|---:|
| cold start | ${coldStart.durationMs.toFixed(2)} |
| first tools/list | ${firstToolsList.durationMs.toFixed(2)} |
| warm query | ${warmQuery.durationMs.toFixed(2)} |
| warm status | ${warmStatus.durationMs.toFixed(2)} |
| control-plane avg | ${average(controlPlaneDurations).toFixed(2)} |
| control-plane p50 | ${percentile(controlPlaneDurations, 0.5).toFixed(2)} |
| control-plane p95 | ${percentile(controlPlaneDurations, 0.95).toFixed(2)} |
| daemon soak avg | ${average(daemonSoakDurations).toFixed(2)} |
| daemon soak p50 | ${percentile(daemonSoakDurations, 0.5).toFixed(2)} |
| daemon soak p95 | ${percentile(daemonSoakDurations, 0.95).toFixed(2)} |

## Notes

- empty index 기준이라 retrieval/store workload는 가볍다
- 이 문서는 contract overhead와 transport/session reuse regression 신호로 본다
- 실제 query corpus와 long-running daemon memory profile은 별도 follow-up 운영 검증이 필요하다
`;

process.stdout.write(`${report}\n`);
