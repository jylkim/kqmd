# K-QMD Command Boundary

K-QMD is a replacement distribution, not a parallel CLI. The package name is `kqmd`, but the
published command is still `qmd`.

## Routing layers

1. `routing`
   [`src/commands/manifest.ts`](/Users/jylkim/kqmd/src/commands/manifest.ts) is the source of truth for
   owned vs passthrough commands.
2. `policy defaults`
   [`src/config/qmd_paths.ts`](/Users/jylkim/kqmd/src/config/qmd_paths.ts) mirrors upstream path
   conventions so wrapper code and upstream code see the same config and cache layout.
3. `execution`
   owned commands return explicit scaffold stubs, while passthrough commands resolve and execute the
   upstream `qmd` binary.

## Current ownership

### Owned

- `search`
- `query`
- `update`
- `embed`

### Passthrough

- `collection`
- `status`
- `ls`
- `get`
- `multi-get`
- `mcp`
- help/version/no-command entrypoints

## Guardrails

- owned commands must not mutate shared upstream state until real implementations exist
- passthrough must preserve argv, stdio, and exit codes
- unknown commands should fail explicitly rather than silently guessing a route

