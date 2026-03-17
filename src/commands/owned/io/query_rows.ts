import { addLineNumbers, extractSnippet } from '@tobilu/qmd';

import type { SearchOutputRow } from './types.js';

const MAX_SNIPPET_SOURCE_BYTES = 12_000;

function maybeAddLineNumbers(text: string | undefined, lineNumbers: boolean): string | undefined {
  if (!text) {
    return text;
  }

  return lineNumbers ? addLineNumbers(text) : text;
}

function countNewlines(text: string, end = text.length): number {
  let count = 0;
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 10) {
      count += 1;
    }
  }
  return count;
}

function splitSnippetHeader(snippet: string): { body: string } {
  const newlineIndex = snippet.indexOf('\n');
  if (newlineIndex === -1) {
    return { body: snippet };
  }

  return {
    body: snippet.slice(newlineIndex + 1),
  };
}

function findLexicalAnchor(sourceBody: string, query: string, intent?: string): number | undefined {
  const loweredBody = sourceBody.toLowerCase();
  const loweredQuery = query.trim().toLowerCase();
  if (loweredQuery.length > 0) {
    const fullQueryIndex = loweredBody.indexOf(loweredQuery);
    if (fullQueryIndex >= 0) {
      return fullQueryIndex;
    }
  }

  const terms = new Set(
    `${query} ${intent ?? ''}`
      .toLowerCase()
      .split(/\s+/)
      .map((term) => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter((term) => term.length > 1),
  );

  let bestIndex: number | undefined;
  for (const term of terms) {
    const index = loweredBody.indexOf(term);
    if (index >= 0 && (bestIndex === undefined || index < bestIndex)) {
      bestIndex = index;
    }
  }

  return bestIndex;
}

function buildSnippetWindow(
  row: SearchOutputRow,
  query: string,
  intent?: string,
): {
  source: string;
  chunkPos?: number;
  lineOffset: number;
  totalLines: number;
} {
  const sourceBody = row.sourceBody;
  if (!sourceBody || sourceBody.length <= MAX_SNIPPET_SOURCE_BYTES) {
    return {
      source: sourceBody ?? row.body,
      chunkPos: row.sourceChunkPos ?? row.chunkPos,
      lineOffset: 0,
      totalLines: countNewlines(sourceBody ?? row.body) + 1,
    };
  }

  const lexicalAnchor = findLexicalAnchor(sourceBody, query, intent);
  const bestChunkAnchor =
    typeof row.sourceChunkPos === 'number'
      ? row.sourceChunkPos
      : row.body.length > 0 && row.body !== sourceBody
        ? sourceBody.indexOf(row.body)
        : -1;
  const anchor =
    typeof row.sourceChunkPos === 'number'
      ? row.sourceChunkPos
      : (lexicalAnchor ?? (bestChunkAnchor >= 0 ? bestChunkAnchor : undefined));

  if (anchor === undefined) {
    return {
      source: row.body,
      chunkPos: row.chunkPos,
      lineOffset: 0,
      totalLines: countNewlines(row.body) + 1,
    };
  }

  const halfWindow = Math.floor(MAX_SNIPPET_SOURCE_BYTES / 2);
  const start = Math.max(0, anchor - halfWindow);
  const end = Math.min(sourceBody.length, start + MAX_SNIPPET_SOURCE_BYTES);
  const adjustedStart = Math.max(0, end - MAX_SNIPPET_SOURCE_BYTES);

  return {
    source: sourceBody.slice(adjustedStart, end),
    chunkPos:
      lexicalAnchor !== undefined && lexicalAnchor >= adjustedStart && lexicalAnchor < end
        ? lexicalAnchor - adjustedStart
        : anchor - adjustedStart,
    lineOffset: countNewlines(sourceBody, adjustedStart),
    totalLines: countNewlines(sourceBody) + 1,
  };
}

export function buildRowSnippet(
  row: SearchOutputRow,
  query: string,
  full: boolean,
  lineNumbers: boolean,
  maxLen: number,
  intent?: string,
): { line: number; content?: string } {
  if (full) {
    return {
      line: 1,
      content: maybeAddLineNumbers(row.body, lineNumbers),
    };
  }

  const snippetWindow = buildSnippetWindow(row, query, intent);
  const { line, snippet, linesBefore, snippetLines } = extractSnippet(
    snippetWindow.source,
    query,
    maxLen,
    snippetWindow.chunkPos,
    undefined,
    intent,
  );
  const snippetStartLine = snippetWindow.lineOffset + linesBefore + 1;
  const absoluteLine = snippetWindow.lineOffset + line;
  const linesAfter = Math.max(0, snippetWindow.totalLines - (snippetStartLine + snippetLines - 1));
  const snippetBody = splitSnippetHeader(snippet).body;
  const absoluteSnippet = `@@ -${snippetStartLine},${snippetLines} @@ (${snippetStartLine - 1} before, ${linesAfter} after)\n${snippetBody}`;

  return {
    line: absoluteLine,
    content: maybeAddLineNumbers(absoluteSnippet, lineNumbers),
  };
}

export function buildMcpQueryRows(
  rows: readonly SearchOutputRow[],
  primaryQuery: string,
  intent?: string,
) {
  return rows.map((row) => {
    const snippet = buildRowSnippet(row, primaryQuery, false, false, 300, intent);

    return {
      docid: `#${row.docid}`,
      file: row.displayPath,
      title: row.title,
      score: Math.round(row.score * 100) / 100,
      context: row.context,
      snippet: addLineNumbers(snippet.content ?? '', snippet.line),
      explain: row.explain,
      adaptive: row.adaptive,
    };
  });
}
