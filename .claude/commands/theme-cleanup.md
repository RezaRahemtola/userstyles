---
description: Remove scratch files from theme docs/ dirs, keeping only the ship bundle (one site or, by default, all)
argument-hint: [site]  (default: all themes)
---

Clean up throwaway files left in `themes/<site>/docs/` — review before/after shots, agent verification screenshots, and other scratch — keeping only the ship bundle.

Target: **$ARGUMENTS** (a single site, or all themes if empty).

The keeper standard (everything else in `docs/` is scratch and gets removed):
- `promo-*` — listing promo shots (`.png` + `-org.jpg`)
- `incumbent-*` — opportunity / incumbent render-test evidence cited by `rationale.md`
- `walkthrough.mp4` — walkthrough video
- `listing.md`, `rationale.md`

Steps:
1. **Preview** (dry-run, default): `bash .claude/scripts/cleanup-docs.sh $ARGUMENTS`
2. Eyeball the list — confirm nothing useful is slated (the script never removes a keeper, but a sanity glance is cheap).
3. **Apply:** `bash .claude/scripts/cleanup-docs.sh $ARGUMENTS --apply`

`docs/` is gitignored, so this only touches local scratch — no tracked files. Report the removed/kept counts.
