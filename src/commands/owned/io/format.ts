import type { EmbedResult, HybridQueryResult, SearchResult, UpdateResult } from '@tobilu/qmd';
import {
  hasEmbeddingMismatch,
  preferredEmbedCommand,
  summarizeStoredEmbeddingModels,
} from '#src/commands/owned/embedding_health.js';
import {
  hasSearchIndexMismatch,
  preferredSearchRecoveryCommand,
  summarizeStoredSearchPolicy,
} from '#src/commands/owned/search_index_health.js';
import type { CommandExecutionResult } from '#src/types/command.js';
import { buildRowSnippet } from './query_rows.js';
import type {
  CleanupCommandInput,
  CleanupCommandOutput,
  EmbedCommandInput,
  QueryCommandInput,
  QueryExecutionSummary,
  SearchCommandInput,
  SearchOutputFormat,
  SearchOutputRow,
  StatusCommandInput,
  StatusCommandOutput,
  UpdateCommandInput,
} from './types.js';

function shouldUseColor(): boolean {
  return !process.env.NO_COLOR && process.stdout.isTTY;
}

function getColorPalette() {
  if (!shouldUseColor()) {
    return {
      reset: '',
      dim: '',
      bold: '',
      cyan: '',
      yellow: '',
      green: '',
    };
  }

  return {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
  };
}

function toQmdPath(displayPath: string): string {
  return displayPath.startsWith('qmd://') ? displayPath : `qmd://${displayPath}`;
}

function formatScore(score: number): string {
  const colors = getColorPalette();
  const percentage = `${(score * 100).toFixed(0).padStart(3)}%`;

  if (!shouldUseColor()) {
    return percentage;
  }

  // 스코어 색상 구간: 70%↑ 초록(높은 관련도), 40%↑ 노랑(중간), 그 외 흐림(낮음)
  if (score >= 0.7) {
    return `${colors.green}${percentage}${colors.reset}`;
  }

  if (score >= 0.4) {
    return `${colors.yellow}${percentage}${colors.reset}`;
  }

  return `${colors.dim}${percentage}${colors.reset}`;
}

function formatExplainNumber(value: number): string {
  return value.toFixed(4);
}

function buildSnippet(
  row: SearchOutputRow,
  query: string,
  full: boolean,
  lineNumbers: boolean,
  intent?: string,
): { line: number; content?: string } {
  return buildRowSnippet(row, query, full, lineNumbers, 500, intent);
}

export function filterRows(
  rows: readonly SearchOutputRow[],
  limit: number,
  minScore: number,
): SearchOutputRow[] {
  return rows.filter((row) => row.score >= minScore).slice(0, limit);
}

function formatJsonExplainResult(
  results: unknown[],
  querySummary?: QueryExecutionSummary,
): string | undefined {
  if (!querySummary) {
    return undefined;
  }

  return JSON.stringify({ query: querySummary, results }, null, 2);
}

export function formatEmptySearchResults(
  format: SearchOutputFormat,
  reason: 'no-results' | 'min-score',
): string | undefined {
  switch (format) {
    case 'json':
      return '[]';
    case 'csv':
      return 'docid,score,file,title,context,line,snippet';
    case 'xml':
      return '<results></results>';
    case 'md':
    case 'files':
      return undefined;
    case 'cli':
      return reason === 'min-score'
        ? 'No results found above minimum score threshold.'
        : 'No results found.';
  }
}

export function normalizeSearchResults(results: SearchResult[]): SearchOutputRow[] {
  return results.map((result) => ({
    displayPath: result.displayPath,
    title: result.title,
    body: result.body ?? '',
    context: result.context,
    score: result.score,
    docid: result.docid,
    chunkPos: result.chunkPos,
  }));
}

export function normalizeHybridQueryResults(results: HybridQueryResult[]): SearchOutputRow[] {
  return results.map((result) => ({
    displayPath: result.displayPath,
    title: result.title,
    body: result.bestChunk,
    sourceBody: result.body,
    context: result.context,
    score: result.score,
    docid: result.docid,
    chunkPos: result.bestChunkPos,
    sourceChunkPos: result.bestChunkPos,
    explain: result.explain,
  }));
}

