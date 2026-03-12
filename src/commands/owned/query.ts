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
} from './io/errors.js';
import { formatSearchExecutionResult, normalizeHybridQueryResults } from './io/format.js';
import { parseOwnedQueryInput } from './io/parse.js';
import type { OwnedCommandError, QueryCommandInput, SearchOutputRow } from './io/types.js';
import { resolveSelectedCollections } from './io/validate.js';
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

function buildQueryMismatchWarning(expectedModel: string, storedModels: string): string {
  return [
    'Embedding model mismatch detected.',
    `Expected effective model: ${expectedModel}`,
    `Stored models: ${storedModels}`,
    "Run 'qmd embed --force' to rebuild embeddings for the current model.",
  ].join('\n');
}

function looksLikeModelFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(model|embedding|llm|sqlite-vec|resolveModel)/i.test(message);
}

async function runQueryCommand(
  context: CommandExecutionContext,
  input: QueryCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
): Promise<QueryCommandSuccess | OwnedCommandError | OwnedRuntimeFailure> {
  const effectiveModel = describeEffectiveEmbedModel(runtimeDependencies?.env);

  return withOwnedStore(
    'query',
    context,
    async (session) => {
      const [availableCollections, defaultCollections] = await Promise.all([
        session.store.listCollections(),
        session.store.getDefaultCollectionNames(),
      ]);
      const selectedCollections = resolveSelectedCollections(
        input.collections,
        availableCollections.map((collection) => collection.name),
        defaultCollections,
      );

      if (isOwnedCommandError(selectedCollections)) {
        return selectedCollections;
      }

      const health = await readEmbeddingHealth(session.store, effectiveModel.uri, {
        collections: selectedCollections,
      });

      const results =
        input.queryMode === 'structured' && input.queries
          ? await session.store.search({
              queries: input.queries,
              collections: selectedCollections.length > 0 ? selectedCollections : undefined,
              limit: input.all ? 500 : input.limit,
              minScore: input.minScore,
              explain: input.explain,
              intent: input.intent,
            })
          : await session.store.search({
              query: input.query,
              collections: selectedCollections.length > 0 ? selectedCollections : undefined,
              limit: input.all ? 500 : input.limit,
              minScore: input.minScore,
              explain: input.explain,
              intent: input.intent,
            });

      return {
        rows: normalizeHybridQueryResults(results),
        stderr: hasEmbeddingMismatch(health)
          ? buildQueryMismatchWarning(effectiveModel.uri, summarizeStoredEmbeddingModels(health))
          : undefined,
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
