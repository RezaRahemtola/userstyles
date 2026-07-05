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

## Steps 3+4 — Replace the CSS source (CodeMirror 6) and Save
`run-code` can't read files, so **generate a temp JS script that embeds the CSS as a JSON string
literal** (json-encoding avoids all escaping bugs), then run it with `--filename`. Proven recipe —
a Python generator that reads the on-disk `.org.css` and emits the driver:

```python
import json
css = open(f'themes/{site}/{site}.org.css', encoding='utf-8').read()
open(f'scratchpad/pub-{site}.js','w').write('''async (p) => {
  const css = %s, id = '%s';
  await p.goto('https://userstyles.org/styles/'+id+'/edit', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3500);
  await p.waitForSelector('.cm-content');
  const c = await p.$('.cm-content'); await c.click();
  await p.keyboard.press('Meta+a');            // CM6 selectAll on the FULL virtual doc (darwin)
  await p.keyboard.insertText(css);            // one insertText replaces whole doc
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: /Save and Publish/i }).click();   // NOT a bare button[type=submit] (that hits the nav search form)
  await p.waitForTimeout(6000);
  const stored = await p.evaluate(async i => (await fetch('https://userstyles.org/styles/'+i+'.css')).text(), id);
  const norm = s => s.replace(/\\r\\n/g,'\\n').replace(/\\s+$/,'');
  return JSON.stringify({ MATCH: norm(stored) === norm(css) });
}''' % (json.dumps(css), sid))
```
Run: `npx playwright-cli -s="$S" run-code --filename=scratchpad/pub-<site>.js`.
CM6 virtualizes (only visible lines in the DOM) and doesn't expose its `EditorView` — so don't try to
read the doc back from the DOM; the HTTP readback below is the truth.

## Step 5 — Verify (authoritative)
The `MATCH` above (readback vs on-disk, CRLF→LF normalized) is the success signal. Double-check out of band:
```bash
diff <(curl -s "https://userstyles.org/styles/<id>.css" | tr -d '\r') themes/<site>/<site>.org.css
```
PASS = identical after normalization. If it differs, the save was REJECTED — do NOT claim success.

## .org rejects invalid CSS on save (the browser tolerates it — .org does not)
The save POSTs to `gateway.userstyles.org/styles/create`; a **502** with a `message` means rejected and
NOTHING was saved (readback stays old → MATCH false). Capture it by listening for the POST response.
Two real causes seen — fix the theme, don't work around:
- **Stray `*/` inside a comment** prematurely closes it (e.g. `trc_*/videoCube` → `*/`), then the trailer
  is parsed as CSS → `parse error`. Browsers silently drop the broken block; .org errors. Fix the comment.
- **example-url domain not covered by the CSS `@-moz-document`** → `"example_url … does not match the
  sites specified in the code."` The style's example URL (Style Info tab) must be a host the CSS matches
  (e.g. CSS `domain("www.thingiverse.com")` needs example `https://www.thingiverse.com`, not bare). This
  is a metadata field — surface it to Reza; the CSS-only skill does not edit it.

## Guards
- One site per run. Never create a new style. Never edit name/description/preview.
- Assume `.org.css` is fresh (bundle regenerated separately) — this skill does not run the bundler.
- Never `git commit` / push — Reza reviews.
- `close` the `.publish-profile` session when done.
