import type { Thread } from '../types';

export const visualThreads: Thread[] = [
  {
    slug: 'vis-baseline-first-run-writes-and-fails',
    title: 'First @visual run fails with "A snapshot doesn\'t exist" and then passes. Bug?',
    askedBy: 'elsa-nyman',
    askedOn: '2021-11-08',
    tags: ['visual', 'ui'],
    votes: 41,
    views: 15920,
    body: `Copied the baseline example out of the guide more or less verbatim:

\`\`\`gherkin
@ui @regression @visual
Scenario: The sign-in page matches its baseline
  Given I am on the sign-in page
  Then the page should match the visual baseline "signin"
\`\`\`

\`\`\`bash
sdods run -p rwa-bank -e local -l ui -b chromium -t @visual
\`\`\`

It fails:

\`\`\`text
Error: A snapshot doesn't exist at projects/rwa-bank/features/__screenshots__/rwa-bank--ui--chromium/darwin/signin.png, writing actual.
\`\`\`

The PNG is sitting there afterwards and the second run is green. So am I supposed to run it twice on purpose, or did I miss a setting somewhere?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2021-11-08',
        votes: 52,
        body: `Neither. That failure is the design, and the message is doing exactly what it says: there was no baseline, so it wrote one and told you it had nothing to compare against.

The alternative is worse. If the first run passed quietly, your very first baseline would be a file nobody ever looked at, promoted to the truth by a green tick. Failing forces a person to open the PNG once.

The workshop chapter spells this out in the same words: [Screenshots and visual baselines](https://docs.sdods.com/docs/workshop/visual-a11y-performance/).`,
      },
      {
        id: 'a2',
        by: 'annika-solheim',
        on: '2021-11-10',
        votes: 18,
        body: `One habit that follows from that: do not let the run which writes the baseline be the run that gates a merge.

Record it deliberately, look at it, commit it:

\`\`\`bash
sdods run -p rwa-bank -e local -l ui -b chromium -t @visual --update-snapshots
\`\`\`

After that, every run in the pipeline only ever compares — it never writes — and a red \`@visual\` means something changed rather than "this is the first time".`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-visual-flaky-on-ci-green-on-my-laptop',
    title: '@visual is green locally and reported flaky on CI — attempt 1 fails, attempt 2 passes',
    askedBy: 'sam-orbison',
    askedOn: '2022-05-19',
    tags: ['visual', 'ci', 'linux'],
    votes: 58,
    views: 21400,
    body: `Same commit, same command, two machines.

On my laptop:

\`\`\`bash
sdods run -p rwa-bank -e local -l ui -b chromium -t @visual
\`\`\`

Green, every time. On the CI job (Ubuntu runner, project has \`retries: { ci: 2 }\`) the scenario is reported flaky. Attempt 1:

\`\`\`text
Error: A snapshot doesn't exist at projects/rwa-bank/features/__screenshots__/rwa-bank--ui--chromium/linux/signin.png, writing actual.
\`\`\`

Attempt 2 passes and the run finishes green-with-a-flaky. Nothing in git changed between the attempts, obviously. This has happened on every nightly for a week and I do not understand what is unstable.`,
    answers: [
      {
        id: 'a1',
        by: 'nadia-belkacem',
        on: '2022-05-19',
        votes: 71,
        body: `Nothing is unstable. Read the two paths next to each other:

\`\`\`text
projects/rwa-bank/features/__screenshots__/rwa-bank--ui--chromium/darwin/signin.png
projects/rwa-bank/features/__screenshots__/rwa-bank--ui--chromium/linux/signin.png
\`\`\`

The platform is a segment in the baseline path. You have committed the first one. The second one does not exist, so on the runner every attempt 1 is a first run: it writes a baseline and fails, exactly as it did on your laptop the very first time. Attempt 2 then finds the file attempt 1 just wrote and passes.

The runner is thrown away at the end of the job, the written file goes with it, and tomorrow it happens again. "Flaky" is a fair description of what you are seeing and completely the wrong diagnosis.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2022-05-20',
        votes: 26,
        body: `Why the platform is in the path at all: font rendering. Glyph rasterisation and subpixel antialiasing are not the same on macOS and on Linux, and text is most of the pixels on most pages. A baseline recorded on a laptop would not match a Linux runner even with byte-identical CSS and the same browser build — so rather than compare and fail, the path keeps them apart.`,
      },
      {
        id: 'a3',
        by: 'priya-venkatesh',
        on: '2022-06-02',
        votes: 34,
        body: `The fix is to produce the Linux baseline where CI produces it. Run the job once on a Linux runner with the update flag, then commit what it leaves behind:

\`\`\`bash
sdods run -p rwa-bank -e ci -l ui -b chromium -t @visual --update-snapshots
\`\`\`

You commit \`__screenshots__/rwa-bank--ui--chromium/linux/\` alongside the darwin one, and from then on both machines compare rather than write.

Two things I would do at the same time:

- Keep \`@visual\` out of the tag expression that gates a merge until the Linux baselines are in. A suite that goes flaky on a fresh runner teaches people to ignore red.
- Do not accept a baseline produced on a runner without opening it. It is a screenshot of your app taken by a machine nobody was watching.

This exact case is in [Known limitations](https://docs.sdods.com/docs/reference/known-limitations/).`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-baseline-directory-name-does-not-match-the-guide',
    title:
      'Guide says baselines live under __screenshots__/<browser>/ — mine are in demo-shop--ui--chromium/darwin/',
    askedBy: 'gcastellano',
    askedOn: '2022-09-27',
    tags: ['visual', 'config', 'ui'],
    votes: 22,
    views: 8630,
    body: `[Screenshots and visual testing](https://docs.sdods.com/docs/guides/screenshots-and-visual/) says:

> Baselines live under \`projects/<slug>/features/__screenshots__/<browser>/\`

What is actually on disk after a run:

\`\`\`text
projects/demo-shop/features/__screenshots__/demo-shop--ui--chromium/darwin/inventory.png
\`\`\`

Two extra segments and neither of them is just the browser. I want to write a cleanup script that prunes baselines for browsers we dropped, so I would rather know the real rule than pattern-match on what I can see today.`,
    answers: [
      {
        id: 'a1',
        by: 'nadia-belkacem',
        on: '2022-09-27',
        votes: 29,
        body: `The two segments are the run target and the platform.

- \`demo-shop--ui--chromium\` is the run target name: project slug, layer, browser, joined with a double dash. The API layer has no browser so its targets are two segments, but the API layer never takes a screenshot.
- \`darwin\` is the platform the baseline was recorded on.

So the real rule is \`__screenshots__/<project>--<layer>--<browser>/<platform>/<name>.png\`. Dropping a browser means deleting one directory per platform, not one directory.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2022-09-28',
        votes: 24,
        body: `To be exact about where it comes from: the runner config sets the snapshot path template to \`{projectName}/{platform}/{arg}{ext}\` under \`<project root>/features/__screenshots__\`, and \`{projectName}\` is the run target, not the SDODS project.

The guide's shorthand predates the layer being part of that name and is wrong. [Known limitations](https://docs.sdods.com/docs/reference/known-limitations/) is closer — it has the platform — but writes \`<project>\` where it means the run target. Both want a fix; thank you for reading them side by side.`,
      },
      {
        id: 'a3',
        by: 'mkuiper',
        on: '2022-10-04',
        votes: 11,
        body: `Practical consequence nobody mentions until it bites: adding a browser to \`browsers:\` in the project yaml creates a whole new baseline tree, empty, for every platform you run on.

\`\`\`yaml
browsers: [chromium, firefox, webkit]
\`\`\`

That is one line in review and six directories of missing baselines in the nightly. Add browsers to \`@visual\` deliberately, not as a side effect of widening the matrix.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-mask-a-timestamp-that-changes-every-run',
    title: 'How do I keep a "last updated" timestamp out of a visual baseline?',
    askedBy: 'ade-oyinlola',
    askedOn: '2023-04-11',
    tags: ['visual', 'config', 'mock'],
    votes: 27,
    views: 9840,
    body: `The dashboard we are baselining has a "last updated HH:MM:SS" line in the header. Every single run differs by that strip of pixels, so the baseline is red forever and the diff is a tiny grey smear in the corner.

I do not want to delete the scenario and I do not want to raise the tolerance until the whole layout can move without anyone noticing. What is the intended way to say "ignore this box"?`,
    answers: [
      {
        id: 'a1',
        by: 'nadia-belkacem',
        on: '2023-04-11',
        votes: 33,
        body: `\`screenshots.mask\`. It is a list of selectors that get painted over before the pixels are compared, and it applies to the baseline comparison as well as to the narrated step captures:

\`\`\`yaml
screenshots:
  policy:
    default: on-failure
    '@visual': visual
  mask:
    - '[data-test="last-updated"]'
  viewport: { width: 1280, height: 720 }
\`\`\`

Two things to know about it.

It is project-wide, not per scenario. That reads like a limitation and usually is not: a region that is unstable in the baseline scenario is unstable in every other capture too, and a masked box in a step screenshot is more honest than a box that says 14:03:07 in an artefact somebody reads at 09:00 the next morning.

The strings are raw CSS selectors handed to the page — the role-and-name locator priority does not apply here, because you are describing a rectangle, not an element a user interacts with. Pick something stable; a test id is the usual right answer.

More in [Screenshots and visual testing](https://docs.sdods.com/docs/guides/screenshots-and-visual/).`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-fade-in-makes-the-diff-flap',
    title: 'Diff flaps between clean and 2% on a page with a fade-in, but animations are disabled',
    askedBy: 'yusuf-demir',
    askedOn: '2023-07-19',
    tags: ['visual', 'ui'],
    votes: 14,
    views: 5120,
    body: `About one run in four:

\`\`\`text
Error: Screenshot comparison failed:

  18420 pixels (ratio 0.02 of all image pixels) are different.
\`\`\`

The rest of the time it is clean. The only thing on that page that moves is a card that fades in when the summary request comes back.

My understanding was that captures already run with animations disabled, so what is left to be non-deterministic?`,
    answers: [
      {
        id: 'a1',
        by: 'nadia-belkacem',
        on: '2023-07-19',
        votes: 21,
        body: `Animations are disabled on every capture, yes — finite CSS animations are fast-forwarded to their end state and infinite ones are frozen. What that cannot do is wait for the data behind the fade.

Your card is not mid-animation, it is mid-request. Sometimes the summary has landed when the comparison happens and sometimes it has not, and disabling animations makes the two outcomes crisper rather than closer.

Assert the settled state before you compare, and let the assertion be the wait:

\`\`\`gherkin
@ui @regression @visual
Scenario: The account summary matches its baseline
  Given I am on the account page
  Then the element with test id "summary-total" should be visible
  And the page should match the visual baseline "account-summary"
\`\`\`

No sleep, no polling loop — the visibility assertion already retries until the timeout, so by the time the baseline step runs the page is in one state rather than two.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2023-07-21',
        votes: 12,
        body: `Worth adding what your escape hatches are not.

The comparison runs with a maximum different-pixel ratio of 0.01, and that number is not exposed in the project yaml today. So a page that genuinely moves 2% will keep failing and there is no knob to turn.

I am not in a hurry to add one either. A tolerance loose enough to hide a fading card is loose enough to hide a column that dropped below the fold. Stabilise the region or mask it; those are the two answers that stay true when someone else inherits the suite.`,
      },
    ],
  },

  {
    slug: 'vis-retina-baseline-recorded-at-two-x',
    title: 'Is my baseline being recorded at 2x because the laptop screen is retina?',
    askedBy: 'nikhil-sane',
    askedOn: '2024-03-05',
    tags: ['visual', 'macos', 'ui'],
    votes: 9,
    views: 3180,
    body: `Trying to work out in advance why a macOS baseline will not match a Linux one, before I spend a day on it.

My assumption was device pixel ratio: the Mac renders at 2x, the runner at 1x, so the PNGs are different sizes and the comparison never had a chance. Is that the mechanism, and if so is there a setting that pins the ratio so one baseline could serve both?`,
    answers: [
      {
        id: 'a1',
        by: 'nadia-belkacem',
        on: '2024-03-05',
        votes: 16,
        body: `Open the PNG and check before you plan around it — it will be 1280x720, or whatever \`screenshots.viewport\` says. The baseline comparison works in CSS pixels, so a retina display does not double the file, and pinning the ratio would fix a problem you do not have.

What actually differs is the text. Glyph rasterisation, hinting and subpixel antialiasing are properties of the operating system, and on a normal page text is most of the pixels that carry information. Two machines rendering the identical DOM with the identical browser produce images that are visibly the same and numerically different, everywhere there is a letter.

That is why the platform is a path segment rather than a tolerance: you cannot pick a threshold that forgives every glyph edge and still notices a heading that moved four pixels. So the honest design is two baselines, one per platform, each compared strictly.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-commit-baseline-pngs-or-use-lfs',
    title: 'Do you commit baseline PNGs into the repo, or is this what git-lfs is for?',
    askedBy: 'fiona-mcallister',
    askedOn: '2024-06-18',
    tags: ['visual', 'ci'],
    votes: 19,
    views: 7460,
    body: `We are about to turn \`@visual\` on for real — currently one scenario, about to be fifteen, on two browsers, and eventually two platforms once CI has its own baselines.

Before I commit the first batch: does anyone regret putting the PNGs straight into git? Our repo is already not small and I would rather set up LFS now than migrate later.`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2024-06-18',
        votes: 27,
        body: `Commit them plainly. Do the arithmetic before you reach for LFS.

A 1280x720 PNG of a mostly flat application UI is tens of kilobytes — flat colour compresses well, and screenshots of forms and tables are mostly flat colour. Fifteen scenarios on two browsers and two platforms is sixty files. That is a few megabytes, once, and thereafter only the ones that genuinely change.

Baselines also want to be reviewable in a pull request and revertable with the commit that broke them. Both of those are worse behind LFS, and neither is worth trading away for single-digit megabytes.`,
      },
      {
        id: 'a2',
        by: 'nadia-belkacem',
        on: '2024-06-19',
        votes: 14,
        body: `The multiplier to watch is browsers times platforms, not scenarios. Going from fifteen scenarios to thirty adds fifteen files per target; adding webkit and a Linux runner doubles everything you already have, twice.

So the question that actually controls the size of this directory is which browsers earn a pixel baseline. For most teams that is one, and the other browsers get functional coverage instead.`,
      },
      {
        id: 'a3',
        by: 'mkuiper',
        on: '2024-06-24',
        votes: 9,
        body: `If you do end up on LFS eventually, the failure mode to know about: every job that runs \`@visual\` then needs the LFS fetch too, and a job that skips it checks out pointer files — small text files sitting exactly where the PNG should be.

The comparison does not say "this is a pointer file". You get a decode error or a wildly wrong diff, on CI only, on the one job somebody added last week. Perfectly debuggable and a genuinely miserable hour.`,
      },
      {
        id: 'a4',
        by: 'tomas-brekke',
        on: '2024-06-25',
        votes: 8,
        body: `One mechanical note in case it is behind the question: the lint walker descends \`features/\` and skips \`__screenshots__\`, so a PNG in there is never mistaken for something it should parse.

Which is to say you do not need to move baselines out of \`features/\` to keep the directory tidy for tooling. Leave them where the runner writes them.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-keep-baselines-drop-per-step-captures',
    title: 'Runs are 900MB of PNGs — can I keep the baseline check and stop capturing every step?',
    askedBy: 'sergio-alcaraz',
    askedOn: '2025-02-26',
    tags: ['visual', 'config', 'reporting'],
    votes: 16,
    views: 5890,
    body: `Nightly regression writes a before and an after image for every UI step, which is wonderful when something fails and enormous every other night. The artefact bucket is the problem, not the runtime.

What I want on that one environment is: no step captures, still fail on a baseline drift. Is that expressible, or is it all-or-nothing per policy?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2025-02-26',
        votes: 22,
        body: `Expressible, and it is the case the flag was added for. Set it on the environment rather than the project so your local runs keep their narrative:

\`\`\`yaml
screenshots:
  onlyOnFailure: true
\`\`\`

\`\`\`bash
SDODS_SHOTS_ONLY_ON_FAILURE=1 sdods run -p demo-shop -e staging -t @regression
\`\`\`

Either form downgrades the capture mode to on-failure — no scenario start and end, no per-step before and after — and deliberately leaves the baseline comparison switched on. The visual assertion is an assertion; it is not a screenshot policy, and turning down the narration should not quietly stop testing something.`,
      },
      {
        id: 'a2',
        by: 'nadia-belkacem',
        on: '2025-02-27',
        votes: 11,
        body: `Worth knowing the precedence at the same time, because the next question is usually "why does my \`@regression @visual\` scenario still compare when I set \`'@regression': step\`":

1. \`@visual\` wins outright.
2. Otherwise the suite tag on the scenario (\`@smoke\`, \`@regression\`, \`@sanity\`).
3. Otherwise any other tag on the scenario that has a key in \`screenshots.policy\`.
4. Otherwise \`default\`.

So \`@visual\` is not a policy you can be talked out of by a broader tag, which is what you want given a scenario carries several tags and only one of them is about pixels.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-see-expected-vs-actual-after-a-ci-failure',
    title: 'Where do I actually look at expected vs actual after a @visual failure on CI?',
    askedBy: 'ingrid-solberg',
    askedOn: '2026-03-19',
    tags: ['visual', 'reporting', 'ci'],
    votes: 6,
    views: 1240,
    body: `The nightly went red on a baseline scenario. I can see the scenario failed and I can read the pixel count in the log, which tells me nothing about whether somebody changed a button or a font.

Is there a view that puts the committed baseline and the actual capture next to each other, or am I meant to download the artefacts and open them in an image viewer?`,
    answers: [
      {
        id: 'a1',
        by: 'nadia-belkacem',
        on: '2026-03-19',
        votes: 12,
        body: `There is a view. Open the run, go to the Scenarios tab, expand the scenario, and the step that ran the baseline assertion carries a block headed "Visual baseline" with the name you gave it. Inside that block the expected and the actual image are loaded together, and it opens in diff mode by default — there is also a slider, an overlay and plain side-by-side if the diff is too noisy to read.

![The SDODS run detail page, Scenarios tab, listing the Inventory page visual baseline scenario with a visual tag](/questions/ui-run-detail.png "Run detail — the visual scenario is the row tagged visual")

Locally the same thing without the server:

\`\`\`bash
sdods report --last --open
\`\`\`

The slider is the one I actually use. A font change moves every glyph edge slightly and looks like noise in a diff; drag the slider and it is obvious in a second.`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2026-03-20',
        votes: 9,
        body: `Caveat for the CI half of the question: those images only reach the server if the run is ingested on the machine that produced them. The ingest route accepts \`run.json\`, NDJSON and runner JSON — it does not accept an artefacts archive yet, so uploading a tarball from a later job gets you the rows and none of the pictures.

Two ways round it:

- Put \`--ingest\` on the CI run itself, so it ingests from the runner while the files are still there.
- Or run \`sdods report ingest --artifacts-dir .sdods/runs\` as a later step in the same job.

Listed under [Known limitations](https://docs.sdods.com/docs/reference/known-limitations/) as "Server ingest".`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-a11y-step-undefined-but-reference-lists-it',
    title: 'Lint says the accessibility step is undefined, but the step library reference lists it',
    askedBy: 'chandra-p',
    askedOn: '2023-11-30',
    tags: ['a11y', 'lint', 'ui'],
    votes: 31,
    views: 11270,
    body: `Copied the scenario straight out of [Accessibility and performance budgets](https://docs.sdods.com/docs/guides/accessibility-and-performance/):

\`\`\`gherkin
@ui @regression @a11y
Scenario: The inventory page has no serious accessibility violations
  Given I am on the inventory page
  Then the page should have no accessibility violations of impact "serious" or higher
\`\`\`

\`\`\`bash
sdods lint -p demo-shop
\`\`\`

\`\`\`text
features/inventory/a11y.feature:6
Undefined step: Then the page should have no accessibility violations of impact "serious" or higher
\`\`\`

The phrasing is identical to the table in the step library reference, down to the quotes. What am I missing — a plugin, a dependency, a config flag?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2023-11-30',
        votes: 44,
        body: `Nothing. The step does not exist. Neither does \`the page should meet the performance budget\`.

I would rather say that plainly than let you spend an afternoon on the configuration. The accessibility guide and that row in the step library reference describe a design, not a build. What is real as I write this is that \`@a11y\` and \`@perf\` are reserved in the tag taxonomy and that the project schema accepts accessibility and performance gates on a process. There is no axe hook in the runner yet, and no budget check.

The page that is honest about it is the workshop chapter: [Screenshots, a11y and performance](https://docs.sdods.com/docs/workshop/visual-a11y-performance/).

If you want the check anyway, the interim shape is yours to own:

1. Add the accessibility library to your own project's dependencies — nothing in SDODS pulls it in.
2. Write the step under \`projects/<slug>/steps/\` with the phrasing you actually want, and assert on the result there.
3. Attach the JSON under \`sdods/a11y/<step>\`. That attachment name is already reserved in the contracts, so the run viewer and the ingest will file it in the right place even though nothing produces it yet.

\`\`\`bash
sdods steps list -p demo-shop
\`\`\`

is the fastest way to check whether a phrasing you read somewhere is really in your catalogue.`,
      },
      {
        id: 'a2',
        by: 'helle-borg',
        on: '2023-12-04',
        votes: 15,
        body: `Before you build step 2, agree what "serious or higher" is going to mean to your team.

The impact field on an accessibility finding is a heuristic supplied by the rule engine, not a severity your product has agreed to. A rule set is not a policy. Teams that skip that conversation ship a gate that fails on a decorative image and passes a keyboard trap, and then quite reasonably stop believing it.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-perf-budgets-validate-but-page-still-passes',
    title:
      'perf.budgets validates and resolves, and a nine-second page still passes. What am I missing?',
    askedBy: 'anouk-devries',
    askedOn: '2024-10-22',
    tags: ['perf', 'config', 'ci'],
    votes: 24,
    views: 8150,
    body: `Project yaml:

\`\`\`yaml
perf:
  budgets: { pageLoadMs: 4000, lcpMs: 3000, apiP95Ms: 1500 }
\`\`\`

Environment override, and a process that asks for the gate:

\`\`\`yaml
processes:
  - name: release-gate
    trigger: release
    tags: '@smoke or @regression'
    gates: { minPassRate: 100, maxFlaky: 0, perfBudgets: true, a11y: true }
\`\`\`

\`\`\`bash
sdods config show -p demo-shop -e staging --explain
\`\`\`

shows \`perf.budgets.pageLoadMs\` resolving from \`envs/staging.yaml\`, so the plumbing is clearly there. But a page we know takes about nine seconds on staging goes green, and no scenario has ever failed on the gate. Is the budget compared against the wrong metric, or am I meant to add a step?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2024-10-22',
        votes: 38,
        body: `You are missing nothing, and the reason it looks like plumbing is that it is plumbing with nothing on the end of it.

The schema accepts \`perf.budgets\`. The schema accepts \`perfBudgets\` and \`a11y\` on a process gate. The resolver merges them and \`config show --explain\` will happily tell you which layer won. Then, as of this answer, nothing at run time reads either value. There is no timing check and no accessibility hook yet — the gate booleans are recorded and never asked.

So a green run is not evidence about the speed of that page. It is evidence that the scenario's assertions passed.

This is stated on [the workshop chapter](https://docs.sdods.com/docs/workshop/visual-a11y-performance/); the accessibility and performance guide contradicts it and the guide is the one that is wrong.`,
      },
      {
        id: 'a2',
        by: 'helle-borg',
        on: '2024-10-25',
        votes: 13,
        body: `If the budget matters for a release, put it somewhere that enforces it — a separate step in the pipeline that measures and exits non-zero, owned by whoever cares about the number.

Keeping the yaml key costs nothing and documents the intent, so I would leave it. Just do not let anybody put "performance budgets enforced" on a slide because the key is in the file.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-a11y-tagged-scenario-green-did-axe-run',
    title: 'Tagged a scenario @a11y and it went green in four seconds — how do I tell if axe ran?',
    askedBy: 'koen-vermeulen',
    askedOn: '2025-06-11',
    tags: ['a11y', 'ui', 'regression'],
    votes: 20,
    views: 6340,
    body: `Added \`@a11y\` to two existing scenarios expecting them to get slower and probably to fail, because the pages in question are not good.

\`\`\`bash
sdods run -p demo-shop -e staging -l ui -b chromium -t @a11y
\`\`\`

Both passed, in about the same time as before. I cannot tell from the output whether an accessibility pass ran and found nothing, or nothing ran. Is there something in the report that would distinguish the two?`,
    answers: [
      {
        id: 'a1',
        by: 'annika-solheim',
        on: '2025-06-11',
        votes: 28,
        body: `Yes, and it will tell you nothing ran.

An accessibility pass would attach JSON per step under \`sdods/a11y/<step>\`. Open the run, go to Artifacts, and there is nothing under that name. Empty artefacts is the difference between "checked and clean" and "not checked", and it is the only reliable tell.

For now \`@a11y\` is a plain selection tag. In this area the only tag the runner treats specially is \`@visual\`, which chooses the screenshot policy; everything else a scenario carries is used to decide whether it runs, not what happens while it does. Your two scenarios ran as ordinary scenarios and passed for the ordinary reason.`,
      },
      {
        id: 'a2',
        by: 'helle-borg',
        on: '2025-06-12',
        votes: 17,
        body: `And this is why the empty-artefact tell matters more than it sounds. A green accessibility test that runs nothing is worse than having no accessibility test, because it is a claim — on a dashboard, in a report to somebody who cannot check it, eventually in a procurement answer.

Rename the tag, add a comment above the scenario, do whatever your team will actually read. Just do not leave \`@a11y\` sitting there looking like coverage.`,
      },
      {
        id: 'a3',
        by: 'elsa-nyman',
        on: '2025-06-18',
        votes: 9,
        body: `The thing that has genuinely caught accessibility regressions for us, in the absence of a checker, is the locator strategy.

Scenarios written against role and accessible name break the moment the accessible name disappears — somebody swaps a labelled button for a div with a click handler and four scenarios go red for what looks like a locator reason and is actually the finding.

It is not a substitute. It says nothing about contrast, focus order, or heading structure. But it is not nothing, and it is the part you already have.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-a11y-guide-and-workshop-contradict',
    title: 'Two documentation pages say opposite things about @a11y. Which one should I believe?',
    askedBy: 'rasha-halabi',
    askedOn: '2025-08-28',
    tags: ['a11y', 'perf'],
    votes: 33,
    views: 7910,
    body: `Not a bug report, a request for a ruling, because I have to tell a client which it is.

The guide describes a hook that runs an accessibility pass after each UI step, violations attached per step, an assertion step with an impact threshold, performance budgets per environment and gates on a process.

The workshop chapter says:

> The tag taxonomy reserves \`@a11y\` and \`@perf\`, and the project schema accepts accessibility and performance gates on a process. Neither is implemented in the runner today — an \`@a11y\` scenario runs as an ordinary scenario, and a performance budget is not enforced.

Both pages are in the same documentation set, published together. One of them is wrong and I cannot tell from the outside which.`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2025-08-28',
        votes: 47,
        body: `The workshop chapter is right. As of today, \`@a11y\` and \`@perf\` are schema-only: reserved in the tag taxonomy, accepted by the project schema, read by nothing at run time.

The accessibility and performance guide describes a design that was written before the code and never retracted when the code went a different way. The step library reference is wrong in the same direction — it lists two steps that are not in the catalogue, which you can confirm yourself with \`sdods steps list\`. Known limitations records the visual-baseline gap and not this one, which is a third instance of the same bug.

It is on [the roadmap](https://docs.sdods.com/docs/roadmap/) as a choice between implementing the checks and retracting the pages. I am not going to give you a date in a forum post; tell your client that the tags are reserved and the checks are not implemented, because that is the sentence that will still be true whichever way it goes.`,
      },
      {
        id: 'a2',
        by: 'helle-borg',
        on: '2025-08-29',
        votes: 21,
        body: `A habit worth having generally, not just here: when a claim in a guide matters, verify it against the catalogue rather than the prose.

\`\`\`bash
sdods steps list -p demo-shop
\`\`\`

A step that is not in that output cannot run, whatever a table says. The same trick works for config: \`sdods config show --explain\` tells you a key resolved, which is a weaker statement than "something reads it", and this thread is exactly the gap between those two.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-a11y-why-findings-need-a-human-pass',
    title:
      'If we wire an accessibility checker in ourselves, why does everyone insist on human triage?',
    askedBy: 'tanvi-bhatt',
    askedOn: '2025-10-09',
    tags: ['a11y', 'ui'],
    votes: 11,
    views: 2760,
    body: `We accepted that the tag does nothing and we are adding our own step, so we will shortly have a machine-readable list of violations per page.

The advice I keep getting is "do not gate on it directly, triage first". That sounds like the advice that turns a check into a report nobody reads. What specifically goes wrong if we just fail the build on anything serious or above?`,
    answers: [
      {
        id: 'a1',
        by: 'helle-borg',
        on: '2025-10-11',
        votes: 19,
        body: `I audit these for a living, so: what goes wrong is that a meaningful fraction of the findings are true statements about the DOM and wrong statements about the product.

The ones that show up in nearly every suite I see:

- Contrast reported on controls that are disabled, where the low contrast is the meaning.
- Decorative imagery flagged for a missing name, where a name would make it worse for a screen reader user, not better.
- Duplicate landmarks reported inside a modal, because the checker sees the page underneath as well as the dialog.
- Findings on third-party widgets you do not control and cannot fix this quarter.

None of that means the tool is bad. It means the tool reports what it can see, and whether a finding is a defect depends on intent, which is not in the DOM.

So the failure mode of gating on everything is not false confidence, it is abandonment: the gate fires on something nobody agrees is a bug, somebody adds an exception, then a wildcard, then a skip, and within two sprints you have neither the gate nor the report.

What survives contact with a team is smaller: pick a short list of rules your team has actually agreed are never acceptable, fail on those, and attach the rest so the trend is visible. Grow the list when a category stops appearing.`,
      },
    ],
  },

  {
    slug: 'vis-a11y-brand-colour-fails-contrast',
    title: 'Our brand indigo measures 4.47:1 on white — do we have to change the brand?',
    askedBy: 'paulo-mendes',
    askedOn: '2026-05-21',
    tags: ['a11y', 'ui'],
    votes: 7,
    views: 1490,
    body: `Audit finding we cannot argue our way out of. The brand colour is an indigo that measures 4.47:1 against white, which is under the line by a hair, and it is used for links, for small labels, and as the fill behind white text on the landing page call to action.

Design's position is that the colour is the brand and everything else is negotiable. Before I go back into that meeting: is this actually one finding or several, and is there a version of the fix that does not repaint the company?`,
    answers: [
      {
        id: 'a1',
        by: 'helle-borg',
        on: '2026-05-21',
        votes: 16,
        body: `Several, and they do not all fail.

4.47:1 is under the 4.5:1 that normal-size text needs, so the links and the small labels fail, and so does white text sitting on that fill — the CTA is text on a colour, and it is judged as text. But the button's own edge against the page is a non-text boundary and only needs 3:1, which your indigo clears comfortably. Large display text has a lower bar too.

So the fix is usually not the brand, it is the rule that the brand colour is not allowed to carry a glyph. Darken one step on the same ramp for anything with text on or in it — the next tint down is typically somewhere above 6:1 on white, which is not a close call — and keep the original for fills, borders, the focus ring and the chart series where nothing is written.

Visually that is almost invisible: two adjacent tints of the same hue, and one of them only ever appears under letters. It is the version of this that design teams accept, because nobody is being told their colour was wrong.

The CTA is the one that gets missed every time, incidentally. It reads as a brand asset rather than as text, so it never gets measured, and it is the single most-clicked thing on the site.`,
      },
      {
        id: 'a2',
        by: 'annika-solheim',
        on: '2026-05-22',
        votes: 8,
        body: `And to close the loop on the SDODS side, since this is a testing forum: nothing here is going to be caught by the suite.

There is no accessibility checker in the runner, so \`@a11y\` will not measure it. Even if there were, contrast is a decision made in a palette, not a property of a locator — a self-healing locator can find a button whose test id changed; it cannot notice the button is the wrong colour. This one is a design review item with a number attached, and the number is the useful part.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'vis-perf-collect-lcp-without-a-budget',
    title: 'Can I get LCP out of a run as a recorded number, given budgets are not enforced?',
    askedBy: 'zeynep-arslan',
    askedOn: '2026-07-14',
    tags: ['perf', 'reporting', 'ci'],
    votes: 2,
    views: 118,
    body: `I have read the workshop chapter, so I know \`@perf\` does not gate anything today and I am not asking for the gate.

What I want is the measurement recorded per run so I can watch it drift across a quarter. The contracts already reserve an attachment name \`sdods/perf/<step>\` and a per-step file \`perf/NN.json\`, and the run types carry an optional perf field, so the shape exists.

Two questions:

1. Is anything writing to those names today, or are they reserved for something that does not exist yet?
2. If I attach my own JSON under \`sdods/perf/<step>\` from a step I write, does the ingest pick it up into the run record, or does it need a matching column before it becomes queryable?

Happy to write the collection step. I would just rather write it into the shape that is going to be filled in than invent a parallel one.`,
    answers: [],
  },
];
