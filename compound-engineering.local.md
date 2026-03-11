---
review_agents: [kieran-typescript-reviewer, code-simplicity-reviewer, security-sentinel, performance-oracle]
plan_review_agents: [kieran-typescript-reviewer, code-simplicity-reviewer]
---

# Review Context

- K-QMD는 `qmd-compatible replacement distribution`이다.
- `search`, `query`, `update`, `embed`는 이후 스프린트에서 직접 구현할 owned surface다.
- `collection`, `status`, `ls`, `get`, `multi-get`, `mcp`는 현재 upstream passthrough surface다.
- 설정/DB/캐시 경로는 upstream `@tobilu/qmd`와 호환되어야 한다.
- `docs/plans/*.md`와 `docs/solutions/*.md`는 compound-engineering pipeline 산출물이므로 정리 대상이 아니다.