export function formatSearchExecutionResult(
  rows: SearchOutputRow[],
  input: SearchCommandInput | QueryCommandInput,
  querySummary?: QueryExecutionSummary,
): CommandExecutionResult {
  const filteredRows = filterRows(rows, input.limit, input.minScore);
  const reason = rows.length > 0 && filteredRows.length === 0 ? 'min-score' : 'no-results';

  if (filteredRows.length === 0) {
    const emptyExplainJson =
      input.format === 'json' && 'explain' in input && input.explain
        ? formatJsonExplainResult([], querySummary)
        : undefined;
    if (emptyExplainJson) {
      return { exitCode: 0, stdout: emptyExplainJson };
    }

    const empty = formatEmptySearchResults(input.format, reason);
    return empty ? { exitCode: 0, stdout: empty } : { exitCode: 0 };
  }

  const effectiveQuery = 'displayQuery' in input ? input.displayQuery : input.query;
  const effectiveIntent = 'intent' in input ? input.intent : undefined;

  switch (input.format) {
    case 'json': {
      const output = filteredRows.map((row) => {
        const snippet = buildSnippet(
          row,
          effectiveQuery,
          input.full,
          input.lineNumbers,
          effectiveIntent,
        );

        return {
          docid: `#${row.docid}`,
          score: Math.round(row.score * 100) / 100,
          file: toQmdPath(row.displayPath),
          title: row.title,
          ...(row.context ? { context: row.context } : {}),
          ...(input.full
            ? { body: snippet.content ?? '' }
            : snippet.content
              ? { snippet: snippet.content }
              : {}),
          ...('explain' in input && input.explain && row.explain ? { explain: row.explain } : {}),
          ...('explain' in input && input.explain && row.adaptive
            ? { adaptive: row.adaptive }
            : {}),
          ...('explain' in input && input.explain && row.searchAssist
            ? { searchAssist: row.searchAssist }
            : {}),
        };
      });

      const stdout =
        ('explain' in input && input.explain
          ? formatJsonExplainResult(output, querySummary)
          : null) ?? JSON.stringify(output, null, 2);

      return {
        exitCode: 0,
        stdout,
      };
    }

    case 'files': {
      const stdout = filteredRows
        .map((row) => {
          const contextSuffix = row.context ? `,"${row.context.replaceAll('"', '""')}"` : '';
          return `#${row.docid},${row.score.toFixed(2)},${toQmdPath(row.displayPath)}${contextSuffix}`;
        })
        .join('\n');

      return { exitCode: 0, stdout };
    }

    case 'csv': {
      const rowsText = filteredRows.map((row) => {
        const snippet = buildSnippet(
          row,
          effectiveQuery,
          input.full,
          input.lineNumbers,
          effectiveIntent,
        );
        const content = snippet.content ?? '';
        const escapeCsvValue = (value: string) =>
          value.includes(',') || value.includes('"') || value.includes('\n')
            ? `"${value.replaceAll('"', '""')}"`
            : value;

        return [
          `#${row.docid}`,
          row.score.toFixed(4),
          escapeCsvValue(toQmdPath(row.displayPath)),
          escapeCsvValue(row.title),
          escapeCsvValue(row.context ?? ''),
          String(snippet.line),
          escapeCsvValue(content),
        ].join(',');
      });

      return {
        exitCode: 0,
        stdout: ['docid,score,file,title,context,line,snippet', ...rowsText].join('\n'),
      };
    }

    case 'md': {
      const stdout = filteredRows
        .map((row) => {
          const snippet = buildSnippet(
            row,
            effectiveQuery,
            input.full,
            input.lineNumbers,
            effectiveIntent,
          );
          const contextLine = row.context ? `**context:** ${row.context}\n` : '';
          return `---\n# ${row.title || row.displayPath}\n\n**docid:** \`#${row.docid}\`\n${contextLine}\n${snippet.content ?? ''}\n`;
        })
        .join('\n');

      return { exitCode: 0, stdout };
    }

    case 'xml': {
      const stdout = filteredRows
        .map((row) => {
          const snippet = buildSnippet(
            row,
            effectiveQuery,
            input.full,
            input.lineNumbers,
            effectiveIntent,
          );
          const escapeXml = (value: string) =>
            value
              .replaceAll('&', '&amp;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;')
              .replaceAll('"', '&quot;')
              .replaceAll("'", '&apos;');
          const titleAttr = row.title ? ` title="${escapeXml(row.title)}"` : '';
          const contextAttr = row.context ? ` context="${escapeXml(row.context)}"` : '';
          return `<file docid="#${row.docid}" name="${escapeXml(toQmdPath(row.displayPath))}"${titleAttr}${contextAttr}>\n${escapeXml(snippet.content ?? '')}\n</file>`;
        })
        .join('\n\n');

      return { exitCode: 0, stdout };
    }

    case 'cli': {
      const colors = getColorPalette();
      const queryLines =
        'explain' in input && input.explain && querySummary
          ? [
              `${colors.dim}Query: mode=${querySummary.mode} class=${querySummary.queryClass} retrieval=${querySummary.execution.retrievalKind} signal=${querySummary.execution.lexicalSignal} reason=${querySummary.execution.fallbackReason}${colors.reset}`,
              `${colors.dim}  Execution: embed=${querySummary.execution.embeddingApplied ? 'yes' : 'no'} expand=${querySummary.execution.expansionApplied ? 'yes' : 'no'} rerank=${querySummary.execution.rerankApplied ? 'yes' : 'no'} heavy=${querySummary.execution.heavyPathUsed ? 'yes' : 'no'} candidateWindow=${querySummary.execution.candidateWindow}${colors.reset}`,
              `${colors.dim}  Normalization: applied=${querySummary.normalization.applied ? 'yes' : 'no'} reason=${querySummary.normalization.reason} added=${querySummary.normalization.addedCandidates}${colors.reset}`,
              `${colors.dim}  SearchAssist summary: applied=${querySummary.searchAssist.applied ? 'yes' : 'no'} reason=${querySummary.searchAssist.reason} added=${querySummary.searchAssist.addedCandidates}${colors.reset}`,
            ]
          : [];
      const stdout = filteredRows
        .map((row) => {
          const snippet = buildSnippet(
            row,
            effectiveQuery,
            input.full,
            input.lineNumbers,
            effectiveIntent,
          );
          const snippetBody = (snippet.content ?? '').split('\n').slice(1).join('\n').toLowerCase();
          const hasMatch = effectiveQuery
            .toLowerCase()
            .split(/\s+/)
            .some((term) => term.length > 0 && snippetBody.includes(term));
          const lineInfo = hasMatch ? `:${snippet.line}` : '';
          const docid = `${colors.dim}#${row.docid}${colors.reset}`;
          const parts = [
            `${colors.cyan}${toQmdPath(row.displayPath)}${colors.dim}${lineInfo}${colors.reset} ${docid}`,
            row.title ? `${colors.bold}Title: ${row.title}${colors.reset}` : undefined,
            row.context ? `${colors.dim}Context: ${row.context}${colors.reset}` : undefined,
            `Score: ${colors.bold}${formatScore(row.score)}${colors.reset}`,
            ...('explain' in input && input.explain && row.explain
              ? (() => {
                  const explain = row.explain;
                  const ftsScores =
                    explain.ftsScores.length > 0
                      ? explain.ftsScores.map(formatExplainNumber).join(', ')
                      : 'none';
                  const vecScores =
                    explain.vectorScores.length > 0
                      ? explain.vectorScores.map(formatExplainNumber).join(', ')
                      : 'none';
                  const contributionSummary = explain.rrf.contributions
                    .slice()
                    .sort((left, right) => right.rrfContribution - left.rrfContribution)
                    .slice(0, 3)
                    .map(
                      (contribution) =>
                        `${contribution.source}/${contribution.queryType}#${contribution.rank}:${formatExplainNumber(contribution.rrfContribution)}`,
                    )
                    .join(' | ');

                  return [
                    `${colors.dim}Explain: fts=[${ftsScores}] vec=[${vecScores}]${colors.reset}`,
                    `${colors.dim}  RRF: total=${formatExplainNumber(explain.rrf.totalScore)} base=${formatExplainNumber(explain.rrf.baseScore)} bonus=${formatExplainNumber(explain.rrf.topRankBonus)} rank=${explain.rrf.rank}${colors.reset}`,
                    `${colors.dim}  Blend: ${Math.round(explain.rrf.weight * 100)}%*${formatExplainNumber(explain.rrf.positionScore)} + ${Math.round((1 - explain.rrf.weight) * 100)}%*${formatExplainNumber(explain.rerankScore)} = ${formatExplainNumber(explain.blendedScore)}${colors.reset}`,
                    row.adaptive
                      ? `${colors.dim}  Adaptive: class=${row.adaptive.queryClass} phrase=${formatExplainNumber(row.adaptive.phrase)} title=${formatExplainNumber(row.adaptive.title)} heading=${formatExplainNumber(row.adaptive.heading)} coverage=${formatExplainNumber(row.adaptive.coverage)} proximity=${formatExplainNumber(row.adaptive.proximity)} literal=${formatExplainNumber(row.adaptive.literalAnchor)} vector=${row.adaptive.vectorStrength}${colors.reset}`
                      : undefined,
                    row.searchAssist
                      ? `${colors.dim}  SearchAssist: rescued=${row.searchAssist.rescued ? 'yes' : 'no'} source=${row.searchAssist.source} reason=${row.searchAssist.reason} added=${row.searchAssist.addedCandidates}${colors.reset}`
                      : undefined,
                    contributionSummary.length > 0
                      ? `${colors.dim}  Top RRF contributions: ${contributionSummary}${colors.reset}`
                      : undefined,
                  ].filter((line): line is string => Boolean(line));
                })()
              : []),
            snippet.content ?? '',
          ].filter(Boolean);

          return parts.join('\n');
        })
        .join('\n\n');

      return {
        exitCode: 0,
        stdout: queryLines.length > 0 ? `${queryLines.join('\n')}\n\n${stdout}` : stdout,
      };
    }
  }
}

