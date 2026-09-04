# RWA Bank (rwa-bank)

SDODS project. Run:

```bash
sdods run -p rwa-bank -e local -l api
sdods run -p rwa-bank -e local -l ui -b chromium -t @smoke
sdods lint -p rwa-bank
```

- `sdods.project.yaml` — project settings (layers, browsers, tags, data, auth, screenshots)
- `envs/` — one yaml per environment; secrets via `${VAR}` from `.env.<env>`
- `features/` — Gherkin; `steps/` — project steps + fixtures; `pages/` — page objects (decorators)
- `data/` — CSV/JSON/YAML per environment with `data/common` fallback
- `RwaBank` page object in `pages/HomePage.ts` shows the heal-aware locator style
