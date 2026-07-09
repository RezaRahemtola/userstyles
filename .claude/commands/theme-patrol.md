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

**The pipeline is strictly serial per site, and each stage ends with the file frozen:**

```
review (finds bugs, fixes, does the VISUAL pass, mirrors .org.css)
  → STOP + orchestrator verifies on disk + KILLS the reviewer
    → promote (mechanical capture only, hash-guarded, never edits CSS)
      → STOP + verify-theme.sh exit 0 + KILL the promoter
```

The reviewer owns the visual pass, not the promoter. Promoters used to find bugs *by rendering pages*, which made bundling secretly the last review step — so every bundle kept invalidating itself and reshooting. A promoter that spots a bug now reports it and halts; you re-dispatch a reviewer.

**Process the list in waves of at most 4 concurrent `theme-reviewer` teammates** (each is a heavy headless deep-review). For each site:
1. Dispatch a `theme-reviewer` (`run_in_background: true`, name `patrol-<site>`).
2. **When it returns, in ONE tool block:** verify its work on disk, then `TaskStop` it. Never defer the kill to a later turn — that is how finished agents pile up idle. Verify:
   - `css-hash.sh` the `.user.css` twice a couple of seconds apart (stable ⇒ no live writer),
   - declaration-level `.user.css` ↔ `.org.css` mirror diff, both directions,
   - `@version` bumped exactly one patch over `git show HEAD:…`, and absent from `.org.css`,
   - `@description` ≤160 **characters**,
   - each fixed selector present in `.org.css` (proves it survived sanitization).
3. If it changed CSS, dispatch a `theme-promoter`. If it found zero bugs and wrote nothing, skip the promoter — the bundle is still valid, because the gate now hashes rule content rather than comparing mtimes.
4. Run `bash .claude/scripts/verify-theme.sh <site>`; require exit 0. Then `TaskStop` the promoter in that same block.

**Killing teammates:** use `TaskStop({task_id: "<name>"})`. Do **not** `SendMessage` a `shutdown_request` and do **not** reply to a finished agent — messaging a terminated agent silently RESTARTS it with your message as its prompt, and it will open a browser and write CSS. `TaskStop`'s error text lists who is really still running; trust that over your own count. If a reviewer emits an `idle_notification` with no summary, read its work off disk rather than pinging it.

Throttle between waves to avoid anti-bot trips. Start the next site only as a slot frees (keep ≤4 reviewers live).

Report a catalog table: site → bugs found → fixed? → version → verify status. **Never `git commit` or push** — Reza reviews and commits.
