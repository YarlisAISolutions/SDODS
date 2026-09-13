# @sdods/contracts

## 0.5.2

### Patch Changes

- 45a38a8: Stop publishing Playwright traces, and redact the ones a run keeps (#101).
  
  A `trace.zip` records every request's `Cookie`/`Authorization` headers, `Set-Cookie` responses, the context's `storageState` (cookies, localStorage, IndexedDB — where Firebase keeps its refresh token) and typed values, so for projects with pool accounts it carries live sessions.
  
  - **Integrations never upload, attach or link a trace.** GitHub issues no longer link `trace.zip` through `SDODS_PUBLIC_URL` or the CI artifacts page, and `uploadToRelease` no longer uploads it; Jira no longer attaches it. Both name the trace's local path under a warning that it contains credentials, with the `npx playwright show-trace` command. The video is still linked or uploaded (it shows the screen, not headers or storage).
  - **`sdods run` redacts every trace after the run**, before ingest and integrations: `runner-output/**/trace.zip`, the HTML report's copies under `html-report/data/`, zips nested in blob shard reports, and the BASE64 trace bodies embedded in `messages.ndjson` (which ingest turns back into `trace.zip`). Credential headers (`Cookie`, `Set-Cookie`, `Authorization`, `Proxy-Authorization`, `X-Api-Key` and similar), cookie values, localStorage/sessionStorage/IndexedDB values, `httpCredentials` passwords, password inputs in DOM snapshots and values typed into password/secret/token fields become `[redacted]`. Other entries are copied through unchanged and the trace viewer opens the result. Request/response bodies and page text are not redacted.
  - New `evidence.redactTraces` (default `true`; env files may override it). `evidence.trace` and `sdods run --trace <mode>` already control whether traces are recorded at all.
  - Docs warn that traces are credential-bearing (GitHub and Jira guide, `sdods trace`, `project.yaml` reference).

## 0.5.1

### Patch Changes

- bd833e1: Make every credential an API call carries explicit, and wire two config fields that did nothing.
  
  - `I use an isolated API client` (or `apiContext.isolated = true`) sends the rest of the scenario's calls through a separate request context with an empty cookie jar, created on first use and disposed at teardown. On `@ui`/`@hybrid` the shared `request` context starts from the `@user:<role>` storageState, so "an invalid API key is refused" passed on the session cookie. The raw (`without following redirects`) and event-stream steps honour it. The step library reference documents which layers carry which jar.
  - String bodies are sent as bytes. Playwright JSON-encodes a string that does not parse when the content-type is exactly `application/json`, so `{ this is not json` arrived as `"{ this is not json"`. New step `I send a {method} request to {string} with the raw body:` sends its doc string untouched (not parsed, not template-rendered).
  - `I use a leased user with role {string} for API calls` no longer attaches the user's token behind the scenario's back for `custom` auth strategies, whose `token()` may mint a different credential class than the session. New project setting `auth.apiToken: implicit | explicit` (default: explicit for `custom`, implicit for every other strategy, unchanged) and new step `I authenticate the API with the leased user's token`. Which credential was attached, and from where, is logged at `info`. **Behaviour change** for `custom` strategies that relied on the implicit bearer: add the step, or set `auth.apiToken: implicit`.
  - Recorded API evidence carries `request.auth` (`none`, `bearer`, `basic`, `header:<name>`, never the value) and `request.isolated`.
  - `env.api.auth: { type: oauth-client-credentials }` is implemented: a `client_credentials` grant to `tokenUrl` (with `scope`/`audience` when set), sent as a bearer and cached per worker until 30 s before `expires_in`. A refused grant fails the call as `AUTH_FAILED` instead of sending it anonymous, and an auth type the client does not implement throws `NOT_SUPPORTED`. The `oauth-client-credentials` auth strategy's `token()` shares the implementation. Raw requests now resolve auth exactly like the client, which also makes `I use no authentication` apply to them (`null ?? env` used to fall back to the environment credential).
  - `retries.byTag` reaches the runner. Each entry becomes a sibling runner project with the same name that greps the tag and carries its retries; the base project excludes those tags, and a scenario with several such tags runs once with the highest count. `--retries` still overrides it, and a scenario's own `@retries:N` tag overrides both.

## 0.5.0

### Minor Changes

- f179b8e: Trace, video, parallelism and a setup tier are now configurable instead of hard-coded in the runner config.
  
  - `evidence: { trace, video, screenshot }` in `sdods.project.yaml`, overridable per key in `envs/<env>.yaml`, with `sdods run --trace <mode>` / `--video <mode>` and `SDODS_TRACE` / `SDODS_VIDEO` on top. Values are Playwright's modes and are validated. Defaults are unchanged (`on-first-retry`, `retain-on-failure`, `off`); with `retries.local: 0` the old default meant no trace locally, so `--trace on` is now the way to get one without forcing a retry.
  - `fullyParallel` (default `true`) per project and per process. `false` keeps the scenarios of a feature file in order.
  - `setup: { tags: '@setup' }` per project, or per process (`setup: false` to turn it off): each run target gets a `<target>--setup` companion that runs the matching scenarios first, in the same browser, and the target depends on it, so the rest of the run does not start when a probe or login fails. Setup scenarios ignore `--tags` and run once.
  - `parseRunnerProjectName` reads the new `<project>--<layer>[--<browser>]--setup` names as their real layer and browser with `phase: 'setup'`.
  - A config value that is invalid only after `${VAR}`, `SDODS_*` or CLI overrides now fails with a configuration error naming the path instead of a raw validation error.

## 0.4.0

## 0.3.2

## 0.3.1

### Patch Changes

- 77c4a03: `steps.core.exclude` — the migration path 0.3.0 should have shipped with.
  
  0.3.0 added ten step libraries at once. They share ONE step namespace with a
  project's own steps, and playwright-bdd fails generation outright when two
  definitions match the same text, so the upgrade broke every consumer that had
  already written those phrasings — before a single scenario ran, with
  `Multiple definitions matched scenario step`. The first repo to upgrade hit 67
  collisions, which is not a coincidence: the core libraries were modelled on the
  gaps that project documented.
  
  The only remedy was to rewrite all 67 in one commit, unverified, because the
  suite could not run until every one was gone.
  
      steps:
        core:
          exclude: [a11y, browser, dom, net, perf]
  
  excludes by file basename. With nothing excluded the pattern is byte-identical
  to what shipped before, so projects that never set it are unaffected. An unknown
  name throws `CONFIG_INVALID` listing what is available — a typo that silently
  excluded nothing would leave the author believing the collision was handled
  while generation still failed, pointing at the step rather than at the typo.

## 0.3.0
