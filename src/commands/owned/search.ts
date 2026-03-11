import type { CommandExecutionContext, CommandExecutionResult } from '../../types/command.js';

export async function handleSearchCommand(
  context: CommandExecutionContext,
): Promise<CommandExecutionResult> {
  return {
    exitCode: 2,
    stderr: [
      'The `search` command is reserved by K-QMD but is still scaffold-only.',
      `Received arguments: ${context.commandArgs.join(' ') || '(none)'}`,
      'Next sprint will replace this stub with Korean-aware search behavior.',
    ].join('\n'),
  };
}
