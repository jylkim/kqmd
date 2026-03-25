import type { CommandExecutionContext, CommandExecutionResult } from '#src/types/command.js';
import {
  fromExecutionFailure,
  fromRuntimeFailure,
  isOwnedCommandError,
  isOwnedRuntimeFailure,
  toExecutionResult,
} from './io/errors.js';
import { formatSearchExecutionResult } from './io/format.js';
import { parseOwnedSearchInput } from './io/parse.js';
import type { OwnedCommandError, SearchCommandInput, SearchOutputRow } from './io/types.js';
import { resolveSelectedCollections } from './io/validate.js';
import { probeQueryLexicalCandidates } from './query_lexical_candidates.js';
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
      const lexicalProbe = await probeQueryLexicalCandidates(
        session.store,
        input.query,
        selectedCollections,
        fetchLimit,
      );

      return {
        rows: lexicalProbe.rows,
        stderr: lexicalProbe.warning,
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

  let result: SearchCommandSuccess | SearchOutputRow[] | OwnedCommandError | OwnedRuntimeFailure;
  try {
    result = dependencies.run
      ? await dependencies.run(context, parsed.input, dependencies.runtimeDependencies)
      : await runSearchCommand(context, parsed.input, dependencies.runtimeDependencies);
  } catch (error) {
    return toExecutionResult(fromExecutionFailure('search', error));
  }

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
