import type { EmbedResult } from '@tobilu/qmd';
import { describeEffectiveEmbedModel } from '../../config/embedding_policy.js';
import type { CommandExecutionContext, CommandExecutionResult } from '../../types/command.js';
import {
  hasEmbeddingMismatch,
  readEmbeddingHealth,
  summarizeStoredEmbeddingModels,
} from './embedding_health.js';
import {
  fromExecutionFailure,
  fromRuntimeFailure,
  isOwnedCommandError,
  isOwnedRuntimeFailure,
  toExecutionResult,
  validationError,
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
  const effectiveModel = describeEffectiveEmbedModel(runtimeDependencies?.env);

  return withOwnedStore(
    'embed',
    context,
    async (session) => {
      const health = await readEmbeddingHealth(session.store, effectiveModel.uri);
      if (hasEmbeddingMismatch(health) && !input.force) {
        return validationError(
          [
            'Stored embeddings do not match the current effective embedding model.',
            `Expected effective model: ${effectiveModel.uri}`,
            `Stored models: ${summarizeStoredEmbeddingModels(health)}`,
            "Run 'qmd embed --force' to rebuild embeddings for the current model.",
          ].join('\n'),
        );
      }

      return session.store.embed({
        force: input.force,
        model: effectiveModel.uri,
      });
    },
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

  try {
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
  } catch (error) {
    const effectiveModel = describeEffectiveEmbedModel(dependencies.runtimeDependencies?.env);
    return toExecutionResult(
      fromExecutionFailure('embed', error, [
        "Run 'qmd pull' to fetch required local models.",
        `Current effective embedding model: ${effectiveModel.uri}`,
      ]),
    );
  }
}
