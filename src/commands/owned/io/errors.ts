import type { CommandExecutionResult } from '../../../types/command.js';
import type { OwnedRuntimeFailure } from '../runtime.js';
import type { OwnedCommandError, ParseResult } from './types.js';

export function usageError(stderr: string): OwnedCommandError {
  return { kind: 'usage', stderr, exitCode: 1 };
}

export function validationError(stderr: string): OwnedCommandError {
  return { kind: 'validation', stderr, exitCode: 1 };
}

export function runtimeError(stderr: string): OwnedCommandError {
  return { kind: 'runtime', stderr, exitCode: 1 };
}

export function executionError(stderr: string): OwnedCommandError {
  return { kind: 'execution', stderr, exitCode: 1 };
}

export function isOwnedCommandError(value: unknown): value is OwnedCommandError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ['usage', 'validation', 'runtime', 'execution'].includes(
      String((value as OwnedCommandError).kind),
    ) &&
    'stderr' in value &&
    'exitCode' in value
  );
}

export function isParseSuccess<T>(result: ParseResult<T>): result is { kind: 'ok'; input: T } {
  return result.kind === 'ok';
}

export function isOwnedRuntimeFailure(value: unknown): value is OwnedRuntimeFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ['config-missing', 'store-open-failed'].includes(String((value as OwnedRuntimeFailure).kind))
  );
}

export function fromRuntimeFailure(failure: OwnedRuntimeFailure): OwnedCommandError {
  switch (failure.kind) {
    case 'config-missing':
      if (failure.reason === 'config-required') {
        return runtimeError(
          [
            `The \`${failure.command}\` command requires a qmd config file.`,
            `Expected config at: ${failure.configPath}`,
          ].join('\n'),
        );
      }

      return runtimeError(
        [
          `No existing index or config found for \`${failure.indexName}\`.`,
          `Expected config at: ${failure.configPath}`,
          `Expected database at: ${failure.dbPath}`,
        ].join('\n'),
      );

    case 'store-open-failed':
      return runtimeError(
        [
          `Failed to open qmd store for \`${failure.command}\`.`,
          `Database: ${failure.dbPath}`,
          failure.configPath ? `Config: ${failure.configPath}` : undefined,
          `Cause: ${failure.cause.message}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
  }
}

export function toExecutionResult(
  result: OwnedCommandError | CommandExecutionResult,
): CommandExecutionResult {
  if (isOwnedCommandError(result)) {
    return {
      exitCode: result.exitCode,
      stderr: result.stderr,
    };
  }

  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
