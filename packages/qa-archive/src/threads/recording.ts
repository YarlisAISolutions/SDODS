import type { Thread } from '../types';

export const recordingThreads: Thread[] = [
  {
    slug: 'rec-codegen-exit-1-no-spec-on-build-agent',
    title: 'sdods record on our Linux build agent: codegen exited with code 1 and produced no spec',
    askedBy: 'avery-hollis',
    askedOn: '2021-11-08',
    tags: ['recording', 'ci', 'cli'],
    votes: 44,
    views: 16210,
    body: `We moved recording onto the same Linux build agent that runs the nightly suite so nobody has to
install browsers locally. It dies before a browser ever appears.

\`\`\`bash
sdods record -p demo-shop -e staging --name checkout --user standard
\`\`\`

\`\`\`text
✖ RUN_FAILED: playwright codegen exited with code 1 and produced no spec.
  hint: Codegen needs a display. On a headless machine, record on your workstation or import an existing spec into recorded/.
\`\`\`

\`sdods run -p demo-shop -e staging -l ui -b chromium\` passes on that same agent, so the browsers
are installed. Is there a headless recording mode, or a flag I have missed?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2021-11-08',
        votes: 61,
        body: `There is no headless recording mode and there will not be one. \`sdods record\` shells out to
\`playwright codegen\`, which opens two windows: the browser you drive and the inspector that writes
the code as you click. Running a suite headless is fine because the run has nothing to show.
Recording is the opposite — the window is the whole feature.

The exit code is the tell. Codegen came up, could not open a display, exited 1 and never wrote the
output file, so SDODS has nothing to post-process and says so rather than leaving you a half spec.

Two things that do work.

Record on a workstation and commit the spec. It travels: post-processing rewrites absolute URLs on
the environment origin into relative paths, so a flow recorded against local runs against staging.

Or import a spec you already have. Put it under \`projects/demo-shop/recorded/\` and give it the
three things post-processing would have added — the fixtures import, relative routes, and the
describe wrapper with the tags:

\`\`\`ts
import { expect, test } from '@sdods/core/test';

test.describe('checkout', { tag: ['@recorded', '@ui', '@regression'] }, () => {
  test('checkout', async ({ page }) => {
    await page.goto('/inventory.html');
    // ...
  });
});
\`\`\`

Then the agent runs it like anything else:

\`\`\`bash
sdods run -p demo-shop -e staging -l recorded -b chromium
\`\`\`

\`recorded\` is a real layer next to ui, api and hybrid — demo-shop declares all four — so it shards,
retries and reports exactly like the rest.`,
      },
      {
        id: 'a2',
        by: 'tobi-schrader',
        on: '2021-11-09',
        votes: 17,
        body: `Worth adding because it is the next thing you will try: hosting the web UI on that agent does not
get you around it either. The Recorder page spawns \`sdods record\` on the server, so the display it
needs is the server's, not your laptop's. The page says so under its own title.

What you can move between machines is the login, not the session. \`sdods auth capture\` writes
\`projects/demo-shop/.auth/staging/standard-0.json\` and the recorder loads it, so you record locally
and still start signed in as a pool user.`,
      },
      {
        id: 'a3',
        by: 'mkuiper',
        on: '2021-11-12',
        votes: 6,
        body: `We spent an afternoon on the virtual-framebuffer route before admitting defeat. You can get the
inspector to start that way, and then there is nobody sitting in front of it to click through the
flow, which is the actual constraint. Recording is a human activity.

Where we landed: recordings are made locally and reviewed like any other code, and CI only ever runs
\`-l recorded\`.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'rec-record-a-flow-that-needs-login-first',
    title: 'How do I record a checkout when the app needs me logged in first?',
    askedBy: 'kmoreau',
    askedOn: '2022-03-02',
    tags: ['recording', 'ui', 'cli'],
    votes: 26,
    views: 9140,
    body: `Every recording I make starts on the login page, so the first stretch of the spec is me typing a
username and a password. Worse, when I re-record after a change the login part churns too and the
diff tells me nothing about the bit I actually changed.

\`\`\`bash
sdods record -p demo-shop -e staging --name checkout
\`\`\`

Is there a way to have the recorder open on an already signed-in session?`,
    answers: [
      {
        id: 'a1',
        by: 'gcastellano',
        on: '2022-03-04',
        votes: 33,
        body: `\`--user <role>\`. It takes the first pool user of that role, makes sure there is a fresh storage
state for it, and hands that state to codegen, so the browser opens signed in.

\`\`\`bash
sdods record -p demo-shop -e staging --name checkout --user standard
\`\`\`

The first time you will watch it log in for you before the window appears:

\`\`\`text
no fresh login state for standard_user; capturing…
recording checkout · project demo-shop · env staging · user standard_user (standard)
\`\`\`

After that the state is cached at \`projects/demo-shop/.auth/staging/standard-0.json\` and reused
until it ages past \`auth.maxAgeMinutes\`.

Two things to know. The role has to exist in the user pool dataset, or you get
\`USER_POOL_EXHAUSTED\` with the roles that are actually present listed in the hint. And if the
capture fails, recording does not stop — it warns and carries on logged out:

\`\`\`text
⚠ could not capture login state (strategy returned no storage state); recording without it
\`\`\`

which is worth reading, because otherwise you record the login page again and wonder why the spec
looks the same as last time.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'rec-auth-strategy-custom-needs-auth-export',
    title: 'record --user stops with: auth.strategy "custom" needs an auth export',
    askedBy: 'sunita-kale',
    askedOn: '2022-09-30',
    tags: ['recording', 'config', 'cli'],
    votes: 18,
    views: 6820,
    body: `Our login is bespoke, so the project yaml says:

\`\`\`yaml
auth:
  strategy: custom
  storageState: true
\`\`\`

And every recording with a role stops immediately:

\`\`\`text
✖ CONFIG_INVALID: auth.strategy "custom" needs an \`auth\` export in projects/demo-shop/steps/auth.ts.
  hint: export const auth = defineAuth({ strategy: 'custom', login: async ({ page, user }) => { ... } })
\`\`\`

The file is right there. What is it actually looking for?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2022-09-30',
        votes: 24,
        body: `The export, not the file. SDODS looks for \`steps/auth.ts\`, \`steps/auth.js\` or \`auth.ts\` under
the project root, imports whichever it finds first, and takes the \`auth\` named export or the default
export — but only accepts it if it has a \`login\` function on it. A module that exports a plain config
object, or exports the class instead of an instance, does not match, and you fall through to the yaml
strategy. For \`custom\` there is nothing to fall through to, hence the error.

So the fix is usually one line in that file. A full example:

\`\`\`ts
import { defineAuth } from '@sdods/core/auth';

export const auth = defineAuth({
  strategy: 'custom',
  async login({ browser, config, user }) {
    const context = await browser.newContext({ baseURL: config.env.ui.baseUrl });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByLabel('Username').fill(user.username);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL('**/inventory.html');
    return context;
  },
});
\`\`\`

Return the context and stop there — SDODS saves the storage state off it and closes it. Once that
resolves, \`--user\` works for the recorder and for the runner, because both read the same cached
file.

Credentials come off the pool row on \`user\`, so nothing in that file is a literal.`,
      },
      {
        id: 'a2',
        by: 'tobi-schrader',
        on: '2022-10-03',
        votes: 9,
        body: `One thing to check before you write any of that: if your login is interactive — a second factor, a
consent screen, anything a script cannot get through — you do not want \`custom\` at all. Declare
\`sso\` and capture the state with a person in the loop:

\`\`\`bash
sdods auth capture -p demo-shop -e staging -u standard --interactive
\`\`\`

That opens codegen, waits for you to finish the login, and saves the storage state.

Rough rule: \`custom\` is for logins you can automate, \`sso\` is for the ones you cannot.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'rec-cached-login-state-says-fresh-but-is-not',
    title: 'auth list says the cached state is fresh but the recording opens logged out',
    askedBy: 'renata-kohl',
    askedOn: '2023-04-11',
    tags: ['recording', 'config', 'data'],
    votes: 29,
    views: 10420,
    body: `Starting a recording with \`--user standard\` drops me on the sign-in page, but the cache insists it
has a good state:

\`\`\`bash
sdods auth list -p rwa-bank -e local
\`\`\`

![sdods auth list showing two cached standard-role states, eighteen minutes old and both marked fresh](/questions/auth-list.png "Both states are well inside auth.maxAgeMinutes, so SDODS calls them fresh")

Eighteen minutes old, and we never touched \`auth.maxAgeMinutes\`, so that is well inside the default
hour. The server clearly disagrees. What decides "fresh"?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2023-04-11',
        votes: 38,
        body: `Two independent checks decide it, and only one of them is the clock.

- the sidecar beside the state file has to say the capture happened less than \`auth.maxAgeMinutes\` ago, which defaults to 60
- the state file itself has to still contain something usable — a cookie whose expiry has not passed, or a localStorage entry

The second check drops expired cookies as it reads them. If the login was cookie-based and every
cookie has expired, the state counts as stale even when unrelated localStorage entries survive, and
it gets recaptured. That part does what you want.

The case you are in is the other one. A session cookie has no expiry — it comes back as \`-1\` in the
storage state — so there is nothing for that check to compare against and it is always kept. The
server can have dropped the session thirty seconds after capture and the file still reads as valid.
SDODS calls it fresh, hands it to codegen, and the app bounces you to sign-in.

So stop trusting the clock for that app. Recapture now:

\`\`\`bash
sdods auth capture -p rwa-bank -e local -u standard --all --force
\`\`\`

and put \`auth.maxAgeMinutes\` under the server's own session timeout in \`sdods.project.yaml\`. Ten
is not a silly number for a demo backend.`,
      },
      {
        id: 'a2',
        by: 'ade-oyinlola',
        on: '2023-04-12',
        votes: 11,
        body: `Also check you are capturing every user of the role and not just the first. The index in
\`<role>-<n>.json\` is the position within the role, and \`sdods auth capture\` defaults to
\`--index 0\`, so a pool of four with one capture leaves three files missing or stale. \`--all\` does
the lot.

Recording only ever uses the first user of the role, so this bites on the run rather than on the
recorder — a scenario that leases \`standard-2\` pays for a fresh login mid-suite.`,
      },
      {
        id: 'a3',
        by: 'mkuiper',
        on: '2023-04-18',
        votes: 4,
        body: `Small thing that surprised us on the same trail: \`.auth/\` is gitignored, so a clean CI checkout has
none of it and the first run of the day pays for the capture. Nothing is wrong, but the extra minute
shows up in the timings and somebody will ask.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'rec-capture-login-once-and-reuse-it',
    title:
      'Does every scenario log in separately, or is there one place the login state comes from?',
    askedBy: 'chandra-p',
    askedOn: '2023-09-19',
    tags: ['recording', 'config', 'cli'],
    votes: 21,
    views: 7960,
    body: `Trying to work out how much of our suite time is logging in. We have thirty-odd UI scenarios tagged
\`@user:standard\`, plus somebody recording a flow most mornings. Do those all log in independently,
or is there a single cached thing they share?`,
    answers: [
      {
        id: 'a1',
        by: 'thom-vasseur',
        on: '2023-09-19',
        votes: 8,
        body: `Shared. One file per pool user per environment, and both the runner and the recorder read the same
file — that is why \`sdods record --user standard\` opens signed in without you doing anything.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2023-09-21',
        votes: 27,
        body: `To put numbers on it: one login per pool user per environment, not one per scenario.

\`\`\`text
projects/demo-shop/.auth/staging/standard-0.json
projects/demo-shop/.auth/staging/standard-1.json
\`\`\`

A scenario tagged \`@user:standard\` leases a user, the fixture checks whether that user's file is
fresh, logs in once in a throwaway context if it is not, and starts the browser context from the
state. Thirty scenarios sharing one leased user share one login. The index in the filename is the
position within the role.

Prime it yourself if you would rather pay up front and see the cost:

\`\`\`bash
sdods auth capture -p demo-shop -e staging -u standard --all
sdods auth list -p demo-shop -e staging
\`\`\`

One thing to be aware of rather than to work around: there are two code paths producing these files
today — \`sdods auth capture\`, which works from dataset rows, and the library \`captureAuth()\` that
\`sdods record --user\` calls. They write the same files to the same place, so nothing is broken, but
they are two implementations of one idea. Consolidation is scheduled and it has not happened, so if
you go reading the source do not expect one path. It is written down under
[known limitations](https://docs.sdods.com/docs/reference/known-limitations/).`,
      },
      {
        id: 'a3',
        by: 'gcastellano',
        on: '2023-10-02',
        votes: 6,
        body: `Adding the boring operational half: \`.auth/\` is gitignored and should stay that way. Those files are
live sessions — anyone who gets one is signed in as that user until it expires.

If you want a teammate to be able to record without hunting for credentials, the answer is to give
them the pool dataset and let capture do its thing, not to hand them a state file. Passwords in the
dataset reference environment variables, never literals.

[Auth strategies and storage state](https://docs.sdods.com/docs/guides/auth-and-storage-state/) has
the table of which strategy produces state how.`,
      },
    ],
    acceptedAnswerId: 'a2',
  },
  {
    slug: 'rec-recorded-spec-is-all-css-locators',
    title:
      'Recorded spec is all .btn_primary and nth-child — fix the locators before or after converting?',
    askedBy: 'nikhil-sane',
    askedOn: '2024-02-27',
    tags: ['recording', 'locators', 'page-objects'],
    votes: 35,
    views: 11930,
    body: `Recorded a checkout. The spec is mostly this:

\`\`\`ts
await page.locator('.inventory_item:nth-child(3) > .pricebar > .btn_primary').click();
await page.locator('#checkout').click();
\`\`\`

Each of those came back with a \`// sdods:fragile\` comment above it, and the CLI finished with

\`\`\`text
⚠ 12 CSS/XPath locator(s) marked // sdods:fragile — prefer role/label/test-id locators.
\`\`\`

I would rather not convert this into a feature and inherit twelve selectors that break next sprint.
What is the right order of operations?`,
    answers: [
      {
        id: 'a1',
        by: 'thom-vasseur',
        on: '2024-02-27',
        votes: 31,
        body: `Fix them in the spec, then convert. Conversion reads the spec you hand it — whatever locators are in
there end up in the page object the generator proposes, fragile comments and all. There is no pass in
between that cleans them up for you.

Before you touch anything by hand, check \`testIdAttribute\` in \`sdods.project.yaml\`. Codegen is
started with \`--test-id-attribute\` taken from it, so if your app has test ids and the project does
not name the attribute, codegen has no idea they are ids and falls back to CSS. demo-shop sets

\`\`\`yaml
testIdAttribute: data-test
\`\`\`

which is the only reason its recordings come out with \`getByTestId\` and yours do not.

Then re-record instead of editing forty lines. The fragile marker is a line heuristic — anything
starting \`#\`, \`.\`, \`[\`, \`//\`, \`xpath=\` or \`css=\` — so once the locators are role or test-id
based the count in that warning drops to zero and you know you are finished without reading the diff.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2024-02-28',
        votes: 22,
        body: `The priority, in order: role plus accessible name, then label, then the project's test id, then
placeholder, then text, then CSS. XPath never.

Where a CSS locator is genuinely the only handle the markup gives you, do not leave it bare. Put it
in a page object and give the healer somewhere to go:

\`\`\`ts
readonly title = this.heal.locator(this.page.locator('.title'), {
  text: 'Products',
  description: 'page title',
});
\`\`\`

The primary stays the one you believe in; alternatives are only probed when it fails, and you are
told which one won. A recorded \`.btn_primary\` with no context is a locator with no fallback, and
that is the real problem — not the CSS itself.

[Self-healing locators](https://docs.sdods.com/docs/guides/self-healing/) covers what goes in the
context object.`,
      },
      {
        id: 'a3',
        by: 'bea-lindqvist',
        on: '2024-03-04',
        votes: 7,
        body: `Cheap trick that worked on our frontend team: record the flow twice, once against the app as it is
and once against a branch with \`data-test\` attributes on the four components you care about, and put
the two specs side by side. It is a much shorter conversation than a paragraph about locator
stability.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'rec-device-flag-ignores-viewport',
    title: 'Recording with --device "iPhone 15" silently ignores my --viewport',
    askedBy: 'fiona-mcallister',
    askedOn: '2024-06-05',
    tags: ['recording', 'ui', 'cli'],
    votes: 14,
    views: 5310,
    body: `\`\`\`bash
sdods record -p demo-shop -e staging --name checkout-mobile --device "iPhone 15" --viewport 390x900
\`\`\`

The session came up at the iPhone's own size, not 390x900. No warning, no note in the header comment,
it just ignored the flag. Bug, or intended?`,
    answers: [
      {
        id: 'a1',
        by: 'thom-vasseur',
        on: '2024-06-05',
        votes: 16,
        body: `Intended, and spelled out on the flag itself — \`--viewport <WxH>\` is documented as "ignored with
--device".

A device profile is not only a size: it carries the viewport, the user agent, the device scale factor
and whether touch is emulated. Letting a separate \`--viewport\` override half of it would hand you a
context that matches no real phone, which is worse than either option on its own.

So pick one. \`--device "iPhone 15"\` for a real profile, \`--viewport 390x900\` for an arbitrary
window in a desktop browser. With neither, the recorder falls back to the project's screenshot
viewport from \`sdods.project.yaml\` — 1280x720 in demo-shop.

Play it back the same way you recorded it, or the spec is exercising a different device than it was
written against:

\`\`\`bash
sdods run -p demo-shop -e staging -l recorded --device "iPhone 15"
\`\`\``,
      },
      {
        id: 'a2',
        by: 'tobi-schrader',
        on: '2024-06-07',
        votes: 6,
        body: `Quoting matters more than people expect here. \`--device "iPhone 15"\` with the quotes; without them
the shell splits it and \`15\` arrives as a separate argument, so the flag never sees the name you
meant. Whatever it fails with, it will not be a message about quoting.

If all you want is a mobile browser in the run matrix rather than a specific handset, \`-b
mobile-chrome\` and \`-b mobile-safari\` are browsers you can pass to \`sdods run\` directly and they
compose with the rest of the matrix.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'rec-save-har-during-a-recording',
    title: 'Can one session give me both the recorded spec and a HAR for offline replay?',
    askedBy: 'bruno-teixeira',
    askedOn: '2024-11-14',
    tags: ['recording', 'har'],
    votes: 17,
    views: 6240,
    body: `I want the network traffic from a recording session so we can replay the flow offline in CI later.
Do I record the flow, then do a second pass for the HAR, or is there a way to get both out of one
sitting? Doing it twice means the two artefacts are of two slightly different journeys, which feels
like it will bite us.`,
    answers: [
      {
        id: 'a1',
        by: 'gcastellano',
        on: '2024-11-15',
        votes: 21,
        body: `One session. \`--save-har\` captures the network while you drive:

\`\`\`bash
sdods record -p demo-shop -e staging --name checkout --user standard --save-har --har-glob "**/api/**"
\`\`\`

Three files come out of that:

\`\`\`text
projects/demo-shop/recorded/checkout.spec.ts
projects/demo-shop/har/staging/checkout.har
projects/demo-shop/har/staging/checkout.har.json
\`\`\`

The \`.har.json\` is the sidecar: the URL glob you used, when it was captured, and \`source: codegen\`
so you can tell it apart from a HAR produced by a run. \`--har-glob\` defaults to \`**/*\`, which on a
real app means fonts, images and analytics beacons all land in the file, so narrowing it is usually
right.

One naming detail: the name is slugified for both files. \`--name "Checkout Flow"\` gives you
\`checkout-flow.spec.ts\` and \`checkout-flow.har\`, not what you typed, so pick something you would
have typed anyway.`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2024-11-15',
        votes: 15,
        body: `Capturing it is half the job — replay is keyed on the scenario tag, not on the recording. A scenario
plays back from \`har/<env>/<name>.har\` because it carries \`@har:<name>\`, so when you convert the
recording into a feature, tag the scenario to match the file you just wrote:

\`\`\`gherkin
@ui @regression @har:checkout
Scenario: Standard user checks out
\`\`\`

Then:

\`\`\`bash
sdods run -p demo-shop -e staging -t @har:checkout --har-replay --strict
\`\`\`

\`--strict\` aborts any request that is not in the HAR and blocks every other network call, which is
what makes the CI run genuinely offline rather than mostly offline.

Two failure modes to know about. Lint tells you \`@har:checkout has no recorded file under
har/<env>/checkout.har\` if the tag and the file drifted apart, which is the good outcome. And the tag
has no room for spaces, so the slugified name from the recording is the one to type.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'rec-what-does-record-convert-write',
    title:
      'What does sdods record convert actually write, and where do I review it before it lands?',
    askedBy: 'sergio-alcaraz',
    askedOn: '2025-02-18',
    tags: ['recording', 'agents', 'cli'],
    votes: 23,
    views: 7480,
    body: `I have four recordings under \`projects/demo-shop/recorded/\` and I have been told to convert them
rather than hand-write the features. Before I point it at anything that matters: what does
\`sdods record convert\` write, and where? I do not want a generator rearranging files under me while
I am reading something else.`,
    answers: [
      {
        id: 'a1',
        by: 'thom-vasseur',
        on: '2025-02-18',
        votes: 26,
        body: `Nothing lands in the working tree. \`record convert\` hands the spec to the generator agent and the
agent's output is a proposal — a directory under \`proposals/<id>/\` with a manifest, the files it
wants to add and a diff. Your \`features/\`, \`steps/\` and \`pages/\` are untouched until a person says
otherwise.

\`\`\`bash
sdods record convert projects/demo-shop/recorded/checkout.spec.ts
sdods proposals list
sdods proposals show <id>
sdods proposals accept <id>
\`\`\`

\`accept\` applies the files and then runs \`sdods lint\`, unless you pass \`--no-lint\`; \`--branch
<name>\` puts them on a new git branch if you would rather review it as a pull request. \`reject\`
takes a \`--reason\`.

The recording itself is never deleted, and it stays runnable under \`-l recorded\` whether you accept
or not, so the conversion is additive in both directions.

If you want the shape without spending a model call:

\`\`\`bash
sdods record convert projects/demo-shop/recorded/checkout.spec.ts --dry-run
\`\`\`

which prints the prompt and the plan and stops. \`--adapter fake\` is the other way to exercise the
plumbing without a provider.`,
      },
      {
        id: 'a2',
        by: 'ade-oyinlola',
        on: '2025-02-20',
        votes: 12,
        body: `Having reviewed a handful of these, the three things worth actually reading in the proposal:

- which steps it reused — it matches the existing step catalogue first and only writes new steps for actions it could not match, so a proposed step that reads almost like one you already have is the thing to send back
- the locators it lifted into the page object — anything fragile in the spec is fragile in the proposal, because conversion does not improve locators, it relocates them
- the tags — every scenario needs exactly one layer tag and one suite tag, and since \`accept\` runs lint, a mistagged proposal fails there rather than landing quietly

The roles guide also shows passing two recordings of the same flow at once, in which case the
generator proposes a single Scenario Outline with the role in the examples table instead of two
near-identical scenarios:
[record and playback with roles and environments](https://docs.sdods.com/docs/guides/record-playback-roles-environments/).`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'rec-convert-cannot-tell-which-project',
    title:
      'record convert: Cannot tell which project my spec belongs to, and I only have one project',
    askedBy: 'koen-vermeulen',
    askedOn: '2025-06-30',
    tags: ['recording', 'cli'],
    votes: 11,
    views: 3980,
    body: `Copied a recording out to a scratch directory to try the conversion without touching the repo:

\`\`\`bash
sdods record convert ~/scratch/checkout.spec.ts
\`\`\`

\`\`\`text
✖ CONFIG_INVALID: Cannot tell which project ~/scratch/checkout.spec.ts belongs to.
  hint: Pass -p <slug>, or keep recordings under projects/<slug>/recorded/.
\`\`\`

There is one project in the whole workspace. Why does it not just pick it?`,
    answers: [
      {
        id: 'a1',
        by: 'tobi-schrader',
        on: '2025-06-30',
        votes: 15,
        body: `Because convert does not go through the project picker at all — it reads the slug out of the path.
The rule is exactly "is there a \`projects/<slug>/\` segment in what you passed", and a scratch
directory has none. Having one project in the registry is the shortcut that makes \`-p\` optional for
\`sdods record\` and \`sdods run\`; it does not apply here.

Either of these works:

\`\`\`bash
sdods record convert ~/scratch/checkout.spec.ts -p demo-shop
sdods record convert projects/demo-shop/recorded/checkout.spec.ts
\`\`\`

The second is what you want regardless. Conversion produces a proposal, not a write, so pointing it
at the real path is not the destructive thing the copy was protecting you from.

Its neighbour is \`Spec not found: <spec>\` when the path does not exist. Both exit \`2\`, so a script
cannot tell them apart by exit code — only by the message.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'rec-re-record-after-a-redesign',
    title: 'Cart got redesigned — re-record the flow from scratch, or patch the old spec?',
    askedBy: 'rasha-halabi',
    askedOn: '2025-09-08',
    tags: ['recording', 'ui', 'locators'],
    votes: 19,
    views: 6110,
    body: `The cart page was redesigned. Same flow, different markup. We have \`checkout.spec.ts\` from March and
a feature that came out of it back then.

Do I re-record from scratch or patch the spec? Genuinely unsure which is less work, and I do not want
to lose the name and the tags in the process.`,
    answers: [
      {
        id: 'a1',
        by: 'thom-vasseur',
        on: '2025-09-08',
        votes: 18,
        body: `Re-record. The spec carries the command that made it, in the header comment at the top:

\`\`\`text
// Recorded with SDODS. Re-record with: sdods record -p demo-shop -e staging --name checkout --user standard
\`\`\`

Run that line back. The same \`--name\` writes the same file, so \`git diff\` shows you exactly what the
redesign changed and nothing else. That diff is the artefact you actually want — patching by hand
gives you a spec that works and tells you nothing about what moved.

Tags survive too: post-processing puts \`@recorded @ui @regression\` back on the describe block every
time, plus whatever you passed as \`--tag\`.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2025-09-09',
        votes: 14,
        body: `The feature is a separate question from the recording, and mostly it should not move.

If the steps describe what a person does — add to cart, check out, see the confirmation — a redesign
should touch the page object underneath them and leave the feature alone. So look at the page object
first. If the diff really does suggest rewriting the feature, that is a signal the steps were
describing the markup rather than the behaviour, and it is worth fixing while you have a reason to be
in there.`,
      },
      {
        id: 'a3',
        by: 'reeta-nandal',
        on: '2025-09-09',
        votes: 11,
        body: `Two cautions on re-recording over an existing file.

The first re-record after a gap will stop and log in for you, because the cached storage state for
that role has aged out. That is the extra minute, not the redesign breaking something.

And the same \`--name\` means codegen overwrites the file. If anybody hand-edited that spec, their
edits are gone — post-processing also strips its own header lines before rewriting, so nothing at the
top of the file survives either.

> [!WARNING] A recording is an artefact, not source. Anything worth keeping belongs in the page
> object or the feature, never in the spec under recorded/.`,
      },
      {
        id: 'a4',
        by: 'gcastellano',
        on: '2025-09-16',
        votes: 5,
        body: `If you are doing several variants in one sitting — the redesign as standard, as problem user, and on
a phone — the Recorder page is less typing than four CLI invocations, and it shows you the
post-processed spec as soon as you close the codegen window.

![The Recorder page of the SDODS web UI, with environment, recording name, start URL, pool role, browser and device fields beside a pane for the post-processed spec](/questions/ui-recorder.png "The form spawns the same sdods record command; the CLI equivalent is printed under the button")

Give each variant a distinct name — \`checkout\`, \`checkout-problem\`, \`checkout-mobile\` — or the
second one overwrites the first, which is the same overwrite Reeta is warning about.`,
      },
    ],
  },
  {
    slug: 'rec-multi-tab-oauth-popup-not-recorded',
    title: 'OAuth popup during a recording: everything I did in the popup is missing from the spec',
    askedBy: 'ingrid-solberg',
    askedOn: '2026-03-12',
    tags: ['recording', 'ui', 'page-objects'],
    votes: 24,
    views: 5730,
    body: `Recording a login that goes through our identity provider. The provider opens in a popup, you finish
there, the popup closes and the app is signed in.

\`\`\`bash
sdods record -p demo-shop -e staging --name sso-login
\`\`\`

The recorded spec has the click that opens the popup, then nothing at all until after it closed.
Everything I typed inside the popup is missing. Converting it gives me a feature that is one click
followed by an assertion that cannot pass.

Is there a tag or a flag for multi-window flows that I have not found?`,
    answers: [
      {
        id: 'a1',
        by: 'thom-vasseur',
        on: '2026-03-12',
        votes: 22,
        body: `No, and I would rather say so plainly than send you looking for it.

The built-in UI step library has no step that waits for a popup or switches to another tab.
Conversion maps recorded actions onto steps; with no step meaning "do this in the other window", the
popup half of the flow has nothing to convert into and drops out. What you are seeing is that gap,
not a recorder bug.

The workaround is to stop trying to say it in Gherkin. Put the whole popup in a page-object method
and give it one step name:

\`\`\`ts
@When('I sign in through the identity provider as {string}')
async ssoLogin(username: string) {
  const popup = await this.waitForPopup(async () => {
    await this.page.getByRole('button', { name: 'Sign in with SSO' }).click();
  });
  await popup.getByLabel('Email').fill(username);
  await popup.getByRole('button', { name: 'Continue' }).click();
  await popup.waitForEvent('close');
}
\`\`\`

\`waitForPopup(action)\` is on \`BasePage\`, and it starts waiting before it runs your action, which is
the part people get wrong writing it themselves. The feature then reads as one line and the
multi-window mechanics live in TypeScript, where they belong.

The recorded spec is still worth keeping for the parts before and after the popup — it runs fine
under \`-l recorded\`, it just cannot become a feature on its own.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2026-03-14',
        votes: 13,
        body: `Confirming where the gap is: the step library, not the recorder and not the converter. \`BasePage\`
carries \`waitForPopup()\`, \`frame()\`, \`setInputFiles()\` and \`waitForDownload()\` precisely because
these are the flows Gherkin should not be asked to spell out.

If you would rather the suite never saw the popup at all, capture the state once with a person in the
loop:

\`\`\`bash
sdods auth capture -p demo-shop -e staging -u standard --interactive
\`\`\`

Interactive capture opens codegen and waits while you complete the login, popup and all, then saves
the storage state. After that, scenarios tagged \`@user:standard\` never touch the identity provider,
and neither does a recording started with \`--user standard\`.

You still want one scenario that exercises the real login. That is the one that gets Thom's
page-object method; the other thirty do not need it.`,
      },
    ],
  },
  {
    slug: 'rec-codegen-closed-without-writing-a-spec',
    title: 'Closed the browser after ten minutes and got "Codegen closed without writing a spec"',
    askedBy: 'paulo-mendes',
    askedOn: '2026-05-20',
    tags: ['recording', 'cli'],
    votes: 12,
    views: 3410,
    body: `Recorded for about ten minutes, closed the window, and:

\`\`\`text
✖ RUN_FAILED: Codegen closed without writing a spec (nothing was recorded).
\`\`\`

Nothing under \`projects/demo-shop/recorded/\`. Ten minutes gone. What did I do wrong, and is there
anywhere the actions are buffered that I can recover from?`,
    answers: [
      {
        id: 'a1',
        by: 'tobi-schrader',
        on: '2026-05-20',
        votes: 17,
        body: `Nothing to recover, sorry — SDODS has nothing to recover from.

Read the message literally. Codegen exited normally, and afterwards there was no file at
\`projects/demo-shop/recorded/checkout.spec.ts\`. That existence check is the whole test. SDODS does
not watch what you did in the browser, it looks for the output file at the end, and when it is not
there it refuses to report a recording that did not happen.

Note this is a different failure from the neighbouring one. \`playwright codegen exited with code 1
and produced no spec\` is codegen never starting, almost always no display. Yours is codegen running
to completion and leaving nothing behind.

Which usually means the session ended before anything was written — the window closed in a way that
took the recorder with it, or the terminal running the command went away. It is also worth checking
that anything was actually recorded: codegen writes down actions, so a session spent scrolling and
reading produces an empty result honestly.

Habit worth picking up: pass \`--name\` rather than taking the \`rec-<timestamp>\` default, so you know
exactly which file to go looking for afterwards.

\`\`\`bash
sdods record -p demo-shop -e staging --name checkout --user standard
\`\`\``,
      },
      {
        id: 'a2',
        by: 'thom-vasseur',
        on: '2026-05-22',
        votes: 8,
        body: `Adding the case that catches people who did nothing wrong at all: running the CLI inside the Docker
image. There you do not get this error — the image has no display, so you get the exit-1 one with the
hint about recording on your workstation instead.

Recording is the single thing in SDODS that does not containerise, because a person has to be sitting
in front of it. Everything else in the image behaves.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'rec-env-use-color-scheme-and-webkit',
    title: 'Does colorScheme from the env use: block reach a recording, or only the runner?',
    askedBy: 'zeynep-arslan',
    askedOn: '2026-08-24',
    tags: ['recording', 'config'],
    votes: 3,
    views: 88,
    body: `\`envs/staging.yaml\` has:

\`\`\`yaml
use:
  locale: en-US
  timezoneId: America/New_York
  colorScheme: dark
\`\`\`

\`sdods run -l ui\` respects all three. A recording started with

\`\`\`bash
sdods record -p demo-shop -e staging --name nav-dark -b webkit
\`\`\`

comes up in light mode for me, while the locale and the timezone are clearly applied — the dates in
the app are New York time and the number formatting is US.

Two questions, and I am not sure which one I am actually asking. Is \`colorScheme\` from \`use:\` meant
to reach the recorder at all, or is that block only read by the runner? And if it is meant to, does
it behave differently on webkit than on chromium — I have not tried the same recording on chromium
yet, which I realise is the obvious next thing.

Happy to raise it properly if someone can tell me which of those two it is.`,
    answers: [],
  },
];
