import { describeEffectiveEmbedModel } from '#src/config/embedding_policy.js';
import type { CommandExecutionContext, CommandExecutionResult } from '#src/types/command.js';
import {
  fromExecutionFailure,
  fromRuntimeFailure,
  isOwnedCommandError,
  isOwnedRuntimeFailure,
  toExecutionResult,
} from './io/errors.js';
import { formatSearchExecutionResult } from './io/format.js';
import { parseOwnedQueryInput } from './io/parse.js';
import type { OwnedCommandError, QueryCommandInput, SearchOutputRow } from './io/types.js';
import { executeQueryCore } from './query_core.js';
import type { OwnedRuntimeDependencies, OwnedRuntimeFailure } from './runtime.js';
import { withOwnedStore } from './runtime.js';

export interface QueryCommandDependencies {
  readonly run?: (
    context: CommandExecutionContext,
    input: QueryCommandInput,
    runtimeDependencies?: OwnedRuntimeDependencies,
  ) => Promise<QueryCommandSuccess | OwnedCommandError | OwnedRuntimeFailure>;
  readonly runtimeDependencies?: OwnedRuntimeDependencies;
}

type QueryCommandSuccess = {
  readonly rows: SearchOutputRow[];
  readonly stderr?: string;
};

function looksLikeModelFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(model|embedding|llm|sqlite-vec|resolveModel)/i.test(message);
}

async function runQueryCommand(
  context: CommandExecutionContext,
  input: QueryCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
): Promise<QueryCommandSuccess | OwnedCommandError | OwnedRuntimeFailure> {
  return withOwnedStore(
    'query',
    context,
    async (session) => {
      const result = await executeQueryCore(session.store, input, runtimeDependencies?.env);

      if (isOwnedCommandError(result)) {
        return result;
      }

      return {
        rows: result.rows,
        stderr: result.advisories.length > 0 ? result.advisories.join('\n\n') : undefined,
      };
    },
    runtimeDependencies,
  );
}

export async function handleQueryCommand(
  context: CommandExecutionContext,
  dependencies: QueryCommandDependencies = {},
): Promise<CommandExecutionResult> {
  const parsed = parseOwnedQueryInput(context);
  if (parsed.kind !== 'ok') {
    return toExecutionResult(parsed);
  }

  try {
    const result = await (dependencies.run ?? runQueryCommand)(
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

    const execution = formatSearchExecutionResult(result.rows, parsed.input);

    return result.stderr ? { ...execution, stderr: result.stderr } : execution;
  } catch (error) {
    const effectiveModel = describeEffectiveEmbedModel(dependencies.runtimeDependencies?.env);
    return toExecutionResult(
      fromExecutionFailure(
        'query',
        error,
        looksLikeModelFailure(error)
          ? [
              "Run 'qmd pull' to fetch required local models.",
              `Current effective embedding model: ${effectiveModel.uri}`,
            ]
          : [],
      ),
    );
  }
}
