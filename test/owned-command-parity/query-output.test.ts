import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';
import type { SearchOutputRow } from '../../src/commands/owned/io/types.js';
import { handleQueryCommand } from '../../src/commands/owned/query.js';
import type { CommandExecutionContext } from '../../src/types/command.js';

function createContext(argv: string[]): CommandExecutionContext {
  return {
    argv,
    commandArgs: argv.slice(1),
  };
}

function withTrailingNewline(stdout: string | undefined): string {
  return stdout ? `${stdout}\n` : '';
}

const queryRows: SearchOutputRow[] = [
  {
    displayPath: 'notes/plan.md',
    title: 'Planning Notes',
    body: 'auth flow summary',
    context: 'Work',
    score: 0.87,
    docid: 'def456',
  },
];

describe('owned query parity output', () => {
  test('matches json success output snapshot', async () => {
    const result = await handleQueryCommand(
      createContext(['query', '--json', '--full', 'lex: auth flow\nvec: login journey']),
      {
        run: async () => queryRows,
      },
    );

    await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
      resolve(process.cwd(), 'test/fixtures/owned-command-parity/query/query-success.output.json'),
    );
  });

  test('matches empty xml output snapshot', async () => {
    const result = await handleQueryCommand(createContext(['query', '--xml', 'auth flow']), {
      run: async () => [],
    });

    await expect(withTrailingNewline(result.stdout)).toMatchFileSnapshot(
      resolve(process.cwd(), 'test/fixtures/owned-command-parity/query/query-empty.output.xml'),
    );
  });
});
