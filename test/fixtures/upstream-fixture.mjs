#!/usr/bin/env node

process.stdout.write(`fixture argv: ${JSON.stringify(process.argv.slice(2))}\n`);
process.exit(Number(process.env.TEST_UPSTREAM_EXIT_CODE ?? '0'));

