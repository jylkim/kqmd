import { describeEffectiveEmbedModel } from '../../config/embedding_policy.js';
import { describeEffectiveSearchPolicy } from '../../config/search_policy.js';
import type { CommandExecutionContext, CommandExecutionResult } from '../../types/command.js';
import { readEmbeddingHealth } from './embedding_health.js';
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
import { readSearchIndexHealth } from './search_index_health.js';

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
  const effectiveModel = describeEffectiveEmbedModel(runtimeDependencies?.env);
  const searchPolicy = describeEffectiveSearchPolicy();

  return withOwnedStore(
    'status',
    context,
    async (session) => {
      const status = await session.store.getStatus();
      const health = await readEmbeddingHealth(session.store, effectiveModel.uri, {
        status,
      });
      const searchHealth = readSearchIndexHealth(session.store.internal.db, searchPolicy);

      return {
        dbPath: session.dbPath,
        effectiveModel,
        searchPolicy,
        status,
        health,
        searchHealth,
      };
    },
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
