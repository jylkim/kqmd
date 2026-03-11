export type OwnedCommand = 'search' | 'query' | 'update' | 'embed';

export type PassthroughCommand = 'collection' | 'status' | 'ls' | 'get' | 'multi-get' | 'mcp';

export type CommandRoute =
  | { mode: 'owned'; command: OwnedCommand }
  | { mode: 'passthrough'; command: PassthroughCommand | 'help' | string }
  | { mode: 'unknown'; command: string };

export interface ParsedCliInvocation {
  argv: string[];
  command?: string;
  commandArgs: string[];
  indexName?: string;
  route: CommandRoute;
}

export interface CommandExecutionContext {
  readonly argv: string[];
  readonly commandArgs: string[];
  readonly indexName?: string;
}

export interface CommandExecutionResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
}
