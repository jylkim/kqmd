import type { CommandRoute, OwnedCommand, PassthroughCommand } from '../types/command.js';

export const OWNED_COMMANDS = ['search', 'query', 'update', 'embed', 'status'] as const;

export const PASSTHROUGH_COMMANDS = ['collection', 'ls', 'get', 'multi-get', 'mcp'] as const;

type ManifestEntry = Extract<CommandRoute, { mode: 'owned' | 'passthrough' }>;

export const commandManifest = {
  search: { mode: 'owned', command: 'search' },
  query: { mode: 'owned', command: 'query' },
  update: { mode: 'owned', command: 'update' },
  embed: { mode: 'owned', command: 'embed' },
  status: { mode: 'owned', command: 'status' },
  collection: { mode: 'passthrough', command: 'collection' },
  ls: { mode: 'passthrough', command: 'ls' },
  get: { mode: 'passthrough', command: 'get' },
  'multi-get': { mode: 'passthrough', command: 'multi-get' },
  mcp: { mode: 'passthrough', command: 'mcp' },
} as const satisfies Record<string, ManifestEntry>;

const HELP_ALIASES = new Set(['help']);

export function isHelpAlias(command?: string): boolean {
  return typeof command === 'string' && HELP_ALIASES.has(command);
}

export function isOwnedCommand(command: string): command is OwnedCommand {
  return OWNED_COMMANDS.includes(command as OwnedCommand);
}

export function isPassthroughCommand(command: string): command is PassthroughCommand {
  return PASSTHROUGH_COMMANDS.includes(command as PassthroughCommand);
}

export function resolveCommandRoute(command?: string): CommandRoute {
  if (!command) {
    return { mode: 'passthrough', command: 'help' };
  }

  if (isHelpAlias(command)) {
    return { mode: 'passthrough', command: 'help' };
  }

  const route = commandManifest[command as keyof typeof commandManifest];

  if (route) {
    return route;
  }

  return { mode: 'unknown', command };
}

export function formatSupportedCommandList(): string {
  return [
    `owned: ${OWNED_COMMANDS.join(', ')}`,
    `passthrough: ${PASSTHROUGH_COMMANDS.join(', ')}`,
  ].join('\n');
}
