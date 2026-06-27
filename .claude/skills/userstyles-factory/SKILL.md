---
name: userstyles-factory
description: How the userstyles dark-theme factory works end to end — the loop, the standard dark palette, the team-orchestration model, the build coverage checklist, and the promo verification gate. Load when orchestrating any theme flow (discover/build/review/patrol).
---

## The factory loop

```
loop:
  site = next candidate from queue
  verdict = coverage_gate(site)          # both platforms
  if verdict == SATURATED: skip, log why, continue
  build(site)                            # browser inspect + author CSS
  verify(site)                           # automated audits + before/after diff, loop to zero
  bundle(site)                           # listing.md + promo-*.png + walkthrough.mp4
  cleanup()                              # close browser, rm temp
  log result; continue until queue empty or stop-count reached
```

**Autonomy rules:** never `git commit`/push, never upload to the platforms (Reza does that), never claim done without audits passing. Leave each finished theme staged: public files in `themes/<site>/`, bundle in gitignored `themes/<site>/docs/`.

## Four flows — which skills each loads

The five `userstyles-*` skills are building blocks; a flow loads whichever it needs (not 1:1):

| Flow | Agent(s) | Skills loaded |
|---|---|---|
| **discover** | `theme-scout` → `theme-builder` | `userstyles-discovery` + `userstyles-browser` (scout); then build |
| **build** | `theme-builder` → `theme-promoter` | `userstyles-browser` + `userstyles-audits` (+ this factory skill); promoter loads `userstyles-bundle` |
| **review** | `theme-reviewer` → `theme-promoter` | `userstyles-browser` + `userstyles-audits`; promoter loads `userstyles-bundle` |
| **patrol** | `theme-reviewer` ×N → `theme-promoter` | same as review, fanned out (waves of 4) |

`userstyles-bundle` is loaded by `theme-promoter` (the sole promo generator), never by builders/reviewers. Each skill is self-contained — load only what the job needs; don't re-paste its content.

## Standard dark palette

| Role | Hex |
|---|---|
| base bg | `#14181d` |
| elevated surface | `#1c2128` / `#1a1f26` |
| header/footer | `#0d1117` |
| border (subtle) | `#262c33` (soften light borders), `#2d333b` (component) |
| text primary | `#e6edf3` |
| text body | `#c4cdd6` |
| link/accent | `#5fb0e6` (hover `#9bd4ff`) |
| success/green | `#3fb950` |
| syntax: comment | `#8b949e` |
| syntax: keyword | `#ff7b72` |
| syntax: string | `#a5d6ff` |
| syntax: number | `#79c0ff` |

Always include `:root { color-scheme: dark }`.

## Build coverage checklist

Work through these in order; loop to zero audit fails:

1. **base** — `html, body { background: #14181d; color: #e6edf3 }`
2. **section wrappers** — transparent or elevated (`#1c2128`)
3. **soften light borders** — `* { border-color: #262c33 !important }` broad pass, then refine
4. **header/nav** — find the REAL element (e.g. `.site-header`, not a guessed class); set `#0d1117`
5. **headings + body text** — headings `#e6edf3`, body `#c4cdd6`
6. **links** — `#5fb0e6` default, `#9bd4ff` hover
7. **code + syntax palette** — scope full Pygments/highlight palette to `pre`/`.highlight`/`.codehilite`; light token colors are the worst offenders on dark
8. **tables** — rows + header cells
9. **forms/inputs** — bg `#1c2128`, color `#e6edf3`; placeholders `#8b949e`
10. **buttons** — darken bg, keep brand hue readable (never raw saturated hex — the Genius `#d61500` lesson)
11. **callouts** — info/warn/error variants
12. **cards** — elevated surface; confirm contrast against `#1c2128` not `#14181d`
13. **footer** — `#0d1117`
14. **`:root { color-scheme: dark }`**

**Preserve semantic colors** — keep status greens/reds/badges; recolor only what must change.

**Adapt brand/accent colors for dark** — keep the brand identity (same hue family) but tune saturation/lightness to sit well on the dark palette. Never dump the raw original hex verbatim.

## Domain coverage

`@-moz-document` MUST cover ALL domains/ccTLDs the site serves (geo-redirects, www vs apex, `m.`, regional subdomains). Mirror the SAME domain list in the generated `.org.css`. Check for ccTLD variants (espn.co.uk, espn.com.au, etc.).

`.org.css` must be sanitized: no `" i]`, `:has()`, `:is()`, `:where()`, complex `:not()`, `oklch()`, `@layer`. Check brace balance after stripping.

## Team-orchestration model

**Orchestrator responsibilities:**
- Owns the candidate queue and selection (coverage gate + incumbent render-test)
- Fan-out: dispatch one build subagent per site
- Monitor: teammates **auto-notify on completion** — the harness re-invokes you when they finish, so NEVER poll/`sleep`/wait-loop for them. Only if one goes silent well past expected, `SendMessage` it for a summary — or read `themes/<site>/` + `docs/` on disk
- Log each returned summary; move on

**Subagent rules:**
- Launch with `run_in_background: true` + a name
- One agent per site — NEVER two for the same site (the Agent tool auto-suffixes duplicates as `build-khan-2`; that suffix is the tell one is already running; cancel the dupe)
- Agents can't be force-killed: `SendMessage` a `shutdown_request` (processes at next yield; a long browser op delays it). Failsafe: `rm -rf themes/<site>/docs` to discard a bad bundle and restart cleanly
- Each agent writes only its own `themes/<site>/` (+ `docs/`); orchestrator appends the README row after agents return (never concurrent)
- **THROTTLE** — space requests between sites; don't fan many agents at the same site; retry "blocked" sites later, slowly before declaring unviable (a 403/CAPTCHA is almost always rate-limiting, not a permanent hard WAF block)
- **Session cleanup backstop** — each teammate owns and closes its own `playwright-cli` process. After ALL teammates are done, clear any stragglers: `npx playwright-cli list` → `close-all` (`kill-all` for zombies). Never `close-all` while a teammate is live. Unstick ONE wedged teammate by killing only its session: `npx playwright-cli -s=<session> kill`

## Verification gate (mandatory before declaring a theme done)

```bash
bash .claude/scripts/verify-theme.sh <site>
```

Require exit 0. The script checks: brace balance (both files), `.org.css` sanitization, `@version` present in `.user.css` only, and **promo freshness** (every promo newer than the `.user.css`). The audits-at-zero, the clean ≤160-char `@description`, and the full `@-moz-document` domain list are the agent's responsibility (`userstyles-audits` / `userstyles-bundle`), not this script — verify them before declaring done.

**Promos are made ONLY by `theme-promoter`.** If the verify script reports stale or missing promos, re-dispatch a `theme-promoter` agent; do NOT generate promos inline. Promos must be regenerated after ANY CSS change — never leave stale shots in the bundle.

Only after exit 0 is a theme considered done and ready for Reza to review.
