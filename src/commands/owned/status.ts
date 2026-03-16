import type { CommandExecutionContext, CommandExecutionResult } from '../../types/command.js';
import {
  fromExecutionFailure,
  fromRuntimeFailure,
  isOwnedCommandError,
  isOwnedRuntimeFailure,
  toExecutionResult,
} from './io/errors.js';
import { formatStatusExecutionResult } from './io/format.js';
import { parseOwnedStatusInput } from './io/parse.js';
import type { OwnedCommandError, StatusCommandInput, StatusCommandOutput } from './io/types.js';
import type { OwnedRuntimeDependencies, OwnedRuntimeFailure } from './runtime.js';
import { withOwnedStore } from './runtime.js';
import { readStatusCore } from './status_core.js';

export interface StatusCommandDependencies {
  readonly run?: (
    context: CommandExecutionContext,
    input: StatusCommandInput,
    runtimeDependencies?: OwnedRuntimeDependencies,
  ) => Promise<StatusCommandOutput | OwnedCommandError | OwnedRuntimeFailure>;
  readonly runtimeDependencies?: OwnedRuntimeDependencies;
}

async function runStatusCommand(
  context: CommandExecutionContext,
  _input: StatusCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
): Promise<StatusCommandOutput | OwnedCommandError | OwnedRuntimeFailure> {
  return withOwnedStore(
    'status',
    context,
    async (session) => readStatusCore(session.store, runtimeDependencies?.env),
    runtimeDependencies,
  );
}

export async function handleStatusCommand(
  context: CommandExecutionContext,
  dependencies: StatusCommandDependencies = {},
): Promise<CommandExecutionResult> {
  const parsed = parseOwnedStatusInput(context);
  if (parsed.kind !== 'ok') {
    return toExecutionResult(parsed);
  }

  try {
    const result = await (dependencies.run ?? runStatusCommand)(
      context,
      parsed.input,
      dependencies.runtimeDependencies,
    );

    if (isOwnedRuntimeFailure(result)) {
      return toExecutionResult(fromRuntimeFailure(result));
    }

    if (isOwnedCommandError(result)) {
      return toExecutionResult(result);
    }

    return formatStatusExecutionResult(result, parsed.input);
  } catch (error) {
    return toExecutionResult(fromExecutionFailure('status', error));
  }
}
