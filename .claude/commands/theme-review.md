---
description: Deep-review and fix ONE published theme (reviewer → promoter → verify)
argument-hint: <site>
---

Deep-review and fix the published theme for: **$ARGUMENTS**

You are the orchestrator. Load the `userstyles-factory` skill.

This command handles exactly ONE site. If more than one site was given, tell the user to use `/theme-patrol` for multiple, and proceed with the first only after confirming.

1. **Dispatch one `theme-reviewer`** teammate (`run_in_background: true`, name `review-<site>`) for the site. It reviews every page type live, hunts the audit-blind bug classes, fixes each with before/after screenshots into `themes/<site>/docs/`, bumps `@version` (+1 patch) only if CSS changed, and regenerates + sanitizes `.org.css`. It does NOT make promos.
2. When it returns, **dispatch a `theme-promoter`** for the site to regenerate every impacted promo from the final CSS.
3. Run `bash .claude/scripts/verify-theme.sh <site>`; re-dispatch the promoter on a stale-promo failure, surface any other failure.

Report the bug list (page/class/selector + before/after shots), the `@version` decision, and verify-theme.sh status. **Never `git commit` or push** — Reza reviews and commits.
