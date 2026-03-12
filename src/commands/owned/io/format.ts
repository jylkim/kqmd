import {
  addLineNumbers,
  type EmbedResult,
  extractSnippet,
  type HybridQueryResult,
  type SearchResult,
  type UpdateResult,
} from '@tobilu/qmd';

import type { CommandExecutionResult } from '../../../types/command.js';
import {
  hasEmbeddingMismatch,
  preferredEmbedCommand,
  summarizeStoredEmbeddingModels,
} from '../embedding_health.js';
import type {
  EmbedCommandInput,
  QueryCommandInput,
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

function maybeAddLineNumbers(text: string | undefined, lineNumbers: boolean): string | undefined {
  if (!text) {
    return text;
  }

  return lineNumbers ? addLineNumbers(text) : text;
}

function buildSnippet(
  row: SearchOutputRow,
  query: string,
  full: boolean,
  lineNumbers: boolean,
  intent?: string,
): { line: number; content?: string } {
  if (full) {
    return {
      line: 1,
      content: maybeAddLineNumbers(row.body, lineNumbers),
    };
  }

  const { line, snippet } = extractSnippet(row.body, query, 500, row.chunkPos, undefined, intent);
  return {
    line,
    content: maybeAddLineNumbers(snippet, lineNumbers),
  };
}

function filterRows(rows: SearchOutputRow[], limit: number, minScore: number): SearchOutputRow[] {
  return rows.filter((row) => row.score >= minScore).slice(0, limit);
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
    context: result.context,
    score: result.score,
    docid: result.docid,
    chunkPos: result.bestChunkPos,
    explain: result.explain,
  }));
}

export function formatSearchExecutionResult(
  rows: SearchOutputRow[],
  input: SearchCommandInput | QueryCommandInput,
): CommandExecutionResult {
  const filteredRows = filterRows(rows, input.limit, input.minScore);
  const reason = rows.length > 0 && filteredRows.length === 0 ? 'min-score' : 'no-results';

  if (filteredRows.length === 0) {
    const empty = formatEmptySearchResults(input.format, reason);
    return empty ? { exitCode: 0, stdout: empty } : { exitCode: 0 };
  }

  switch (input.format) {
    case 'json': {
      const output = filteredRows.map((row) => {
        const snippet = buildSnippet(
          row,
          'displayQuery' in input ? input.displayQuery : input.query,
          input.full,
          input.lineNumbers,
          'intent' in input ? input.intent : undefined,
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
        };
      });

      return {
        exitCode: 0,
        stdout: JSON.stringify(output, null, 2),
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
          'displayQuery' in input ? input.displayQuery : input.query,
          input.full,
          input.lineNumbers,
          'intent' in input ? input.intent : undefined,
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
            'displayQuery' in input ? input.displayQuery : input.query,
            input.full,
            input.lineNumbers,
            'intent' in input ? input.intent : undefined,
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
            'displayQuery' in input ? input.displayQuery : input.query,
            input.full,
            input.lineNumbers,
            'intent' in input ? input.intent : undefined,
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
      const stdout = filteredRows
        .map((row) => {
          const snippet = buildSnippet(
            row,
            'displayQuery' in input ? input.displayQuery : input.query,
            input.full,
            input.lineNumbers,
            'intent' in input ? input.intent : undefined,
          );
          const snippetBody = (snippet.content ?? '').split('\n').slice(1).join('\n').toLowerCase();
          const hasMatch = ('displayQuery' in input ? input.displayQuery : input.query)
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

      return { exitCode: 0, stdout };
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
  const nextStep = hasEmbeddingMismatch(result.health)
    ? `Run '${preferredEmbedCommand(result.health)}' to rebuild embeddings for the current model.`
    : result.health.kind === 'needs-embedding'
      ? `Run '${preferredEmbedCommand(result.health)}' to create missing embeddings.`
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
      ...collectionLines,
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
  };
}
