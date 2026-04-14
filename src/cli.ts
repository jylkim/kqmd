import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { CLI_OPTIONS } from './cli_options.js';
import {
  formatSupportedCommandList,
  isHelpAlias,
  isOwnedCommand,
  resolveCommandRoute,
} from './commands/manifest.js';
import { handleBenchCommand } from './commands/owned/bench.js';
import { handleCleanupCommand } from './commands/owned/cleanup.js';
import { handleEmbedCommand } from './commands/owned/embed.js';
import { formatOwnedCommandHelp, hasOwnedCommandHelpFlag } from './commands/owned/help.js';
import { handleMcpCommand } from './commands/owned/mcp.js';
import { handleQueryCommand } from './commands/owned/query.js';
import { handleSearchCommand } from './commands/owned/search.js';
import { handleStatusCommand } from './commands/owned/status.js';
import { handleUpdateCommand } from './commands/owned/update.js';
import { delegatePassthrough } from './passthrough/delegate.js';
import type {
  CommandExecutionContext,
  CommandExecutionResult,
  CommandRoute,
  OwnedCommand,
  ParsedCliInvocation,
} from './types/command.js';

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
  const helpAliasCommand = isHelpAlias(positionals[0]) ? positionals[1] : undefined;

  if (helpAliasCommand && isOwnedCommand(helpAliasCommand)) {
    route = { mode: 'owned', command: helpAliasCommand };
  } else if (values.help) {
    const helpCommand = positionals[0];
    route =
      helpCommand && isOwnedCommand(helpCommand)
        ? { mode: 'owned', command: helpCommand }
        : { mode: 'passthrough', command: helpCommand ?? 'help' };
  } else if (values.skill) {
    route = { mode: 'passthrough', command: positionals[0] ?? 'help' };
  } else if (positionals.length === 0) {
    route = { mode: 'passthrough', command: 'help' };
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
  invocation: ParsedCliInvocation & { route: { mode: 'owned'; command: OwnedCommand } },
): Promise<CommandExecutionResult> {
  if (hasOwnedCommandHelpFlag(invocation.argv) || invocation.command === 'help') {
    return formatOwnedCommandHelp(invocation.route.command);
  }

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
    case 'status':
      return handleStatusCommand(context);
    case 'mcp':
      return handleMcpCommand(context);
    case 'cleanup':
      return handleCleanupCommand(context);
    case 'bench':
      return handleBenchCommand(context);
  }

  throw new Error(`Unhandled owned command: ${invocation.route.command}`);
}

function writeResult(io: CliIO, result: CommandExecutionResult): void {
  if (result.directIO) {
    return;
  }

  if (result.stdout) {
    io.stdout.write(`${result.stdout}\n`);
  }

  if (result.stderr) {
    io.stderr.write(`${result.stderr}\n`);
  }
}

function readVersionString(): string {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json') as {
    version: string;
    dependencies: Record<string, string>;
  };
  return `kqmd ${pkg.version} (qmd ${pkg.dependencies['@tobilu/qmd']})`;
}

const UPSTREAM_HELP_HEADLINE = /^qmd\b.*$/m;

function brandHelpOutput(upstream: string): string {
  return upstream.replace(
    UPSTREAM_HELP_HEADLINE,
    'kqmd — Drop-in QMD replacement with Korean-aware search',
  );
}

export async function runCli(argv: string[], io: CliIO = process): Promise<number> {
  if (argv.includes('--version') || argv.includes('-v')) {
    io.stdout.write(`${readVersionString()}\n`);
    return 0;
  }

  const invocation = parseCliInvocation(argv);

  if (invocation.route.mode === 'owned') {
    const result = await executeOwnedCommand(
      invocation as ParsedCliInvocation & {
        route: { mode: 'owned'; command: OwnedCommand };
      },
    );
    writeResult(io, result);
    return result.exitCode;
  }

  if (invocation.route.mode === 'passthrough') {
    if (invocation.route.command === 'help' && invocation.command !== 'help') {
      const { delegatePassthroughPiped } = await import('./passthrough/delegate_piped.js');
      const result = await delegatePassthroughPiped(argv);
      if (result.stdout) {
        io.stdout.write(brandHelpOutput(result.stdout));
      }
      if (result.stderr) {
        io.stderr.write(brandHelpOutput(result.stderr));
      }
      return result.exitCode;
    }

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
