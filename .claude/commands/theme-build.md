---
description: Build dark theme(s) for one or more sites end-to-end (builder → promoter → verify)
argument-hint: <site> [site2 …]
---

Build a complete dark theme for each site in: **$ARGUMENTS**

You are the orchestrator. Load the `userstyles-factory` skill for the palette, orchestration model, and the verification gate.

For each `<site>` in the arguments (process in parallel, one teammate per site):

1. **Dispatch a `theme-builder`** teammate (`run_in_background: true`, name `build-<site>`). It inspects the live site, authors `themes/<site>/<site>.user.css` + sanitized `.org.css` (`@version 1.0.0`), and loops the audits to zero. It does NOT make promos.
2. When the builder reports ready, **dispatch a `theme-promoter`** for that site to generate the bundle into `themes/<site>/docs/`.
3. After the promoter returns, run `bash .claude/scripts/verify-theme.sh <site>`. If it fails on stale promos, re-dispatch the promoter; surface any non-promo failure (brace/sanitize/version).

Throttle if building many sites at once (don't hammer one host; space requests). Run the global Playwright context sweep ONCE, only after all teammates are done. 

Report a per-site summary: what was built, audit result, version, verify-theme.sh status, any caveats. **Never `git commit` or push** — Reza reviews and commits.
