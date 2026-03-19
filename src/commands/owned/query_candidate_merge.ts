import type { SearchOutputRow } from './io/types.js';

function dedupeKey(row: SearchOutputRow): string {
  return row.docid || row.displayPath;
}

export function mergeNormalizedCandidates(
  baseRows: readonly SearchOutputRow[],
  normalizedRows: readonly SearchOutputRow[],
  rescueCap: number,
): { readonly rows: SearchOutputRow[]; readonly addedCandidates: number } {
  const rows = baseRows.map((row) => ({ ...row }));
  const seen = new Map(rows.map((row, index) => [dedupeKey(row), index]));
  let addedCandidates = 0;

  for (const row of normalizedRows) {
    const key = dedupeKey(row);
    const existingIndex = seen.get(key);

    if (existingIndex !== undefined) {
      const existing = rows[existingIndex];
      rows[existingIndex] = existing.normalization
        ? existing
        : {
            ...existing,
            normalization: {
              supplemented: true,
            },
          };
      continue;
    }

    if (addedCandidates >= rescueCap) {
      break;
    }

    rows.push({
      ...row,
      normalization: {
        supplemented: true,
      },
    });
    seen.set(key, rows.length - 1);
    addedCandidates += 1;
  }

  return {
    rows,
    addedCandidates,
  };
}
