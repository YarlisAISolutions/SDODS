import type { Thread } from '../types';

export const runningThreads: Thread[] = [
  {
    slug: 'run-api-layer-finished-too-fast',
    title: 'sdods run -l api finished in under two seconds — did it actually run anything?',
    askedBy: 'dperera',
    askedOn: '2020-10-14',
    tags: ['api', 'cli', 'smoke'],
    votes: 21,
    views: 9140,
    body: `I pointed the CLI at staging and asked for the API layer only:

\`\`\`bash
sdods run -p demo-shop -e staging -l api
\`\`\`

It printed nine passing scenarios and was finished before I had read the command back. No browser window, no window flashing past, nothing. Coming off a Selenium suite where nine tests is a coffee break I do not believe it.

Is \`-l api\` some kind of dry run, or did it really talk to the environment?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2020-10-14',
        votes: 30,
        body: `It really ran. \`-l api\` selects the API layer, which drives HTTP requests directly and never starts a browser — that is the whole point of the layer, and it is why the same nine scenarios take two seconds instead of two minutes.

If you want proof rather than a feeling, the run leaves it on disk:

\`\`\`bash
cat .sdods/runs/<runId>/summary.json
\`\`\`

\`totals\` there is the same count the terminal printed, and \`run.json\` records the command, the env and the exit code. The dry run you are thinking of is \`--list\`, which prints the run targets and the tests that would run and then stops.`,
      },
      {
        id: 'a2',
        by: 'hsu-wei-lin',
        on: '2020-11-09',
        votes: 12,
        body: `The speed is the feature. An API-layer run is cheap enough to put in a pre-commit hook, which is not true of anything that opens a browser.

If you still distrust it, break it on purpose: stop the application and run the same command. Every scenario fails with a connection error instead of an assertion failure, which tells you the suite was genuinely reaching the environment before.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-do-layer-and-tag-filters-stack',
    title: 'Do -l, -b and -t stack, or does the last one win?',
    askedBy: 'avery-hollis',
    askedOn: '2020-12-08',
    tags: ['cli', 'ui', 'smoke'],
    votes: 17,
    views: 7620,
    body: `I have been typing this without really knowing what it means:

\`\`\`bash
sdods run -p demo-shop -e staging -l ui -b chromium -t @smoke
\`\`\`

Three filters. Do they narrow each other down, or is one of them authoritative? Specifically: I have a scenario tagged \`@api @smoke\`. Is it in that run or not?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2020-12-09',
        votes: 26,
        body: `They narrow. \`-l\` and \`-b\` pick the run targets (layer × browser), and your tag expression is combined with the layer, so what actually executes is

\`\`\`text
(@ui) and (@smoke)
\`\`\`

Your \`@api @smoke\` scenario is not in that run — it has no \`@ui\`. Run it with \`-l api\`, or drop \`-l\` and let both layers in.

\`-l\` and \`-b\` are repeatable rather than last-wins, so \`-l ui -l api\` means both.`,
      },
      {
        id: 'a2',
        by: 'mkuiper',
        on: '2020-12-11',
        votes: 9,
        body: `Add \`--list\` whenever you are unsure. It prints the run targets and the tests they contain and exits, which is a lot cheaper than discovering after eight minutes that you selected nothing.

There is a fourth filter you will want eventually: \`-m <module>\`, which restricts the run to one module's features.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-ci-green-but-no-scenarios-ran',
    title: 'CI has been green for a week and I do not think the suite ran at all',
    askedBy: 'kmoreau',
    askedOn: '2021-03-16',
    tags: ['ci', 'cli', 'smoke'],
    votes: 47,
    views: 15420,
    body: `Someone renamed a tag and our pipeline step is:

\`\`\`bash
sdods run -p demo-shop -e staging -t @smoke-ui
\`\`\`

Exit code 0, green check, everyone happy. I only looked because a bug walked into production that we have a scenario for. Scrolling back through the log:

\`\`\`text
⚠ No scenarios matched the selection (tags @smoke-ui · layers ui,api,hybrid).

✔ passed  0 passed, 0 failed, 0 skipped, 0 flaky  (4s)
\`\`\`

Zero passed is not passed. Why is that a zero exit code?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2021-03-16',
        votes: 53,
        body: `Because an empty selection is normal in the shape CI usually has: a shard or a matrix leg with nothing to do has to stay green, or a three-browser matrix fails the moment one browser has no matching scenario. So the run warns and exits 0.

For a command a person scoped by hand that reading is wrong, and today the warning is the only signal you get. Two habits that catch it:

- \`--list\` before you commit a new selection, so you see the tests rather than trusting the tag.
- \`sdods features list -p demo-shop\` for the real inventory — module, layer and tags per feature. That is the table to look at when an expression selects nothing.

An unknown tag on the command line is not an error and lint will not save you: lint checks the tags in your features, not the ones you type.`,
      },
      {
        id: 'a2',
        by: 'mkuiper',
        on: '2021-04-02',
        votes: 22,
        body: `We got bitten by exactly this and now the pipeline asserts a floor. After the run:

\`\`\`bash
test "$(jq .totals.total .sdods/runs/$RUN_ID/summary.json)" -gt 0
\`\`\`

Crude, but it has caught two more renames since. The summary is written before ingest, so it is there whether or not you have a database.`,
      },
      {
        id: 'a3',
        by: 'bea-lindqvist',
        on: '2024-02-28',
        votes: 13,
        body: `Late to this, but the root cause is worth naming: nobody should be renaming a suite tag. There are three of them, they are the interface to the suite, and the whole CI estate is written against those names. If you genuinely need a fourth, add it under \`tags.suites\` in the project YAML rather than inventing \`@smoke-ui\` in one feature file.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-layer-not-enabled-for-project',
    title: 'Layer "ui" is not enabled for project demo-shop — but the features are right there',
    askedBy: 'tobi-schrader',
    askedOn: '2021-05-27',
    tags: ['config', 'cli', 'ui'],
    votes: 14,
    views: 6210,
    body: `I have \`@ui\` scenarios in \`features/cart/\` and they lint clean. Running them:

\`\`\`bash
sdods run -p demo-shop -e staging -l ui -b chromium
\`\`\`

\`\`\`text
Layer "ui" is not enabled for project demo-shop (layers: api).
\`\`\`

Exit code 2. What is checking this, if not the feature files?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2021-05-28',
        votes: 24,
        body: `The project YAML is. \`layers:\` in \`projects/demo-shop/sdods.project.yaml\` is an allow-list of what this project may be run at, and yours says \`[api]\`. The features being present does not enable a layer — that would make a stray tag silently add a browser run to everybody's pipeline.

Add it:

\`\`\`yaml
layers: [api, ui]
\`\`\`

Exit code 2 always means configuration or usage rather than a failing test, which is the distinction to teach your CI file: a 2 is your problem, a 1 is the product's. The full list is on [Reference → Exit codes](https://docs.sdods.com/docs/reference/exit-codes/).`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-sharding-and-merging-reports',
    title: 'Three shards, three HTML reports — how do I get one report out of a matrix build?',
    askedBy: 'vikram-r',
    askedOn: '2021-08-19',
    tags: ['ci', 'reporting', 'cli'],
    votes: 39,
    views: 12980,
    body: `The nightly runs on three machines:

\`\`\`bash
sdods run -p demo-shop -e staging -b chromium --shard 1/3
sdods run -p demo-shop -e staging -b chromium --shard 2/3
sdods run -p demo-shop -e staging -b chromium --shard 3/3
\`\`\`

Every machine mints its own run id, so I get three artefact directories, three HTML reports and three rows in the dashboard for what is one nightly. Reading the morning report means opening three tabs and adding up.

Is there a supported way to make that one run?`,
    answers: [
      {
        id: 'a1',
        by: 'mkuiper',
        on: '2021-08-20',
        votes: 45,
        body: `Give every shard the same run id and have them write blob reports, then merge:

\`\`\`bash
sdods run -p demo-shop -e staging -b chromium --shard 1/3 --run-id gh-123 --reporter blob
sdods run -p demo-shop -e staging -b chromium --shard 2/3 --run-id gh-123 --reporter blob
sdods run -p demo-shop -e staging -b chromium --shard 3/3 --run-id gh-123 --reporter blob
sdods report merge --run gh-123 .sdods/runs/gh-123/shard-reports
\`\`\`

The shared run id is doing more work than the report: user-pool leases are keyed off it (shard offset plus worker index) so three machines never lease the same pool user, and ingest merges the NDJSON of every shard into one run instead of three.

The whole shape is written up in [Sharding and CI](https://docs.sdods.com/docs/guides/sharding-and-ci/). Download the shard report directories from your artefact store into one place first — \`report merge\` takes directories, and it tells you which ones it could not find.`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2021-08-23',
        votes: 19,
        body: `Adding the half that people forget: getting the results into the database from CI without putting database credentials on the build agents.

\`\`\`bash
sdods report ingest --run-id gh-123 --server https://sdods.example.com --token $SDODS_TOKEN .sdods/runs/gh-123/messages*.ndjson
\`\`\`

The upload goes through the server with a scoped token, so the agent holds nothing you would mind rotating.`,
      },
      {
        id: 'a3',
        by: 'sunita-kale',
        on: '2022-10-04',
        votes: 11,
        body: `A year late, one operational note from running this on our farm: upload the shard artefacts unconditionally, not just on success. A failed shard is the one whose report you want, and if the upload step is skipped on failure you have merged two thirds of a story.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-what-goes-in-pr-check-vs-nightly',
    title: 'What should a pull request run, and what should wait for the nightly?',
    askedBy: 'elsa-nyman',
    askedOn: '2021-11-30',
    tags: ['ci', 'smoke', 'regression'],
    votes: 26,
    views: 10420,
    body: `We have about 400 scenarios and currently every pull request runs all of them on three browsers. It takes 35 minutes and people merge without waiting, which makes the whole thing decorative.

I know the tags exist. What I want is the boring answer: what do teams actually put on a pull request, and what waits?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2021-12-01',
        votes: 34,
        body: `The taxonomy is designed around exactly this split, so use it as intended:

- \`@smoke\` on every pull request, one browser, and treat it as a budget rather than a category — a few minutes per browser. If it grows past that, something in it belongs in regression.
- \`@regression\` on merge to main and on the nightly, across the browser matrix. That is where the breadth lives.
- \`@sanity\` after a deploy or a hotfix, narrow and targeted.

\`\`\`bash
sdods run -p demo-shop -e staging -t @smoke -b chromium     # pull request
sdods run -p demo-shop -e staging -t @regression --project-matrix   # nightly
\`\`\`

The thing that keeps it honest is that the pull request check has to be fast enough that people wait for it. A 35-minute check is not a gate, it is a suggestion.`,
      },
      {
        id: 'a2',
        by: 'vikram-r',
        on: '2021-12-06',
        votes: 13,
        body: `From the side that reads the nightly every morning: put the full matrix in the nightly and let it notify, otherwise nobody looks. And do not put anything in the nightly that you would not act on before lunch — a nightly with 30 known failures is the same as no nightly.`,
      },
    ],
  },

  {
    slug: 'run-comma-tag-list-selected-more-not-less',
    title: '-t @regression,@mock ran more scenarios, not fewer',
    askedBy: 'gcastellano',
    askedOn: '2022-03-02',
    tags: ['cli', 'regression', 'windows'],
    votes: 23,
    views: 8300,
    body: `I wanted the regression scenarios that are mocked, so I asked for both tags:

\`\`\`bash
sdods run -p demo-shop -e staging -t @regression,@mock
\`\`\`

It ran considerably more than either tag has on its own. I expected a comma to mean "and". What does it mean?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2022-03-02',
        votes: 27,
        body: `Or. A comma list is shorthand for an or-expression, so \`-t smoke,sanity\` is \`"@smoke or @sanity"\` and yours was every regression scenario plus every mocked one. The \`@\` is optional in that form, which is the only reason the shorthand exists.

For anything else, write the expression and quote it:

\`\`\`bash
sdods run -p demo-shop -e staging -t "@regression and @mock"
sdods run -p demo-shop -e staging -t "@regression and not @mock"
\`\`\`

It is Cucumber tag-expression syntax, so \`and\`, \`or\`, \`not\` and parentheses all work.`,
      },
      {
        id: 'a2',
        by: 'sam-orbison',
        on: '2022-03-04',
        votes: 14,
        body: `Quote it on Windows even when the expression is a single tag. A bare \`@\`-prefixed token is splatting syntax in PowerShell, so \`-t @smoke\` can be mangled before the CLI ever sees the argument. \`-t "@smoke"\` is unambiguous everywhere and costs you two characters.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-stop-retyping-flags-use-a-process',
    title: 'Everyone on the team runs a slightly different command. Can I name one?',
    askedBy: 'mina-farouk',
    askedOn: '2022-05-11',
    tags: ['cli', 'ci', 'config'],
    votes: 34,
    views: 11240,
    body: `Our wiki has four versions of "the command to run before you merge", the CI file has a fifth, and they disagree about browsers and retries. Every time we change a gate someone has to find all five.

Is there something in SDODS for this, or do I write a Makefile?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2022-05-11',
        votes: 41,
        body: `Processes. A process is a named run recipe that lives in the project or workspace YAML:

\`\`\`yaml
processes:
  - name: pr-check
    title: Pull request check
    trigger: pr
    tags: '@smoke'
    browsers: [chromium]
    harMode: replay
    gates: { minPassRate: 100 }
  - name: nightly-regression
    trigger: nightly
    tags: '@regression'
    browsers: [chromium, firefox, webkit]
    notify: [github]
\`\`\`

Then the command everybody types, and the one in CI, is the same short thing:

\`\`\`bash
sdods run -p demo-shop --process pr-check
\`\`\`

Explicit flags override the process's fields, so \`--process nightly-regression -b chromium\` is a legitimate way to run one browser of a nightly locally.

\`sdods processes list -p <slug>\` prints what exists:

![sdods processes list showing pr-check, nightly-regression and release-gate with their triggers, tags, browsers and gates](/questions/processes.png "Three recipes and their gates, printed by processes list")`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2022-05-13',
        votes: 16,
        body: `Worth knowing where to put them. Processes under \`defaults.processes\` in the workspace file apply to every project; a project process with the same name overrides it wholesale.

So the pattern that scales is: the shape of \`pr-check\` in the workspace, and only the projects that genuinely differ redefining it. After that a change of gate or browser list is a YAML edit rather than a pull request against your CI file.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-process-and-an-explicit-tag-flag-together',
    title: 'If I pass --process nightly-regression and -t @smoke, which one wins?',
    askedBy: 'sunita-kale',
    askedOn: '2022-10-11',
    tags: ['cli', 'config', 'ci'],
    votes: 11,
    views: 4980,
    body: `We have a \`nightly-regression\` process that pins the env, the layers, the browsers and a tag expression. Last night I wanted the same recipe but only the smoke scenarios, so I ran:

\`\`\`bash
sdods run -p demo-shop --process nightly-regression -t @smoke
\`\`\`

It ran something. I cannot tell from the output whether it used my \`@smoke\` or the process's tag expression, and I do not want to find out the wrong way on a release gate. Is passing both defined behaviour, or should I stop doing it?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2022-10-11',
        votes: 19,
        body: `It is defined, and your flag wins. A process supplies **defaults for the flags you did not give**, so anything explicit on the command line overrides the recipe:

- \`-t\` / \`-e\` / \`--retries\` / \`-w\` / \`--fail-on-flaky\` override the process when present
- \`-l\`, \`-b\` and \`-m\` are lists, so the process's values are used only when you pass none — one \`-b chromium\` replaces the recipe's whole browser list rather than narrowing it

So your run was \`@smoke\`, with the env, layers and browsers still coming from \`nightly-regression\`. That is usually what people want.

Two things to watch. Because lists replace rather than intersect, \`--process release-gate -b chromium\` is not "the release gate, chromium only" if the gate also pins modules you forgot about — it is the gate with a one-browser list. And the run record stores the process name either way, so a dashboard will file that \`@smoke\` run under \`nightly-regression\` alongside the real ones.

If you want to see what you are actually about to run:

\`\`\`bash
sdods run -p demo-shop --process nightly-regression -t @smoke --list
\`\`\`

\`--list\` resolves everything and prints the scenarios without running them.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-workers-and-max-failures-on-ci',
    title: 'How many workers on a two-core build box, and can I stop at the first failure?',
    askedBy: 'lars-vinter',
    askedOn: '2022-12-06',
    tags: ['ci', 'cli', 'regression'],
    votes: 19,
    views: 7740,
    body: `Two questions from the same afternoon of tuning.

Our agents have two cores. I have seen \`-w 8\` in examples, which on our box makes the UI run slower and adds timeouts. What is the actual guidance?

And when a regression run is going to fail, I would rather know in three minutes than in twenty. Is there a fail-fast?`,
    answers: [
      {
        id: 'a1',
        by: 'mkuiper',
        on: '2022-12-06',
        votes: 25,
        body: `Rules of thumb, in the order I would apply them:

- UI: around one worker per core, and no more. Every worker is a browser; oversubscribing turns locator waits into timeouts and you get flakiness that looks like product bugs.
- API: much higher is fine, there is no browser to feed. We run the API layer at four times the core count.
- Measure it rather than believing me. \`summary.json\` has durations, and two runs at different \`-w\` settle the argument.

Fail-fast is \`--max-failures\`:

\`\`\`bash
sdods run -p demo-shop -e staging -t @regression --max-failures 1
\`\`\`

One caveat that has confused people here: on a sharded run it stops that shard. The other shards carry on, because they are separate processes.`,
      },
      {
        id: 'a2',
        by: 'sunita-kale',
        on: '2022-12-08',
        votes: 12,
        body: `From the platform side: on a build agent the core count you read is often the host's, not your quota. If the runner thinks it has 16 cores and the cgroup gives you two, the default worker count is already wrong before you touch a flag.

Pin \`workers\` in the process YAML per environment instead of in the workflow file. Then the agent's opinion of itself stops mattering, and the number is somewhere a person will find it.`,
      },
    ],
  },

  {
    slug: 'run-prove-a-scenario-is-flaky',
    title: 'How do I prove the checkout scenario is flaky instead of arguing about it?',
    askedBy: 'owen-brackley',
    askedOn: '2023-02-27',
    tags: ['regression', 'ci', 'cli'],
    votes: 29,
    views: 9860,
    body: `One scenario fails maybe one run in six. Every time I raise it I am told it passed locally, and every time I run it locally it passes, so I am the person crying wolf about the checkout test.

I want a number I can put in a ticket. Is there a way to run one scenario many times?`,
    answers: [
      {
        id: 'a1',
        by: 'lena-hartwig',
        on: '2023-02-27',
        votes: 37,
        body: `Yes, and this is the exact command for it:

\`\`\`bash
sdods run -p demo-shop -e staging --scenario "Checkout with a saved card" --repeat-each 20 --fail-on-flaky
\`\`\`

\`--scenario\` matches scenarios whose title contains that text, \`--repeat-each\` runs each of them twenty times, and \`--fail-on-flaky\` makes the run exit 1 if any of them passed only on a retry. Twenty green runs is an argument; three failures out of twenty is a ticket.

Once you have the number, classify before you fix: heal events in the run point at locator drift, API snapshots with 5xx or timeouts point at the environment, and the before/after screenshots usually show a timing race. The fix differs for all three, and only the last one is really "the test's fault".`,
      },
      {
        id: 'a2',
        by: 'vikram-r',
        on: '2023-03-01',
        votes: 15,
        body: `If twenty repeats come back clean, try reproducing the conditions rather than the scenario: raise \`-w\` so it runs alongside its neighbours. A good share of the flakiness we chase only exists in parallel — shared data, a pool user two scenarios both wanted, an application that does not like two sessions.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-retries-made-the-nightly-green',
    title: 'We set --retries 3 and the nightly went green. Why is everyone unhappy?',
    askedBy: 'ade-oyinlola',
    askedOn: '2023-04-18',
    tags: ['ci', 'regression', 'reporting'],
    votes: 42,
    views: 13640,
    body: `Genuine question, not a troll. Our nightly had six or seven failures a week, all different, all "it passes when I run it". We set retries to 3 and it has been green for nine days. Two people have told me this is bad and neither could say why beyond "it hides things".

What is it hiding, concretely?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2023-04-18',
        votes: 49,
        body: `Concretely: the pass is now conditional on a retry, and nothing in your green check says how conditional.

A retry does not repair a scenario. It converts a failure into a "flaky" result, and flaky is a state your dashboard tracks precisely because it is not the same as passed. What you have bought is that nobody has to look at the seven weekly failures, which were seven weekly pieces of information about your application or your environment.

Two things to put back:

- Keep retries as a shock absorber for infrastructure, not for product assertions. One retry in CI, zero locally, is a common setting.
- Put \`--fail-on-flaky\` (or \`failOnFlaky: true\`) on the gate that actually matters — the release gate. Then the nightly can absorb a retry and the release cannot.

After that, rank what is left by flakiness in insights and fix the top two. That is a smaller job than it sounds; flakiness concentrates.`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2023-04-19',
        votes: 23,
        body: `The routine that works, in order: detect (insights ranks the last 30 runs), classify (locator drift, environment or timing), contain (quarantine so the gate stays honest while you work — the scenario keeps running and reporting), fix, then verify with \`--repeat-each 10 --fail-on-flaky\` and lift the quarantine.

The step people skip is "contain". Without it the pressure to raise retries comes back the following week.`,
      },
      {
        id: 'a3',
        by: 'mkuiper',
        on: '2023-05-02',
        votes: 9,
        body: `Our numbers, for calibration: retries 1 in CI, 0 locally, and a scenario that needs more than one is not a flaky test, it is a bug report against either the app or the scenario. We have about 4,000 scenarios and roughly a dozen carry that debt at any time.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-first-ui-run-five-failures-signin',
    title: 'First UI run: five scenarios fail on the sign-in page, but the API layer was green',
    askedBy: 'yusuf-demir',
    askedOn: '2023-06-12',
    tags: ['ui', 'smoke', 'pool'],
    votes: 51,
    views: 18960,
    body: `Working through the workshop on my own checkout of the sample app. The API layer passed straight away. Then the browser:

\`\`\`bash
sdods run -p rwa-raw -e local -l ui -b chromium -t @smoke
\`\`\`

Five failures, and as far as I can tell they are all the same failure:

\`\`\`text
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\\/\\*/
Received string:  "http://localhost:3000/signin"
Timeout: 10000ms
\`\`\`

![A failing URL assertion showing the expected pattern and the received URL ending in /signin](/questions/run-ui-first.png "Five scenarios, one cause: the application redirected to its sign-in page")

The app is definitely running — the API scenarios hit it. Is the generated suite just wrong?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2023-06-12',
        votes: 62,
        body: `The suite is not wrong; it has not been given an account. Every one of those pages is behind a login, so the application redirected to \`/signin\` and the URL assertion saw the redirect target.

Give it a user and the same five scenarios go green:

\`\`\`bash
sdods auth capture -p rwa-raw -e local
sdods auth list -p rwa-raw -e local
\`\`\`

Then tag the scenario with the role it needs:

\`\`\`gherkin
  @smoke @user:standard
  Scenario: The personal page loads
    Given I navigate to the "personal" page
    Then the page URL should contain "/personal"
\`\`\`

Login happens once per pool user and the browser state is reused, so this costs you seconds across the whole suite rather than a login per scenario.

The reason the API layer was green is that those endpoints did not need a session, or the suite already had a token for them. Layers fail for different reasons: api points at the endpoint or the port, ui points at the page, the locator or the login.`,
      },
      {
        id: 'a2',
        by: 'rgarrido',
        on: '2023-06-13',
        votes: 19,
        body: `One extra thing to fix while you are in there: look at the expected pattern in your own paste. \`/\\/\\*/\` is what analysis wrote when it could not tell what the route was — it is asserting the URL contains \`/*\`, which is nothing.

Once the login works, correct the assertion to the route the page actually has. Otherwise you have a scenario that goes green and checks nothing, which is worse than the failure you have now.`,
      },
      {
        id: 'a3',
        by: 'priya-venkatesh',
        on: '2023-06-14',
        votes: 16,
        body: `Worth reading the pool guide before you scale this up. \`@user:<role>\` leases a user from the pool for the scenario, so two scenarios that both want \`standard\` do not fight over the same session when you raise workers. The role has to exist in \`tags.roles\` or lint rejects the tag.`,
      },
      {
        id: 'a4',
        by: 'tomas-brekke',
        on: '2023-07-04',
        votes: 8,
        body: `Coming late — if you have the login working and a scenario still fails, stop reading the URL and open the trace. A post-login failure is a locator or a step problem, and the trace shows you the page as it was at the failing step instead of asking you to reconstruct it.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-every-api-scenario-fails-connection',
    title: 'Every API scenario fails at once with a connection error — where do I start?',
    askedBy: 'chandra-p',
    askedOn: '2023-08-22',
    tags: ['api', 'cli', 'ci'],
    votes: 25,
    views: 8420,
    body: `All 34 API scenarios, same run, same message, no exceptions:

\`\`\`text
apiRequestContext.get: connect ECONNREFUSED 127.0.0.1:3000
\`\`\`

Yesterday they passed. I have not touched the features. Do I start bisecting the suite or is this something else?`,
    answers: [
      {
        id: 'a1',
        by: 'hsu-wei-lin',
        on: '2023-08-22',
        votes: 31,
        body: `Do not bisect. Two signals in your paste say this is not the suite:

- All of them failed, not some.
- The failure is a connection error, not an assertion failure.

Nothing is listening on that port. Either the application is not running, or \`baseUrl\` in \`envs/local.yaml\` (or whichever env you selected) points somewhere the app no longer is. Start the app, or check the env file, and run again.

A suite that fails on assertions is telling you about the product. A suite that fails on connections is telling you about the environment, and that distinction saves an hour every time you respect it.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2023-08-23',
        votes: 17,
        body: `Adding the third category, since these three cover almost everything:

- exit 2 — configuration or usage. Unknown project, missing env file, unresolved \${VAR}, a bad flag value. The suite never started.
- exit 1 with connection errors — the environment. What you have.
- exit 1 with assertion failures — the product and the suite disagree, which is the only one worth reading scenario by scenario.

The workshop suggests stopping the application on purpose once, precisely so you recognise the second shape when it turns up at 3am.`,
      },
      {
        id: 'a3',
        by: 'j-okonkwo',
        on: '2024-01-09',
        votes: 12,
        body: `If this keeps happening on a merge gate rather than locally, take the environment out of the equation: tag the scenarios \`@har:<name>\` and run with \`--har-replay --strict\`. Strict aborts any request that is not in the HAR, so the run is genuinely offline and a gate stops depending on somebody's staging box being awake.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-see-what-a-selection-would-run',
    title: 'Is there a dry run? I want to see what -t and -m select before I wait ten minutes',
    askedBy: 'helle-borg',
    askedOn: '2023-11-07',
    tags: ['cli', 'regression', 'ci'],
    votes: 22,
    views: 7960,
    body: `Writing a new pipeline step and I keep guessing at the selection, running it, waiting, and finding out I was wrong. Twice now the wrong thing was "it selected nothing", which is not obvious from a green run.

Is there a way to ask what a command would do without doing it?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2023-11-07',
        votes: 28,
        body: `\`--list\`. It prints the run targets and the tests that would run, then stops:

\`\`\`bash
sdods run -p demo-shop --module cart -t @regression --list
\`\`\`

It generates the specs to work out the list and then removes them along with the run directory, so it leaves nothing behind and you can run it as often as you like.

Two things it answers at once: which run targets your \`-l\`/\`-b\` selection produced, and how many tests are in them. Zero tests printed is the answer to your second problem.`,
      },
      {
        id: 'a2',
        by: 'mkuiper',
        on: '2023-11-08',
        votes: 10,
        body: `And for the inverse question — "what tags exist that I could select" — \`sdods features list -p <slug>\` gives you module, scenario count, layers and tags per feature. I keep that output open while writing a tag expression.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-just-one-scenario-while-debugging',
    title: 'Running one scenario without waiting for the whole feature file',
    askedBy: 'nikhil-sane',
    askedOn: '2024-02-19',
    tags: ['cli', 'ui'],
    votes: 16,
    views: 6100,
    body: `I am fixing one scenario in a feature that has eleven of them. Running the feature each time costs me two minutes per attempt, most of which is scenarios I am not touching.

What is the narrowest thing I can run?`,
    answers: [
      {
        id: 'a1',
        by: 'rgarrido',
        on: '2024-02-19',
        votes: 22,
        body: `Three levels of narrowing, from coarse to fine:

\`\`\`bash
sdods run -p demo-shop -e staging --feature cart/cart.feature
sdods run -p demo-shop -e staging --scenario "Removing the last item"
sdods run -p demo-shop -e staging --grep "last item|empty cart"
\`\`\`

\`--feature\` is a path relative to \`features/\`. \`--scenario\` matches scenarios whose title contains that text, which is the one you want here. \`--grep\` is a regular expression against the test title if the substring is not selective enough.

While you are iterating, add \`--headed --debug\` and watch it fail at the step. Do not leave either in anything committed — they need a display and a person.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-ci-exits-3-before-any-test',
    title: 'Pipeline exits 3 and no test ran — the report is empty',
    askedBy: 'renata-kohl',
    askedOn: '2024-03-26',
    tags: ['lint', 'cli', 'ci'],
    votes: 24,
    views: 8880,
    body: `Merged a branch this morning and the test job now ends in seconds:

\`\`\`text
Error: Process completed with exit code 3.
\`\`\`

There is no HTML report and no failing scenario to look at, so my first instinct was that the runner is broken. 3 is not in the list of codes I had memorised (0, 1, 2).`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2024-03-26',
        votes: 32,
        body: `3 is lint errors. \`sdods run\` lints the project before it generates or runs anything, and stops if lint found errors — which is why there is no report: nothing ran.

The findings are printed on stderr just above that line; if your CI collapses stderr, run it directly:

\`\`\`bash
sdods lint -p demo-shop
\`\`\`

Somebody's merge almost certainly added a scenario with two suite tags or no layer tag. Fix that. \`--no-lint\` exists and will make your job go green, and it is the wrong lever — you would be shipping a scenario that no tag expression selects correctly.`,
      },
      {
        id: 'a2',
        by: 'bea-lindqvist',
        on: '2024-03-27',
        votes: 20,
        body: `The two errors that account for nearly all of these, in my experience of policing this: a scenario with both \`@smoke\` and \`@regression\`, and a scenario with no layer tag at all after somebody copied it into a new file.

\`\`\`bash
sdods lint -p demo-shop --fix-tags
\`\`\`

\`--fix-tags\` adds a missing layer tag when the folder makes it obvious. It will not choose a suite tag for you, and it should not — that is a decision about how often the scenario runs.`,
      },
      {
        id: 'a3',
        by: 'vikram-r',
        on: '2024-04-03',
        votes: 7,
        body: `Small pipeline change that removes the confusion permanently: run lint as its own step before the suite step. Then the failing step is called "lint" and nobody spends fifteen minutes wondering why the test job produced no tests.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-headed-on-the-build-agent-hangs',
    title: '--headed on the build agent just sits there until the job times out',
    askedBy: 'fiona-mcallister',
    askedOn: '2024-06-11',
    tags: ['ci', 'ui', 'cli'],
    votes: 18,
    views: 6740,
    body: `Someone copied their local command into the pipeline, including \`--headed\`, and the job now hangs and is killed at the 60-minute timeout. Removing the flag fixes it, so the immediate problem is solved, but I would like to understand what it was waiting for — and whether there is a legitimate reason to run headed on an agent.`,
    answers: [
      {
        id: 'a1',
        by: 'sunita-kale',
        on: '2024-06-11',
        votes: 25,
        body: `Headless is the default and it is the right default for an agent. \`--headed\` asks for visible browser windows and a build agent has no display, so the browser cannot launch at all.

There is no legitimate reason to run headed in CI, because the thing people want it for — seeing what happened — is served better after the fact:

- the HTML report and the dashboard under \`.sdods/runs/<runId>/\`, uploaded as artefacts,
- the trace, which replays the run step by step with the DOM at each point.

Keep \`--headed\`, \`--ui\` and \`--debug\` for your own machine. They are all interactive.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-browsers-not-installed-on-the-agent',
    title: 'Some browsers are not installed. — fresh agent, first run of the day',
    askedBy: 'bruno-teixeira',
    askedOn: '2024-08-27',
    tags: ['ci', 'install', 'cli'],
    votes: 32,
    views: 11400,
    body: `New pool of agents. The first thing the job does is a preflight:

\`\`\`bash
sdods browsers list -p demo-shop
\`\`\`

\`\`\`text
Some browsers are not installed.
Run \`sdods browsers install --with-deps\`.
\`\`\`

Exits 1. I can obviously run the suggested command, but adding a browser download to every job feels wrong when the agents are supposed to be identical. What do people do?`,
    answers: [
      {
        id: 'a1',
        by: 'daniel-oyelaran',
        on: '2024-08-27',
        votes: 36,
        body: `Run the install once and cache it, rather than either downloading every time or pretending the agents are prepared.

\`\`\`bash
sdods browsers install --with-deps
\`\`\`

\`--with-deps\` also pulls the system libraries the engines need, which is the part that bites on a minimal agent — the browser downloads fine and then fails to start with a missing shared library.

Cache the browser directory keyed on the engine version, and keep your \`browsers list\` preflight: it exits 1 when anything is missing, so a cache that silently went stale fails in a step called "preflight" instead of halfway through the suite.`,
      },
      {
        id: 'a2',
        by: 'sunita-kale',
        on: '2024-08-28',
        votes: 17,
        body: `If you control the agent image, bake the browsers into it and drop the install step entirely. Then \`browsers list\` becomes an assertion about the image rather than a step that does work, and a bad image is caught in seconds.

Either way, only install what the project declares — \`-p <slug>\` limits the list to that project's browsers, so a chromium-only project does not pay for webkit.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-shards-finish-four-minutes-apart',
    title: 'Shard 3 finishes four minutes after shard 1 — is there anything smarter than i/n?',
    askedBy: 'mkuiper',
    askedOn: '2024-11-19',
    tags: ['ci', 'regression', 'cli'],
    votes: 8,
    views: 1190,
    body: `We run the regression across eight shards. The wall-clock time of the job is set by the slowest shard, and ours are consistently uneven — shard 3 carries two long visual features and lands about four minutes after shard 1, which has been idle that whole time.

\`--shard i/n\` splits by test count as far as I can tell, not by duration. We have per-scenario p95 durations sitting in the database from every previous run, so the information to do better exists.

Has anyone built anything on top of this? I am thinking of generating the shard assignment myself and passing explicit \`--feature\` lists per machine, but that is a lot of moving parts to maintain for four minutes. Curious whether anyone has gone down that road and regretted it.`,
    answers: [],
  },

  {
    slug: 'run-project-matrix-vs-repeating-b',
    title: '--project-matrix or three -b flags? What is the difference in practice?',
    askedBy: 'sergio-alcaraz',
    askedOn: '2025-02-11',
    tags: ['ci', 'ui', 'cli'],
    votes: 15,
    views: 4900,
    body: `Our nightly says \`-b chromium -b firefox -b webkit\`. I noticed \`--project-matrix\` in the flag list and it looks like it does the same thing. Is one of them preferred, and what happens if I pass both?`,
    answers: [
      {
        id: 'a1',
        by: 'sunita-kale',
        on: '2025-02-11',
        votes: 19,
        body: `\`--project-matrix\` means "every browser declared in the project YAML". Your three \`-b\` flags mean "these three, whatever the project says".

Prefer the matrix flag for a nightly: when someone adds a browser to the project, the nightly picks it up without an edit to your CI file. Prefer explicit \`-b\` where the point is that this job runs one specific engine — a pull request check on chromium, say.

Note that \`-b\` is checked against the project's allow-list either way:

\`\`\`text
Browser "webkit" is not enabled for project demo-shop (browsers: chromium, firefox).
\`\`\`

Exit 2, before anything runs.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2025-02-12',
        votes: 10,
        body: `If you pass both, \`--project-matrix\` wins — it is read first and the \`-b\` values are ignored. Not an error, which is arguably too quiet, so do not write both and expect an intersection.

The full precedence for browsers is: \`--project-matrix\`, then explicit \`-b\`, then the browsers of a \`--process\`, then the project default.`,
      },
      {
        id: 'a3',
        by: 'rasha-halabi',
        on: '2025-09-02',
        votes: 7,
        body: `From the release side: put the browser list in the process rather than in either flag. \`release-gate\` names its browsers in YAML, so the gate cannot drift because someone edited a workflow, and the list is reviewable in the same place as the pass-rate gate.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-smoke-check-takes-fourteen-minutes',
    title: 'Our @smoke check takes fourteen minutes and people have stopped waiting for it',
    askedBy: 'tanvi-bhatt',
    askedOn: '2025-04-08',
    tags: ['smoke', 'ci', 'pool'],
    votes: 45,
    views: 14380,
    body: `120 scenarios tagged \`@smoke\`, one browser, fourteen minutes on the pull request. The team merges and then reads the result, which means it is not a gate any more.

I do not want to just delete scenarios. Where does the time actually go in a suite like this, and what are the levers in SDODS specifically?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2025-04-08',
        votes: 51,
        body: `Measure first — \`summary.json\` has per-scenario durations and the dashboard has the duration chart — but the costs are nearly always in this order:

- Logging in per scenario. Set \`auth.storageState: true\` and use \`@user:<role>\`. Login then happens once per pool user and every scenario reuses the state. On a 120-scenario suite this alone is usually minutes.
- Starting a browser for something that did not need one. Any scenario that is really about an endpoint should be \`@api\` and never open a browser.
- Slow third-party network. HAR replay with \`--strict\`, so the run does not wait on somebody else's sandbox.
- Screenshots. Keep the \`step\` policy for \`@regression\` and use \`onlyOnFailure\` on slow environments.
- Serialisation. Suites are fully parallel by default; \`-w\` and \`--shard\` are there. \`@mode:serial\` should be rare and deliberate.

And the anti-lever: retries. If the run is slow because things fail and retry, raising retries makes it slower and hides the reason.`,
      },
      {
        id: 'a2',
        by: 'mkuiper',
        on: '2025-04-09',
        votes: 23,
        body: `Once the per-scenario waste is out, buy the rest with machines. We shard the pull request check six ways with a shared \`--run-id\` and merge the reports; 4,000 scenarios, about six minutes wall clock.

Sharding is not a substitute for the first answer though. Six shards of a suite that logs in 120 times is still 120 logins, just spread out.`,
      },
      {
        id: 'a3',
        by: 'j-okonkwo',
        on: '2025-04-09',
        votes: 16,
        body: `If any part of your smoke path touches a payment or identity sandbox, HAR replay is the single biggest win available to you and it is not close. Record once with \`--har-update\`, then run the gate with \`--har-replay --strict\`. Ours went from four minutes of waiting on a third party to nothing, and stopped failing on their maintenance windows as a bonus.`,
      },
      {
        id: 'a4',
        by: 'lena-hartwig',
        on: '2025-04-14',
        votes: 9,
        body: `Before you optimise anything, look at the slowest scenarios in insights. Twice now the answer here has been one scenario with a hard wait in a step, and everybody had been arguing about workers.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-where-do-the-generated-specs-go',
    title: 'Where do the generated spec files live? Git does not see them and neither do I',
    askedBy: 'bruno-teixeira',
    askedOn: '2025-06-24',
    tags: ['cli', 'reporting', 'config'],
    votes: 20,
    views: 7200,
    body: `I understand roughly that the Gherkin gets turned into runner specs before a run. I cannot find them. Nothing appears in my working tree during a run, \`git status\` stays clean, and after the run there is no trace.

Two questions: where are they while the run is happening, and what should I be putting in \`.gitignore\`?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2025-06-24',
        votes: 27,
        body: `They go to \`.sdods/generated/<runId>/<slug>/<layer>/\` and are removed when the run ends. (The \`run\` reference page still calls this \`.features-gen/\`; it is out of date — check the path on disk mid-run if you want to be sure.) The run id is in the path on purpose: two runs on the same machine — a shard and someone's local run, say — never write to the same place and never race.

They are an implementation detail, so do not read them and do not commit them. What you do want to know about is the artefacts directory, which persists:

\`\`\`text
.sdods/runs/<runId>/run.json          the manifest: command, env, git sha, exit code
.sdods/runs/<runId>/summary.json      totals and durations
.sdods/runs/<runId>/messages.ndjson   what ingest reads
.sdods/runs/<runId>/html-report/      the report
.sdods/runs/<runId>/dashboard/
\`\`\`

\`.sdods/\` is what belongs in \`.gitignore\`. The run id is printed at the top of every run:

![Terminal output of a regression run: eight scenarios passed and the run was ingested into the sqlite database](/questions/run-regression.png "The run id printed on the ingest line is the directory name under .sdods/runs")`,
      },
      {
        id: 'a2',
        by: 'ify-adeyemi',
        on: '2025-06-25',
        votes: 12,
        body: `On CI you often want the artefacts somewhere other than the checkout — a mounted volume, or a path your artefact upload already watches. \`--artifacts-dir <dir>\` moves the whole \`<runId>\` tree, and the paths printed at the end of the run follow it.

Upload that directory unconditionally rather than on success. The runs you want the trace for are the failed ones.`,
      },
    ],
  },

  {
    slug: 'run-all-scenarios-passed-but-the-gate-failed',
    title: 'Every scenario passed and the release gate still failed the job',
    askedBy: 'koen-vermeulen',
    askedOn: '2025-09-16',
    tags: ['ci', 'regression', 'config'],
    votes: 31,
    views: 9340,
    body: `\`\`\`bash
sdods run -p demo-shop -e staging --process release-gate
\`\`\`

\`\`\`text
✖ failed  318 passed, 0 failed, 0 skipped, 2 flaky  (662s)
\`\`\`

Nothing failed. Zero. And the job is red, so the release is blocked and I am the one holding it.

I can see the two flaky scenarios in the report and they both ended up passing. What is failing the run?`,
    answers: [
      {
        id: 'a1',
        by: 'rasha-halabi',
        on: '2025-09-16',
        votes: 38,
        body: `The gate is. That is what a gate is for.

\`release-gate\` in the demo YAML carries \`failOnFlaky: true\` and \`gates: { minPassRate: 100, maxFlaky: 0, perfBudgets: true, a11y: true }\`. Two flaky scenarios is \`maxFlaky: 0\` violated, so the process fails even though every scenario eventually passed.

That is deliberate, and it is the difference between a report and a decision: a scenario that only passed on a retry has not demonstrated that the release is good, it has demonstrated that the release is good about two thirds of the time. For a nightly you would absorb that. For a release you should not.

Two legitimate ways forward, and one that is not:

- Fix the two scenarios, which is the point of the gate telling you.
- Decide as a team that \`maxFlaky: 1\` is your standard and change it in the YAML, where it is reviewed.
- Do not pass \`--retries 3\` on the command line to make it go away. Flags override the process's fields, which is exactly how a gate gets quietly weakened.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2025-09-17',
        votes: 13,
        body: `To read it yourself next time: \`summary.json\` has the totals including \`flaky\`, and \`run.json\` records which process the run used. Between the two you can tell "scenarios failed" from "the gate was not met" without opening the HTML report.

Exit code is 1 in both cases, which is the one thing here that is arguably too coarse.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-exit-code-130-in-ci',
    title: 'Job shows exit 130 — did the suite fail or not?',
    askedBy: 'devon-marsh',
    askedOn: '2025-11-20',
    tags: ['ci', 'cli', 'reporting'],
    votes: 15,
    views: 5100,
    body: `Evaluating SDODS against two other tools, so forgive the basic question. A nightly ended with exit code 130 and there is no failing scenario in the report — 212 passed, 0 failed, and then 130.

Our triage rules file anything non-zero as a defect. Should this one be?`,
    answers: [
      {
        id: 'a1',
        by: 'rasha-halabi',
        on: '2025-11-20',
        votes: 22,
        body: `No. 130 means the run was cancelled — Ctrl-C, a cancel from the server or the web UI, or the process being killed. It is not a test result, and filing it as a defect against the suite will waste somebody's morning.

In CI it is nearly always one of: the job hit its timeout, the workflow was cancelled because a newer commit superseded it, or the agent was reclaimed.

The exit code is recorded in \`run.json\` alongside \`finishedAt\`, so you can tell a cancelled run from a completed one after the fact without reading the log. The whole set is worth putting in your triage rules: 0 passed, 1 failures, 2 configuration or usage, 3 lint errors, 130 cancelled — they are all listed on [Reference → Exit codes](https://docs.sdods.com/docs/reference/exit-codes/). Only 1 is a defect candidate.`,
      },
      {
        id: 'a2',
        by: 'sunita-kale',
        on: '2025-11-21',
        votes: 9,
        body: `Check the step timeout against the run's own duration first. If the run was still going at the cut-off, the interesting question is why it was slow, and \`--max-failures\` gives you a much earlier signal than a timeout does — a run that is going to fail 40 scenarios does not need to prove it 40 times.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-quarantine-not-enforced-by-the-runner',
    title: 'Quarantined scenarios still run in our release gate and still fail it',
    askedBy: 'ingrid-solberg',
    askedOn: '2026-02-24',
    tags: ['ci', 'regression', 'config'],
    votes: 19,
    views: 4380,
    body: `We quarantine flaky scenarios in the web UI while somebody fixes them. The dashboard shows them as quarantined, so I assumed that was the end of it.

The release gate disagrees. The quarantined checkout scenario ran last night, failed, and the job exited 1. The gate job does not have a database configured — it uploads artefacts and that is all.

Am I holding this wrong, or does the runner not know about quarantine?`,
    answers: [
      {
        id: 'a1',
        by: 'rasha-halabi',
        on: '2026-02-25',
        votes: 26,
        body: `The runner does not know. This is a real gap, not a misconfiguration on your side.

Quarantine is a fact stored in the database. It is honoured where the numbers are computed — the dashboard, insights, anything reading ingested runs — and it means "keeps running and reporting, does not block". \`sdods run\` selects scenarios from one input only: the tag expression. So on a gate job with no database, nothing in the pipeline has ever heard the word quarantine.

The workaround we use, and it is a workaround:

\`\`\`yaml
processes:
  - name: release-gate
    trigger: release
    tags: '(@smoke or @regression) and not @quarantine'
    failOnFlaky: true
    gates: { minPassRate: 100, maxFlaky: 0 }
\`\`\`

Then tag the scenario \`@quarantine\` in the feature file when you quarantine it in the UI, and declare \`quarantine\` under \`tags.extra\` so lint does not warn about an unknown tag.

The cost is that it is two actions instead of one, and you have to repeat \`and not @quarantine\` in every process, schedule and hand-written command that must stay green. We keep it out of the nightly deliberately — the nightly should still run them, because that is how you find out they are fixed.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2026-02-26',
        votes: 16,
        body: `Confirming the shape of it: selection happens before anything database-backed is consulted, and there is no plan yet for the runner to query the database before choosing scenarios. It would make a run depend on a database being reachable, which is a trade nobody has wanted to make for a gate.

One correction to the docs while you are here: they mention an \`insights quarantine <fingerprint>\` command. The insights CLI is a placeholder today — computing and showing work, the toggle does not. Use the web UI. The tag mirror in the answer above is the part that actually changes what runs.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-no-since-flag-every-pr-runs-everything',
    title: 'Is there a --since? Every pull request runs the entire suite',
    askedBy: 'paulo-mendes',
    askedOn: '2026-04-15',
    tags: ['ci', 'cli', 'regression'],
    votes: 28,
    views: 6140,
    body: `A one-line change to a CSS file runs 900 scenarios. Other tools I have used take a diff and work out which tests could possibly be affected.

I have read the flag list twice and I cannot find anything diff-aware — the selection flags are all tags, layers, browsers, modules, feature and scenario. Is there something I am missing, or is this genuinely not a thing?`,
    answers: [
      {
        id: 'a1',
        by: 'sunita-kale',
        on: '2026-04-15',
        votes: 30,
        body: `Genuinely not a thing. There is no \`--since\`, no changed-files input, and nothing in the run pipeline looks at git beyond recording the sha in \`run.json\`. Selection is exactly the list you found.

What we do instead, in order of how much I would trust it:

1. Keep \`@smoke\` small and honest, and let the pull request run only that. This is the workaround that requires no cleverness and does not go wrong.
2. Map changed paths to modules in the CI job and pass them through: \`sdods run -p demo-shop -m cart -m checkout -t @smoke\`. Cheap to write, and modules already carry an ownership boundary, so the mapping is usually obvious.
3. Shard to cut wall-clock rather than cutting tests. Eight machines running everything is often cheaper than an afternoon debating which scenarios a shared component touches.

If you go with 2, still run everything before merging to main. A one-line CSS change to a shared component genuinely can break nine modules, and a path-based mapping will not know.`,
      },
      {
        id: 'a2',
        by: 'mkuiper',
        on: '2026-04-16',
        votes: 18,
        body: `We do 2 and 3 together on a 4,000-scenario suite: module-scoped smoke on the pull request, full matrix nightly, and a full regression on the merge queue before anything lands on main.

The honest accounting is that module scoping has let two regressions through in three years, both from shared components, and both were caught by the merge-queue run within twenty minutes. That was an acceptable trade for us. It would not be for everybody.`,
      },
      {
        id: 'a3',
        by: 'reeta-nandal',
        on: '2026-04-20',
        votes: 13,
        body: `Half a tool exists, for completeness: \`analyze_change_impact\` over MCP takes a project and a diff range and tells you which scenarios the change touches. It is genuinely useful when an agent or a person is deciding what to look at.

Nothing wires its output into \`sdods run\`. You would be turning a list of scenarios into \`--feature\` arguments yourself, in a script, and owning that script. I would not build a merge gate on it today.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-skip-flag-gated-scenarios-per-environment',
    title: 'Scenarios for a feature flag that is on in staging and off in production',
    askedBy: 'zeynep-arslan',
    askedOn: '2026-06-30',
    tags: ['ci', 'config', 'regression'],
    votes: 16,
    views: 3420,
    body: `Our new checkout is behind a build-time flag. On staging it is on, on the production build it is off, and the flag is baked into the bundle at build time so there is nothing to query at run time.

Eleven scenarios cover it. On staging they pass. On the post-deploy sanity run against production they all fail, correctly — the feature is not there.

I tried checking for the feature inside a step and skipping if it is absent. That felt wrong the moment I wrote it. What is the intended way to say "these scenarios belong to one environment"?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-07-01',
        votes: 22,
        body: `Your instinct about the step is right — delete that. A scenario that decides at run time whether to assert is a scenario that can never fail, and it will go green for the wrong reason long before anyone notices.

There is no flag-aware selection today. Nothing in SDODS talks to a flag service, and because your flag is baked at build time there is not even a run-time fact to read. That is the honest state of it.

The closest supported thing is \`@env:<name>\`, which restricts a scenario to one environment and is validated against \`envs.available\`:

\`\`\`gherkin
  @ui @regression @env:staging
  Scenario: The new checkout summarises the order before payment
\`\`\`

The cost is that it is hand-maintained. When the rollout flips, somebody edits eleven feature files, and nothing reminds them. It also collapses if the same flag is on in two environments and off in a third — you end up with a tag expression instead of a tag.

For that case, tag the group and exclude it explicitly per run:

\`\`\`bash
sdods run -p demo-shop -e prod -t "@sanity and not @newcheckout"
\`\`\`

Declare \`newcheckout\` under \`tags.extra\` so lint accepts it rather than warning.`,
      },
      {
        id: 'a2',
        by: 'rasha-halabi',
        on: '2026-07-02',
        votes: 14,
        body: `Put the exclusion in a process rather than in the command, whichever of the two mechanisms you choose:

\`\`\`yaml
processes:
  - name: prod-sanity
    trigger: manual
    env: prod
    tags: '@sanity and not @newcheckout'
\`\`\`

Two reasons. It is auditable — when someone asks why eleven scenarios did not run against production, the answer is a line in a reviewed file rather than a flag in a workflow. And when the flag ships everywhere, it is one deletion in one place instead of a search across your CI files.

We keep a comment above each such exclusion naming the flag and the person who owns it. Ours have all been removed within a quarter, which is the point.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-a-renamed-tag-left-the-job-passing-with-zero-tests',
    title: 'A renamed tag left our smoke job passing with zero tests for three weeks',
    askedBy: 'tanvi-bhatt',
    askedOn: '2026-01-19',
    tags: ['ci', 'cli', 'smoke'],
    votes: 35,
    views: 7460,
    body: `Three weeks. The only trace, in a log nobody opens:

\`\`\`text
⚠ No scenarios matched the selection (tags @smoke · layers ui,api,hybrid).

✔ passed  0 passed, 0 failed, 0 skipped, 0 flaky  (3s)
\`\`\`

I understand from an older thread here that an empty selection exits 0 on purpose so a matrix leg with nothing to do stays green. Fine. But our job is not a matrix leg, it is the check that gates merges, and it went green for three weeks while testing nothing.

Is there anything better available now than grepping our own logs?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-01-19',
        votes: 41,
        body: `Nothing in the runner will do it for you — that is the honest answer. A selection that matches nothing prints a warning and exits 0:

\`\`\`text
⚠ No scenarios matched the selection (tags: @smoke).
\`\`\`

Exit 0, a summary with zero scenarios, and a green tick. Which is what you had for three weeks.

The check has to live in the job. \`--list\` resolves the selection and prints what would run, without running it, so a scoped job can assert on it before it starts:

\`\`\`bash
sdods run -p demo-shop -e staging -t @smoke --list > selected.txt
test -s selected.txt || { echo "smoke selected nothing"; exit 1; }
sdods run -p demo-shop -e staging -t @smoke
\`\`\`

The other half is not writing the expression in the pipeline at all. A process names the recipe once in the project, so a renamed tag is a change to a file that gets reviewed rather than a string in CI that nobody reads.

It is opt-in for exactly the reason you already know — a shard or a matrix leg with nothing to do has to stay green — but a run somebody scoped by hand is the opposite case, and calling that "passed" hides the mistake behind a green badge. Put it on every hand-written command in CI.

It is not in the flag table in the reference page yet. It is in \`--help\`.`,
      },
      {
        id: 'a2',
        by: 'rasha-halabi',
        on: '2026-01-20',
        votes: 15,
        body: `Runs started from the web UI run dialog already pass it — somebody scoped that run by hand, so matching nothing is a mistake rather than a pass. If you have seen a run from the dialog fail with zero tests and wondered why the same selection from the CLI did not, that is the difference.

Belt and braces on top: our release gate asserts \`totals.total\` against a floor read from the previous green run, so a selection that halves is caught too, not only one that empties.`,
      },
      {
        id: 'a3',
        by: 'bea-lindqvist',
        on: '2026-02-02',
        votes: 11,
        body: `Also: stop renaming suite tags. There are three of them and every pipeline, process and schedule you own is written against those names. If a team genuinely needs a fourth, add it under \`tags.suites\` in the project YAML — then lint knows about it and the rename is a config change rather than a silent hole in your gate.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'run-repeat-each-together-with-shard',
    title: 'Does --repeat-each 5 with --shard 1/4 repeat inside the shard or across shards?',
    askedBy: 'mkuiper',
    askedOn: '2026-08-11',
    tags: ['ci', 'cli', 'regression'],
    votes: 4,
    views: 265,
    body: `Setting up a soak job: run the regression five times over, spread across four machines, and fail if anything is flaky.

\`\`\`bash
sdods run -p demo-shop -e staging -t @regression --repeat-each 5 --shard 1/4 --run-id soak-0811 --reporter blob --fail-on-flaky
\`\`\`

What I cannot work out is whether the repeats are part of the set that gets sharded — so each machine gets a quarter of 5N tests — or whether each shard takes a quarter of the N scenarios and then repeats each of them five times locally. The wall-clock maths is the same either way, but the flakiness answer is not: repeats spread across four machines exercise four different environments, and repeats on one machine exercise the same one four times, which is a weaker test of exactly what I am trying to measure.

Has anyone actually watched this happen rather than reasoned about it? I can instrument it, but if someone already knows I would rather not.`,
    answers: [],
  },
];
