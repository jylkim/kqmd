import type { CommandExecutionContext, CommandExecutionResult } from '../../types/command.js';

export async function handleEmbedCommand(
  context: CommandExecutionContext,
): Promise<CommandExecutionResult> {
  return {
    exitCode: 2,
    stderr: [
      'The `embed` command is reserved by K-QMD but is still scaffold-only.',
      `Received arguments: ${context.commandArgs.join(' ') || '(none)'}`,
      'Embedding defaults and Korean-specific behavior are intentionally deferred.',
    ].join('\n'),
  };
}
