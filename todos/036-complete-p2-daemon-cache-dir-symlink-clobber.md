---
status: complete
priority: p2
issue_id: "036"
tags: [code-review, security, mcp, daemon, filesystem, typescript]
dependencies: []
---

# Daemon cache directory symlink can redirect PID/log writes

## Problem Statement

The daemon path safety checks only validate the final `mcp.pid` and `mcp.log` file paths, not whether the parent cache directory itself is a symlink. This still permits PID/log file clobbering within the same user account if `~/.cache/qmd` or `XDG_CACHE_HOME/qmd` points elsewhere.

## Findings

- `ensureRegularPath()` rejects a symlink only when the target path itself exists and is a symlink ([src/mcp/daemon_state.ts:21](/Users/jylkim/kqmd/src/mcp/daemon_state.ts#L21)).
- `startDaemon()` creates/truncates `mcp.log` and writes `mcp.pid` under the resolved cache directory without verifying that the parent directory is not symlinked ([src/commands/owned/mcp.ts:102](/Users/jylkim/kqmd/src/commands/owned/mcp.ts#L102)).
- The cache root is derived from `getCacheDir()` and can itself be redirected via `XDG_CACHE_HOME` or a symlinked `~/.cache/qmd` tree ([src/config/qmd_paths.ts:26](/Users/jylkim/kqmd/src/config/qmd_paths.ts#L26)).

## Proposed Solutions

### Option 1: Validate each ancestor directory in the daemon path

**Approach:** Add a helper that checks the cache directory chain for symlinks before creating or truncating PID/log files.

**Pros:**
- Closes the actual clobber vector
- Keeps existing path layout unchanged

**Cons:**
- Slightly more path-validation code

**Effort:** 2-3 hours

**Risk:** Low

---

### Option 2: Move daemon state to a dedicated secure temp directory

**Approach:** Stop reusing the regular cache path and place PID/log files in a dedicated runtime directory with stricter ownership assumptions.

**Pros:**
- Stronger separation of concerns

**Cons:**
- Breaks upstream-compatible path conventions
- Requires more migration/documentation work

**Effort:** 4-6 hours

**Risk:** Medium

## Recommended Action

Use Option 1. The current product contract wants upstream-compatible PID/log paths, so ancestor validation is the smallest safe fix.

## Technical Details

**Affected files:**
- [src/mcp/daemon_state.ts](/Users/jylkim/kqmd/src/mcp/daemon_state.ts)
- [src/commands/owned/mcp.ts](/Users/jylkim/kqmd/src/commands/owned/mcp.ts)
- [src/config/qmd_paths.ts](/Users/jylkim/kqmd/src/config/qmd_paths.ts)
- [test/mcp-daemon-state.test.ts](/Users/jylkim/kqmd/test/mcp-daemon-state.test.ts)

## Resources

- Security review finding

## Acceptance Criteria

- [x] Daemon start/stop rejects symlinked ancestor directories for PID/log files
- [x] PID/log safety tests cover both leaf and parent-directory symlink cases
- [x] Upstream-compatible path conventions remain unchanged

## Work Log

### 2026-03-16 - Code review finding

**By:** Codex

**Actions:**
- Reviewed daemon PID/log safety helpers and startup code
- Traced path derivation from `getCacheDir()` into `mcp.pid` and `mcp.log`

**Learnings:**
- Checking only the final file path is not enough when the containing cache directory can itself be redirected

### 2026-03-16 - Resolution

**By:** Codex

**Actions:**
- Expanded daemon path validation to walk ancestor directories rather than only the final file path
- Updated daemon-state tests to cover a symlinked `qmd` cache directory
- Verified that the original upstream-compatible PID/log paths stay unchanged

**Learnings:**
- Parent-directory symlinks are the real clobber vector in cache-based runtime state, not just the final leaf file
