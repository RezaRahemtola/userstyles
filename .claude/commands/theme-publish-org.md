---
description: Push a theme's fresh .org.css to its existing userstyles.org style (CSS source only)
argument-hint: <site>
---

Publish/update the userstyles.org style for: **$ARGUMENTS**

You are the orchestrator. Load the `userstyles-publish` skill and follow it for this ONE site.

This command handles exactly ONE site. If more than one was given, tell Reza to run it per-site and proceed with the first only after confirming.

Scope: updates the **CSS source only** on userstyles.org, from the on-disk `themes/<site>/<site>.org.css` (assumed already fresh — this does NOT run the bundler). userstyles.world is NOT touched here (it auto-updates from its GitHub raw mirror). Never create a style, never edit name/description/preview.

Steps (per the skill): auth-check the shared `.publish-profile`; read `themes/<site>/publish.json` for the `orgStyleUrl`; open the CM6 editor; replace the source with the on-disk `.org.css`; save; verify by fetching `styles/<id>.css` and diffing against on-disk (normalize CRLF→LF).

Report: the style URL, the verify PASS or the diff, and whether the on-disk `.org.css` was already live (no-op) or changed. **Never `git commit` or push** — Reza reviews.
