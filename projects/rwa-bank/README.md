# RWA Bank (rwa-bank)

The workshop project. It drives [cypress-io/cypress-realworld-app](https://github.com/cypress-io/cypress-realworld-app),
which has to be running: front end on `:3000`, API on `:3001`.

## Locally

Start the app next to this checkout, as the workshop does, then run against env `local`:

```bash
git clone --depth 1 https://github.com/cypress-io/cypress-realworld-app.git ../cypress-realworld-app
cd ../cypress-realworld-app && yarn install && yarn dev
```

```bash
sdods run -p rwa-bank -e local -l api
sdods run -p rwa-bank -e local -l ui -b chromium -t @smoke
sdods lint -p rwa-bank
```

## In CI

Env `ci` has the same URLs as `local`, and exists for two reasons: the app is started inside the job
rather than by a person, and `har/local` recordings must not be replayed in place of the live app.

- `.github/actions/start-rwa` checks the app out at a pinned commit, seeds its database, builds it
  and starts it inside the Playwright container, then waits for both ports.
- The `rwa-bank · chromium · @regression` job in `ci.yml` runs nightly and on manual dispatch: API,
  UI `@smoke`, UI `@regression` (which includes the `@visual` sign-in baseline) and hybrid
  `@regression`. It does not run on pull requests.
- `ci.enabled` stays `false`: the generic matrix also drives the pull-request job, which replays HARs
  with no application running.
- Linux baselines come from the `visual-baselines` workflow, dispatched with `projects: rwa-bank`,
  `env: ci`, `browsers: chromium`. To move the app to a newer commit, change the pinned `ref` in the
  action and re-render the baseline in the same pull request.

## Layout

- `sdods.project.yaml` — project settings (layers, browsers, tags, data, auth, screenshots)
- `envs/` — one yaml per environment; secrets via `${VAR}` from `.env.<env>`
- `features/` — Gherkin; `steps/` — project steps + fixtures; `pages/` — page objects (decorators)
- `features/__screenshots__/rwa-bank--ui--chromium/{darwin,linux}/` — visual baselines per platform
- `data/` — CSV/JSON/YAML per environment with `data/common` fallback
- `RwaBank` page object in `pages/HomePage.ts` shows the heal-aware locator style
