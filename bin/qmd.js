#!/usr/bin/env node

import('../dist/config/embedding_policy.js')
  .then(({ installKqmdEmbedModelDefault }) => {
    installKqmdEmbedModelDefault(process.env);
    return import('../dist/cli.js');
  })
  .then(async ({ main }) => {
    await main(process.argv.slice(2));
  })
  .catch((error) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
