# Screenshots

Real product output, refreshed by `scripts/collect-screenshots.ts` before every docs build:

- `scenario-start.png`, `scenario-end.png`, `step-NN-before.png`, `step-NN-after.png` — captures of one
  scenario from the newest demo run that has per-step screenshots (a `@regression` run produces them;
  `step-before.png` / `step-after.png` are aliases of the first pair). `manifest.json` records which run
  and scenario they came from.
- `dashboard.html` — the AutoMax dashboard of that run (regenerated, not committed).
- `ui/*.png` — pages of the web UI rendered against the mock API by `packages/web/scripts/screenshot.ts`.

PNG files are committed on purpose; keep them under ~400 KB. Regenerate with:

```bash
bun run sdods run -p demo-shop -e staging -b chromium -t @regression
node --import tsx apps/docs/scripts/collect-screenshots.ts
```
