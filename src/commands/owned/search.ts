import { describeEffectiveSearchPolicy } from '#src/config/search_policy.js';
import type { CommandExecutionContext, CommandExecutionResult } from '#src/types/command.js';
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
import { containsHangul } from './kiwi_tokenizer.js';
import { hasConservativeLexSyntax } from './query_search_assist_policy.js';
import type { OwnedRuntimeDependencies, OwnedRuntimeFailure } from './runtime.js';
import { withOwnedStore } from './runtime.js';
import {
  preferredSearchRecoveryCommand,
  readSearchIndexHealth,
  shouldUseShadowSearchIndex,
  summarizeStoredSearchPolicy,
} from './search_index_health.js';
import { searchShadowIndex } from './search_shadow_index.js';

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

function buildSearchPolicyWarning(
  expectedPolicyId: string,
  storedPolicy: string,
  indexedDocuments: number,
  totalDocuments: number,
): string {
  return [
    'Korean lexical search index is not ready for the current policy.',
    `Expected search policy: ${expectedPolicyId}`,
    `Stored search policy: ${storedPolicy}`,
    `Indexed documents: ${indexedDocuments}/${totalDocuments}`,
    `Falling back to legacy lexical search. Run '${preferredSearchRecoveryCommand()}' to rebuild the Korean search index.`,
  ].join('\n');
}

async function runSearchCommand(
  context: CommandExecutionContext,
  input: SearchCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
): Promise<SearchCommandSuccess | OwnedCommandError | OwnedRuntimeFailure> {
  return withOwnedStore(
    'search',
    context,
    async (session) => {
      const searchPolicy = describeEffectiveSearchPolicy();
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
      const koreanQuery = containsHangul(input.query);
      const conservativeSyntax = hasConservativeLexSyntax(input.query);
      const searchHealth = readSearchIndexHealth(session.store.internal.db, searchPolicy, {
        collections: selectedCollections,
      });
      const shadowSearchReady = shouldUseShadowSearchIndex(searchHealth);

      let results =
        koreanQuery && !conservativeSyntax && shadowSearchReady
          ? searchShadowIndex(session.store.internal, input.query, {
              limit: fetchLimit,
              collections: selectedCollections,
            })
          : await session.store.searchLex(input.query, {
              limit: fetchLimit,
              collection: singleCollection,
            });

      if (selectedCollections.length > 1) {
        results = results.filter((result) => selectedCollections.includes(result.collectionName));
      }

      return {
        rows: normalizeSearchResults(results),
        stderr:
          koreanQuery && !conservativeSyntax && !shadowSearchReady
            ? buildSearchPolicyWarning(
                searchPolicy.id,
                summarizeStoredSearchPolicy(searchHealth),
                searchHealth.indexedDocuments,
                searchHealth.totalDocuments,
              )
            : undefined,
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
