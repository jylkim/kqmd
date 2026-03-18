import { describeEffectiveSearchPolicy } from '#src/config/search_policy.js';
import type { CommandExecutionContext, CommandExecutionResult } from '#src/types/command.js';
import {
  fromExecutionFailure,
  fromRuntimeFailure,
  isOwnedCommandError,
  isOwnedRuntimeFailure,
  toExecutionResult,
} from './io/errors.js';
import { formatCleanupExecutionResult } from './io/format.js';
import { parseOwnedCleanupInput } from './io/parse.js';
import type { CleanupCommandInput, CleanupCommandOutput, OwnedCommandError } from './io/types.js';
import { ensureKiwiReady } from './kiwi_tokenizer.js';
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

export interface CleanupCommandDependencies {
  readonly run?: (
    context: CommandExecutionContext,
    input: CleanupCommandInput,
    runtimeDependencies?: OwnedRuntimeDependencies,
  ) => Promise<CleanupCommandOutput | OwnedCommandError | OwnedRuntimeFailure>;
  readonly runtimeDependencies?: OwnedRuntimeDependencies;
  readonly searchIndexDependencies?: SearchShadowIndexDependencies;
}

async function executeCleanup(session: OwnedStoreContext): Promise<CleanupCommandOutput> {
  const store = session.store;

  const cachedResponsesCleared = store.internal.deleteLLMCache();
  const orphanedEmbeddingsRemoved = store.internal.cleanupOrphanedVectors();
  const inactiveDocumentsRemoved = store.internal.deleteInactiveDocuments();
  const orphanedContentRemoved = store.internal.cleanupOrphanedContent();
  store.internal.vacuumDatabase();

  return {
    cachedResponsesCleared,
    inactiveDocumentsRemoved,
    orphanedContentRemoved,
    orphanedEmbeddingsRemoved,
    vacuumed: true,
    shadowIndexRebuilt: false,
  };
}

async function runCleanupCommand(
  context: CommandExecutionContext,
  _input: CleanupCommandInput,
  runtimeDependencies?: OwnedRuntimeDependencies,
  searchIndexDependencies?: SearchShadowIndexDependencies,
): Promise<CleanupCommandOutput | OwnedCommandError | OwnedRuntimeFailure> {
  const searchPolicy = describeEffectiveSearchPolicy();

  return withOwnedStore(
    'cleanup',
    context,
    async (session) => {
      const result = await executeCleanup(session);
      const searchHealth = readSearchIndexHealth(session.store.internal.db, searchPolicy);

      if (result.inactiveDocumentsRemoved > 0 || hasSearchIndexMismatch(searchHealth)) {
        await ensureKiwiReady(searchIndexDependencies?.kiwiDependencies);
        const rebuildResult = await rebuildSearchShadowIndex(
          session.store.internal.db,
          searchPolicy,
          {
            ...searchIndexDependencies,
            kiwiDependencies: {
              env: runtimeDependencies?.env,
              ...searchIndexDependencies?.kiwiDependencies,
            },
          },
        );

        return {
          ...result,
          shadowIndexRebuilt: true,
          shadowIndexDocuments: rebuildResult.indexedDocuments,
        };
      }

      return result;
    },
    runtimeDependencies,
  );
}

export async function handleCleanupCommand(
  context: CommandExecutionContext,
  dependencies: CleanupCommandDependencies = {},
): Promise<CommandExecutionResult> {
  const parsed = parseOwnedCleanupInput(context);
  if (parsed.kind !== 'ok') {
    return toExecutionResult(parsed);
  }

  try {
    const result = dependencies.run
      ? await dependencies.run(context, parsed.input, dependencies.runtimeDependencies)
      : await runCleanupCommand(
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

    return formatCleanupExecutionResult(result, parsed.input);
  } catch (error) {
    return toExecutionResult(fromExecutionFailure('cleanup', error));
  }
}
