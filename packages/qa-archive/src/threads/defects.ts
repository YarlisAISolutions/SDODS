import type { Thread } from '../types';

export const defectsThreads: Thread[] = [
  {
    slug: 'bug-analyze-invents-page-routes-from-pages-directories',
    title:
      'sdods analyze invented 18 page routes out of directories that happen to be called pages',
    askedBy: 'sergio-alcaraz',
    askedOn: '2026-01-14',
    tags: ['cli', 'config'],
    votes: 18,
    views: 3120,
    body: `We are App Router only. No \`pages/\` directory anywhere near the router. But:

\`\`\`bash
sdods analyze ../platform --report-only
\`\`\`

comes back with a routes table full of things that do not exist:

\`\`\`text
kind   method  path                        source              file
page   -       /{id}                       next-pages-router   app/api/intranet/pages/[id]/route.ts
page   -       /{id}/publish/route.test     next-pages-router   app/api/intranet/pages/[id]/publish/route.test.ts
page   -       /{id}/archive               next-pages-router   app/api/intranet/pages/[id]/archive/route.ts
\`\`\`

Eighteen of them. The same paths also appear correctly as \`api\` rows from the App Router
detector, so I get both the right row and the wrong one. Is my repo laid out badly or is this
the tool?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-01-14',
        votes: 26,
        body: `Your repo is fine. This is the Pages-Router detector.

Its path pattern is not anchored to the router root, so it matches a \`pages/\` segment
anywhere in the relative path — including \`app/api/intranet/pages/[id]/route.ts\`, where
"pages" is your own resource name. Three things then compound:

- the App Router branch already matched and emitted the correct row, and nothing arbitrates
  between the two, so you get both
- that branch has no test/spec exclusion (the Express one does), which is where
  \`route.test.ts\` becomes a route
- the path is sliced from the regex match rather than from the router root, so the parent
  segments are lost and \`/api/intranet/pages/[id]\` collapses to \`/{id}\`

There is an open issue for it and it is not fixed. What makes it bearable is that the failure
is completely predictable: every phantom row sits under a directory literally named \`pages\`.
On a repo with no such segment the detector is silent.

Workaround, and it is the whole workaround: keep using \`--report-only\`, drop the bad rows out
of the proposed \`routes:\` map, and only then \`--apply\`. If you have already applied, the map
is a plain block in \`projects/<slug>/sdods.project.yaml\` and deleting the rows costs nothing —
just do it before anyone writes a feature that navigates by one of those keys.

> [!NOTE]
> Do the same pass on \`modules:\`. A phantom route usually drags a phantom module in with it.`,
      },
      {
        id: 'a2',
        by: 'mkuiper',
        on: '2026-01-16',
        votes: 9,
        body: `Cheap way to know how bad it will be before you run anything:

\`\`\`bash
find . -type d -name pages -not -path '*/node_modules/*'
\`\`\`

Every hit that is not an actual Pages Router root is one to several bogus rows. We have a
\`pages\` resource too (a CMS) and it produced exactly the shape Reeta describes.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-analyze-scan-truncated-by-gitignored-worktrees',
    title: 'analyze stopped at 8000 files and most of them were gitignored worktrees',
    askedBy: 'bea-lindqvist',
    askedOn: '2026-01-22',
    tags: ['cli', 'config'],
    votes: 22,
    views: 4180,
    body: `\`sdods analyze .\` on our monorepo finishes but the checklist has \`scan-truncated\` on it,
and the report is nonsense: no CI provider, two modules, no test-id attribute. We have 48
workflow files and a test id on nearly every component.

The repo has \`.claude/worktrees/\` in \`.gitignore\`, with four checkouts under it. That is
where the file budget went, I assume, because \`.claude\` sorts before \`.github\`.

Is there a way to make the scan respect \`.gitignore\`?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2026-01-22',
        votes: 28,
        body: `No, and you have diagnosed it exactly. The scan has a static list of directories it skips.
It does not read \`.gitignore\` and it does not stop when it walks into a nested git root, so
each worktree is traversed in full. The walk is alphabetical, so \`.claude\` really does eat the
budget before \`.github\` is reached, and every absence-based finding after that
(\`no-ci\`, \`no-test-ids\`, \`no-openapi\`) is a confident false negative rather than a fact.

Open issue, not fixed. Two workarounds, both with a cost:

1. Scope the scan to the app package: \`sdods analyze apps/web --report-only\`. This completes.
   But at that depth there is no lockfile and no workspace root, so the package manager comes
   back \`unknown\`, and the base URLs get picked up from that package's own env files instead
   of the root ones — there is a separate open issue for each of those. You trade one wrong
   answer for two smaller ones.
2. Move the worktrees out of the tree for the duration of the analysis. Ugly, but the report
   is then honest, which matters because you are going to accept it into a project.

Whichever you pick, read the checklist first and treat \`scan-truncated\` as invalidating every
"we did not find X" line in the report.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2026-01-23',
        votes: 12,
        body: `Third option that avoids both costs: analyze a shallow clone.

\`\`\`bash
git clone --depth 1 <your-repo> /tmp/analyze-src
sdods analyze /tmp/analyze-src --report-only
\`\`\`

You get the real root (so the lockfile and the root env files are there) with none of the
untracked or ignored weight. It is what I do for any repo where I do not already know what is
sitting in the ignored directories.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-analyze-no-max-files-flag',
    title: 'Is there a flag to raise the analyze file budget? --max-files is not accepted',
    askedBy: 'koen-vermeulen',
    askedOn: '2026-01-29',
    tags: ['cli'],
    votes: 9,
    views: 1490,
    body: `The truncation warning tells me the scan hit its limit. Nothing in
[the analyze reference](https://docs.sdods.com/docs/reference/cli-commands/analyze/) looks like a
budget flag, and guessing does not help:

\`\`\`text
error: unknown option '--max-files'
\`\`\`

Same for \`--max-depth\`. Am I missing the flag name, or is there no way to raise it?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-01-29',
        votes: 14,
        body: `There is no flag. The budget is fixed at 8000 files and 12 levels of depth, and although
the scan options carry those fields internally, the CLI never passes anything through — so
there is nothing you can set from the command line or from config.

Open issue. Worth knowing before you go hunting for a workaround: raising the budget alone
would not be enough on a large monorepo anyway, and neither would teaching the walk to respect
\`.gitignore\` — a genuinely large repo exceeds 8000 tracked files on its own. Both have to
change together.

So today the only lever you have is the path you point it at. Analyze the app package rather
than the workspace root, or a shallow clone if the weight is untracked, and read
\`scan-truncated\` on the checklist as "the absence findings in this report are unsound".`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-analyze-emits-urls-from-gitignored-env-local',
    title: 'analyze put a URL out of my gitignored .env.local straight into the generated env yaml',
    askedBy: 'helle-borg',
    askedOn: '2026-02-05',
    tags: ['cli', 'config'],
    votes: 31,
    views: 5640,
    body: `Ran analyze on an app I had just been given, applied the proposal, opened the result and
found this in \`projects/portal/envs/local.yaml\`:

\`\`\`yaml
api:
  baseUrl: https://storage.googleapis.com/<a bucket I did not know about>
\`\`\`

That value is not in any tracked file. It is in \`.env.local\`, which is gitignored. I nearly
committed it. Analyze is documented as read-only, and I had assumed read-only also meant it
only read what is in source control. What exactly does it read, and how do I stop it?`,
    answers: [
      {
        id: 'a1',
        by: 'daniel-oyelaran',
        on: '2026-02-05',
        votes: 33,
        body: `Read-only means it does not write to your app. It does read every \`.env*\` file it finds at
up to two levels of depth, gitignored or not — \`.env.local\`, \`.env.<anything>\`, and the
\`.env.local.something-backup\` files people leave lying around.

The part that surprises everybody: the evidence snippet in the report is redacted for any file
that is not \`.env.example\`, but the detected base URLs are not redacted at all. They go into
the report, into the \`--report-only\` output, and into the generated \`envs/*.yaml\`. So the one
field most likely to name an internal host is the field that comes through in clear.

There is an open issue. There is no opt-out flag today, so this is what to do meanwhile:

- before analyzing, \`git status --ignored --short | grep '\\.env'\` so you know what is in
  scope
- always \`--report-only\` first and read the envs block, not just the module list
- if you have already applied, treat \`projects/<slug>/envs/\` as the thing to review before the
  first commit, and rewrite any \`baseUrl\` you do not recognise
- if the app is not yours, analyze a shallow clone — a fresh clone has no local env files in
  it at all, which sidesteps the whole thing

If a value has already been committed, rotate whatever it points at rather than just deleting
the line. It is a URL rather than a credential, so this is usually about internal hosts leaking
rather than access, but that judgement is yours to make and not mine.`,
      },
      {
        id: 'a2',
        by: 'rasha-halabi',
        on: '2026-02-06',
        votes: 11,
        body: `Adding one detail because it caught us: the backup files count.

Ours picked values out of \`.env.local.portal-backup\` — a file one person made months ago and
forgot. It is not in \`.gitignore\` by name, it is covered by a \`.env.*\` pattern, and it was
the oldest and least accurate of the three. So the URL that ended up in our project yaml was
not just untracked, it was stale.

Worth a \`ls -a | grep env\` in every app directory before you run analyze, not only the root.`,
      },
      {
        id: 'a3',
        by: 'sunita-kale',
        on: '2026-02-11',
        votes: 6,
        body: `We ended up adding a review step for this that costs nothing:

\`\`\`bash
grep -rn 'baseUrl' projects/<slug>/envs/
\`\`\`

right after \`--apply\`, before the first commit. Two lines per environment, and you either
recognise every host or you do not. It is not a fix and I would rather not need it, but it has
caught something twice now.`,
      },
    ],
  },

  {
    slug: 'bug-analyze-api-base-url-picks-wrong-env-var',
    title: 'The generated env yaml points api at our copilot host instead of our API',
    askedBy: 'nikhil-sane',
    askedOn: '2026-02-11',
    tags: ['cli', 'config', 'api'],
    votes: 14,
    views: 2210,
    body: `\`envs/staging.yaml\` came out with:

\`\`\`yaml
api:
  baseUrl: https://copilot.example.com
\`\`\`

That is a different service entirely. The correct value is in the same \`.env.example\` file
that analyze read:

\`\`\`text
line 40:  SIM_AGENT_API_URL=https://copilot.example.com
line 79:  NEXT_PUBLIC_API_URL=http://localhost:3000/api
\`\`\`

So it is not that it could not find the right one. It found both and chose the wrong one. Is
there a way to tell it which variable to trust?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-02-12',
        votes: 19,
        body: `No, and the reason it chose that one is not clever at all.

The env-var scan matches \`API_URL\` as a substring, so \`SIM_AGENT_API_URL\` is a candidate on
equal footing with \`NEXT_PUBLIC_API_URL\`. The base URL is then assigned first-wins in file
order. Line 40 beats line 79. Nothing ranks the canonical names above an arbitrary prefixed
one, and nothing tells you in the report that there was more than one candidate.

Open issue, no fix yet, and no override flag. The workaround is to correct
\`api.baseUrl\` in \`projects/<slug>/envs/<env>.yaml\` after applying — it is one line per
environment and the file is yours from then on, so this is a one-time cost rather than a
recurring one.

The thing to actually guard against is not noticing. Read the envs block in \`--report-only\`
before you apply, and if the app has more than one \`*_API_URL\` in its env files, assume the
guess is wrong until you have checked it.`,
      },
      {
        id: 'a2',
        by: 'sunita-kale',
        on: '2026-02-13',
        votes: 7,
        body: `Since it is first-wins by file order, moving \`NEXT_PUBLIC_API_URL\` above the others in
\`.env.example\` does make it win. We did that, it worked, and I still think it is a daft thing
to have to do to a file that other people read for other reasons — so if your \`.env.example\`
is grouped logically, I would take Reeta's one-line fix in the env yaml instead and leave the
app alone.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-express-detection-sets-api-base-equal-to-ui',
    title:
      'Every generated API scenario hits the UI origin — ui and api baseUrl came out identical',
    askedBy: 'yusuf-demir',
    askedOn: '2026-02-19',
    tags: ['cli', 'api', 'config'],
    votes: 12,
    views: 1980,
    body: `Fresh project from analyze. The starter \`@api\` features all fail with HTML where JSON
should be, and the reason is in the env file:

\`\`\`yaml
ui:
  baseUrl: http://localhost:3000
api:
  baseUrl: http://localhost:3000
\`\`\`

Our API is at \`/api\` on the same origin. I expected the \`/api\` suffix to be there. It is a
Next app; the only Express in the repo is a small socket server in another package.`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2026-02-19',
        votes: 17,
        body: `That socket server is the cause.

Environment detection checks whether any manifest in scope depends on \`express\`. If one does,
it runs a \`.listen()\` port heuristic to find the API origin, and when that heuristic finds
nothing usable it falls back to \`http://localhost:3000\` — which happens to be what \`ui\`
already is. Crucially, taking that branch skips the default that would otherwise have set
\`api\` to the UI base URL plus \`/api\`. So one unrelated package in the workspace changes the
answer for the whole proposal.

Open issue. The fix on your side is one line per environment:

\`\`\`yaml
api:
  baseUrl: http://localhost:3000/api
\`\`\`

Do it before you write features, because the failure is downstream and confusing — the request
succeeds, returns the app shell, and you get a JSON parse error or a schema mismatch rather
than anything that points at configuration.`,
      },
      {
        id: 'a2',
        by: 'mkuiper',
        on: '2026-02-20',
        votes: 6,
        body: `Quick check for anyone reading this later, run it right after \`--apply\`:

\`\`\`bash
grep -n 'baseUrl' projects/<slug>/envs/*.yaml
\`\`\`

If \`ui\` and \`api\` are byte-identical, you are in this bug. Ours was, and we have no Express
at all in the app — it came in through a dev dependency of a tool package.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-analyze-modules-named-after-http-verbs',
    title: 'analyze gave me modules called deploy, execute and status instead of workflows',
    askedBy: 'tanvi-bhatt',
    askedOn: '2026-02-26',
    tags: ['cli', 'config'],
    votes: 20,
    views: 3410,
    body: `Thirty modules on the proposal and twelve of them are verbs: \`status\`, \`delete\`,
\`export\`, \`send\`, \`run\`, \`update\`, \`upload\`, \`download\`, \`stats\`, \`validate\`,
\`versions\`, \`introspect\`.

They are all coming from route files like:

\`\`\`text
app/api/workflows/[id]/deploy/route.ts
app/api/workflows/[id]/execute/route.ts
\`\`\`

Both of those should obviously be \`workflows\`. Modules are what \`-m\` filters on and what the
features get organised under, so I do not want to accept this. Is there a setting?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2026-02-26',
        votes: 24,
        body: `No setting, and your reading of it is right.

When the route file's own basename is generic — \`route.ts\`, \`index.ts\` — module naming walks
up the directory tree and stops at the first directory whose name is not generic. In a
REST-shaped App Router tree the first such directory going up is the action segment, not the
resource. Hence \`deploy\` and \`execute\` as module names. There is an open issue; it is not
fixed.

What you can do today is read the module table before applying, because it tells you enough to
spot every bad row:

![sdods analyze printing the modules block: each module with a confidence score, the number of routes or endpoints, the winning signal and the source file it came from](/questions/analyze-modules.png "The module table prints the signal and source file that named each module")

The \`source-file\` signal at 0.70 is the one this bug lives in. Sort your eye down that column:
any module whose source file sits under an action segment
(\`.../<resource>/[id]/<verb>/route.ts\`) is misnamed, and the correct name is the resource
directory a level or two above it.

Then edit \`modules:\` in the proposal before \`--apply\`, or in
\`projects/<slug>/sdods.project.yaml\` straight after. Doing it early is much cheaper than doing
it later, because the module name is also the feature directory.`,
      },
      {
        id: 'a2',
        by: 'rasha-halabi',
        on: '2026-03-01',
        votes: 8,
        body: `Second-order annoyance worth mentioning: the verb modules also inflate the count, so the
proposal looks like it discovered more structure than it did. We came out with 30 modules for
what is genuinely about 14 domains, and \`-m\` filtering was useless until we merged them by
hand.

Merging is fine — you rename several entries to the same module and the routes collect under
it. Just budget an hour for it on a large app, and do it before anyone writes a feature.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-generated-route-keys-unreadable-in-feature-files',
    title: 'Route keys like pageid-edit-components-section-palette — do I have to type these?',
    askedBy: 'anouk-devries',
    askedOn: '2026-03-04',
    tags: ['cli', 'config'],
    votes: 11,
    views: 1740,
    body: `The generated \`routes:\` map is full of keys like

\`\`\`yaml
routes:
  id-publish-route-test: /api/intranet/pages/{id}/publish
  pageid-edit-components-section-palette: /pages/{pageId}/edit/components/{sectionId}/palette
  workspaceid-usage: /workspace/{workspaceId}/usage
\`\`\`

and the navigate step takes the key:

\`\`\`gherkin
When I navigate to the "pageid-edit-components-section-palette" page
\`\`\`

Nobody on my team is going to type that correctly twice. Can the key be something else?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-03-04',
        votes: 15,
        body: `Yes — rename them. The key is just a label; the path is the part that has to be right.

The generator builds the key by stripping braces and punctuation out of the whole path and
joining the remains with hyphens, which is why you get \`workspaceid-usage\` rather than
\`workspace-usage\`, and why the \`by-\` marker that is supposed to mark a parameter segment only
appears when the parameter is not the first segment. There is an open issue for it; nothing has
changed yet.

So after \`--apply\`, rewrite the left-hand side and leave the right-hand side alone:

\`\`\`yaml
routes:
  section-palette: /pages/{pageId}/edit/components/{sectionId}/palette
  workspace-usage: /workspace/{workspaceId}/usage
\`\`\`

Do it while the map is the only thing that references those keys. Once features exist, a rename
is a find-and-replace across every feature file, and \`sdods lint\` will not tell you that a
navigate step names a key that no longer exists in a way you will enjoy chasing.

While you are in there: \`id-publish-route-test\` is not a real route at all — that is the
Pages-Router detector firing on a directory called \`pages\` and picking up a test file. Delete
that row.`,
      },
      {
        id: 'a2',
        by: 'sunita-kale',
        on: '2026-03-05',
        votes: 6,
        body: `We make the rename pass part of accepting the proposal, same as tidying the module names.
Roughly: module name plus the last static segment, collision-suffixed if two collide. Takes
twenty minutes on a hundred routes and it is the difference between feature files people can
read and feature files people copy-paste from each other.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-i-use-no-authentication-still-sends-credentials',
    title: 'I use no authentication still sends the bearer token — my 401 assertion gets a 200',
    askedBy: 'gcastellano',
    askedOn: '2026-03-11',
    tags: ['api', 'config'],
    votes: 44,
    views: 7920,
    body: `Deny-direction scenario, as plain as it gets:

\`\`\`gherkin
@api @regression
Scenario: The admin list is refused to an anonymous caller
  Given I use no authentication
  When I send a GET request to "/admin/users"
  Then the response status should be 401
\`\`\`

\`\`\`text
Expected: 401
Received: 200
\`\`\`

The endpoint does deny anonymous callers — I checked with curl. Our \`envs/staging.yaml\` has:

\`\`\`yaml
api:
  auth: { type: bearer }
\`\`\`

and if I remove that block the scenario passes. So the step is not clearing anything. What is
\`I use no authentication\` supposed to do?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-03-11',
        votes: 51,
        body: `It is supposed to send the request anonymously. It does not.

The step clears the per-scenario auth by setting it to undefined, and the API client resolves
auth with \`??\` — which treats undefined as "nothing was specified" and falls straight through
to the environment's \`api.auth\`. So your request goes out with the bearer token on it, the
endpoint quite correctly answers 200, and the assertion fails. The step is a no-op whenever the
environment configures auth, which is exactly the case where you would want it.

There is an open issue for this and it is not fixed.

Two things you can do today. Neither is the step working:

1. Run the deny direction under an environment that has no \`api.auth\`. Copy \`staging.yaml\`
   to \`staging-anon.yaml\`, delete the \`auth\` block, and select it with \`-e staging-anon\`.
   Better still, wrap that in a named process in the project yaml so the invocation is one word
   and nobody has to remember the reason — see
   [processes](https://docs.sdods.com/docs/guides/processes-and-testing-types/).
2. If you cannot split the environment, assert on a rejected credential instead of no
   credential, and be honest in the scenario title about what you are testing:

\`\`\`gherkin
  Given I set the request header "authorization" to "Bearer not-a-real-token"
\`\`\`

That exercises the reject path. It is not the same test — it proves an invalid token is
refused, not that an absent one is — so do not let it quietly replace the anonymous case in
your coverage.

> [!WARNING]
> The scenarios to worry about are not the ones failing like yours. They are the ones asserting
> a success status after \`Given I use no authentication\` on an endpoint that is public anyway.
> Those pass, and they prove nothing.`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2026-03-12',
        votes: 22,
        body: `Adding the audit, because you almost certainly have more than one:

\`\`\`bash
grep -rn 'I use no authentication' projects/<slug>/features/
\`\`\`

Treat every hit as unverified. Split them into the ones that assert a denial — those fail
loudly, you already know about them — and the ones that assert anything else. The second group
is where the risk sits, and there is no signal on them at all.

We found eleven. Three were real deny-direction tests that had been quietly failing and were
excluded by tag "until someone looks at it". The other eight passed and always would have.`,
      },
      {
        id: 'a3',
        by: 'mkuiper',
        on: '2026-03-16',
        votes: 9,
        body: `Ours came at it from the other side, which is worth knowing about because it delays the
discovery by months.

Local has no \`api.auth\` — nothing to authenticate against — so on local the step genuinely
behaves anonymously and the scenarios pass honestly. It only broke when staging started
requiring an API key. So a suite can be green everywhere for a long time and then a change in
one environment's config turns a whole class of assertions inside out, and it will look like
staging broke.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-sso-strategy-silently-produces-no-session',
    title: 'strategy: sso gives me no session and no error — every scenario lands on /login',
    askedBy: 'fiona-mcallister',
    askedOn: '2026-03-17',
    tags: ['config', 'ui'],
    votes: 26,
    views: 4610,
    body: `We are behind an identity provider, so:

\`\`\`yaml
auth:
  strategy: sso
\`\`\`

Every \`@ui\` scenario now fails, but not with an auth error — with a pile of locator timeouts,
because the page is \`/login\` and none of the things the steps look for are on it.

\`sdods doctor\` is clean. Nothing in the run output mentions authentication at all. Where is
the error?`,
    answers: [
      {
        id: 'a1',
        by: 'daniel-oyelaran',
        on: '2026-03-17',
        votes: 30,
        body: `There is no error because the \`sso\` case is a stub. Its login function resolves to nothing:
no storage state written, and nothing thrown. You get a clean unauthenticated browser context
and the failure surfaces thirty seconds later as whatever locator was unlucky enough to be
first.

Open issue — the minimum fix is for it to raise an auth failure instead of returning quietly,
and that has not landed.

The path that does work is the interactive capture, which is what the
[auth guide](https://docs.sdods.com/docs/guides/auth-and-storage-state/) describes for \`sso\`:

\`\`\`bash
sdods auth capture -p <slug> -e staging --user standard --interactive
\`\`\`

That opens a codegen window, you complete the SSO round trip by hand, and it writes the storage
state that the fixture then applies to every scenario for that role. The config value does not
do this for you; you do it once per role and the runs reuse it.

So: keep \`strategy: sso\` for documentation if you like, but understand that the captured state
is the thing actually logging you in.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2026-03-18',
        votes: 13,
        body: `One consequence of the above that bites on a schedule rather than immediately.

The fixture re-captures \`form\` and \`token\` state by itself once it is older than
\`auth.maxAgeMinutes\`. It cannot re-capture \`sso\` state, because the capture is interactive by
definition. So a nightly will run fine for as long as your provider's session lives and then
start failing in exactly the way Fiona describes, with no message.

Give yourself a signal: a \`@smoke\` scenario per role that asserts on something only a
signed-in user sees, and put it first. Then a stale capture fails one obvious scenario instead
of two hundred obscure ones.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-token-strategy-gives-no-browser-session',
    title: 'token strategy authenticates my API calls but the browser is signed out',
    askedBy: 'devon-marsh',
    askedOn: '2026-03-24',
    tags: ['config', 'ui', 'api'],
    votes: 17,
    views: 2860,
    body: `\`auth.strategy: token\` with a working token. All the \`@api\` scenarios are green. Every
\`@ui\` scenario starts at the login page.

I assumed the token would be placed into the browser context too — that is what
"place it as a header, cookie or local-storage entry" reads like to me. Is there something else
I have to set for the browser side?`,
    answers: [
      {
        id: 'a1',
        by: 'daniel-oyelaran',
        on: '2026-03-24',
        votes: 21,
        body: `Nothing you can set. The \`token\` strategy writes no browser storage state — its login hook
resolves to nothing, same shape as the \`sso\` stub. Your API scenarios are green for an
unrelated reason: the API client picks up \`api.auth\` from the environment independently of the
auth strategy, so it never needed the strategy to work.

There is an open issue. Until it lands, treat the two layers as separately configured:

\`\`\`bash
sdods auth capture -p <slug> -e staging --user standard
\`\`\`

for the UI session (form login, or \`--interactive\` if a provider is involved), and keep the
token in \`api.auth\` for the API layer. Both can be true at once; they are just not wired to
each other.`,
      },
      {
        id: 'a2',
        by: 'rasha-halabi',
        on: '2026-03-26',
        votes: 8,
        body: `Same conclusion here. We ended up with \`strategy: form\` on the project, because that is the
strategy that actually produces a browser session, and the bearer token declared only under
\`api.auth\`. Reads slightly oddly in the yaml — the project claims form auth while half the
suite uses a token — so leave a comment next to it, or the next person will "tidy" it back.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-one-account-per-role-starves-parallel-workers',
    title:
      '335 of 390 scenarios failed at -w 4 with the user pool exhausted, and doctor is all green',
    askedBy: 'chandra-p',
    askedOn: '2026-04-02',
    tags: ['pool', 'data', 'ci'],
    votes: 52,
    views: 9840,
    body: `Full regression at four workers. 55 passed, 335 failed, and nearly all of the failures are
this:

\`\`\`text
SdodsError: All 1 user(s) with role "member" are leased.
  hint: Owners: {"member":"nightly-20260401:2"}.
        Increase env.users.poolSize, add users, or lower --workers.
Test timeout of 120000ms exceeded while running "beforeEach" hook.
\`\`\`

The passes are all scenarios that need no user, or need \`@user:admin\`, which nothing else was
competing for. About two thirds of our suite is \`@user:member\`.

We have one row per role in \`data/common/users.csv\`. I get that that is not many. What I do not
get is why nothing said so — this is the whole check output:

![sdods doctor printing a green checklist: node, bun, runner, three browsers, projects, per-project variable resolution and the database, every line a tick](/questions/doctor.png "doctor passes every check without ever comparing pool rows to worker count")

Is one row per role simply not supported, or have I misconfigured the pool?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2026-04-02',
        votes: 44,
        body: `Your pool is configured correctly. It is too small, and the thing that makes it fatal rather
than merely slow is that a lease is held per worker for the worker's whole lifetime, not per
scenario. One row means exactly one worker can ever run a \`@user:member\` scenario. The other
three wait out the lease timeout (30 s by default), throw, and because the throw happens inside
\`beforeEach\` the test then runs on to the 120 s test timeout.

So each starved scenario costs you up to 150 seconds and produces no information. That is why
your four-worker run was slower per test than a single-worker run would have been — fewer
workers is currently both faster and more correct.

There is an open issue covering the framework half of this, and it is not fixed. Two things it
asks for, so you know what is not going to save you today: the runner has every input it needs
before the first test to refuse to start when \`workers\` exceeds the rows available for a role
the selection uses, and it does not; and \`doctor\` does not compare rows-per-role against the
worker count, which is why your screenshot is green.

What to do now, in order of preference:

1. Seed at least as many accounts per role as you intend to run workers. \`member\` carries most
   of your suite, so start there. This is the real fix and it is on your side.
2. Until then pin \`-w 1\`. Put it in the invocation, not in someone's memory.

\`\`\`bash
sdods run -p <slug> -e staging -l ui -w 1 -t @regression
\`\`\`

And re-baseline afterwards. A run contaminated like this tells you almost nothing about the
product — every count you took from it is a count of the pool.`,
      },
      {
        id: 'a2',
        by: 'daniel-oyelaran',
        on: '2026-04-03',
        votes: 27,
        body: `Before you take this to CI, there is a second and worse version of it there.

If your nightly runs a browser matrix as parallel jobs, each job is a separate machine with its
own \`.sdods/leases\` directory. \`leaseStore: file\` is single-machine by design, and
\`leaseStore: db\` is declared in the schema but, as of this writing, has no implementation — the file pool
wins regardless. So three matrix jobs will lease the same real accounts at the same time,
happily, with no contention visible to any of them.

If those accounts are shared identities on a real staging system, that is not just noisy
results — two jobs mutating the same account's data will produce failures that are impossible
to reproduce.

Until the shared lease store exists: run the matrix on one runner, or give each browser its own
fixture identities, or accept single-browser nightlies. Also check your workflow actually pins
\`--workers\`; with no flag it inherits the runner default, which on a standard hosted runner is
enough to starve a one-row pool.`,
      },
      {
        id: 'a3',
        by: 'mkuiper',
        on: '2026-04-06',
        votes: 11,
        body: `Data point since it sounds counter-intuitive until you see it: we pinned \`-w 1\` on the
nightly and the wall-clock time went down, from a bit over two hours to about ninety minutes.
Four workers spent most of their lives asleep on a lease and then burning a test timeout.`,
      },
      {
        id: 'a4',
        by: 'ingrid-solberg',
        on: '2026-04-09',
        votes: 7,
        body: `One practical note on seeding: keep the pool rows in the dataset as \`\${TEST_*}\` references
rather than literals, and add the new identities to whatever provisioning script created the
first ones, with a verify mode. Otherwise you have four accounts that exist in a spreadsheet
and one that exists in the system, and the next person to hit this has a harder problem than
you did.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-api-layer-signs-in-per-scenario-and-hits-quota',
    title: '295 API scenarios fail with QUOTA_EXCEEDED: Exceeded quota for verifying passwords',
    askedBy: 'ade-oyinlola',
    askedOn: '2026-04-15',
    tags: ['api', 'pool', 'ci'],
    votes: 61,
    views: 11200,
    body: `Ran the API and hybrid layers, single worker, one browser. 1,152 tests. 295 of the
failures are this one message:

\`\`\`text
Error: Firebase sign-in failed for qa-member@example.com:
  QUOTA_EXCEEDED : Exceeded quota for verifying passwords.
\`\`\`

The credentials are fine. If I run any one of those scenarios on its own an hour later it
passes. The failures also start partway through the run rather than at the beginning, which is
what made me think it was a rate limit rather than a password.

Our project has a step that mints a session by calling the identity provider directly, because
an \`@api\` scenario cannot use the browser storage state. Is there a supported way to stop it
doing that once per scenario?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2026-04-15',
        votes: 48,
        body: `Not one that ships working today, no. You are going to have to cache it yourself, and the
good news is that it is a small change with a very large effect.

The shape of the problem: that step performs a fresh password sign-in for every scenario.
Identity Platform rate-limits password verification per project, so with several hundred
\`@api\` scenarios you are making several hundred verifications against one project from one IP
within a few minutes, and you exhaust the quota partway through. Everything after that fails at
sign-in, before any assertion runs. Because it is time-dependent it looks exactly like flake —
a scenario that fails at minute twenty passes alone — which is how this gets closed as "flaky"
and comes back.

An ID token from that endpoint is valid for an hour. Cache one per role, keyed the way the UI
auth cache is, with a TTL comfortably under the hour — 45 minutes matches the
\`auth.maxAgeMinutes\` the UI side already uses for the same reason. That turns several hundred
sign-ins into one per role.

Until you have it, keep API runs single-worker and single-browser so you are at least not
multiplying the rate, and be aware that a run in this state tells you almost nothing about your
API surface. The scenarios that passed are the ones that ran before the quota went.`,
      },
      {
        id: 'a2',
        by: 'daniel-oyelaran',
        on: '2026-04-16',
        votes: 31,
        body: `Worth knowing that the mechanism which should make Priya's answer unnecessary already ships,
and does nothing.

\`sdods auth capture\` writes a token file per role and index:

\`\`\`text
projects/<slug>/.auth/staging/owner-0.token.json
projects/<slug>/.auth/staging/admin-0.token.json
projects/<slug>/.auth/staging/member-0.token.json
\`\`\`

Those files are on your disk right now and they contain what the API layer needs. Nothing reads
them at runtime, and \`auth.tokenPlacement\` has no consumer either. That is the open issue —
the capture side is written, the consumption side is not — and it is why every project that
hits this ends up hand-rolling the cache instead of using the framework's own path.

So: build the cache, but build it so you can delete it later.`,
      },
      {
        id: 'a3',
        by: 'rasha-halabi',
        on: '2026-04-17',
        votes: 16,
        body: `Please also check what else lives on that identity project before you keep running into the
limit. Quota exhaustion is per project, not per caller — if anything real signs in against the
same project as your staging fixtures, your test suite can lock out actual people for the rest
of the window. We moved the fixtures onto their own project partly for that reason and partly so
the noise in the sign-in metrics stopped being ours.`,
      },
      {
        id: 'a4',
        by: 'sunita-kale',
        on: '2026-04-24',
        votes: 9,
        body: `Small addition to the cache: handle the failure as well as the success. Backoff-and-retry
specifically on \`QUOTA_EXCEEDED\` turns a cliff into a slope, so if the cache misses in a burst
(new role, expired TTL, whatever) you degrade instead of losing the rest of the run. Ten lines,
and it saved us a rerun the first week it existed.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-page-goto-on-authed-route-err-aborted',
    title: 'net::ERR_ABORTED on an authenticated route is our single biggest source of failures',
    askedBy: 'elsa-nyman',
    askedOn: '2026-04-23',
    tags: ['ui', 'page-objects'],
    votes: 47,
    views: 8730,
    body: `Top error signature in a clean single-worker run, by a wide margin:

\`\`\`text
page.goto: net::ERR_ABORTED at https://staging-app.example.com/workspace/<uuid>/home
\`\`\`

55 of the 192 failures I captured, plus a big pile of click timeouts that I am fairly sure are
downstream of it. The step behind it is a page-object method that deep-links the workspace:

\`\`\`ts
await this.page.goto(\`/workspace/\${workspaceId}/home\`, { waitUntil: 'domcontentloaded' });
await this.page.waitForURL(new RegExp(\`/workspace/\${workspaceId}\`), { timeout: 30_000 });
\`\`\`

It is intermittent — the same scenario passes on a rerun maybe a third of the time. Failure
screenshots are either a blank white page or the app frozen on "Loading session…". Our auth is
client-side.

Is \`waitUntil: 'domcontentloaded'\` the wrong wait here?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2026-04-23',
        votes: 41,
        body: `The wait is not the problem. The \`goto\` is.

Client-side auth attaches after the first authenticated route has loaded. Deep-linking an
internal route lands before that bootstrap has finished, the client sees no user yet and issues
a redirect to the login route, and the navigation you started is aborted by the one the client
started. \`ERR_ABORTED\` is the precise symptom of that, and your two screenshots are the two
halves of the race: blank if the abort came early, "Loading session…" if it came mid-bootstrap.

\`waitForURL\` cannot rescue it because it runs after \`goto\` resolves, and here \`goto\` is what
rejects. And a retry around the navigation would only hide it.

There is an open issue. Nothing has been fixed, but the fix on your side is a page-object
change and it is worth making now:

- make the first authenticated navigation the only \`goto\` — enter at the app root once, let
  the session attach
- reach the deep target the way a person does, through the switcher or the sidebar
- if you must keep a deep link somewhere, wait on a test id that only exists once the shell has
  rendered, not on \`domcontentloaded\`

\`\`\`ts
async openFixtureWorkspace(workspaceId: string) {
  if (!this.page.url().includes('/workspace')) {
    await this.page.goto('/workspace', { waitUntil: 'domcontentloaded' });
    await this.page.waitForURL(/\\/workspace/, { timeout: 30_000 });
  }
  await this.workspaceSwitcher.click();
  await this.page.getByTestId(\`workspace-option-\${workspaceId}\`).click();
  await this.page.waitForURL(new RegExp(\`/workspace/\${workspaceId}\`), { timeout: 30_000 });
}
\`\`\`

That needs a stable test id on the switcher options. If your app does not have one yet, that
request is the highest-value thing you can put in front of your developers this week.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2026-04-24',
        votes: 19,
        body: `When you do this, audit every \`page.goto\` on an authenticated path, not just the one in the
page object:

\`\`\`bash
grep -rn "page.goto('/workspace" projects/<slug>/steps/ projects/<slug>/pages/
\`\`\`

The ones inside step files are the easy ones to miss, and they are on the paths that hurt —
deep links into a builder or a settings surface. The single legitimate \`goto\` is the first
entry after login; everything else should be navigation.

Also worth a review rule, because a comment does not hold. We had this documented in the page
object itself, nine lines above the call that broke it.`,
      },
      {
        id: 'a3',
        by: 'ingrid-solberg',
        on: '2026-05-02',
        votes: 12,
        body: `We added a \`workspace-shell\` test id and waited on that instead of \`domcontentloaded\`, which
cut it a long way down but not to zero — the very first entry of the run still has to happen
somewhere, and that one is still a \`goto\`. Doing it once per worker in a fixture rather than
once per scenario is what got the last of it.

Also: do not re-baseline anything until this is fixed. Several hundred of our scenarios go
through that step, so the reported state of most UI modules was a report on this bug.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-env-tag-has-no-runtime-effect',
    title: 'My @env:local scenarios ran against staging — does @env: actually skip anything?',
    askedBy: 'lars-vinter',
    askedOn: '2026-05-06',
    tags: ['config', 'ci'],
    votes: 38,
    views: 6420,
    body: `The [tags table](https://docs.sdods.com/docs/guides/tags-and-suites/) says \`@env:<name>\`
"restricts a scenario to one environment", and \`sdods lint\` is happy with the tag. But:

\`\`\`bash
sdods run -p portal -e staging -t @regression
\`\`\`

ran all 41 of our \`@env:local\` scenarios against staging. Some of them create data. Nothing
warned, nothing skipped.

Am I holding it wrong, or does the tag do nothing?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-05-06',
        votes: 40,
        body: `It does nothing at run time. Lint validates that the name is one of \`envs.available\` and
that is the end of it — nothing consults the tag while selecting or running scenarios. Compare
\`@skip:<browser>\`, which really does skip; \`@env:\` looks like its sibling and is not.

Open issue. Until it is enforced, you have to do the exclusion yourself, in the tag expression:

\`\`\`bash
sdods run -p portal -e staging -t "@regression and not @env:local and not @env:prod-preview"
\`\`\`

The important part is not typing that once. It is making it impossible to forget: put the
expression in a named process in the project yaml and run the process, so the gate, the nightly
and the person debugging on a laptop all get the same selection. An expression that lives in
one person's shell history is the same amount of protection as no expression at all.`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2026-05-07',
        votes: 24,
        body: `The part of your message I would not move past: "some of them create data".

If you are relying on \`@env:\` to keep scenarios off a production-like environment, you are
relying on nothing. Add something structural underneath it:

\`\`\`yaml
users: {}
\`\`\`

in that environment's yaml. With no pool, any scenario reaching
\`I use a leased user with role "..."\` throws \`USER_POOL_EXHAUSTED\` instead of signing in. It
fails closed, which is the right direction.

Two caveats and both matter. It only protects scenarios that lease a user — an anonymous POST,
a public form submission, a webhook call is not stopped by an empty pool at all. And it is one
well-meaning edit away from being gone: somebody adds a single pool row for a legitimate reason
and every \`@user:\` scenario is armed against that environment silently. Put a comment on the
empty map saying why it is empty, and if you can, a CI assertion that it still is.`,
      },
      {
        id: 'a3',
        by: 'sunita-kale',
        on: '2026-05-12',
        votes: 9,
        body: `Worth counting yours before you decide how much this matters:

\`\`\`bash
grep -rho '@env:[a-z-]*' projects/<slug>/features/ | sort | uniq -c
\`\`\`

We assumed we had a handful and had sixty-odd, most of them added by people who reasonably
believed the tag was doing something. That number is also a decent argument to take to whoever
prioritises the fix.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-quarantined-scenario-still-fails-the-gate',
    title: 'I quarantined a flaky scenario and it still reds the gate',
    askedBy: 'renata-kohl',
    askedOn: '2026-05-13',
    tags: ['reporting', 'ci'],
    votes: 15,
    views: 2540,
    body: `Followed the [flaky triage](https://docs.sdods.com/docs/best-practices/flaky-triage/) advice
and quarantined the worst offender:

\`\`\`bash
sdods insights quarantine <fingerprint>
\`\`\`

It shows as quarantined on the dashboard. It also still fails the nightly, and the gate is still
red, which is the entire thing I was trying to avoid. Do I need to pass something to \`run\` for
the quarantine to be picked up?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-05-13',
        votes: 16,
        body: `There is nothing to pass. \`sdods run\` does not read the quarantine list — the flag is
recorded, insights and the dashboard show it, and the runner never consults it. So a
quarantined scenario runs exactly as before and counts exactly as before.

Open issue. What it needs is for the runner to read the quarantine state and skip or
soft-report those scenarios; that has not been written.

Meanwhile the only lever is tags. Keep the quarantine flag for the reporting (it is genuinely
useful on the dashboard) and add a \`@quarantine\` tag to the scenario as well, then run two
selections:

\`\`\`bash
sdods run -p <slug> -t "@regression and not @quarantine" --fail-on-flaky
sdods run -p <slug> -t "@quarantine" --no-ingest
\`\`\`

The first is the gate. The second keeps the quarantined scenarios executing so you still get
the flake signal and notice when one starts passing again.

I will be honest that this is not a good workaround. You now have two sources of truth for
which scenarios are quarantined, and they drift.`,
      },
      {
        id: 'a2',
        by: 'bea-lindqvist',
        on: '2026-05-14',
        votes: 7,
        body: `On the drift: put the exclusion in a named process rather than in each workflow, so the gate
and anyone running locally use the same expression. Ours drifted within a fortnight when it
lived in two workflow files — someone quarantined a scenario, added the tag, and only the
nightly had the exclusion.

It does not fix the two-sources problem, it just stops it multiplying.`,
      },
    ],
  },

  {
    slug: 'bug-no-since-flag-for-changed-tests',
    title: 'Every PR runs all 190 specs — is there a --since for sdods run?',
    askedBy: 'thom-vasseur',
    askedOn: '2026-05-21',
    tags: ['cli', 'ci', 'mcp'],
    votes: 19,
    views: 3280,
    body: `PR checks take 40 minutes because we run the whole suite on every push, and a typical PR
touches one module. I was expecting something like

\`\`\`bash
sdods run -p portal --since origin/main
\`\`\`

but that is not a flag. There is clearly change-impact analysis somewhere — is it reachable
from \`run\`?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2026-05-21',
        votes: 18,
        body: `It is not. \`sdods run\` has no \`--since\` and no equivalent. The analysis exists, but only as
the \`analyze_change_impact\` tool on the
[MCP server](https://docs.sdods.com/docs/reference/mcp-tools/) — and nothing feeds its output
back into the runner. Open issue; the ask is exactly your flag.

Two-step version that works today: call the tool from CI, take the modules or tags it reports,
and pass them to \`run\`:

\`\`\`bash
sdods run -p portal -m <module> -m <module> -t @regression
\`\`\`

That does cut the time. It just makes your CI job responsible for wiring together two things
that should be one.`,
      },
      {
        id: 'a2',
        by: 'mkuiper',
        on: '2026-05-22',
        votes: 11,
        body: `We do that, and the awkward part is not the plumbing, it is the fallback.

When the tool returns nothing — a change it cannot map, a config-only PR, a failure in the step
itself — you have to choose between running everything (and losing the saving on exactly the
changes you understand least) and running nothing. Get that branch wrong and you have a green
PR check that tested nothing, quietly, for weeks. Ours defaults to the full suite on an empty
result and shouts about it in the job summary.

If you build this, spend your care there rather than on the selection.`,
      },
    ],
  },

  {
    slug: 'bug-no-iframe-step-stripe-elements-unreachable',
    title: 'How do I fill a Stripe Elements card field from a feature file?',
    askedBy: 'owen-brackley',
    askedOn: '2026-05-28',
    tags: ['ui', 'page-objects'],
    votes: 24,
    views: 5120,
    body: `Checkout uses Elements, so the card number is inside an iframe. The obvious step does not
find it:

\`\`\`gherkin
When I fill the "Card number" field with "4242424242424242"
\`\`\`

\`\`\`text
Could not locate "Card number" field
\`\`\`

Which is fair enough — it is not in the main frame. I cannot find a frame step in
[the step library](https://docs.sdods.com/docs/reference/step-library/). Is there one under a
name I would not guess?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2026-05-28',
        votes: 27,
        body: `There is no iframe step. Every UI step in the shared library resolves against the scenario's
main frame, so from a feature file alone the Elements fields are unreachable. There is an open
issue proposing a set of frame and tab steps; none of it exists yet.

What does exist is the hook on the page object base class — \`frame(name)\` — so this is a page
object away rather than blocked:

\`\`\`ts
@When('I enter the test card')
async enterTestCard() {
  const card = this.frame('__privateStripeFrame');
  await card.getByPlaceholder('1234 1234 1234 1234').fill('4242424242424242');
}
\`\`\`

Expose one project step per meaningful action rather than a generic "switch to iframe" step —
\`I enter the test card\` reads better in the feature than three frame-switching lines, and when
the shared steps do arrive you replace the body and leave the feature files alone.

See [page objects](https://docs.sdods.com/docs/guides/page-objects/) for how the method binds
to the step.`,
      },
      {
        id: 'a2',
        by: 'sunita-kale',
        on: '2026-05-29',
        votes: 12,
        body: `One thing that surprised us: on Elements the number, expiry and CVC are separate iframes, so
if you were hoping for one \`switch to the payment iframe\` and then three fills, that is not the
shape of it. A single method that fills all three is much less annoying than three steps, and it
is also the only place you have to change when the provider reorganises its frames.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-no-download-step-for-export-surfaces',
    title: 'No step for downloads — how do I assert that an export produced a real CSV?',
    askedBy: 'kmoreau',
    askedOn: '2026-06-04',
    tags: ['ui', 'page-objects', 'reporting'],
    votes: 21,
    views: 4030,
    body: `We have about a dozen export buttons. The most I can assert from a feature file today is
that a toast appeared, which passed happily for two weeks while the export was returning an
empty file.

Is there a download step anywhere? I cannot find one in the step library.`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2026-06-04',
        votes: 23,
        body: `No download step ships. There is an open issue with a proposed set — filename, size, content
type, CSV row count — and none of it is written yet.

The base class gives you \`waitForDownload()\`, so a project step is short:

\`\`\`ts
@When('I export the current view as CSV')
async exportCsv() {
  const download = await this.waitForDownload(() =>
    this.page.getByRole('button', { name: 'Export' }).click(),
  );
  this.lastExport = await download.path();
  expect(download.suggestedFilename()).toContain('.csv');
}
\`\`\`

Then a \`Then\` step that reads the file and asserts on it.`,
      },
      {
        id: 'a2',
        by: 'rasha-halabi',
        on: '2026-06-05',
        votes: 14,
        body: `Given what you described — a toast that passed while the file was empty — please assert on
content and not just on the filename. A zero-byte \`report.csv\` satisfies every filename check
you can write.

Minimum useful pair: a byte size above some floor, and a row count that matches something you
know (the number of rows the UI was showing). The second one has caught genuine bugs for us
twice, both times a filter that applied on screen and not in the export.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-no-multi-tab-step-for-oauth-popup',
    title: 'OAuth consent opens a popup and my steps keep talking to the first tab',
    askedBy: 'vikram-r',
    askedOn: '2026-06-11',
    tags: ['ui', 'page-objects'],
    votes: 16,
    views: 2970,
    body: `Clicking "Connect account" opens the provider's consent screen in a new tab. Everything
after that in my scenario runs against the original tab, which is still sitting on the
integrations page, so I get a timeout on the consent button.

Is there a step to switch tabs? I could not find one.`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2026-06-11',
        votes: 18,
        body: `There is not — every UI step targets the scenario's page, and nothing in the shared library
changes what that is. It is an open issue with a proposed tab step set, unwritten.

\`waitForPopup()\` on the base class is the hook. The important detail is that you have to be
waiting before the click, or you race the popup:

\`\`\`ts
@When('I approve the connection in the provider window')
async approveConnection() {
  const popup = await this.waitForPopup(() =>
    this.page.getByRole('button', { name: 'Connect account' }).click(),
  );
  await popup.getByRole('button', { name: 'Allow' }).click();
  await popup.waitForEvent('close');
}
\`\`\`

Keep the whole popup interaction inside one project step. A step that leaves the scenario
pointing at a different tab than it started with is the kind of thing that makes the next
five steps in the feature file lie about where they are running.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-no-email-assertion-for-signup-verification',
    title: 'Signup verification email — is there any way to assert on an inbox?',
    askedBy: 'zeynep-arslan',
    askedOn: '2026-06-30',
    tags: ['ui', 'hybrid'],
    votes: 13,
    views: 2340,
    body: `Our signup funnel is: register, receive an email, click the link, land verified. I can test
the first step and the last step and nothing in between, so the coverage stops exactly where
the interesting failures are. Invitations and 2FA enrolment have the same shape.

Is there an inbox adapter or an email step I have missed?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2026-06-30',
        votes: 17,
        body: `Nothing ships. No mail adapter, no inbox steps. There is an open issue proposing a Mailpit
adapter and a set of inbox assertions; it has not been built.

The workaround I would push you towards is not "wait for the framework" — it is to stop routing
the test through the mailbox at all where you can:

- if the verification token is readable from an API or from the database that issued it, read
  it there and drive the link directly. You keep the assertion that matters (the link works,
  the account ends up verified) and lose only the assertion that mail was delivered, which is
  your provider's job more than yours.
- keep one scenario that does go through a real inbox, so delivery is covered somewhere, and
  accept that it is the slow one.

If you genuinely have no such surface, run Mailpit in your test environment and write project
steps against its HTTP API. That is exactly what the proposed adapter would do — you are
writing it yourself a bit earlier, and it is maybe fifty lines.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-no-database-assertion-step',
    title: 'The UI says saved and no row is written — how do I assert on the database?',
    askedBy: 'hsu-wei-lin',
    askedOn: '2026-07-08',
    tags: ['data', 'hybrid'],
    votes: 29,
    views: 5480,
    body: `We keep getting the same class of bug: the form submits, the toast says saved, the UI shows
the new item from local state, and nothing was persisted. It survives every UI assertion we have
because the UI is not lying about what it believes.

I can see there is a database configured for SDODS itself. Is there a step to assert against
our application's database from a scenario?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2026-07-08',
        votes: 26,
        body: `No database assertion steps in the shared library. There is an open issue with the step set
designed — row counts, column values, capture-a-value-into-a-variable — and none of it is
written.

The fixture is there though, so project steps over it are small. What you want is roughly:

\`\`\`gherkin
Then the table "items" should have 1 rows where "name" is "{{itemName}}"
Then the column "status" of the row in "items" where "id" is "{{itemId}}" should equal "active"
\`\`\`

Write those two and you have covered the whole silent-success class, which is what you actually
came for.

One design note while you are writing them: make the "where" a single indexed column rather
than allowing arbitrary SQL through the step. A step that takes a fragment of SQL is a step
nobody can review in a feature file.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2026-07-09',
        votes: 15,
        body: `Before you write those, check whether an API read gets you the same assertion. If there is a
\`GET\` that returns the thing you just created, that is the far-side check, and it costs you
nothing in coupling:

\`\`\`gherkin
When I send a GET request to "/items/{{itemId}}"
Then the response status should be 200
Then the response JSON path "status" should equal "active"
\`\`\`

A database assertion binds your suite to the schema, so every migration becomes a test change.
Worth it for things with no API surface — audit rows, side-effect tables, soft deletes — and
not worth it for anything you can read back through the product.`,
      },
      {
        id: 'a3',
        by: 'sunita-kale',
        on: '2026-07-14',
        votes: 8,
        body: `If you do go direct, add the cleanup at the same time and not later. \`I register cleanup\`
handles it where the API can delete the thing:

\`\`\`gherkin
When I register cleanup DELETE "/items/{{itemId}}"
\`\`\`

We wrote the assertions first and the cleanup "next sprint", and spent a fortnight with a
staging database full of test rows that then broke the row-count assertions we had just added.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-no-canvas-drag-and-graph-steps',
    title: 'How do you test a node-graph editor — blocks, edges and connection handles?',
    askedBy: 'nadia-belkacem',
    askedOn: '2026-07-23',
    tags: ['ui', 'locators', 'page-objects'],
    votes: 18,
    views: 3260,
    body: `Half our product is a workflow builder: a canvas with about 190 block types, edges between
them, and connection handles on each node. None of it is text or roles — the nodes carry
\`data-nodeid\` and the handles are \`.react-flow__handle[data-handleid]\`.

Nothing in the step library moves anything, so the most I can express is clicking. Has anyone
got a shape for this that is not "one custom step per interaction"?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2026-07-23',
        votes: 19,
        body: `There are no canvas, drag or graph steps, and there is an open issue proposing a set of them
— drag onto, connect handle to handle, select node, assert node and edge counts. Not written.

What you get for free today is more than it looks like, because on most builders adding a block
is a click rather than a drag:

\`\`\`gherkin
When I click the element with test id "toolbar-block-http-request"
\`\`\`

If your palette has test ids, that covers create. What genuinely needs project steps is edges
and handles, and that is where I would spend the effort:

\`\`\`ts
@When('I connect {string} to {string}')
async connect(from: string, to: string) {
  const source = this.page.locator(\`[data-nodeid="\${from}"] .react-flow__handle[data-handleid="source"]\`);
  const target = this.page.locator(\`[data-nodeid="\${to}"] .react-flow__handle[data-handleid="target"]\`);
  await source.dragTo(target);
}
\`\`\`

Two more things worth knowing. Ask for a test id on the node wrapper rather than relying on
\`data-nodeid\` alone if the id is generated per run — otherwise your scenarios need the id
threaded through from wherever the node was created. And keep assertions on the model where you
can (node count, an edge exists between two named nodes) rather than on pixels; a canvas is the
one surface where a visual baseline will punish you for a two-pixel layout change forever.`,
      },
      {
        id: 'a2',
        by: 'ingrid-solberg',
        on: '2026-07-27',
        votes: 9,
        body: `We landed on about nine project steps for the whole builder and it has been stable. The one I
would add to Tomas's list is a settle assertion — after a connect, wait for the edge to exist in
the DOM before the next step, or you get a lovely class of failures where the drag succeeded and
the next click happened mid-animation.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'bug-no-per-scenario-locale-or-theme',
    title: 'Six locales times dark and light means twelve env files — is there a per-scenario way?',
    askedBy: 'paulo-mendes',
    askedOn: '2026-08-11',
    tags: ['ui', 'config'],
    votes: 4,
    views: 118,
    body: `We ship in six locales and both colour schemes. As far as I can tell the locale and the
colour scheme are properties of the environment, so covering the matrix means twelve
\`envs/*.yaml\` files that differ in two lines each, and twelve run invocations.

That cannot be the intended shape. Is there a tag or a step that sets locale or colour scheme
per scenario, so I can keep two env files and tag the handful of scenarios that actually care?
Something like \`@locale:fr\` or \`@theme:dark\`.`,
    answers: [],
  },

  {
    slug: 'bug-no-sse-or-streaming-assertions',
    title: 'Our streaming endpoint returns 200 and then dies mid-stream, and nothing catches it',
    askedBy: 'petrov-k',
    askedOn: '2026-09-02',
    tags: ['api', 'hybrid'],
    votes: 3,
    views: 74,
    body: `The API steps assert on a completed response, which is fine until the response is a stream.
Ours opens with a 200, sends a few events and then fails halfway — and

\`\`\`gherkin
Then the response status should be 200
\`\`\`

is perfectly happy with that, because the status was genuinely 200. The failure is in the
middle and nothing in the step library can see it.

Has anyone assembled something for server-sent events? What I think I need is an assertion that
the stream closed cleanly and one that no error event arrived, and I would rather not invent the
vocabulary if someone has already settled on one.`,
    answers: [],
  },
];
