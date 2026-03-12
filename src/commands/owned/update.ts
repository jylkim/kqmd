import type { UpdateResult } from '@tobilu/qmd';
import { describeEffectiveEmbedModel } from '../../config/embedding_policy.js';
import type { CommandExecutionContext, CommandExecutionResult } from '../../types/command.js';
import { hasEmbeddingMismatch, readEmbeddingHealth } from './embedding_health.js';
import {
  fromExecutionFailure,
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
  ) => Promise<UpdateCommandSuccess | OwnedCommandError | OwnedRuntimeFailure>;
  readonly runtimeDependencies?: OwnedRuntimeDependencies;
}

type UpdateCommandSuccess =
  | UpdateResult
  | {
      readonly result: UpdateResult;
      readonly followUp?: string;
    };

function isUpdateCommandSuccess(
  value: UpdateCommandSuccess,
): value is { readonly result: UpdateResult; readonly followUp?: string } {
  return typeof value === 'object' && value !== null && 'result' in value;
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
): Promise<UpdateCommandSuccess | OwnedCommandError | OwnedRuntimeFailure> {
  const effectiveModel = describeEffectiveEmbedModel(runtimeDependencies?.env);

  return withOwnedStore(
    'update',
    context,
    async (session) => {
      const result = await executeUpdate(session, input);
      const health = await readEmbeddingHealth(session.store, effectiveModel.uri);

      return {
        result,
        followUp: hasEmbeddingMismatch(health)
          ? "Run 'qmd embed --force' to rebuild embeddings for the current model."
          : undefined,
      };
    },
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

  try {
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

    const success = isUpdateCommandSuccess(result) ? result : { result };
    return formatUpdateExecutionResult(success.result, parsed.input, success.followUp);
  } catch (error) {
    return toExecutionResult(fromExecutionFailure('update', error));
  }
}
