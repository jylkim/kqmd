# Upstream Compatibility Policy

K-QMD treats upstream `@tobilu/qmd` as a baseline, not as vendored runtime source.

## What we mirror

- package/bin discovery for the upstream `qmd` executable
- config path overrides via `QMD_CONFIG_DIR`
- db path overrides via `INDEX_PATH`
- XDG-based config/cache fallbacks
- current passthrough command surface

## What we do not do yet

- vendor upstream source into this repository
- fork or patch upstream internals
- reimplement every qmd command

## Drift policy

- command ownership lives in the local manifest and should be reviewed when upstream CLI surface changes
- path compatibility tests should compare local helpers against the installed upstream package
- publish checks should include `npm pack --dry-run` to verify the `qmd` bin, `files` allowlist, and
  build output contract

## Delegate policy

- passthrough execution should use direct process spawning with `shell: false`
- stdio should stay inherited in the real CLI path
- environment-based override (`KQMD_UPSTREAM_BIN`) is allowed for tests and local verification

