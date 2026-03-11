import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { formatSupportedCommandList, resolveCommandRoute } from './commands/manifest.js';
import { handleEmbedCommand } from './commands/owned/embed.js';
import { handleQueryCommand } from './commands/owned/query.js';
import { handleSearchCommand } from './commands/owned/search.js';
import { handleUpdateCommand } from './commands/owned/update.js';
import { delegatePassthrough } from './passthrough/delegate.js';
import type {
  CommandExecutionContext,
  CommandExecutionResult,
  CommandRoute,
  ParsedCliInvocation,
} from './types/command.js';

const CLI_OPTIONS = {
  index: { type: 'string' },
  context: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  skill: { type: 'boolean' },
  global: { type: 'boolean' },
  yes: { type: 'boolean' },
  n: { type: 'string' },
  'min-score': { type: 'string' },
  all: { type: 'boolean' },
  full: { type: 'boolean' },
  csv: { type: 'boolean' },
  md: { type: 'boolean' },
  xml: { type: 'boolean' },
  files: { type: 'boolean' },
  json: { type: 'boolean' },
  explain: { type: 'boolean' },
  collection: { type: 'string', short: 'c', multiple: true },
  name: { type: 'string' },
  mask: { type: 'string' },
  force: { type: 'boolean', short: 'f' },
  pull: { type: 'boolean' },
  refresh: { type: 'boolean' },
  l: { type: 'string' },
  from: { type: 'string' },
  'max-bytes': { type: 'string' },
  'line-numbers': { type: 'boolean' },
  'candidate-limit': { type: 'string', short: 'C' },
  intent: { type: 'string' },
  http: { type: 'boolean' },
  daemon: { type: 'boolean' },
  port: { type: 'string' },
} as const;

interface CliIO {
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: NodeJS.WriteStream;
}

export function parseCliInvocation(argv: string[]): ParsedCliInvocation {
  const { values, positionals } = parseArgs({
    args: argv,
    options: CLI_OPTIONS,
    allowPositionals: true,
    strict: false,
  });

  let route: CommandRoute;

  if (positionals.length === 0) {
    if (values.help || values.version || argv.length === 0) {
      route = { mode: 'passthrough', command: 'help' };
    } else {
      route = { mode: 'passthrough', command: 'help' };
    }
  } else {
    route = resolveCommandRoute(positionals[0]);
  }

  return {
    argv,
    command: positionals[0],
    commandArgs: positionals.slice(1),
    indexName: typeof values.index === 'string' ? values.index : undefined,
    route,
  };
}

function getOwnedCommandContext(invocation: ParsedCliInvocation): CommandExecutionContext {
  return {
    argv: invocation.argv,
    commandArgs: invocation.commandArgs,
    indexName: invocation.indexName,
  };
}

async function executeOwnedCommand(
  invocation: ParsedCliInvocation,
): Promise<CommandExecutionResult> {
  const context = getOwnedCommandContext(invocation);

  switch (invocation.route.command) {
    case 'search':
      return handleSearchCommand(context);
    case 'query':
      return handleQueryCommand(context);
    case 'update':
      return handleUpdateCommand(context);
    case 'embed':
      return handleEmbedCommand(context);
  }

  throw new Error(`Unhandled owned command: ${invocation.route.command}`);
}

function writeResult(io: CliIO, result: CommandExecutionResult): void {
  if (result.stdout) {
    io.stdout.write(`${result.stdout}\n`);
  }

  if (result.stderr) {
    io.stderr.write(`${result.stderr}\n`);
  }
}

export async function runCli(argv: string[], io: CliIO = process): Promise<number> {
  const invocation = parseCliInvocation(argv);

  if (invocation.route.mode === 'owned') {
    const result = await executeOwnedCommand(invocation);
    writeResult(io, result);
    return result.exitCode;
  }

  if (invocation.route.mode === 'passthrough') {
    const result = await delegatePassthrough(argv);

    if (result.signal) {
      process.kill(process.pid, result.signal);
      return 1;
    }

    return result.exitCode;
  }

  io.stderr.write(
    `${[
      `Unknown command: ${invocation.route.command}`,
      'K-QMD currently owns only a subset of qmd commands.',
      formatSupportedCommandList(),
      'Run `qmd --help` for upstream help output.',
    ].join('\n')}\n`,
  );

  return 1;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const exitCode = await runCli(argv);
    process.exitCode = exitCode;
    return exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return 1;
  }
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  void main();
}
