import type { UpdateResult } from '@tobilu/qmd';
import { describeEffectiveEmbedModel } from '../../config/embedding_policy.js';
import { describeEffectiveSearchPolicy } from '../../config/search_policy.js';
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
import { hasSearchIndexMismatch, readSearchIndexHealth } from './search_index_health.js';
import {
  rebuildSearchShadowIndex,
  type SearchShadowIndexDependencies,
} from './search_shadow_index.js';

export interface UpdateCommandDependencies {
  readonly run?: (
    context: CommandExecutionContext,
    input: UpdateCommandInput,
    runtimeDependencies?: OwnedRuntimeDependencies,
  ) => Promise<UpdateCommandSuccess | OwnedCommandError | OwnedRuntimeFailure>;
  readonly runtimeDependencies?: OwnedRuntimeDependencies;
  readonly searchIndexDependencies?: SearchShadowIndexDependencies;
}

type UpdateCommandSuccess = {
  readonly result: UpdateResult;
  readonly followUp?: string;
};

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
  searchIndexDependencies?: SearchShadowIndexDependencies,
): Promise<UpdateCommandSuccess | OwnedCommandError | OwnedRuntimeFailure> {
  const effectiveModel = describeEffectiveEmbedModel(runtimeDependencies?.env);
  const searchPolicy = describeEffectiveSearchPolicy();

  return withOwnedStore(
    'update',
    context,
    async (session) => {
      const result = await executeUpdate(session, input);
      const searchHealth = readSearchIndexHealth(session.store.internal.db, searchPolicy);
      const searchChanged = result.indexed > 0 || result.updated > 0 || result.removed > 0;
      if (searchChanged || hasSearchIndexMismatch(searchHealth)) {
        await rebuildSearchShadowIndex(session.store.internal.db, searchPolicy, {
          ...searchIndexDependencies,
          kiwiDependencies: {
            env: runtimeDependencies?.env,
            ...searchIndexDependencies?.kiwiDependencies,
          },
        });
      }

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
    const result = dependencies.run
      ? await dependencies.run(context, parsed.input, dependencies.runtimeDependencies)
      : await runUpdateCommand(
          context,
          parsed.input,
          dependencies.runtimeDependencies,
          dependencies.searchIndexDependencies,
        );

    if (isOwnedRuntimeFailure(result)) {
      return toExecutionResult(fromRuntimeFailure(result));
    }

    if (isOwnedCommandError(result)) {
      return toExecutionResult(result);
    }

    return formatUpdateExecutionResult(result.result, parsed.input, result.followUp);
  } catch (error) {
    return toExecutionResult(fromExecutionFailure('update', error));
  }
}
