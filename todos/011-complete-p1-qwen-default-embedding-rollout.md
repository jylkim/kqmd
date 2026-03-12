---
status: complete
priority: p1
issue_id: "011"
tags: [cli, qmd, embeddings, qwen, typescript]
dependencies: []
---

# Roll out Qwen default embedding policy

Implement the 2026-03-12 plan to make K-QMD use the upstream-documented Qwen3 embedding URI as the default effective model while preserving explicit `QMD_EMBED_MODEL` overrides.

## Problem Statement

K-QMD has a plan and brainstorm for Qwen default embeddings, but the runtime still behaves as if upstream defaults are unchanged. It does not expose model mismatch in `status`, can silently no-op in `embed`, and still gives incomplete `update` guidance when stored vectors do not match the current effective embedding model.

## Findings

- `bin/qmd.js` imports `dist/cli.js` without installing a K-QMD default embed model first.
- upstream `@tobilu/qmd` documents `hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf` as the override example in `dist/llm.js`.
- `status` is still passthrough, so K-QMD cannot surface embedding mismatch health in its own UX.
- upstream `searchVec()` does not filter by `content_vectors.model`, so mismatch detection is correctness-critical.
- existing tests already cover routing, parity, and cross-platform passthrough seams that this change will affect.

## Proposed Solutions

### Option 1: Effective model policy + owned status + mismatch UX

**Approach:** Add a canonical embedding policy helper, compute embedding health from DB metadata, promote `status` to owned, and tighten `embed/query/update` UX around mismatch and recovery.

**Pros:**
- Matches the approved plan and brainstorm
- Keeps behavior coherent across commands
- Prevents silent mismatch regressions

**Cons:**
- Touches routing, tests, and docs together

**Effort:** 4-6 hours

**Risk:** Medium

## Recommended Action

Implement the approved plan in four slices:
1. install default embed policy bootstrap and helper module
2. add embedding health helper and owned `status`
3. wire mismatch-aware behavior into `embed`, `query`, and `update`
4. update tests, plan checklist progress, and docs

## Technical Details

**Affected files:**
- `bin/qmd.js`
- `src/cli.ts`
- `src/types/command.ts`
- `src/commands/manifest.ts`
- `src/commands/owned/runtime.ts`
- `src/commands/owned/embed.ts`
- `src/commands/owned/query.ts`
- `src/commands/owned/update.ts`
- `src/commands/owned/io/format.ts`
- `src/commands/owned/io/errors.ts`
- new `src/config/embedding_policy.ts`
- new `src/commands/owned/embedding_health.ts`
- new `src/commands/owned/status.ts`

**Related documents:**
- `docs/plans/2026-03-12-feat-qwen-default-embedding-rollout-plan.md`
- `docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md`

## Resources

- Plan: `docs/plans/2026-03-12-feat-qwen-default-embedding-rollout-plan.md`
- Brainstorm: `docs/brainstorms/2026-03-12-qwen-default-embedding-brainstorm.md`
- Upstream model reference: `node_modules/@tobilu/qmd/dist/llm.js`
- Related solution docs in `docs/solutions/`

## Acceptance Criteria

- [x] Effective embed model helper applies upstream-documented Qwen3 URI by default and respects explicit overrides
- [x] `status` becomes owned and reports embedding health/mismatch
- [x] `embed` blocks no-force mismatch path and passes explicit model on force path
- [x] `query` warns on mismatch via stderr without corrupting stdout formats
- [x] `update` guidance prefers `qmd embed --force` when mismatch exists
- [x] Routing, parity, smoke, and helper tests cover the new behavior
- [x] Relevant docs and plan progress are updated

## Work Log

### 2026-03-12 - Execution Start

**By:** Codex

**Actions:**
- Read the approved plan and deepened notes
- Confirmed `main` branch execution with explicit user approval
- Reviewed upstream `llm.js`, `store.js`, existing command boundaries, and current test seams
- Identified `status` ownership and mismatch detection as the main architectural shifts

**Learnings:**
- The upstream Qwen3 embedding URI is documented as an override example, not yet the default
- `searchVec()` ignoring `content_vectors.model` makes mismatch detection mandatory, not optional
- Existing parity and smoke tests are already strong enough to extend instead of replacing

### 2026-03-12 - Implementation Complete

**By:** Codex

**Actions:**
- Added `src/config/embedding_policy.ts` and wired `bin/qmd.js` to install the default Qwen3 embed model before importing the built CLI
- Added `src/commands/owned/embedding_health.ts` and promoted `status` into the owned command set with a new `src/commands/owned/status.ts`
- Updated `embed`, `query`, and `update` to use effective model / mismatch-aware behavior
- Extended routing, helper, behavior, status snapshot, parity, and smoke tests
- Updated README, development docs, architecture docs, and marked the work plan complete

**Learnings:**
- The upstream-documented Qwen3 URI is the right single source of truth for K-QMD defaulting
- Owned `status` was the smallest coherent place to surface mismatch health without inventing a new command
- stderr-only advisory keeps machine-readable query output clean while still surfacing recovery steps
