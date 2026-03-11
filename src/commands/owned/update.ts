import type { CommandExecutionContext, CommandExecutionResult } from '../../types/command.js';

export async function handleUpdateCommand(
  context: CommandExecutionContext,
): Promise<CommandExecutionResult> {
  return {
    exitCode: 2,
    stderr: [
      'The `update` command is reserved by K-QMD but is still scaffold-only.',
      `Received arguments: ${context.commandArgs.join(' ') || '(none)'}`,
      'The scaffold intentionally avoids mutating shared index state for now.',
    ].join('\n'),
  };
}
