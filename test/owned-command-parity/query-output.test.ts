import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';
import type { SearchOutputRow } from '../../src/commands/owned/io/types.js';
import { handleQueryCommand } from '../../src/commands/owned/query.js';
import { createContext, withTrailingNewline } from '../helpers.js';

const queryRows: SearchOutputRow[] = [
  {
    displayPath: 'notes/plan.md',
    title: 'Planning Notes',
    body: 'auth flow summary',
    sourceBody: 'auth flow summary',
    context: 'Work',
    score: 0.87,
    docid: 'def456',
    explain: {
      ftsScores: [0.7],
      vectorScores: [0.61],
      rrf: {
        rank: 1,
        positionScore: 0.81,
        weight: 0.6,
        baseScore: 0.55,
        topRankBonus: 0.11,
        totalScore: 0.66,
        contributions: [
          {
            listIndex: 0,
            source: 'fts',
            queryType: 'lex',
            query: 'auth flow',
            rank: 1,
            weight: 2,
            backendScore: 0.7,
            rrfContribution: 0.44,
          },
        ],
      },
      rerankScore: 0.73,
      blendedScore: 0.77,
    },
    adaptive: {
      queryClass: 'mixed-technical',
      candidateSource: 'adaptive',
      vectorStrength: 'strong',
      baseScore: 0.87,
      adjustedScore: 0.87,
      phrase: 0.12,
      title: 0.06,
      heading: 0,
      coverage: 0.04,
      proximity: 0.02,
      literalAnchor: 0.08,
    },
  },
];

describe('owned query parity output', () => {
  test('matches json success output snapshot', async () => {
    const result = await handleQueryCommand(
      createContext(['query', '--json', '--full', 'lex: auth flow\nvec: login journey']),
      {
        run: async () => ({ rows: queryRows }),
      },
    );

    await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
      resolve(process.cwd(), 'test/fixtures/owned-command-parity/query/query-success.output.json'),
    );
  });

  test('matches empty xml output snapshot', async () => {
    const result = await handleQueryCommand(createContext(['query', '--xml', 'auth flow']), {
      run: async () => ({ rows: [] }),
    });

    await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
      resolve(process.cwd(), 'test/fixtures/owned-command-parity/query/query-empty.output.xml'),
    );
  });

  test('matches cli explain output snapshot', async () => {
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';

    try {
      const result = await handleQueryCommand(createContext(['query', '--explain', 'auth flow']), {
        run: async () => ({ rows: queryRows }),
      });

      await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
        resolve(process.cwd(), 'test/fixtures/owned-command-parity/query/query-explain.output.cli'),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previous;
      }
    }
  });
});
