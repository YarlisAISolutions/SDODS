---
name: sdods-brand
description: Change the SDODS logo, mark or tagline and push it across every app in one command. Use when the user asks to update the logo, change the tagline, fix the brand in dark mode, regenerate favicons or app icons, or says the branding looks wrong or inconsistent.
---

# Changing the SDODS brand

Everything visual comes from three files in `brand/`. Nothing else is hand-edited.

| File | What it is |
|---|---|
| `brand/sdods.svg` | the lockup — the name inside the aperture, with the tagline |
| `brand/mark.svg` | the mark alone, for favicons and app icons |
| `brand/brand.json` | tagline, description, palette — the text source of truth |

## The loop

```bash
# 1. edit brand/sdods.svg, brand/mark.svg or brand/brand.json

# 2. look at it on both grounds at three sizes before committing to it
node --import tsx brand/preview.ts

# 3. regenerate every derived file
bun run brand:sync

# 4. verify on the real built page, in both themes — not just in the SVG
bun run docs:build && node --import tsx brand/verify.ts apps/docs/out
```

`bun run brand:sync -- --check` exits 2 on drift and is what CI should run.

## Why inline components, not `<img>`

An SVG loaded through `<img src=…>` is an **isolated document**. Two consequences, both of which
were live bugs:

- `currentColor` resolves against the SVG's own root, not the page. The lockup's ink was baked to
  `#0B1020`, so on the docs dark background (`#0a0a0a`) the wordmark was near-black on near-black
  and simply vanished.
- Page webfonts are unavailable to it. The lockup asked for 'Space Grotesk' and silently got
  Avenir or Arial depending on the OS.

So anything rendered **in a page** uses the inline component — `SdodsMark` / `SdodsLockup` in
`apps/www/components/sdods-mark.tsx` and its copies. It inherits the page's colour and font, and is
correct in both themes with no duplicate light/dark assets. Standalone `.svg` files still exist for
favicons, the README and OG cards, where a fixed ink is unavoidable.

The amber core `#FFB020` stays literal everywhere. It is the one fixed point of the identity and
reads on white and on near-black alike.

## Traps

**A new logo under an old filename is invisible for a week.** `firebase.json` used to cache images
for 7 days, and the SDODS rebrand reused `/img/favicon.svg` and `/img/sdods-logo.svg` — so the site
served the deleted **AutoMax** hexagon beside the current SDODS mark, and a hero reading
"Deployment System" that no longer existed in the source. It looked like two competing logos; it
was one URL serving two generations. Image cache is now 1 hour. If it is ever lengthened again,
content-hash the filenames instead.

**The copies drift.** Before this pipeline there were six hand-duplicated lockups, and
`packages/web/public/sdods-logo.svg` still said "Orchestration & **Deployment** System" while both
websites said "Delivery System" — the product's own dashboard disagreed with its marketing site.
`tests/brand-sync.test.ts` now fails if any copy drifts or if the retired backronym reappears.

**Do not let the tagline rewrite reach agent instructions.** `brand.json` feeds the lockups and a
small set of brand strings. `README.md`, `AGENT.md`, `CLAUDE.md`, the per-package descriptions and
the MCP/agent prompts describe *capability*, not brand, and a script that rewrites agent
instructions will one day break the agents. Leave them alone.

**`.icns` cannot be generated on Linux.** `iconutil` is macOS-only and the site workflows run on
`ubuntu-latest`, so desktop icons are generated locally and committed — the same way
`apps/desktop/build/icon.*` already worked.

**Rasterise with Playwright, not `rsvg-convert`.** `@playwright/test` is already a root
devDependency and `apps/docs/scripts/preview-art.tsx` already turns SVG into PNG this way.
`rsvg-convert` may happen to be installed on a dev machine but is on no CI runner.

## Files

| Path | Purpose |
|---|---|
| `brand/sdods.svg`, `brand/mark.svg`, `brand/brand.json` | the only hand-edited brand files |
| `brand/preview.ts` | candidate lockups on both grounds at 520/240/96px |
| `brand/verify.ts` | screenshots a built site in both themes |
| `scripts/sync-brand.ts` | generates every derived file; `--check` for CI |
| `apps/{www,docs}/components/sdods-mark.tsx`, `packages/web/src/components/sdods-mark.tsx` | the inline, theme-aware components |
| `tests/brand-sync.test.ts` | drift guard |
