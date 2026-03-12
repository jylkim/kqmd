import type { CommandExecutionContext, CommandExecutionResult } from '../../types/command.js';
import {
  fromRuntimeFailure,
  isOwnedCommandError,
  isOwnedRuntimeFailure,
  toExecutionResult,
} from './io/errors.js';
import { formatSearchExecutionResult, normalizeSearchResults } from './io/format.js';
import { parseOwnedSearchInput } from './io/parse.js';
import type { OwnedCommandError, SearchCommandInput, SearchOutputRow } from './io/types.js';
import { resolveSelectedCollections } from './io/validate.js';
import type { OwnedRuntimeDependencies, OwnedRuntimeFailure } from './runtime.js';
import { withOwnedStore } from './runtime.js';

export interface SearchCommandDependencies {
  readonly run?: (
    context: CommandExecutionContext,
    input: SearchCommandInput,
    runtimeDependencies?: OwnedRuntimeDependencies,
  ) => Promise<SearchOutputRow[] | OwnedCommandError | OwnedRuntimeFailure>;
  readonly runtimeDependencies?: OwnedRuntimeDependencies;
}

async function runSearchCommand(
  context: CommandExecutionContext,
  input: SearchCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
): Promise<SearchOutputRow[] | OwnedCommandError | OwnedRuntimeFailure> {
  return withOwnedStore(
    'search',
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

      const fetchLimit = input.all ? 100000 : Math.max(50, input.limit * 2);
      const singleCollection =
        selectedCollections.length === 1 ? selectedCollections[0] : undefined;
      let results = await session.store.searchLex(input.query, {
        limit: fetchLimit,
        collection: singleCollection,
      });

      if (selectedCollections.length > 1) {
        results = results.filter((result) => selectedCollections.includes(result.collectionName));
      }

      return normalizeSearchResults(results);
    },
    runtimeDependencies,
  );
}

export async function handleSearchCommand(
  context: CommandExecutionContext,
  dependencies: SearchCommandDependencies = {},
): Promise<CommandExecutionResult> {
  const parsed = parseOwnedSearchInput(context);
  if (parsed.kind !== 'ok') {
    return toExecutionResult(parsed);
  }

  const result = await (dependencies.run ?? runSearchCommand)(
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
