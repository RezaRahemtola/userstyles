---
description: Re-review published themes against their live sites to catch redesign breakage (default ALL; reviewer per site, waves of 4)
argument-hint: [site …]  (default all published)
---

Patrol published themes for regressions — a site that redesigned and broke our theme surfaces as bugs the reviewer finds and fixes.

You are the orchestrator. Load the `userstyles-factory` skill.

**Determine the site list:**
- If `$ARGUMENTS` is non-empty, use exactly those sites.
- Otherwise, ALL published themes — i.e. tracked theme dirs:
  ```bash
  git ls-files themes/ | sed -n 's#^themes/\([^/]*\)/.*#\1#p' | sort -u
  ```
  (A theme is "published" when its files are git-tracked; untracked in-progress themes are excluded.)

**Process the list in waves of at most 4 concurrent `theme-reviewer` teammates** (each is a heavy headless deep-review). For each site:
1. Dispatch a `theme-reviewer` (`run_in_background: true`, name `patrol-<site>`).
2. When it returns: if it changed CSS, dispatch a `theme-promoter` for that site; if it found zero bugs / changed nothing, skip the promoter (promos aren't stale).
3. Run `bash .claude/scripts/verify-theme.sh <site>`; re-dispatch the promoter on stale-promo failure.
4. **Sweep as you go** — the moment a teammate is fully done (a no-fix reviewer once verified, or a promoter once its verify passes), send it `{"type":"shutdown_request", ...}` via `SendMessage` so it terminates instead of parking idle. Don't leave finished teammates sitting in the idle list; only live reviewers/promoters should remain.

If a reviewer emits an `idle_notification` without a summary, `SendMessage` it for its result before sweeping it.

Throttle between waves to avoid anti-bot trips. Start the next site only as a slot frees (keep ≤4 reviewers live).

Report a catalog table: site → bugs found → fixed? → version → verify status. **Never `git commit` or push** — Reza reviews and commits.
