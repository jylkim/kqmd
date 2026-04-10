import type { CommandExecutionResult, OwnedCommand } from '#src/types/command.js';

const COMMON_OUTPUT_OPTIONS = [
  '  --json                      Output JSON',
  '  --csv                       Output CSV',
  '  --md                        Output Markdown',
  '  --xml                       Output XML',
  '  --files                     Output file list',
];

const COMMON_SEARCH_OPTIONS = [
  '  -c, --collection <name>     Filter to one or more collections',
  '  -n <n>                      Max results (default: 5 CLI, 20 json/files)',
  '  --min-score <n>             Minimum score threshold',
  '  --all                       Return up to 100000 results',
  '  --full                      Show full bodies instead of snippets',
  '  --line-numbers              Add line numbers to snippets or bodies',
  ...COMMON_OUTPUT_OPTIONS,
];

const HELP_TEXT: Record<OwnedCommand, string> = {
  search: [
    'Usage: qmd search [options] <query>',
    '',
    'Options:',
    ...COMMON_SEARCH_OPTIONS,
    '  -h, --help                  Show this help',
  ].join('\n'),
  query: [
    'Usage: qmd query [options] <query>',
    '',
    'Options:',
    ...COMMON_SEARCH_OPTIONS,
    '  --intent <text>             Domain intent hint',
    '  --explain                   Include explain traces',
    '  -C, --candidate-limit <n>   Max candidates to rerank (default: 40; mixed plain <= 50)',
    '  --no-rerank                 Skip LLM reranking',
    '  --chunk-strategy <mode>     Chunking mode: auto or regex',
    '  -h, --help                  Show this help',
  ].join('\n'),
  update: [
    'Usage: qmd update',
    '',
    'Options:',
    '  -h, --help                  Show this help',
  ].join('\n'),
  embed: [
    'Usage: qmd embed [-f|--force]',
    '',
    'Options:',
    '  -f, --force                Rebuild embeddings even when they look current',
    '  --chunk-strategy <mode>   Chunking mode: auto or regex',
    '  -h, --help                 Show this help',
  ].join('\n'),
  status: [
    'Usage: qmd status',
    '',
    'Options:',
    '  -h, --help                  Show this help',
  ].join('\n'),
  mcp: [
    'Usage: qmd mcp [options]',
    '',
    'Modes:',
    '  qmd mcp                     Start the MCP server on stdio',
    '  qmd mcp --http              Start the MCP server over HTTP on localhost',
    '  qmd mcp --http --daemon     Start the HTTP server in the background',
    '  qmd mcp stop                Stop the background HTTP server',
    '',
    'Options:',
    '  --http                      Use localhost HTTP routes: /mcp, /health, /query, /search',
    '  --daemon                    Run the HTTP server in the background',
    '  --port <n>                  Custom HTTP port (default: 8181)',
    '  -h, --help                  Show this help',
  ].join('\n'),
  cleanup: [
    'Usage: qmd cleanup',
    '',
    'Remove cached responses, inactive documents, orphaned content/embeddings,',
    'and vacuum the database. Rebuilds the Korean search shadow index if needed.',
    '',
    'Options:',
    '  -h, --help                  Show this help',
  ].join('\n'),
};

export function hasOwnedCommandHelpFlag(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function formatOwnedCommandHelp(command: OwnedCommand): CommandExecutionResult {
  return {
    exitCode: 0,
    stdout: HELP_TEXT[command],
  };
}
