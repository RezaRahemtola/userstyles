---
name: userstyles-browser
description: Browser mechanics for this repo's userstyle theme work — drive a headless Chrome via playwright-cli, one isolated session per agent (parallel-safe), inject the theme from disk, run the audit-blind DOM scan, and capture true 2× dark screenshots. Load before automating any browser work on a theme.
---

Drive the browser with **`playwright-cli`** (`@playwright/cli`) via the `Bash` tool. Each agent opens its **own named session** (`-s=<unique>`) = its own browser process, so agents run in parallel with zero collision.

## Session = your own browser (parallel-safe)

Pick a session name unique to THIS run and reuse it for every command:

```bash
S="<flow>-<site>-$RANDOM"   # e.g. review-espn-28471 ; must be unique across concurrent agents
```

Pass `-s="$S"` on EVERY command (incl. `run-code`/`eval`/`screenshot`) — a unique `$S` keeps agents fully page-isolated; a missing or colliding `-s` falls back to the shared `default` session and is the only way pages bleed across agents. Always `close` your session when done.

**NEVER persist `$S` to a shared/predictable scratchpad file** (e.g. a fixed `scratchpad/session` path). Keep `$S` in your shell env for the run, or hardcode the literal session string in each command. If you must write it to disk, use a path unique to your run (include `$S` in the filename).

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
# run the audit-blind DOM scan → JSON findings
npx playwright-cli -s="$S" run-code --filename=.claude/scripts/audit-blind.js
# capture a framed 2× screenshot (see the scale gotcha)
npx playwright-cli -s="$S" run-code "async p => { await p.evaluate(() => scrollTo(0,0)); await p.screenshot({ path: 'themes/espn/docs/promo-home.png', scale: 'device' }); return 'ok'; }"
npx playwright-cli -s="$S" close
```

`goto <url>` navigates an open session to other page types without reopening.

## CRITICAL gotchas

- **Screenshots MUST go through `run-code` with `page.screenshot({ scale: 'device' })`** to get true 2× (2560×1600). The bare `screenshot` command renders CSS pixels = 1× (1280×800) and your promos will be half-res. Always shoot via `run-code … scale:'device'`.
- **`run-code` has NO `require`/`fs`/`process`.** Its function runs against the live `page`, but you cannot read files from inside it. Inject CSS with `pw-inject.sh` (which uses `addStyleTag({ path })` — Playwright's driver reads the file). To run page JS, use `run-code "async p => p.evaluate(() => { …DOM code… })"`.
- **Inject = inner rules only.** `pw-inject.sh` strips the `==UserStyle==` header + `@-moz-document … { }` wrapper (Chromium ignores `@-moz-document`, so wrapped rules don't apply) and injects the inner CSS. Don't `addStyleTag` the raw `.user.css` yourself.
- **CSP fallback.** `addStyleTag` adds a `<style>` tag; a few sites' CSP block it. If the page stays light after inject, fall back to a constructable sheet by inlining the (already-stripped) CSS once: `run-code "async p => p.evaluate(css => { const s=new CSSStyleSheet(); s.replaceSync(css); document.adoptedStyleSheets=[...document.adoptedStyleSheets,s]; }, \"<inner css>\")"`.
- **`audit-blind.js` is DOM-only** (light surfaces/borders, SVG white fills, dark-on-dark, `-webkit-text-fill-color`, light bg-image gradients, pseudo-element white bg, invisible placeholders). It does NOT catch `<canvas>`, raster gauges, or anything needing pixel luminance — still take screenshots and eyeball (see `userstyles-audits`). Trust the screenshot over the scan.

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
