---
name: userstyles-browser
description: Browser mechanics for this repo's userstyle theme work — drive a headless Chrome via playwright-cli, one isolated session per agent (parallel-safe), inject the theme from disk, run the audit-theme.js DOM scan, and capture true 2× dark screenshots. Load before automating any browser work on a theme.
---

Drive the browser with **`playwright-cli`** (`@playwright/cli`) via the `Bash` tool. Each agent opens its **own named session** (`-s=<unique>`) = its own browser process, so agents run in parallel with zero collision.

## Session = your own browser (parallel-safe)

Pick a session name unique to THIS run and reuse it for every command:

```bash
S="<flow>-<site>-$RANDOM"   # e.g. review-espn-28471 ; must be unique across concurrent agents
```

Pass `-s="$S"` on EVERY command (incl. `run-code`/`eval`/`screenshot`) — a unique `$S` keeps agents fully page-isolated; a missing or colliding `-s` falls back to the shared `default` session and is the only way pages bleed across agents. Always `close` your session when done.

**NEVER persist `$S` to a shared/predictable scratchpad file** (e.g. a fixed `scratchpad/session` path). Keep `$S` in your shell env for the run, or hardcode the literal session string in each command. If you must write it to disk, use a path unique to your run (include `$S` in the filename).

**Write ALL scratch to your absolute session scratchpad dir** (named in your prompt), never a bare relative `scratchpad/` — CWD is the repo root, so relative paths litter `userstyles/scratchpad/` into git. Only `themes/<site>/docs/` bundle files belong in the repo.

## The standard capture config

`.playwright/cli.config.json` (tracked) sets `deviceScaleFactor:2`, `colorScheme:dark`, `viewport 1280×800`. Pass it to `open`:

```bash
npx playwright-cli -s="$S" open --browser chromium --config .playwright/cli.config.json "<url>"
```

Use `--browser chromium` (bundled; installed once via `npx playwright-cli install-browser chromium`). Headless is the default (omit `--headed`).

## Recipe (per page type)

```bash
S="review-espn-$RANDOM"
npx playwright-cli -s="$S" open --browser chromium --config .playwright/cli.config.json "https://www.espn.com"
# dismiss consent — click the real button (see below), never just remove the node
npx playwright-cli -s="$S" click "Accept"   # or a run-code click; verify no fixed backdrop remains
# inject the theme (strips the @-moz-document wrapper, reads CSS from disk — never in your tokens)
bash .claude/scripts/pw-inject.sh "$S" themes/espn/espn.user.css
# run the theme DOM scan → JSON findings (14 buckets)
npx playwright-cli -s="$S" run-code --filename=.claude/scripts/audit-theme.js
# capture a framed 2× screenshot (see the scale gotcha)
npx playwright-cli -s="$S" run-code "async p => { await p.evaluate(() => scrollTo(0,0)); await p.screenshot({ path: 'themes/espn/docs/promo-home.png', scale: 'device' }); return 'ok'; }"
npx playwright-cli -s="$S" close
```

`goto <url>` navigates an open session to other page types without reopening.

## CRITICAL gotchas

- **Screenshots MUST go through `run-code` with `page.screenshot({ scale: 'device' })`** to get true 2× (2560×1600). The bare `screenshot` command renders CSS pixels = 1× (1280×800) and your promos will be half-res. Always shoot via `run-code … scale:'device'`.
- **`run-code` has NO `require`/`fs`/`process`** (and no global `setTimeout` — use `p.waitForTimeout(ms)`). Its function runs against the live `page`, but you cannot read files from inside it. Inject CSS with `pw-inject.sh` (Playwright's driver reads the file from disk). To run page JS, use `run-code "async p => p.evaluate(() => { …DOM code… })"`.
- **Inject = inner rules only.** `pw-inject.sh` strips the `==UserStyle==` header and unwraps EVERY `@-moz-document … { }` block (Chromium ignores `@-moz-document`, so wrapped rules don't apply) — multi-block themes (e.g. khinsider's `/forums/` block) are fully covered. Don't `addStyleTag` the raw `.user.css` yourself.
- **CSP/hang fallback is automatic.** `pw-inject.sh` injects each frame via a real `<style>` (`addStyleTag` — the faithful path) and, if that throws (CSP) or hangs past a per-frame timeout (ad-heavy frames never settle), auto-falls-back to a constructable `adoptedStyleSheets` sheet — no manual step. Its return string reports the split, e.g. `injected: 5 via <style>, 1 via adoptedStyleSheets (fallback)`. Tune the budget with `PW_INJECT_TIMEOUT_MS` (default 2500). Always confirm the result by reading `document.body` bg, not the return string alone.
- **`audit-theme.js` is DOM-only** (14 buckets: light surfaces/borders, SVG white fills, dark-on-dark, `-webkit-text-fill-color`, light bg-image gradients, pseudo-element white bg + pseudo TEXT, invisible placeholders, SVG gradient stops, `<symbol>` fills, sub-floor light surfaces, filled carets, flattened active borders). It does NOT catch `<canvas>`, raster gauges, blend modes, semantics, closed states, or anything needing pixel luminance — still take screenshots and eyeball (see `userstyles-audits`). **Trust the screenshot over the scan:** it has returned `total=0` on pages carrying six real bugs.

## Bot-challenge fallback → headed (Cloudflare Turnstile / DataDome / "Just a moment")

Some sites (e.g. Genius, behind Cloudflare) challenge **headless** browsers. After `goto`, detect a challenge: page title `Just a moment...`, or `#challenge-running` / `.cf-turnstile` / `#cf-chl-widget` present, or a near-empty body that never loads the real content. If challenged:

1. `close` the session and reopen **with `--headed`** (`open --browser chromium --headed --config …`) — a real window passes the challenge.
2. Give it a moment — `run-code "async p => p.waitForTimeout(3000)"`; if a checkbox remains, humanize: `run-code "async p => { await p.mouse.move(200,200); await p.mouse.move(300,260); await p.click('.cf-turnstile, input[type=checkbox]').catch(()=>{}); await p.waitForTimeout(3000); }"`.
3. Confirm the real page loaded (not the challenge), then proceed normally.

Keep **headless the default** — only escalate to headed for the specific sites that challenge. (Headed pops a real window; with parallel agents that's one window per challenged site.) A site that returns the block on the FIRST request even headed across waits is a hard WAF — shelve it (see `userstyles-discovery`), don't keep retrying.

## Consent / overlays

Dismiss by CLICKING the accept/close button — removing the node leaves its full-screen backdrop + scroll-lock. OneTrust (incl. ESPN/Genius): click `#onetrust-accept-btn-handler` (e.g. `run-code "async p => p.click('#onetrust-accept-btn-handler')"`); confirm `.onetrust-pc-dark-filter` is gone. Generic: a button matching `accept all|accept|i accept|agree|got it`, or `[aria-label="Close"]` / press Escape. Confirm no `position:fixed` full-screen overlay remains before capturing. Hide blank ad iframes before shooting.

## Cleanup = part of "done"

`close` EVERY session you opened. `playwright-cli list` shows live sessions; `close-all` / `kill-all` are the orchestrator's backstop once no agents are live. The CLI writes auto-snapshots to `.playwright-cli/` (gitignored) — remove stray scratch. No browser stays open between themes.