export function formatUpdateExecutionResult(
  result: UpdateResult,
  _input: UpdateCommandInput,
  followUp?: string,
): CommandExecutionResult {
  const nextStep =
    followUp ??
    (result.needsEmbedding > 0
      ? `Run 'qmd embed' to update embeddings (${result.needsEmbedding} unique hashes need vectors).`
      : undefined);

  return {
    exitCode: 0,
    stdout: [
      `Updated ${result.collections} collection(s).`,
      `Indexed: ${result.indexed} new, ${result.updated} updated, ${result.unchanged} unchanged, ${result.removed} removed.`,
      nextStep,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export function formatEmbedExecutionResult(
  result: EmbedResult,
  _input: EmbedCommandInput,
): CommandExecutionResult {
  return {
    exitCode: 0,
    stdout: [
      `Embedded ${result.chunksEmbedded} chunks from ${result.docsProcessed} documents.`,
      `Errors: ${result.errors}`,
      `DurationMs: ${result.durationMs}`,
    ].join('\n'),
  };
}

export function formatStatusExecutionResult(
  result: StatusCommandOutput,
  _input: StatusCommandInput,
): CommandExecutionResult {
  const colors = getColorPalette();
  const healthLabel = result.health.kind.replaceAll('-', ' ');
  const searchHealthLabel = result.searchHealth.kind.replaceAll('-', ' ');
  const nextStep = hasEmbeddingMismatch(result.health)
    ? `Run '${preferredEmbedCommand(result.health)}' to rebuild embeddings for the current model.`
    : result.health.kind === 'needs-embedding'
      ? `Run '${preferredEmbedCommand(result.health)}' to create missing embeddings.`
      : undefined;
  const nextSearchStep = hasSearchIndexMismatch(result.searchHealth)
    ? `Run '${preferredSearchRecoveryCommand()}' to rebuild the Korean lexical search index.`
    : undefined;

  const collectionLines =
    result.status.collections.length > 0
      ? [
          '',
          `${colors.bold}Collections${colors.reset}`,
          ...result.status.collections.flatMap((collection) => [
            `  ${collection.name} (${collection.documents} files)`,
            collection.path ? `    Path: ${collection.path}` : undefined,
            collection.pattern ? `    Pattern: ${collection.pattern}` : undefined,
          ]),
        ]
      : ['', `${colors.dim}No collections.${colors.reset}`];

  return {
    exitCode: 0,
    stdout: [
      `${colors.bold}QMD Status${colors.reset}`,
      '',
      `Index: ${result.dbPath}`,
      '',
      `${colors.bold}Documents${colors.reset}`,
      `  Total:      ${result.status.totalDocuments} files indexed`,
      `  VectorIndex: ${result.status.hasVectorIndex ? 'yes' : 'no'}`,
      `  Missing:    ${result.health.missingDocuments}`,
      `  Mismatch:   ${result.health.mismatchedDocuments}`,
      '',
      `${colors.bold}Embedding Model${colors.reset}`,
      `  Effective:  ${result.effectiveModel.uri}`,
      `  Source:     ${result.effectiveModel.source}`,
      `  Health:     ${healthLabel}`,
      `  Stored:     ${summarizeStoredEmbeddingModels(result.health)}`,
      nextStep ? `  Next:       ${nextStep}` : undefined,
      '',
      `${colors.bold}Search Policy${colors.reset}`,
      `  Effective:  ${result.searchPolicy.id}`,
      `  Tokenizer:  ${result.searchPolicy.tokenizer}/${result.searchPolicy.modelType}`,
      `  Health:     ${searchHealthLabel}`,
      `  Stored:     ${summarizeStoredSearchPolicy(result.searchHealth)}`,
      `  Indexed:    ${result.searchHealth.indexedDocuments}/${result.searchHealth.totalDocuments}`,
      nextSearchStep ? `  Next:       ${nextSearchStep}` : undefined,
      ...collectionLines,
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
  };
}

export function formatCleanupExecutionResult(
  result: CleanupCommandOutput,
  _input: CleanupCommandInput,
): CommandExecutionResult {
  const colors = getColorPalette();

  return {
    exitCode: 0,
    stdout: [
      `${colors.bold}Cleanup${colors.reset}`,
      '',
      `  Cached responses cleared:   ${result.cachedResponsesCleared}`,
      `  Orphaned embeddings removed: ${result.orphanedEmbeddingsRemoved}`,
      `  Inactive documents removed: ${result.inactiveDocumentsRemoved}`,
      `  Orphaned content removed:   ${result.orphanedContentRemoved}`,
      `  Vacuumed:                   ${result.vacuumed ? 'yes' : 'no'}`,
      result.shadowIndexRebuilt
        ? `  Shadow index rebuilt:       ${result.shadowIndexDocuments ?? 0} documents`
        : `  Shadow index rebuilt:       skipped`,
    ].join('\n'),
  };
}
