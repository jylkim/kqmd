---
status: complete
priority: p1
issue_id: "016"
tags: [cli, qmd, search, kiwi, sqlite, fts, typescript]
dependencies: []
---

# Add Kiwi-backed Korean search recall

Implement the 2026-03-12 plan to add Kiwi-backed Korean lexical recall to K-QMD search using a same-DB shadow FTS table and policy-aware status/update/search UX.

## Problem Statement

K-QMD now has an approved brainstorm and deepened plan for Korean lexical recall, but the runtime still delegates lexical search entirely to upstream `searchLex()` and has no Korean-aware indexing path. This leaves the primary user problem unsolved: Korean compound nouns and spacing variants are still missed.

## Findings

- owned `search` is currently a thin lexical wrapper over `session.store.searchLex()`.
- upstream `documents_fts` uses `porter unicode61` and is owned by upstream triggers, so mutating it in place would couple K-QMD directly to upstream lexical schema drift.
- the repo already has a coherent pattern for `canonical policy -> health helper -> status/advisory UX` in the embedding rollout.
- same-DB shadow FTS is the chosen design because it isolates K-QMD ownership while preserving DB-only reopen and a single source of truth.

## Proposed Solutions

### Option 1: Same-DB shadow FTS with policy metadata

**Approach:** Create a K-QMD-owned `kqmd_documents_fts` shadow table, populate it during `update`, query it from `search` when clean, and surface policy health via `status`.

**Pros:**
- avoids mutating upstream `documents_fts`
- keeps metadata and rebuild atomic in one DB transaction
- fits existing `embedding_policy` / `embedding_health` architecture

**Cons:**
- requires local query helper instead of direct `searchLex()` use on the clean path
- adds schema and migration logic inside K-QMD

**Effort:** 1 day

**Risk:** Medium

## Recommended Action

Implement the approved plan in five slices:
1. add canonical search policy and Kiwi tokenizer helpers
2. add search index health helper and same-DB shadow FTS rebuild/query helper
3. wire `update`, `search`, and `status` to the new policy flow
4. add focused unit/integration/parity tests for recall, fallback, and status UX
5. update docs, plan progress, and todo status

## Technical Details

**Affected files:**
- `package.json`
- `package-lock.json`
- `src/config/search_policy.ts`
- `src/commands/owned/kiwi_tokenizer.ts`
- `src/commands/owned/search_index_health.ts`
- `src/commands/owned/search_shadow_index.ts`
- `src/commands/owned/search.ts`
- `src/commands/owned/update.ts`
- `src/commands/owned/status.ts`
- `src/commands/owned/io/types.ts`
- `src/commands/owned/io/format.ts`
- `test/*`
- `README.md`
- `docs/development.md`
- `docs/architecture/*`
- `docs/plans/2026-03-12-feat-kiwi-korean-search-recall-plan.md`

**Related documents:**
- `docs/plans/2026-03-12-feat-kiwi-korean-search-recall-plan.md`
- `docs/brainstorms/2026-03-12-korean-search-recall-brainstorm.md`

## Resources

- Plan: `docs/plans/2026-03-12-feat-kiwi-korean-search-recall-plan.md`
- Brainstorm: `docs/brainstorms/2026-03-12-korean-search-recall-brainstorm.md`
- SQLite FTS5 docs: `https://sqlite.org/fts5.html`
- Kiwi repo: `https://github.com/bab2min/Kiwi`
- `kiwi-nlp` package: `https://www.npmjs.com/package/kiwi-nlp`

## Acceptance Criteria

- [x] canonical search policy helper exists and defines the current Korean lexical policy
- [x] same-DB `kqmd_documents_fts` shadow index can be built and queried without mutating upstream `documents_fts`
- [x] `update` records search policy metadata and rebuilds the shadow index when needed
- [x] `search` uses the shadow index on clean state and falls back to legacy lexical search with stderr warning when stale/untracked
- [x] `status` reports search policy health alongside embedding health
- [x] Korean recall fixtures cover `형태소 분석` → `형태소분석기` and `모델` → `거대언어모델`
- [x] docs and plan progress are updated

## Work Log

### 2026-03-13 - Execution Start

**By:** Codex

**Actions:**
- Re-read the approved plan and deepened notes
- Confirmed explicit user approval to commit directly to `main`
- Reviewed current branch/worktree state and existing owned command seams
- Verified the latest `kiwi-nlp` package version and prepared implementation slices

**Learnings:**
- upstream `documents_fts` reuse would understate schema drift risk
- same-DB shadow FTS keeps atomicity and zero-config behavior simpler than a separate DB file

### 2026-03-13 - Implementation Complete

**By:** Codex

**Actions:**
- Added canonical search policy, Kiwi tokenizer/bootstrap helper, search index health helper, and same-DB shadow FTS rebuild/query helper
- Wired owned `search`, `update`, and `status` to the new Korean lexical policy flow without mutating upstream `documents_fts`
- Added unit, integration, behavior, parity, and snapshot coverage for shadow index health, fallback warnings, and Korean compound recall
- Updated README, development docs, architecture docs, plan progress, and todo status
- Ran `npm run check` and confirmed the full quality gate passed

**Learnings:**
- `kiwi-nlp` requires explicit wasm/model file handling, so cache/bootstrap ownership matters as much as tokenization logic
- same-DB shadow FTS gives enough isolation to avoid upstream lexical schema drift while keeping runtime and status semantics simple
