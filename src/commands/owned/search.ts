import type { CommandExecutionContext, CommandExecutionResult } from '#src/types/command.js';
import {
  fromRuntimeFailure,
  isOwnedCommandError,
  isOwnedRuntimeFailure,
  toExecutionResult,
} from './io/errors.js';
import { formatSearchExecutionResult } from './io/format.js';
import { parseOwnedSearchInput } from './io/parse.js';
import type { OwnedCommandError, SearchCommandInput, SearchOutputRow } from './io/types.js';
import { resolveSelectedCollections } from './io/validate.js';
import { executeLexicalCandidateSearch } from './query_lexical_candidates.js';
import type { OwnedRuntimeDependencies, OwnedRuntimeFailure } from './runtime.js';
import { withOwnedStore } from './runtime.js';

export interface SearchCommandDependencies {
  readonly run?: (
    context: CommandExecutionContext,
    input: SearchCommandInput,
    runtimeDependencies?: OwnedRuntimeDependencies,
  ) => Promise<SearchCommandSuccess | SearchOutputRow[] | OwnedCommandError | OwnedRuntimeFailure>;
  readonly runtimeDependencies?: OwnedRuntimeDependencies;
}

type SearchCommandSuccess = {
  readonly rows: SearchOutputRow[];
  readonly stderr?: string;
};

async function runSearchCommand(
  context: CommandExecutionContext,
  input: SearchCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
): Promise<SearchCommandSuccess | OwnedCommandError | OwnedRuntimeFailure> {
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
      const lexical = await executeLexicalCandidateSearch(
        session.store,
        input.query,
        selectedCollections,
        fetchLimit,
        { includePolicyWarning: true },
      );

      return {
        rows: lexical.rows,
        stderr: lexical.stderr,
      };
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

  const result = dependencies.run
    ? await dependencies.run(context, parsed.input, dependencies.runtimeDependencies)
    : await runSearchCommand(context, parsed.input, dependencies.runtimeDependencies);

  if (isOwnedRuntimeFailure(result)) {
    return toExecutionResult(fromRuntimeFailure(result));
  }

  if (isOwnedCommandError(result)) {
    return toExecutionResult(result);
  }

  const normalized = Array.isArray(result) ? { rows: result } : result;
  const execution = formatSearchExecutionResult(normalized.rows, parsed.input);

  return normalized.stderr ? { ...execution, stderr: normalized.stderr } : execution;
}
