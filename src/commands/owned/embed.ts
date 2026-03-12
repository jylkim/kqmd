import type { EmbedResult } from '@tobilu/qmd';
import type { CommandExecutionContext, CommandExecutionResult } from '../../types/command.js';
import {
  fromRuntimeFailure,
  isOwnedCommandError,
  isOwnedRuntimeFailure,
  toExecutionResult,
} from './io/errors.js';
import { formatEmbedExecutionResult } from './io/format.js';
import { parseOwnedEmbedInput } from './io/parse.js';
import type { EmbedCommandInput, OwnedCommandError } from './io/types.js';
import type { OwnedRuntimeDependencies, OwnedRuntimeFailure } from './runtime.js';
import { withOwnedStore } from './runtime.js';

export interface EmbedCommandDependencies {
  readonly run?: (
    context: CommandExecutionContext,
    input: EmbedCommandInput,
    runtimeDependencies?: OwnedRuntimeDependencies,
  ) => Promise<EmbedResult | OwnedCommandError | OwnedRuntimeFailure>;
  readonly runtimeDependencies?: OwnedRuntimeDependencies;
}

async function runEmbedCommand(
  context: CommandExecutionContext,
  input: EmbedCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
): Promise<EmbedResult | OwnedCommandError | OwnedRuntimeFailure> {
  return withOwnedStore(
    'embed',
    context,
    async (session) =>
      session.store.embed({
        force: input.force,
      }),
    runtimeDependencies,
  );
}

export async function handleEmbedCommand(
  context: CommandExecutionContext,
  dependencies: EmbedCommandDependencies = {},
): Promise<CommandExecutionResult> {
  const parsed = parseOwnedEmbedInput(context);
  if (parsed.kind !== 'ok') {
    return toExecutionResult(parsed);
  }

  const result = await (dependencies.run ?? runEmbedCommand)(
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

  return formatEmbedExecutionResult(result, parsed.input);
}
