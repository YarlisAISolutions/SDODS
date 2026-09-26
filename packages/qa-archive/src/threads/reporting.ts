import type { Thread } from '../types';

export const reportingThreads: Thread[] = [
  {
    slug: 'rep-where-does-a-run-write-its-files',
    title: 'Where does a run actually write its files? I cannot find the report',
    askedBy: 'hsu-wei-lin',
    askedOn: '2020-11-19',
    tags: ['reporting', 'cli'],
    votes: 44,
    views: 16210,
    body: `First real run finished and the console printed the totals, but I have no idea where anything landed. I was expecting a \`reports/\` folder next to \`features/\`.

\`\`\`bash
sdods run -p demo-shop -e staging -l ui -b chromium -t @smoke
\`\`\`

There is a \`.sdods\` directory in the workspace root. I do not want to poke around in it blind — what is in a run directory, and which file am I supposed to open?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2020-11-19',
        votes: 58,
        body: `Everything a run produces goes under \`.sdods/runs/<runId>/\`. The run id is a UUID v7, so the directories sort by time on their own.

\`\`\`text
.sdods/runs/<runId>/
  run.json                     manifest: project, env, tags, browsers, git, command
  summary.json                 totals and status
  messages.ndjson              cucumber messages, the canonical ingest format
  playwright-report/           the HTML report
  dashboard/                   index.html + metrics.json
  demo-shop/<fingerprint>/r0/  one directory per scenario attempt
\`\`\`

You do not have to find it by hand:

\`\`\`bash
sdods report --last --open
\`\`\`

That prints the totals and the report paths, then opens the HTML report and the dashboard. The dashboard is the one to send round: it is self-contained and survives being mailed.

\`sdods run --artifacts-dir <dir>\` writes the tree somewhere else. If you do that, set \`SDODS_ARTIFACTS_DIR\` too, because \`report\` only learns the new root from the environment variable.

[View results](https://docs.sdods.com/docs/getting-started/view-results/) has the full layout.`,
      },
      {
        id: 'a2',
        by: 'mkuiper',
        on: '2020-11-20',
        votes: 11,
        body: `And when you want it in a script rather than on a terminal, \`sdods report --last --json\` gives you \`{ runId, dir, manifest, summary, reports }\` as one object. Much better than parsing the table.`,
      },
      {
        id: 'a3',
        by: 'dperera',
        on: '2020-12-04',
        votes: 6,
        body: `The bit that took me a while to appreciate: the \`<fingerprint>\` directory under the project slug is stable across runs and across browsers. So the same scenario in run A and run B is the same path, and diffing two runs by eye actually works.

\`r0\` is the first attempt, \`r1\` the first retry, and so on. Inside each you get \`meta.json\`, \`scenario-start.png\`, \`scenario-end.png\`, \`failure.png\` when it failed, the numbered before/after step images, and \`api/\` for API steps.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'rep-html-report-missing-after-ci-run',
    title: 'sdods report prints (missing) for the html report after a CI run',
    askedBy: 'tobi-schrader',
    askedOn: '2021-08-03',
    tags: ['reporting', 'ci', 'cli'],
    votes: 27,
    views: 9840,
    body: `Our CI job runs the suite and archives the run, someone downloads the archive and opens it locally. Locally, straight after a run, everything is there. On the downloaded copy:

\`\`\`text
Run 017af9c1-4b02-7d31-8e55-2a9c41d0e118  /home/tobi/dl/.sdods/runs/017af9c1-...
project demo-shop · env staging · 2021-08-02T21:14:07.882Z
18 passed  1 failed  0 flaky  0 skipped

report      path
--------    ----
html        (missing)
dashboard   (missing)
messages    /home/tobi/dl/.sdods/runs/017af9c1-.../messages.ndjson
\`\`\`

So the summary and the ndjson survived and the two things I actually want did not. We pass \`--reporter-mode quiet\` in CI to keep the log readable. Is that dropping them?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2021-08-03',
        votes: 34,
        body: `\`--reporter-mode\` only swaps the console reporter — \`list\` by default, \`line\` for the server, \`dot\` for quiet. The HTML report, the NDJSON and the dashboard are always in the reporter list, so all three were written. Your archive step did not pick two of them up.

The usual cause is an archive pattern that matches files rather than directories, so the JSON and the ndjson come through and \`playwright-report/\` and \`dashboard/\` do not. Archive the run directory itself:

\`\`\`bash
tar -czf sdods-run.tgz -C .sdods/runs 017af9c1-4b02-7d31-8e55-2a9c41d0e118
\`\`\`

\`sdods report\` only looks for \`<runDir>/playwright-report/index.html\` and \`<runDir>/dashboard/index.html\` on disk and prints \`(missing)\` when they are not there. It never regenerates them, so there is nothing to re-run on the downloaded copy.`,
      },
      {
        id: 'a2',
        by: 'vikram-r',
        on: '2021-08-05',
        votes: 12,
        body: `Second thing that bites here even once the archive is right. \`--last\` picks the newest run directory under the artifacts root of wherever you are standing. If you unpack the archive into \`~/dl\` and then run \`sdods report --last\` from your own checkout, it happily finds one of your own local runs and tells you the truth about that one instead.

Be explicit:

\`\`\`bash
SDODS_ARTIFACTS_DIR=/home/tobi/dl/.sdods/runs sdods report --run 017af9c1-4b02-7d31-8e55-2a9c41d0e118 --open
\`\`\`

Ours printed a perfectly plausible summary of a run from the previous afternoon for about a week before anyone noticed the timestamps.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'rep-sharing-a-trace-with-a-developer',
    title: 'What is the least painful way to hand a trace to a developer?',
    askedBy: 'elsa-nyman',
    askedOn: '2021-11-08',
    tags: ['reporting', 'cli'],
    votes: 22,
    views: 7460,
    body: `A checkout scenario fails only on the CI machine. I can open the trace with \`sdods trace --last\` and it is clear enough what happened, but the developer who has to fix it does not have SDODS installed and is not going to install it to look at one failure.

What do I actually send them? The whole run directory is 300 MB and most of it is step screenshots they do not need.`,
    answers: [
      {
        id: 'a1',
        by: 'lena-hartwig',
        on: '2021-11-08',
        votes: 29,
        body: `Send the one \`trace.zip\`. Find it first:

\`\`\`bash
sdods trace --last --list
\`\`\`

\`--list\` prints the trace files instead of opening them, and with \`--json\` you get \`{ source, traces }\` if you are scripting it. Then hand over the single zip — they drop it on [trace.playwright.dev](https://trace.playwright.dev), which runs entirely in their browser and uploads nothing, so it is fine for a trace of an internal environment.

Worth knowing: traces are recorded on the first retry and for failures, so a fully green run has none and \`sdods trace\` exits 2 with nothing to open. If the developer says "can you get me a trace of it passing", you have to make it fail or run with retries first.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2021-11-10',
        votes: 9,
        body: `If they would rather not open a viewer at all, two files usually do it: the dashboard \`index.html\`, which is self-contained, and the failure screenshot at \`<runDir>/<project-slug>/<fingerprint>/r<attempt>/failure.png\`. That is enough for most "what did the page look like" questions and it is two attachments instead of 300 MB.

Note the attempt number — a failure that was retried is under \`r1\`, not \`r0\`, and people send the wrong one constantly.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'rep-reading-summary-json-in-a-script',
    title: 'Reading summary.json in a shell script — which keys are stable?',
    askedBy: 'gcastellano',
    askedOn: '2022-05-17',
    tags: ['reporting', 'ci', 'cli'],
    votes: 31,
    views: 10400,
    body: `I want the CI job to post totals to Slack without scraping console output. \`.sdods/runs/<id>/summary.json\` looks like exactly what I need:

\`\`\`json
{
  "runId": "0180c7d4-9a11-7f02-b3c8-6d10a5e2f477",
  "status": "failed",
  "totals": {
    "total": 20,
    "passed": 18,
    "failed": 1,
    "skipped": 0,
    "timedOut": 0,
    "flaky": 0,
    "healed": 1,
    "durationMs": 9825,
    "workers": 4
  },
  "byProject": { "demo-shop--ui--chromium": { "total": 20, "passed": 18 } }
}
\`\`\`

Before I build on it: is this file part of the contract or an implementation detail that is going to move under me? And what is \`byProject\` keyed on — I want to split the message per browser.`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2022-05-18',
        votes: 27,
        body: `It is the contract. \`summary.json\` is a \`RunSummary\`: \`runId\`, \`status\`, \`totals\`, \`byProject\`, \`failed\`, \`flaky\` and \`reportPaths\`. \`status\` is \`passed\`, \`failed\` or \`cancelled\` and is derived from the exit code, so it agrees with what CI saw rather than being computed a second way.

\`byProject\` is keyed on the runner project name, which is \`<project-slug>--<layer>--<browser>\`:

\`\`\`bash
jq -r '.byProject | keys[]' .sdods/runs/<id>/summary.json
\`\`\`

\`\`\`text
rwa-bank--api--chromium
rwa-bank--hybrid--chromium
rwa-bank--ui--firefox
\`\`\`

For the Slack message you probably want \`failed\` and \`flaky\` rather than counts: both are arrays of \`{ fingerprint, title, runnerProject }\`, and \`failed\` carries \`error\` as well. Three scenario titles read better than "1 failed".

One caveat before you make the job depend on it: \`summary.json\` is written at the end from the dashboard reporter's \`metrics.json\`. If the process was killed mid-run — an agent timeout, a cancelled build — there is no \`metrics.json\` and therefore no \`summary.json\`. Handle the file not existing; do not treat it as "0 failures".`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2022-05-19',
        votes: 14,
        body: `If you would rather not know the path at all:

\`\`\`bash
sdods report --last --json | jq '.summary.totals'
\`\`\`

The same object also carries the manifest, which is where \`git\` and \`command\` live. Putting the sha and the branch in the Slack message is worth the extra two lines — otherwise the first reply is always "which commit is this".`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'rep-how-long-do-we-keep-run-directories',
    title: 'How long should we keep .sdods/runs around? It is 40 GB now',
    askedBy: 'owen-brackley',
    askedOn: '2022-10-06',
    tags: ['reporting', 'ci', 'config'],
    votes: 25,
    views: 8120,
    body: `Nobody set a retention policy when we turned this on and the build agent is now 40 GB of \`.sdods/runs\`, almost all of it step screenshots. I do not want to \`rm -rf\` blindly because we ingest into the database and I assume something in there points at those files.

Is there a supported way to prune, and what does the database lose when the directories go?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2022-10-06',
        votes: 30,
        body: `There is, and it does both halves together:

\`\`\`bash
sdods db prune --keep-runs 200 --keep-days 90
\`\`\`

That deletes old runs and their artifact directories, so the rows and the files stay in step. Doing it the other way round — \`rm -rf\` first — leaves artifact rows pointing at paths that no longer exist. Nothing crashes; the run viewer just shows broken images forever and nobody can tell whether that run had screenshots or not.

On the agent itself I would not keep 200. A build machine wants two or three runs so a rerun can be compared; anything worth keeping longer is the ingested rows plus whatever CI archived.

The size is almost entirely the screenshot policy. \`@regression\` captures before and after every UI step by design, \`@smoke\` and \`@sanity\` only capture scenario start and end. If a suite is tagged \`@regression\` because it is big rather than because anyone reads the narratives, that is where your 40 GB came from — and retagging it is a bigger win than any retention setting.`,
      },
      {
        id: 'a2',
        by: 'vikram-r',
        on: '2022-10-11',
        votes: 8,
        body: `Also worth pointing \`SDODS_ARTIFACTS_DIR\` at a scratch disk on the agent instead of the workspace. The whole tree moves, run ids do not change, and ingest still finds the artifacts because it is handed the same root.

We keep three runs on the agent and ninety days in the database. In two years nobody has asked for the screenshots of a run older than about a week.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'rep-what-does-healed-mean-in-the-summary',
    title: 'What exactly is "healed": 1 counting in summary.json?',
    askedBy: 'renata-kohl',
    askedOn: '2023-04-20',
    tags: ['reporting', 'heal'],
    votes: 19,
    views: 6230,
    body: `Run went green and the summary said:

\`\`\`json
"passed": 24, "failed": 0, "flaky": 0, "healed": 1, "durationMs": 41203, "workers": 4
\`\`\`

Green is green, but I would like to know what got healed before I sign the release off. Is \`healed\` counting scenarios, steps or locators, and where do I look for what actually changed?`,
    answers: [
      {
        id: 'a1',
        by: 'ify-adeyemi',
        on: '2023-04-20',
        votes: 24,
        body: `Scenarios. \`healed\` is the number of scenarios that recorded at least one heal event during the run, not the number of heals — a scenario where three locators drifted still counts as one.

For the detail:

\`\`\`bash
sdods heal report --last
\`\`\`

That gives you the original selector, the strategy that won, the score and the suggested locator, one row per event. The raw log for a single attempt is \`heal.jsonl\` in the attempt directory, next to the screenshots.

Read a green run with \`healed: 1\` as a pass with a to-do attached: the locator in the page object is now wrong and the healer papered over it at runtime. \`sdods heal report --last --write-history\` persists \`heal-history.json\` so later heals lean towards strategies that already worked, but it does not fix the page object. That is still a patch somebody has to accept.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'rep-scenario-fails-one-run-in-twenty',
    title: 'One scenario fails about one run in twenty — what do I do with it?',
    askedBy: 'chandra-p',
    askedOn: '2023-09-11',
    tags: ['regression', 'reporting', 'ci'],
    votes: 48,
    views: 14730,
    body: `We have a checkout scenario that fails maybe one run in twenty. Different step each time, usually a timeout. Rerunning is always green, so nobody has ever debugged it, and by now people hit retry on the pipeline without even reading the failure. That habit is going to hide a real bug eventually.

What is the actual routine here? I do not want to delete the scenario and I do not want to keep rerunning it.`,
    answers: [
      {
        id: 'a1',
        by: 'lena-hartwig',
        on: '2023-09-11',
        votes: 31,
        body: `Measure it before you touch it, otherwise you are arguing about a rate that everybody remembers differently.

\`\`\`bash
sdods insights compute -p demo-shop --window 30
sdods insights show -p demo-shop --top 5
\`\`\`

![sdods insights show for rwa-bank: suite health with a trend line, then scenarios ranked by flakiness with runs, failed, flaky and p95 duration](/questions/insights.png "insights show ranks scenarios by flakiness over the window")

Flakiness per scenario is passes-on-retry plus outcome flips over runs in the window, and the quarantine threshold is 0.2 with at least 10 runs. One in twenty is 0.05, so yours will sit near the top of the table without being flagged — which is the honest answer: it is real, and it is not yet bad enough for the tool to act on by itself.`,
      },
      {
        id: 'a2',
        by: 'ify-adeyemi',
        on: '2023-09-13',
        votes: 26,
        body: `Then classify it, because "flaky" is three different bugs wearing one word:

- heal events in the run point at locator drift: the page changed and the selector was rescued
- API snapshots with a 5xx or a timeout point at the environment, not at your test
- before/after screenshots that are identical except one is a step behind point at a timing race

The run viewer puts all three on one page, so open the failing attempt rather than the log. For checkout the timing race is the usual answer, and it is usually a step asserting on the thing it just clicked instead of on the thing that follows.

To reproduce on demand instead of waiting for CI:

\`\`\`bash
sdods run -p demo-shop -e staging --scenario "Checkout with a saved card" --repeat-each 20 --fail-on-flaky
\`\`\`

\`--fail-on-flaky\` exits 1 if any test is flaky, so the same command is the proof at the end that you fixed it. Twenty repeats of one scenario is a couple of minutes; the argument about whether it is fixed lasts longer.`,
      },
      {
        id: 'a3',
        by: 'priya-venkatesh',
        on: '2023-09-14',
        votes: 18,
        body: `On the retry habit specifically: quarantine is the tool for that, and it is a holding pen, not a fix.

A quarantined scenario keeps running and keeps reporting; it just stops blocking the gate, and its status stays on the dashboard until somebody lifts it. Toggle it in the UI, or with \`insights quarantine <fingerprint>\`.

The point is that the gate becomes honest again the same afternoon, so the next red build is a real one and people stop reflexively retrying. Put a name and a date on every quarantine when you open it — a quarantine with no owner is how you end up with a suite that is 30% quarantined and 0% trusted.

The playbook is written up at [flaky triage](https://docs.sdods.com/docs/best-practices/flaky-triage/).`,
      },
      {
        id: 'a4',
        by: 'yusuf-demir',
        on: '2023-09-20',
        votes: 5,
        body: `Slightly sideways, but look at the p95 duration column in the insights output before you go hunting for a race. Ours "failed one run in twenty" and the real story was that it finished just under the test timeout every single time; any load on the agent pushed it over. Nothing in the test was flaky at all — it was a slow endpoint that had been getting slower for months.`,
      },
    ],
    acceptedAnswerId: 'a2',
  },

  {
    slug: 'rep-trace-route-404-on-the-server',
    title: 'Trace links in the web UI give a 404 from /trace/ — is it my deployment?',
    askedBy: 'nikhil-sane',
    askedOn: '2024-03-12',
    tags: ['reporting', 'ci'],
    votes: 23,
    views: 6890,
    body: `Running \`sdods serve\` behind our reverse proxy. The run detail page is fine, screenshots load, the API panels load, and then the trace link goes to:

\`\`\`text
GET /trace/?trace=/api/runs/018e1c44-.../files/runner-output/.../trace.zip
404
\`\`\`

Every other static path under the server works, so I assumed I had broken something in the proxy config, but I cannot find it and a colleague reproduces it with no proxy at all. Is \`/trace/*\` supposed to be served by the SDODS server?`,
    answers: [
      {
        id: 'a1',
        by: 'ify-adeyemi',
        on: '2024-03-12',
        votes: 28,
        body: `Not your proxy. \`/trace/*\` is served from the runner's bundled trace viewer, and under Bun's package layout that path may not resolve — when it does not, the route returns \`404\`. It is a known limitation rather than a misconfiguration, and it is still open.

The workaround is local:

\`\`\`bash
sdods trace --run 018e1c44-4c07-7a19-b6d2-11f0c3e94a55 --list
sdods trace --run 018e1c44-4c07-7a19-b6d2-11f0c3e94a55
\`\`\`

The artifact itself is fine — \`GET /api/runs/:id/files/*\` serves the zip perfectly well, it is only the viewer that is missing. So if the run is on a CI machine, download that one \`trace.zip\` and open it locally, or drop it on [trace.playwright.dev](https://trace.playwright.dev).

It is the "Trace viewer" row in [known limitations](https://docs.sdods.com/docs/reference/known-limitations/).`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2024-03-13',
        votes: 11,
        body: `Confirming it is on our side. Do not spend any more time on the proxy — nothing you can put in front of the server makes that route exist.

Two things soften it in the meantime. The failure screenshot and the step narrative in the run viewer answer most of what people open a trace for, and for the rest \`sdods trace\` is one command against a downloaded run directory.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'rep-ingest-drops-artifacts-tarball',
    title: 'Server ingest takes the ndjson but the run viewer has no screenshots',
    askedBy: 'bruno-teixeira',
    askedOn: '2024-08-05',
    tags: ['reporting', 'ci', 'cli'],
    votes: 21,
    views: 5940,
    body: `Our CI agents have no database credentials, so we ingest to the server with a scoped token instead. Messages go up fine. Screenshots do not.

\`\`\`bash
sdods report ingest --run-id 019103ab-7d5e-7c40-9b12-8ae0f4d3c221 \\
  --server https://sdods.internal --token $SDODS_TOKEN \\
  .sdods/runs/019103ab-.../messages.ndjson artifacts.tgz
\`\`\`

First attempt was my own fault:

\`\`\`text
Server ingest failed (401): {"error":{...}}
\`\`\`

With the right token the upload reports success, the run appears in the UI and the totals are correct — and every scenario has no images at all. Is the tarball being ignored, or is it landing somewhere the viewer does not look?`,
    answers: [
      {
        id: 'a1',
        by: 'ify-adeyemi',
        on: '2024-08-05',
        votes: 26,
        body: `Do not trust the limitations table on this one. It says \`POST /api/runs/:id/ingest\` takes \`run.json\`, NDJSON and runner JSON only and that an \`artifacts.tgz\` is not accepted yet — but the route does accept it. It looks for a part named exactly \`artifacts.tgz\` or \`artifacts.tar.gz\`, extracts it under the run directory, skips any entry that would escape that directory, and returns an \`extracted\` count of files and bytes alongside the usual result.

So the question is why yours came back with nothing extracted. Two things to check, in this order:

- **The part name.** It is matched literally. \`artifacts.tgz\` works; \`019103ab-artifacts.tgz\` or \`artifacts.tar\` does not, and an unrecognised part is dropped without complaint. Your command line passes a path, so whatever basename that path ends in is the name the server sees.
- **The size ceiling.** The multipart limit is \`SDODS_INGEST_MAX_MB\`, and the extracted bytes are capped at four times that. A run with a few hundred screenshots goes past a modest default quickly, and the extraction stops rather than filling the disk.

Look at the JSON the ingest call returns — if \`extracted\` is missing entirely the part was not recognised, and if it is present with a \`skipped\` count the cap is what bit you.`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2024-08-07',
        votes: 12,
        body: `Worth writing down what the 401 was so the next person does not chase it: the token needs the \`runs:ingest\` scope. Read scopes get you a 401 from that route and nothing else, and the body is not especially forthcoming about it.

The other one to recognise:

\`\`\`text
--server needs --token (or SDODS_TOKEN).
\`\`\`

That is an exit 2 before any request is made, so if you see it, nothing was uploaded and there is no half-ingested run to clean up.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'rep-what-is-error-context-md',
    title: 'What writes error-context.md next to a failure, and can I use it?',
    askedBy: 'fiona-mcallister',
    askedOn: '2024-11-25',
    tags: ['reporting', 'cli'],
    votes: 17,
    views: 4980,
    body: `Poking through a failed run I found this:

\`\`\`text
.sdods/runs/019362f1-.../runner-output/demo-shop-ui-chromium-Checkout-with-a-saved-card/
  error-context.md
  test-failed-1.png
  trace.zip
\`\`\`

The markdown file starts with the headings Instructions, Test info, Error details and Page snapshot, and the page snapshot is a full accessibility tree of the page at the moment it died. Nobody on the team knew it existed.

Is it stable, and is there any reason not to paste it straight into a bug report?`,
    answers: [
      {
        id: 'a1',
        by: 'anouk-devries',
        on: '2024-11-25',
        votes: 21,
        body: `It is the failure context, written per failing test into that test's output directory, and it is the most useful file in a failed run for anybody who was not watching it happen. The four sections are always in that order:

- Instructions — a preamble aimed at whoever, or whatever, is going to fix the test
- Test info — which test, which file
- Error details — the error and the failing call
- Page snapshot — the accessibility tree of the page at the moment of failure

The page snapshot is the reason to paste it instead of a screenshot: it is text, it diffs between two runs, and it names roles and accessible names, so "the button is called Place order now, not Place Order" falls straight out of it. A screenshot makes somebody squint at pixels to reach the same conclusion.

One caution. It is a snapshot of the page, so it contains whatever was on screen — order numbers, the seeded user's email, anything a fixture put there. Read it before it goes into a tracker other people can see.`,
      },
      {
        id: 'a2',
        by: 'ify-adeyemi',
        on: '2024-11-27',
        votes: 13,
        body: `Adding the path detail, because it moved. Failure context and traces live under \`runner-output/\` in current runs and under \`pw-output/\` in older ones, the same way the HTML report is \`html-report/\` now and was \`playwright-report/\` before the rename. Both names are still read when a run is ingested, so old run directories keep working.

A script that hardcodes one of them, though, will quietly find nothing across half your history and report zero failures with a straight face. Let the CLI find the files:

\`\`\`bash
sdods trace --run 019362f1-8b44-7e02-a0c7-5d19be302f61 --list
\`\`\``,
      },
      {
        id: 'a3',
        by: 'sam-orbison',
        on: '2024-12-03',
        votes: 6,
        body: `We append it to the Jira issue body. \`createIssueOnFailure\` already gets you the run link and the error; adding the Error details and Page snapshot sections means the developer has the whole story without opening SDODS at all.

Acceptance went up noticeably once we stopped sending a screenshot and a stack trace and started sending something they could search.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'rep-wiring-run-results-into-a-team-dashboard',
    title: 'Getting run results onto a team dashboard without scraping the CLI',
    askedBy: 'tanvi-bhatt',
    askedOn: '2025-04-09',
    tags: ['reporting', 'ci'],
    votes: 26,
    views: 7310,
    body: `Management wants a pass-rate trend on the wall screen. Today somebody screenshots the console output on Monday morning. I would like to do this properly but I cannot tell which of the four things SDODS produces I should build on: the \`dashboard/\` directory, \`summary.json\`, the ingested database, or the REST API.

Roughly 40 runs a week across three projects, sharded four ways. The wall screen is a browser pointed at a URL and nothing else.`,
    answers: [
      {
        id: 'a1',
        by: 'anouk-devries',
        on: '2025-04-09',
        votes: 19,
        body: `Depends how much you want to own.

The \`dashboard/\` directory in a run is already a wall screen for one run: \`index.html\` is self-contained — totals, pass rate, the flaky list, heals, failure clusters and links into the step narratives — with the chart library inlined so it works offline and survives being mailed. \`metrics.json\` sits beside it when you want to script against the same numbers. What it is not is a trend; it only knows about itself.

For a trend you need the runs ingested, and at that point the web UI already has the page you are describing:

![The workspace dashboard: pass rate, duration and flaky rate over 14 days, with suite health by process, top flaky scenarios and most-failing locators](/questions/ui-dashboard.png "The workspace dashboard in the web UI")

Point the wall screen at that first. If it turns out to be the wrong shape for your team, build on the same API it reads rather than on files.`,
      },
      {
        id: 'a2',
        by: 'vikram-r',
        on: '2025-04-10',
        votes: 14,
        body: `The routes are the stats ones:

\`\`\`text
GET /api/stats/trends
GET /api/stats/flaky
GET /api/stats/heal
GET /api/stats/insights
\`\`\`

\`/api/stats/insights\` is the same computation \`sdods insights show\` prints — suite health and its trend, scenarios by flakiness, locators by fragility, environment stability — so the wall screen and the CLI cannot disagree.

Authenticate with a token from \`sdods tokens create\`. A read-only scope is enough, and please do not put an admin token in a page that is on permanent display in an office. Ingest is the prerequisite for all of it: \`sdods run --ingest\`, or \`sdods report ingest\` after the fact.

[REST API](https://docs.sdods.com/docs/reference/rest-api/) has the scope table.`,
      },
      {
        id: 'a3',
        by: 'reeta-nandal',
        on: '2025-04-11',
        votes: 11,
        body: `One decision to make up front, because it is annoying to change later: what a "run" means to the wall screen when you shard four ways.

Shards merge into one run on ingest, so the database gives you a single row with merged totals — which is what a pass rate wants. \`summary.json\` on a shard is that shard only, and four shards produce four files that each look like a complete run.

If you build on files anyway you have to merge them yourself:

\`\`\`bash
sdods report merge shard-1 shard-2 shard-3 shard-4 --run 0196a72c-3f18-7b55-9d20-c4a7e015b88f
\`\`\`

That rebuilds one HTML report and one JUnit file from \`--reporter blob --shard i/n\` output. It works, but it is a lot of pipeline to maintain for a number the database already has.`,
      },
    ],
  },

  {
    slug: 'rep-insights-cli-called-a-placeholder-in-docs',
    title: 'Docs call the insights CLI a placeholder but it clearly does something',
    askedBy: 'koen-vermeulen',
    askedOn: '2025-07-15',
    tags: ['reporting', 'cli'],
    votes: 20,
    views: 5210,
    body: `The known limitations table says:

> sdods insights — the CLI command is a placeholder. Metrics are computed by the database package and shown in the web UI dashboard and GET /api/stats/insights.

It does not behave like a placeholder:

\`\`\`bash
sdods insights compute -p demo-shop --window 20
\`\`\`

wrote \`.sdods/insights/demo-shop.json\`, printed suite health with a trend, a scenarios-by-flakiness table with p95 durations and quarantine candidates, and a locators-by-fragility table with suggested selectors. \`insights show --top 5\` reads it back.

So which is it? I am about to put this in a nightly job and I would rather not build on something that is going to be replaced next month.`,
    answers: [
      {
        id: 'a1',
        by: 'ify-adeyemi',
        on: '2025-07-15',
        votes: 22,
        body: `Build on it. That row is stale. It was written when the computation only lived in the database package and the CLI really was a stub, and the CLI grew real logic without anybody going back to the table.

The errors are the giveaway, and they are generally the fastest way to tell whether a command is real:

\`\`\`text
No insights computed yet for demo-shop.
  hint: Run \`sdods insights compute -p demo-shop\` after ingesting some runs.
\`\`\`

and, on a machine with no database:

\`\`\`text
Insights need the @sdods/db package and a configured database.
\`\`\`

That second one is a \`DB_REQUIRED\` error with a hint telling you to migrate and ingest. Placeholders do not have a code and two failure modes.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2025-07-16',
        votes: 17,
        body: `Correct on both counts: the command is real and the limitations row is out of date. It is one computation either way — the CLI, the web dashboard and \`GET /api/stats/insights\` all call into the database package, so the numbers agree by construction rather than by luck.

For a nightly job, compute after the last ingest of the day and pin the window and the thresholds:

\`\`\`bash
sdods insights compute -p demo-shop --window 30 --min-runs 10 --flaky-threshold 0.2
\`\`\`

Defaults are window 30, flaky threshold 0.2, fragility threshold 0.1, min-runs 10. Leaving them implicit is fine right up until somebody changes a default and your quarantine list moves overnight with no commit to blame.

[Insights and flaky management](https://docs.sdods.com/docs/guides/insights-and-flaky/) has the formulas.`,
      },
    ],
    acceptedAnswerId: 'a2',
  },

  {
    slug: 'rep-no-insights-computed-yet-for-project',
    title: 'Insights say no runs, but we have a week of nightly runs on disk',
    askedBy: 'rasha-halabi',
    askedOn: '2025-10-02',
    tags: ['reporting', 'cli'],
    votes: 12,
    views: 3410,
    body: `\`\`\`bash
sdods insights show -p checkout-api
\`\`\`

\`\`\`text
No insights computed yet for checkout-api.
  hint: Run \`sdods insights compute -p checkout-api\` after ingesting some runs.
\`\`\`

Fine, so I ran compute:

\`\`\`bash
sdods insights compute -p checkout-api
\`\`\`

\`\`\`text
Insights need the @sdods/db package and a configured database.
\`\`\`

We have run this suite every night for a week and every run is sitting in \`.sdods/runs\` with its summary and its ndjson. Why does counting them need a database?`,
    answers: [
      {
        id: 'a1',
        by: 'anouk-devries',
        on: '2025-10-02',
        votes: 18,
        body: `Because insights are computed over ingested runs, not over directories. A run directory holds one run's artifacts; flakiness, locator fragility and suite health are all "this scenario across the last N runs", and that comparison lives in the database.

So the missing step is ingest, not compute:

\`\`\`bash
sdods db migrate
sdods report ingest --run-id <id> .sdods/runs/<id>/messages.ndjson
\`\`\`

and from then on let the run do it:

\`\`\`bash
sdods run -p checkout-api -e staging -l api --ingest
\`\`\`

You can backfill the week you already have — re-ingesting the same files is idempotent, so a loop over the run directories is safe to run twice if it dies halfway.

One expectation to set: a scenario needs at least \`--min-runs\` runs before it can be flagged, 10 by default. Seven nightlies will compute fine and flag nothing, which looks like it is still broken. It is not.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'rep-html-report-out-of-a-docker-ci-container',
    title: 'Getting the HTML report out of the Docker image we run the suite in',
    askedBy: 'ingrid-solberg',
    askedOn: '2026-03-10',
    tags: ['reporting', 'ci', 'docker'],
    votes: 24,
    views: 5680,
    body: `We run the suite inside \`ghcr.io/yarlisaisolutions/sdods-server\` on a self-hosted agent. The run works and the exit code is right, then the container goes away and takes the report with it.

Right now somebody runs \`docker cp\` afterwards, which fails silently when the container has already exited, so half our builds have no report and nobody notices until they need one.

What is the least fragile way to get \`html-report/\` and the dashboard back onto the agent?`,
    answers: [
      {
        id: 'a1',
        by: 'ify-adeyemi',
        on: '2026-03-10',
        votes: 27,
        body: `Point the artifacts root at a mounted volume before the run instead of copying afterwards. \`SDODS_ARTIFACTS_DIR\` is read by \`run\` and by \`report\`, and any CLI command works as the image argument:

\`\`\`bash
mkdir -p out
docker run --rm --platform linux/amd64 \\
  -e SDODS_ARTIFACTS_DIR=/out/runs \\
  -v "$PWD/out:/out" \\
  ghcr.io/yarlisaisolutions/sdods-server run -p demo-shop -e staging -l ui -b chromium -t @smoke
\`\`\`

Everything lands straight on the agent — \`run.json\`, \`summary.json\`, \`messages.ndjson\`, \`html-report/\`, \`dashboard/\`, \`runner-output/\` — and there is nothing to copy when the container exits, so a failed run and a cancelled run both still leave you a report. \`sdods run --artifacts-dir /out/runs\` does the same per run if you would rather not use the environment variable.

Create \`out/\` on the agent first and pass \`--user\` so the files come back owned by the agent user. Otherwise the archive step hits permission errors on a directory it can see perfectly well, which is a confusing ten minutes.

The published image is \`linux/amd64\` only for now, hence the explicit \`--platform\`.`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2026-03-11',
        votes: 15,
        body: `Second half of this, because it comes up about an hour later: the same volume is what makes ingest useful.

\`POST /api/runs/:id/ingest\` does take an \`artifacts.tgz\` and extract it, whatever the limitations page still says — but the part has to be named exactly that, and the extracted size is capped at four times \`SDODS_INGEST_MAX_MB\`. Get either wrong and the server ends up with totals and no images, which looks identical to the feature not existing.

With the volume mounted you have two working options: ingest from inside the run with \`--ingest\` if the container has database access, or ingest from the agent afterwards against the directory that is now sitting there.`,
      },
      {
        id: 'a3',
        by: 'anouk-devries',
        on: '2026-03-14',
        votes: 9,
        body: `Small thing that saves the wall screen once the files are out: the dashboard \`index.html\` is self-contained, so you can publish that one file per build and skip archiving the full HTML report for everyone who is not debugging.

In practice almost nobody opens the HTML report anyway. They open the run detail page, which links to all of it:

![A run detail page with the scenario tree grouped by module, and HTML report, Dashboard, JUnit and NDJSON buttons in the header](/questions/ui-run-detail.png "The run detail page links to every report of the run")`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'rep-allure-and-extra-reporters',
    title: 'Adding Allure without losing the SDODS dashboard and the ndjson',
    askedBy: 'paulo-mendes',
    askedOn: '2026-05-20',
    tags: ['reporting', 'config', 'cli'],
    votes: 15,
    views: 3620,
    body: `Our QA lead wants Allure because that is what the other teams publish. I am happy to produce it, but the last time I touched a reporter list in another tool I lost everything else that was in it, and our ingest depends on the ndjson.

Does \`--allure\` replace the default reporters or add to them? And can I turn it on for the project instead of remembering a flag?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-05-20',
        votes: 18,
        body: `Adds. The defaults — console, HTML report, cucumber messages NDJSON and the SDODS dashboard — are always emitted. \`--allure\` appends \`allure-playwright\` writing into \`<runDir>/allure-results\`, and \`--reporter <name[=outputFile]>\` appends whatever else you name. A reporter already in the default list is skipped rather than added twice, which is why \`--reporter junit\` in CI does not leave you with two JUnit files fighting over one path.

For the project, put it in the yaml and drop the flag:

\`\`\`yaml
reports:
  allure: true
  junit: true
  cucumberHtml: false
\`\`\`

One thing that gets confused with this: \`--reporter-mode\` is unrelated. It only swaps the console reporter between \`list\`, \`line\` and \`dot\` and never touches the file reporters.`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2026-05-22',
        votes: 7,
        body: `Worth knowing where path-less reporters land, because it is the run directory and not your working directory:

- \`--reporter junit\` writes \`<runDir>/junit.xml\`
- \`--reporter blob\` writes \`<runDir>/shard-reports/\`
- \`--reporter json\` writes \`<runDir>/runner-results.extra.json\`

\`name=outputFile\` overrides that when your publisher insists on a fixed path. The \`blob\` one is the one that matters for sharding — those directories are what you download and feed to \`sdods report merge\`.`,
      },
    ],
  },

  {
    slug: 'rep-run-directory-not-found-after-moving-artifacts',
    title: 'Run directory not found after moving the artifacts root, exit 2',
    askedBy: 'zeynep-arslan',
    askedOn: '2026-07-14',
    tags: ['reporting', 'cli'],
    votes: 2,
    views: 63,
    body: `We moved the artifacts root off the workspace disk on our agents:

\`\`\`bash
sdods run -p rwa-bank -e staging -l hybrid --artifacts-dir /mnt/scratch/sdods-runs
\`\`\`

The run is fine and the directory is there with everything in it. The step afterwards that publishes the run to the tracker is not:

\`\`\`bash
sdods integrations notify --run-id 019f3ac0-2b71-7e93-8f04-6ca5d1b2e770
\`\`\`

\`\`\`text
Run directory not found: /home/build/work/.sdods/runs/019f3ac0-2b71-7e93-8f04-6ca5d1b2e770
  hint: Pass --artifacts-dir or check the run id (sdods report --last).
\`\`\`

Fair enough that \`--artifacts-dir\` on \`run\` does not carry to the next command. But \`SDODS_ARTIFACTS_DIR=/mnt/scratch/sdods-runs\` is exported for the whole job and it does not help either: \`sdods report --last\` finds the run under the scratch path, \`integrations notify\` still looks under the workspace.

Is the environment variable only honoured by some commands, or am I setting it in the wrong place? Passing \`--artifacts-dir\` twice works, I would just like to know which of the two I should stop trusting.`,
    answers: [],
  },
];
