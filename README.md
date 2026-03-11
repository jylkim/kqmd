# K-QMD

K-QMD is a `qmd-compatible replacement distribution` scaffold. Users install `kqmd`, but the package
publishes a `qmd` command so the existing CLI habit stays intact.

This repository intentionally does **not** implement Korean-aware search behavior yet. The current
state is a scaffold for:

- package/bin/build wiring
- command ownership boundaries
- passthrough delegation to upstream `@tobilu/qmd`
- upstream-compatible config/db/cache path resolution
- lint/typecheck/test conventions

## Status

Current owned commands are stubbed:

- `search`
- `query`
- `update`
- `embed`

Current passthrough commands are delegated to upstream `qmd`:

- `collection`
- `status`
- `ls`
- `get`
- `multi-get`
- `mcp`

## Development

```bash
npm install
npm run build
npm run check
```

### Key scripts

- `npm run lint`
- `npm run format`
- `npm run typecheck`
- `npm run test`
- `npm run test:coverage`
- `npm run build`
- `npm run check`

## Packaging contract

- npm package name: `kqmd`
- published CLI name: `qmd`
- executable entrypoint: [`bin/qmd.js`](/Users/jylkim/kqmd/bin/qmd.js)
- compiled runtime entrypoint: `dist/cli.js`

For local verification:

```bash
npm run build
./bin/qmd.js status
npm pack --dry-run
```

## Path compatibility

K-QMD follows the current upstream `@tobilu/qmd` path conventions:

- config dir: `QMD_CONFIG_DIR` or `XDG_CONFIG_HOME/qmd` or `~/.config/qmd`
- config file: `<config-dir>/<index>.yml`
- db path: `INDEX_PATH` or `XDG_CACHE_HOME/qmd/<index>.sqlite` or `~/.cache/qmd/<index>.sqlite`
- cache dir: `XDG_CACHE_HOME/qmd` or `~/.cache/qmd`

The implementation lives in [`src/config/qmd_paths.ts`](/Users/jylkim/kqmd/src/config/qmd_paths.ts) and is
verified against the installed upstream package in tests.

## Architecture

- [`docs/architecture/kqmd-command-boundary.md`](/Users/jylkim/kqmd/docs/architecture/kqmd-command-boundary.md)
- [`docs/architecture/upstream-compatibility-policy.md`](/Users/jylkim/kqmd/docs/architecture/upstream-compatibility-policy.md)

## Next sprint

The next sprint should replace the owned command stubs with real Korean-aware implementations while
keeping the same command boundary and passthrough contract.

