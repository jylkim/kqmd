import type { CommandExecutionContext, CommandExecutionResult } from '../../types/command.js';
import {
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
  ) => Promise<SearchOutputRow[] | OwnedCommandError | OwnedRuntimeFailure>;
  readonly runtimeDependencies?: OwnedRuntimeDependencies;
}

async function runQueryCommand(
  context: CommandExecutionContext,
  input: QueryCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
): Promise<SearchOutputRow[] | OwnedCommandError | OwnedRuntimeFailure> {
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

      return normalizeHybridQueryResults(results);
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

  return formatSearchExecutionResult(result, parsed.input);
}
