---
description: Discover new theme candidates and AUTONOMOUSLY build every clean 🟢 (scouts → gate → builders → promoters → verify)
argument-hint: [angle/topic hints …]  (optional)
---

Discover new theme candidates and autonomously build the winners. Optional focus hints: **$ARGUMENTS**

You are the orchestrator. Load the `userstyles-factory` skill.

1. **Fan out several `theme-scout` teammates** (`run_in_background: true`, named `scout-<angle>`), each on a DIFFERENT search angle/region — full-corpus enumeration, a non-Latin-script term set, comment-complaint mining, stale high-install leaders. Seed angles from `$ARGUMENTS` if given. Each scout reads `.claude/registry/explored.md` first and excludes listed sites, runs the coverage gate, and returns gated candidates.

2. **Dedup** the returned candidates across scouts; keep the clean **🟢 OPPORTUNITY** ones.

3. **AUTONOMOUSLY, for each 🟢** (do NOT pause for approval — this command is unattended): dispatch a `theme-builder`, then on its return a `theme-promoter`, then `bash .claude/scripts/verify-theme.sh <site>` (re-dispatch promoter on stale-promo failure). Throttle — don't fan many builders at once or hammer a host.

4. **Append** the new verdict lines (🟢 built, plus 🟠/⚪/🧱/native-dark skips) to `.claude/registry/explored.md`.

Run the global Playwright context sweep ONCE, only after no teammates are live.

Report what was discovered (with verdicts + demand evidence) and what got built. **Never `git commit` or push** — Reza reviews and commits.
