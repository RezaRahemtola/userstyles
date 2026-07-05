---
name: userstyles-publish
description: Browser mechanics to push a theme's sanitized .org.css to its EXISTING userstyles.org style. Updates the CSS source only (no promo/description/create). Load when running /theme-publish-org for a site.
---

Pushes `themes/<site>/<site>.org.css` (assumed already fresh) to the theme's existing
**userstyles.org** style, in the shared logged-in browser profile. Updates the CSS source ONLY —
never creates a style, never touches promo/description. One site per run.

userstyles.world is NOT handled here — it auto-updates from a GitHub raw URL (source mirroring set
up once in-browser). This skill exists because .org stores a *pasted copy* with no URL mirror.

## Preconditions (stop with a clear message if any fail)
- `themes/<site>/<site>.org.css` exists.
- `themes/<site>/publish.json` exists and has `{ "orgStyleUrl": "https://userstyles.org/styles/<id>/edit" }`
  (or a bare `<id>` — derive the edit URL as `https://userstyles.org/styles/<id>/edit`).
- The shared profile `.publish-profile/` exists (gitignored). If not, the one-time login hasn't been done.

## Browser = the shared persistent profile (NOT an ephemeral session)
Drive `playwright-cli` with the **persistent profile**, headless is fine for .org (no Anubis; unlike .world):

```bash
S="pub-org-<site>-$RANDOM"
npx playwright-cli -s="$S" open --persistent --profile .publish-profile --browser chromium "https://userstyles.org/"
```
- The profile is LOCKED while any session using it is open. `close` it (and any other `.publish-profile` session) when done, and never run two `.publish-profile` sessions at once.
- `run-code` has no `fs`/`process`; pass non-trivial JS via `--filename=<script.js>` (inline double-quoted code breaks in fish on `$(`, e.g. `p.$('…')`).

## Step 1 — Auth check (never attempt a password login)
Load `https://userstyles.org/user-profile/1068424`; the owner-only account editor text
(`Save Changes` / `PAYPAL EMAIL` / `Styles Created`) proves you're logged in. If NOT present,
STOP and tell Reza to re-run the one-time login, then retry:
```
npx playwright-cli open --persistent --profile .publish-profile --browser chromium --headed https://userstyles.org/login
```
(He logs into userstyles.org — and userstyles.world in the same window — then closes it.)

## Step 2 — Open the editor
`goto` the `orgStyleUrl`. `https://userstyles.org/styles/<id>/edit` **redirects to**
`https://userstyles.org/create-style/<id>` — the CodeMirror-6 editor. Wait for `.cm-editor` to exist.

## Step 3 — Replace the CSS source (CodeMirror 6)
CM6 virtualizes (only visible lines in the DOM) and does not expose its `EditorView` on DOM nodes,
so DOM select/read is unreliable. Use CM6's own select-all + a single `insertText` (proven):

```js
// scratchpad script, run with --filename; CSS is passed via a bound arg, NOT string-interpolated
async (p) => {
  const css = /* read themes/<site>/<site>.org.css from disk into the script's Node side, then */ CSS_STRING;
  const c = await p.$('.cm-content');
  await c.click();
  await p.keyboard.press('Meta+a');       // CM6 selectAll on the FULL virtual doc (darwin)
  await p.keyboard.insertText(css);        // one insertText replaces whole doc, no per-char autoindent
}
```
Load the CSS from disk in the driver (e.g. generate the script file with the CSS embedded, or read it
in a wrapper and write a temp script) — `run-code` itself cannot read files.

## Step 4 — Save
Click the button whose text is **"Save and Publish Your Style!"** (scope to the editor form; the page
has a nav search form too — do NOT click a bare `button[type=submit]`, it may hit search). Prefer
`p.getByRole('button',{name:/Save and Publish/i}).click()`. Wait for the save to settle (success signal:
redirect to the style page, or a toast — confirm once, then rely on Step 5).

## Step 5 — Verify (authoritative)
Fetch the stored source and compare to on-disk, **normalizing CRLF→LF** (.org stores `\r\n`; on-disk is `\n`):
```js
const stored = await (await fetch('https://userstyles.org/styles/<id>.css')).text();
```
```bash
# compare normalized
diff <(curl -s "https://userstyles.org/styles/<id>.css" | tr -d '\r') themes/<site>/<site>.org.css
```
PASS = identical after normalization. Otherwise report the diff (don't claim success).

## Guards
- One site per run. Never create a new style. Never edit name/description/preview.
- Assume `.org.css` is fresh (bundle regenerated separately) — this skill does not run the bundler.
- Never `git commit` / push — Reza reviews.
- `close` the `.publish-profile` session when done.
