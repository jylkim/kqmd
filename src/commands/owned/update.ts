import type { UpdateResult } from '@tobilu/qmd';
import type { CommandExecutionContext, CommandExecutionResult } from '../../types/command.js';
import {
  fromRuntimeFailure,
  isOwnedCommandError,
  isOwnedRuntimeFailure,
  toExecutionResult,
} from './io/errors.js';
import { formatUpdateExecutionResult } from './io/format.js';
import { parseOwnedUpdateInput } from './io/parse.js';
import type { OwnedCommandError, UpdateCommandInput } from './io/types.js';
import type {
  OwnedRuntimeDependencies,
  OwnedRuntimeFailure,
  OwnedStoreContext,
} from './runtime.js';
import { withOwnedStore } from './runtime.js';

export interface UpdateCommandDependencies {
  readonly run?: (
    context: CommandExecutionContext,
    input: UpdateCommandInput,
    runtimeDependencies?: OwnedRuntimeDependencies,
  ) => Promise<UpdateResult | OwnedCommandError | OwnedRuntimeFailure>;
  readonly runtimeDependencies?: OwnedRuntimeDependencies;
}

async function executeUpdate(
  session: OwnedStoreContext,
  _input: UpdateCommandInput,
): Promise<UpdateResult> {
  return session.store.update();
}

async function runUpdateCommand(
  context: CommandExecutionContext,
  input: UpdateCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
): Promise<UpdateResult | OwnedCommandError | OwnedRuntimeFailure> {
  return withOwnedStore(
    'update',
    context,
    async (session) => executeUpdate(session, input),
    runtimeDependencies,
  );
}

export async function handleUpdateCommand(
  context: CommandExecutionContext,
  dependencies: UpdateCommandDependencies = {},
): Promise<CommandExecutionResult> {
  const parsed = parseOwnedUpdateInput(context);
  if (parsed.kind !== 'ok') {
    return toExecutionResult(parsed);
  }

  const result = await (dependencies.run ?? runUpdateCommand)(
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

  return formatUpdateExecutionResult(result, parsed.input);
}
