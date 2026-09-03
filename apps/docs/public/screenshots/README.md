# Screenshots used by the docs

The images in this folder are **generated**, not hand-made. `scripts/collect-screenshots.ts` runs before
every docs build and copies from the most recent demo run:

- `.automax/runs/<runId>/demo-shop/<fingerprint>/r0/scenario-start.png` → `scenario-start.png`
- `.automax/runs/<runId>/demo-shop/<fingerprint>/r0/NN-before.png` and `NN-after.png` → `step-before.png`, `step-after.png`
- `.automax/runs/<runId>/dashboard/index.html` → `dashboard.html`

`manifest.json` records which run they came from. If no run exists yet the script keeps whatever is
here and the pages fall back to their descriptive text. To refresh the images:

```bash
bun run automax run -p demo-shop -e staging -l ui -b chromium -t @regression
bun run docs:build
```
