import type { Thread } from '../types';

export const healThreads: Thread[] = [
  {
    slug: 'heal-nothing-heals-when-the-context-is-only-a-description',
    title: 'Healing does nothing — I just get the normal Playwright timeout',
    askedBy: 'annika-solheim',
    askedOn: '2021-04-22',
    tags: ['heal', 'locators', 'page-objects'],
    votes: 27,
    views: 9640,
    body: `We turned healing on for our checkout page object and the button still fails exactly the way it did before. No heal event, nothing in the log, just the Playwright timeout.

\`\`\`ts
readonly checkout = this.heal.locator(this.page.locator('.btn-primary'), {
  description: 'checkout button',
});
\`\`\`

The run output:

\`\`\`text
Error: locator.click: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('.btn-primary')
\`\`\`

\`heal.enabled\` is true and \`click\` is in \`heal.actions\`. What am I missing?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2021-04-22',
        votes: 34,
        body: `Your context has nothing to build candidates from. \`description\` is a label for reports and history keys, not a strategy — the candidate list comes from \`role\` and \`name\`, \`testId\`, \`label\`, \`placeholder\`, \`title\`, \`altText\`, \`text\` and \`css\`. With only a description there are zero candidates, so the healer re-throws the original error rather than inventing one. That is why you see the plain timeout and no heal event.

Give it something to probe:

\`\`\`ts
readonly checkout = this.heal.locator(this.page.locator('.btn-primary'), {
  role: 'button', name: 'Checkout', testId: 'checkout', description: 'checkout button',
});
\`\`\`

> [!NOTE]
> While you are in there, \`.btn-primary\` is the weakest thing you could have picked as the primary. \`getByRole('button', { name: 'Checkout' })\` as the primary and the CSS in the context is the right way round.`,
      },
      {
        id: 'a2',
        by: 'rgarrido',
        on: '2021-04-24',
        votes: 12,
        body: `Adding to that — the ordering in the docs is not decoration, it is the base score. role and name is 1.0, test id 0.95, label 0.9, placeholder 0.8, exact text 0.7, partial text 0.5, css 0.4. So a context that only carries CSS can never clear the default \`minScore\` of 0.6 even in the best case, and buys you nothing.

[Locator strategy](https://docs.sdods.com/docs/best-practices/locator-strategy/)`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-i-want-the-broken-locator-to-fail-not-heal',
    title: 'I do not want healing to rescue a broken locator — I want the test to fail',
    askedBy: 'vikram-r',
    askedOn: '2021-11-08',
    tags: ['heal', 'config', 'ci'],
    votes: 41,
    views: 15220,
    body: `Possibly an unpopular opinion, but: if a developer renames a button and my test still passes, my test did not test anything.

Yesterday a whole feature shipped with the wrong label on the submit button and the suite was green, because healing quietly found it by role. I want the suite to go red on a locator that no longer matches. Is there a switch, or am I holding this wrong?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2021-11-08',
        votes: 39,
        body: `You are not holding it wrong, you are describing the trade the feature makes. Healing keeps a suite running through a refactor; it is not there to certify the DOM.

Nothing about a heal is quiet, though. Every one is attached to the scenario as \`sdods/heal/<step>/<n>\`, appended to \`heal.jsonl\` in the run directory, added to the test annotations, and logged with the selector that won and a suggested rewrite. The failure mode you hit is that nobody read any of it.

If you want it off, the honest switches are:

- \`heal: { enabled: false }\` in \`envs/<env>.yaml\` — the env layer may override \`heal\`
- \`SDODS_HEAL=false\` for a single run
- trimming \`heal.actions\` to the actions you accept, remembering that arrays replace rather than merge
- \`.raw\` on a specific locator when you want exactly that element and no substitute

What I would actually do is leave it on and gate on the report instead. A green run with fourteen heals in it is a signal, and \`sdods heal report --last\` puts it on one screen.`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2021-11-09',
        votes: 18,
        body: `We landed on the middle position: healing on everywhere, and the pipeline fails the job if \`sdods heal report --last --json\` comes back with any events for the smoke suite. Regression is allowed to heal, smoke is not.

Took about ten lines of shell, and it caught exactly the rename you are describing — the day after, rather than never.`,
      },
      {
        id: 'a3',
        by: 'rgarrido',
        on: '2021-11-10',
        votes: 9,
        body: `One more angle. The case that actually bit us was not a rename, it was a duplicate: two elements matched, uniqueness dragged the score down but not below the threshold, and the healer took the first one. It passed. It was the wrong button.

So "healing hid a bug" is real, but so is "our locator was ambiguous all along". Worth checking which of the two you have before you turn the feature off.`,
      },
      {
        id: 'a4',
        by: 'tobi-schrader',
        on: '2021-11-15',
        votes: 4,
        body: `Late to this, but the annotations are the bit that made it visible for us. They show up on the test in the HTML report, so a reviewer looking at a green run sees \`sdods:heal\` next to the scenario name without going anywhere near a JSON file.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-expect-hidden-is-never-healed',
    title: 'Why does healing never kick in for expectHidden()?',
    askedBy: 'gcastellano',
    askedOn: '2022-03-09',
    tags: ['heal', 'ui', 'page-objects'],
    votes: 36,
    views: 12980,
    body: `Every positive assertion in our page object heals fine. This one never does:

\`\`\`ts
async assertBannerGone() {
  await this.errorBanner.expectHidden();
}
\`\`\`

\`assert\` is in \`heal.actions\`, the context has a role, a name and a test id. The step fails with an ordinary Playwright assertion error and there is no entry in \`heal.jsonl\` for it. Is \`expectHidden\` just not wired up yet?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2022-03-09',
        votes: 44,
        body: `It is wired up to do nothing, on purpose. \`expectHidden()\` asserts on the primary locator and never goes through the healer:

\`\`\`ts
async expectHidden() {
  // negative assertions are never healed
  await expect(this.primary).toBeHidden();
}
\`\`\`

The reason is that "not visible" is trivially satisfied by a locator that matches nothing. If we healed a negative assertion, any candidate that found zero elements would make it pass, and the assertion would be worthless. So the primary is the assertion, and if the primary is wrong you get told.

\`isVisible()\` has the same shape for the same reason — it reads the primary and returns a boolean rather than resolving through the healer. \`expectVisible()\`, \`expectText()\`, \`textContent()\` and \`innerText()\` all do heal.`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2022-03-10',
        votes: 15,
        body: `Practical consequence worth knowing: a locator you only ever use in a negative assertion gets no heal coverage at all, which means a rename there fails loudly instead of drifting. That is the right outcome. It also means the fragility statistics never see it, since those are computed from heal events.

If that matters to you, assert the positive somewhere too. A banner that must appear before it disappears usually has a natural place for it.`,
      },
      {
        id: 'a3',
        by: 'rgarrido',
        on: '2022-03-14',
        votes: 7,
        body: `This caught us on \`expectText\` as well, but in the other direction — we assumed it was excluded like \`expectHidden\` and it is not, it resolves through the healer with the \`assert\` action. So a text assertion can pass against a healed element.

Worth writing down which side of the line each method is on before you rely on either.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-should-i-commit-the-suggested-rewrite',
    title: 'Should I commit the suggested locator from a heal log, or go and find out why?',
    askedBy: 'sam-orbison',
    askedOn: '2022-09-14',
    tags: ['heal', 'page-objects', 'locators'],
    votes: 22,
    views: 8110,
    body: `Our log has been telling us this for a fortnight:

\`\`\`text
healed "login button": locator('#login-button') → getByRole('button', { name: 'Login' }) via role (score 1.00, 3180 ms). Update the page object.
\`\`\`

I cannot tell whether "update the page object" means "paste this in" or "go and find out why". The suggestion is obviously better than the id we had. But if I paste it in, the heal context still lists \`role: 'button', name: 'Login'\`, so the primary and the fallback become the same thing, which feels wrong.`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2022-09-16',
        votes: 20,
        body: `Paste it in, then re-derive the context around the new primary. You are right that a context duplicating the primary is dead weight — if the primary is \`getByRole('button', { name: 'Login' })\` then the useful context is the id you just retired, plus the test id:

\`\`\`ts
readonly submit = this.heal.locator(this.page.getByRole('button', { name: 'Login' }), {
  testId: 'login-button', text: 'Login', description: 'login button',
});
\`\`\`

The rule of thumb is that the context should describe the element the way a different team would find it, not the way you already did.

Do go and find out why as well, but the answer is usually boring: somebody replaced a hand-written id with a component library and nobody told the tests.`,
      },
      {
        id: 'a2',
        by: 'owen-brackley',
        on: '2022-09-16',
        votes: 11,
        body: `We treat the log line as a code review comment rather than a patch. Three of ours were the healer being right. One was the healer finding a visually identical button in a modal that happened to be open, and committing that would have made a genuinely wrong test permanently green.

The score does not tell you it picked the element you meant, only that it picked one element confidently. Look at \`pageUrl\` and \`description\` on the event before you take the suggestion.`,
      },
    ],
  },

  {
    slug: 'heal-can-i-put-xpath-in-the-css-fallback-list',
    title: 'Can I put an XPath in the css fallback list of a heal context?',
    askedBy: 'petrov-k',
    askedOn: '2022-11-02',
    tags: ['locators', 'heal', 'page-objects'],
    votes: 31,
    views: 11470,
    body: `Our app renders a summary table where the only stable thing about a row is its position relative to a header cell. The reviewer agent keeps flagging the selector, so I was going to declare a fallback for it:

\`\`\`ts
readonly total = this.heal.locator(this.page.locator('.summary .total'), {
  description: 'order total',
  css: ['xpath=//table[@id="summary"]//tr[last()]/td[2]'],
});
\`\`\`

Does the healer accept that? And if it does, is it a terrible idea?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2022-11-02',
        votes: 28,
        body: `It will not throw at you, because the strings in \`css\` go straight to \`page.locator()\` and Playwright resolves an \`xpath=\` prefix. It will also never once be used.

Candidates built from \`css\` carry a base score of 0.4. The score is \`base × uniqueness × visibility × enabled + history\`, and the history bonus is capped at 0.1, so the best a CSS or XPath candidate can ever reach is 0.5. The default \`minScore\` is 0.6. That is arithmetic, not policy — the candidate loses every time, on every page, forever.

The order that does work is role and accessible name, then label, then the project test id, then placeholder, then text, and CSS only as a last resort inside a page object that has a real context around it. XPath is not on the list at all: it encodes document structure, which is the one thing a refactor is guaranteed to change.

For your table, give the row an accessible name or a test id in the application. That is a ten-minute change in the app and it removes the problem instead of describing it.`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2022-11-04',
        votes: 9,
        body: `If you genuinely cannot touch the app, scope the locator instead of positioning it — find the row by its content and read the cell inside it:

\`\`\`ts
readonly total = this.heal.locator(
  this.page.getByRole('row', { name: 'Order total' }).getByRole('cell').nth(1),
  { description: 'order total' },
);
\`\`\`

Still not lovely, but it survives a column being added above it, which \`tr[last()]/td[2]\` does not.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-suite-got-slower-after-enabling-healing',
    title: 'Suite went from six minutes to nineteen after we enabled healing',
    askedBy: 'renata-kohl',
    askedOn: '2023-04-11',
    tags: ['heal', 'perf', 'ci'],
    votes: 29,
    views: 10240,
    body: `\`\`\`bash
sdods run -p checkout-web -e staging -l ui -b chromium -t @regression
\`\`\`

Same suite, same machine, same worker count. Before healing it was about six minutes, now it is nineteen and change. Nothing failed either way, which is why I assumed healing was free when the locators work.

Where is the time going?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2023-04-11',
        votes: 31,
        body: `Healing is free when the locators work. Nothing runs until the primary locator times out, and then the cost is bounded: \`primaryTimeoutMs\` at 3000, then every candidate probed in parallel inside \`probeTimeoutMs\` at 1500. Worst case is about four and a half seconds for one locator, not the thirty-plus you would get from a chain of fallbacks tried one after another.

Thirteen minutes of extra wall clock means something in the region of a hundred and fifty locators are timing out and being rescued. Your suite is not slower — it is finally telling you how broken it already was.

\`\`\`bash
sdods heal report --last
\`\`\`

Read the \`occurrences\` column. My guess is that a handful of descriptions account for most of it.

[Self-healing locators](https://docs.sdods.com/docs/guides/self-healing/)`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2023-04-12',
        votes: 14,
        body: `Worth adding the pipeline angle. The same run on a loaded agent will hit \`primaryTimeoutMs\` on locators that are merely slow rather than wrong, and then heal to the same element it was already waiting for. Those appear in the report as heals whose winning selector is effectively the primary.

They are noise, and the fix is not to lower the timeout. It is to work out why the page takes more than three seconds to show that element.`,
      },
      {
        id: 'a3',
        by: 'rgarrido',
        on: '2023-04-14',
        votes: 6,
        body: `We had exactly this after a design system upgrade. The report showed two descriptions at forty-odd occurrences each — a nav item and a submit button that had both moved to new components. Fixed the two page objects, run time went back to normal. Total damage: one afternoon.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-testidattribute-is-data-test-but-suggestion-shows-getbytestid',
    title: 'testIdAttribute is data-test, so why does the heal suggestion say getByTestId?',
    askedBy: 'yusuf-demir',
    askedOn: '2023-07-19',
    tags: ['heal', 'config', 'locators'],
    votes: 24,
    views: 8760,
    body: `Our app has used \`data-test\` since long before we adopted SDODS. I set it in the project file:

\`\`\`yaml
testIdAttribute: data-test
\`\`\`

Heal report suggests \`getByTestId('cart-badge')\` for a locator that healed. I pasted that into the page object expecting it to look for \`data-testid\` and fail. It works. I would like to understand why before I trust it in twenty other places.`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2023-07-19',
        votes: 22,
        body: `\`getByTestId\` does not name an attribute — it looks up whichever attribute the runner was configured with. SDODS builds the Playwright projects from your resolved config and sets \`use.testIdAttribute\` from the project's \`testIdAttribute\`, so on your project \`getByTestId('cart-badge')\` resolves \`[data-test="cart-badge"]\`, both in your page objects and in the healer's probes.

The suggestion is therefore correct and portable: change the attribute in one place and every test id locator follows.

Confirm which layer produced the value with:

\`\`\`bash
sdods config show -p shop-web -e staging --explain
\`\`\``,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2023-07-21',
        votes: 8,
        body: `One thing to watch: \`testIdAttribute\` is a project-level key. We tried to override it per environment and it simply did not take. \`envs/<env>.yaml\` may override \`screenshots\`, \`heal\`, \`timeouts\` and \`perf\`, and that is the whole list.

If your environments genuinely disagree about the attribute, you have two projects rather than one.

[Configuration precedence](https://docs.sdods.com/docs/guides/configuration/)`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-safe-to-leave-healing-on-in-ci',
    title: 'Is it safe to leave self-healing enabled in CI, or is that cheating?',
    askedBy: 'chandra-p',
    askedOn: '2023-09-25',
    tags: ['heal', 'ci', 'config'],
    votes: 33,
    views: 11890,
    body: `Team is split. Half want healing on everywhere because the nightly regression run keeps dying on locator drift and nobody is awake to fix it. Half say a run that heals is a run that lied to you.

Is there a position the maintainers recommend, or is this genuinely a taste thing?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2023-09-25',
        votes: 19,
        body: `It is a taste thing at the edges and not a taste thing in the middle. The middle is: leave it on, and never let a heal go unnoticed.

What we do on our own pipelines:

- healing on for every layer and every environment
- \`sdods heal report --last --json\` as a post-run step, published as a build artifact
- any description with three or more occurrences opens a ticket the same day
- the smoke suite treated as a contract, so heals there are reviewed before the next release

The half of your team worried about lying are right about the failure mode and wrong about the remedy. A locator that heals unnoticed is a problem with your reporting, not with healing.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2023-09-26',
        votes: 24,
        body: `A concrete point in favour of leaving it on in the nightly specifically. A run that dies at the first broken locator tells you one thing. A run that heals past it tells you everything downstream of that locator as well, plus what broke and what it should be. You get a full picture and a suggested patch instead of a stack trace.

The two guards that keep it honest are already there without you configuring anything: every heal is annotated on the test and appended to \`heal.jsonl\` in the run directory, and negative assertions are never healed, so nothing can pass by matching nothing.

If you want a hard line, draw it per environment rather than per pipeline — \`heal: { enabled: false }\` in \`envs/prod-verify.yaml\`, and on everywhere else.`,
      },
    ],
    acceptedAnswerId: 'a2',
  },

  {
    slug: 'heal-reading-the-columns-of-heal-report',
    title: 'What do the columns of sdods heal report actually mean?',
    askedBy: 'helle-borg',
    askedOn: '2023-12-06',
    tags: ['heal', 'reporting', 'cli'],
    votes: 18,
    views: 6420,
    body: `\`\`\`bash
sdods heal report --last
\`\`\`

I get a table with \`description\`, \`original\`, \`occurrences\`, \`succeeded\`, \`strategy\` and \`suggested\`. Most of it I can guess. Two I cannot:

- \`occurrences\` is 12 but \`succeeded\` is 9 — where did the other three go, and why is the row still in a report about heals?
- \`strategy\` reads \`role×7 testid×2\`. Why two different ones for the same locator?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2023-12-06',
        votes: 21,
        body: `Rows are keyed on description plus original selector, and every event is counted whether or not it found anything. So \`occurrences: 12, succeeded: 9\` means that locator's primary failed twelve times, and on three of those no candidate cleared \`minScore\` — those three are the runs where your scenario died with \`HEAL_FAILED\`. The row stays because the failures are the interesting half.

\`strategy\` counts only the successful ones, by winning strategy. \`role×7 testid×2\` means the role and name candidate won seven times and the test id twice. That usually means the accessible name is not stable: the element is there both times, but on two runs the name did not match and the test id picked up the slack. Worth a look, because whatever is moving the name will eventually move it past recognition.

\`suggested\` is the last selector that actually won, which is what you would paste into the page object.`,
      },
      {
        id: 'a2',
        by: 'owen-brackley',
        on: '2023-12-08',
        votes: 7,
        body: `Add \`--all\` when you want the same table across every run under the artifacts directory rather than just the last one. That is where the pattern shows up. A locator that heals once is a bad day; one that heals in nine runs out of ten is a page object nobody has updated.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-report-says-no-run-found',
    title: 'sdods heal report says No run found. but the suite ran two minutes ago',
    askedBy: 'nikhil-sane',
    askedOn: '2024-02-27',
    tags: ['heal', 'cli', 'reporting'],
    votes: 14,
    views: 5180,
    body: `\`\`\`bash
sdods run -p billing -e staging -l ui --artifacts-dir /var/tmp/sdods-runs
\`\`\`

\`\`\`bash
sdods heal report --last
\`\`\`

\`\`\`text
No run found.
Run \`sdods run\` first or pass --run <id>.
\`\`\`

Exit code 2. The run directory is there and full of files — I can open \`heal.jsonl\` inside it.`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2024-02-27',
        votes: 16,
        body: `\`heal report\` resolves the artifacts directory from \`SDODS_ARTIFACTS_DIR\` or the default \`.sdods/runs\` under the repo root. It knows nothing about the \`--artifacts-dir\` you passed to \`run\`, so it looked in the default location, found nothing and raised \`RUN_FAILED\` with exit code 2.

Either point both commands at the same place:

\`\`\`bash
SDODS_ARTIFACTS_DIR=/var/tmp/sdods-runs sdods heal report --last
\`\`\`

or leave the runs where they land and name the one you want:

\`\`\`bash
sdods heal report --run <id>
\`\`\`

There is a second cause that produces the same message even when the path is right. \`--last\` picks the most recent subdirectory that contains a \`run.json\`. A directory of scenario output with no manifest at the top is invisible to it, which is what you get when something kills the run before it writes one.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-renamed-one-button-and-forty-scenarios-healed',
    title: 'We renamed one button and 40 scenarios healed in the same run — now what?',
    askedBy: 'bea-lindqvist',
    askedOn: '2024-05-16',
    tags: ['heal', 'locators', 'page-objects', 'regression'],
    votes: 47,
    views: 17640,
    body: `Design renamed "Continue" to "Next" on the checkout stepper. Nothing failed. The nightly regression run is green and carries forty-one heal events, all with the same description, all healing from the accessible name to the test id.

Green is not the reaction I expected, and I am not sure what the right move is. Do I update one page object and hope? Do I go through forty scenarios?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2024-05-16',
        votes: 42,
        body: `One page object, almost certainly. Forty-one events with one description means one declared locator used by forty-one scenarios, not forty-one problems. That is the shape healing is for — the blast radius of a rename is a single edit, and the run stayed green long enough for you to find out what the edit is.

\`\`\`bash
sdods heal report --last
\`\`\`

The \`suggested\` column on that row is the selector that won every time. Make it the primary, move \`Continue\` out of the context and \`Next\` in, and re-run. If the count goes to zero you are done.

The case to actually worry about is the opposite one: forty-one events across forty-one different descriptions. That is a design system change, and it wants the reviewer agent rather than an afternoon of typing.`,
      },
      {
        id: 'a2',
        by: 'rgarrido',
        on: '2024-05-17',
        votes: 15,
        body: `Before you edit, check that the test id it healed to is the element you mean. A stepper usually has more than one forward control — a primary button and a keyboard-accessible link, say.

A test id winning at its full base score tells you it matched exactly one visible, enabled element, which is reassuring, but it does not tell you the product team did not add a second "Next" somewhere. \`pageUrl\` on the event narrows it down quickly.`,
      },
      {
        id: 'a3',
        by: 'lena-hartwig',
        on: '2024-05-17',
        votes: 11,
        body: `For the "now what" beyond this one rename: this is what the fragility number exists for. Once a locator has healed three or more times and its fragility clears the threshold it is marked hot, and insights ranks it next to the flaky scenarios.

![sdods insights show for a project, printing suite health, the trend across recent runs, and scenarios ranked by flakiness](/questions/insights.png "insights show — the locator fragility table follows the scenario table")

That needs a database with ingested runs, so \`sdods run --ingest\` and then \`sdods insights compute -p <slug>\`. Without one you still have \`sdods heal report --all\`, which gets you the same ranking by hand.`,
      },
      {
        id: 'a4',
        by: 'owen-brackley',
        on: '2024-05-21',
        votes: 6,
        body: `Small process thing that helped us. After fixing the page object, run the affected feature with \`--repeat-each 10 --fail-on-flaky\` before you close the ticket. A rename tends to arrive with a timing change attached, and you would rather find that now than in the next nightly.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-what-should-minscore-be',
    title: 'What should minScore be? 0.6 feels arbitrary',
    askedBy: 'bruno-teixeira',
    askedOn: '2024-08-21',
    tags: ['heal', 'config'],
    votes: 20,
    views: 7130,
    body: `\`\`\`yaml
heal:
  enabled: true
  primaryTimeoutMs: 3000
  probeTimeoutMs: 1500
  minScore: 0.6
  actions: [click, fill, select, assert, hover, check]
\`\`\`

I understand what the number does. I do not understand what I would gain or lose by moving it. Has anyone actually tuned this, and in which direction?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2024-08-22',
        votes: 18,
        body: `The number is chosen against the base scores rather than picked out of the air. role and name 1.0, test id 0.95, label 0.9, placeholder 0.8, exact text 0.7, partial text 0.5, css 0.4, and the score is \`base × uniqueness × visibility × enabled + history\` with the history bonus capped at 0.1.

So at 0.6 you are saying: a unique, visible, enabled match on anything down to exact text may win; CSS never can, because 0.4 with every multiplier at 1 and a full history bonus is 0.5; and a match that is not unique loses its uniqueness factor and usually falls below the line as well.

Raising it to 0.9 leaves you with test id and role, which is defensible if your application has good test ids. Lowering it below 0.5 turns CSS fallbacks on, and I would not.

One thing that surprises people: setting it to 1 does not disable healing. A unique, visible, enabled role-and-name candidate scores exactly 1.0 and the comparison is greater-than-or-equal. Use \`heal: { enabled: false }\` if off is what you want.`,
      },
      {
        id: 'a2',
        by: 'rgarrido',
        on: '2024-08-23',
        votes: 9,
        body: `We raised it to 0.8 on one project and the effect was not "fewer wrong heals", it was "more \`HEAL_FAILED\` on the same locators that used to heal via text". Which we wanted, because the failures pointed straight at page objects with thin contexts.

Six weeks later the contexts were better and we could have put it back, but there was no longer any reason to. Tune it as a forcing function on your own contexts rather than as a correctness dial.`,
      },
    ],
  },

  {
    slug: 'heal-failed-on-signed-in-username-with-testid-zero',
    title: 'HEAL_FAILED: nothing scored above 0.6 and testId probed at 0.00',
    askedBy: 'anouk-devries',
    askedOn: '2024-10-30',
    tags: ['heal', 'ui', 'locators'],
    votes: 38,
    views: 13520,
    body: `\`\`\`text
Could not locate "signed-in username" (getByTestId('sidenav-username')) and no healing candidate scored ≥ 0.6.
Probed: role=0.42, testid=0.00, label=0.00. Add role/name/testId/label to the heal context or fix the locator.
\`\`\`

The context is:

\`\`\`ts
readonly username = this.heal.locator(this.page.getByTestId('sidenav-username'), {
  role: 'status', name: 'Signed in as', testId: 'sidenav-username',
  label: 'Signed in as', description: 'signed-in username',
});
\`\`\`

What I cannot work out is \`testid=0.00\`. It is the same test id the primary uses, so of course it found nothing — but then why probe it at all? And where does 0.42 come from?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2024-10-30',
        votes: 35,
        body: `Taking them in order.

\`testid=0.00\` is a count of zero. A candidate that matches nothing scores zero outright, before any multiplier is applied. And you are right that declaring the same test id the primary already uses buys you nothing — it is probed because the healer does not assume the primary and the context overlap, but in your case it can only ever confirm what has already failed. Take it out of the context and put something useful there.

0.42 is the role candidate scoring badly rather than not matching. Base 1.0 for role and name, then multiplied down by uniqueness, visibility and enabled. Something with that role is on the page and the healer is not confident it is yours. The event records \`count\`, \`visible\` and \`enabled\` per candidate, so open it and see which multiplier did the damage rather than reasoning backwards from the number.

\`label=0.00\` is the other half of the story: \`getByLabel('Signed in as')\` matches nothing, so what you declared as a label is not a label in the accessibility sense. It is almost certainly adjacent text.

The context to write is the one that describes the element instead of restating the primary:

\`\`\`ts
readonly username = this.heal.locator(this.page.getByTestId('sidenav-username'), {
  role: 'status', name: /Signed in as/, text: 'Signed in as', description: 'signed-in username',
});
\`\`\`

Note the explicit \`text\`. Text candidates come from \`text\`, or from \`name\` when \`name\` is a string — a regular expression name gives you no text candidate at all.`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2024-10-31',
        votes: 13,
        body: `The likely root cause, going by the description: a sidenav username is usually rendered twice, once in the sidenav and once in a collapsed mobile menu, or wrapped in a container that is hidden at your viewport. Two matches costs you the uniqueness factor, and one of them being invisible costs you the rest.

Check what your viewport is actually rendering before you rewrite the context.`,
      },
      {
        id: 'a3',
        by: 'rgarrido',
        on: '2024-11-04',
        votes: 6,
        body: `Separate from the diagnosis: \`role: 'status'\` is a rough choice for a name display. If the element is not a live region, that probe is scoring against whatever else on the page claims the role.

We got much better results declaring the container's role and the text, and leaving the test id as the primary.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-error-class-sdodshealerror-or-sdodserror',
    title:
      'Is a healing failure a SdodsHealError or a SdodsError? The docs disagree with the output',
    askedBy: 'sergio-alcaraz',
    askedOn: '2025-02-19',
    tags: ['heal', 'cli'],
    votes: 16,
    views: 5340,
    body: `We catch SDODS errors in a small wrapper to add our own reporting. The self-healing guide's resolution diagram ends at a node labelled \`SdodsHealError\`, so I wrote:

\`\`\`ts
if (err.constructor.name === 'SdodsHealError') { /* ... */ }
\`\`\`

which never fires. What we actually get is a \`SdodsError\`. Which one is right?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2025-02-20',
        votes: 19,
        body: `The output is right and the diagram is wrong. There is no \`SdodsHealError\`. The healer throws \`SdodsError\` with the code \`HEAL_FAILED\`, a message naming the description and the primary selector, and a hint listing the probe scores.

Match on the code, never the class name:

\`\`\`ts
if (err instanceof SdodsError && err.code === 'HEAL_FAILED') { /* ... */ }
\`\`\`

Every structured error carries \`code\`, \`message\`, \`hint\` and \`docsUrl\`, and with \`--json\` they are printed as JSON on stderr, so the code is the stable thing to key on in either shape. I will get the diagram label fixed.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-nth-child-selector-breaks-and-healing-does-not-save-it',
    title: 'Our nth-child selectors break every sprint and healing never rescues them',
    askedBy: 'tanvi-bhatt',
    askedOn: '2025-04-24',
    tags: ['locators', 'heal', 'page-objects'],
    votes: 26,
    views: 8940,
    body: `Inherited suite, roughly two hundred locators in this shape:

\`\`\`ts
readonly price = this.heal.locator(
  this.page.locator('.results > div:nth-child(3) > span:nth-child(2)'),
  { description: 'first result price', css: ['.results div:nth-child(3) span'] },
);
\`\`\`

Every time the results list gains a badge or a promo row, a chunk of them break, and they break with \`HEAL_FAILED\` rather than healing. The contexts are declared, so I expected at least some recovery. What am I supposed to do with two hundred of these?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2025-04-24',
        votes: 24,
        body: `Your contexts are declared, but they are declared with the same thing that broke.

A \`css\` candidate has a base score of 0.4. The score is \`base × uniqueness × visibility × enabled + history\` with the bonus capped at 0.1, so the ceiling for CSS is 0.5 and \`minScore\` defaults to 0.6. A CSS-only context cannot heal — not because it is discouraged, because it cannot reach the threshold.

Worse, \`nth-child\` describes precisely the thing your promo row changes. A structural selector with a structural fallback is one locator written twice.`,
      },
      {
        id: 'a2',
        by: 'owen-brackley',
        on: '2025-04-25',
        votes: 27,
        body: `Two hundred is a migration rather than a fix, and it is worth doing in the order that gets you the most back first.

- \`analyze_locators\` over the MCP server audits \`pages/\`, \`steps/\` and \`recorded/\` and reports the kinds it found — role, label, test id, css, xpath — plus whether each is heal-wrapped, and a fragility score
- the reviewer agent will work over the same ground and write the rewrites as a proposal, so you review a diff instead of typing

The target shape for that price is the row found by its content, then the cell inside it:

\`\`\`ts
readonly price = this.heal.locator(
  this.page.getByRole('listitem').filter({ hasText: 'Widget' }).getByTestId('price'),
  { testId: 'price', description: 'first result price' },
);
\`\`\`

If the application has no test ids on results, that is the change to ask for. It is smaller than rewriting two hundred selectors twice.`,
      },
      {
        id: 'a3',
        by: 'lena-hartwig',
        on: '2025-04-28',
        votes: 8,
        body: `While you migrate, the interim that bought us time was declaring text as the fallback rather than CSS. Exact text has a base of 0.7 and clears the threshold when it is unique, so a locator with \`text: 'Add to basket'\` at least survives a structural change, even if it will not survive a copy change.

Not a destination, but it turned red runs into logged heals while we worked through the list.`,
      },
    ],
    acceptedAnswerId: 'a2',
  },

  {
    slug: 'heal-three-identical-heals-but-no-page-object-proposal',
    title: 'Same locator healed five times and I still have no page-object proposal',
    askedBy: 'koen-vermeulen',
    askedOn: '2025-06-18',
    tags: ['heal', 'agents', 'page-objects'],
    votes: 21,
    views: 7260,
    body: `The docs say three identical successful heals of the same locator produce a page-object patch proposal. Ours has healed five times across four nightly runs, same description, same winning selector, and:

\`\`\`bash
sdods proposals list --status pending
\`\`\`

comes back empty. The page object does use \`heal.locator\`, so this should be the deterministic path rather than the agent one.`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2025-06-18',
        votes: 17,
        body: `The counting does not happen during the run, it happens in insights, and insights reads a database rather than the run directories. If your nightly is not ingesting, the heal events are sitting in \`heal.jsonl\` where nothing is aggregating them.

\`\`\`bash
sdods run -p portal -e staging -l ui --ingest
\`\`\`

\`\`\`bash
sdods insights compute -p portal
\`\`\`

A locator becomes hot when its fragility clears the threshold and it has at least three heals, and hot locators are what the trigger watches. Check \`sdods insights show -p portal\` first: if the locator is not in the fragility table at all, the events never reached the database and no amount of waiting will produce a proposal.

[Insights and flaky management](https://docs.sdods.com/docs/guides/insights-and-flaky/)`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2025-06-19',
        votes: 9,
        body: `Also worth ruling out the boring one: proposals are per project, so \`sdods proposals list -p <slug>\` rather than the bare form if you have several in the workspace.

And the scheduler only spawns the command. If nothing is scheduled, nothing computes on its own and insights are as fresh as the last time somebody ran them.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-what-does-write-history-change',
    title: 'What does --write-history actually change about future heals?',
    askedBy: 'rasha-halabi',
    askedOn: '2025-09-08',
    tags: ['heal', 'cli', 'config'],
    votes: 19,
    views: 6180,
    body: `\`\`\`bash
sdods heal report -p storefront --write-history
\`\`\`

The docs say it biases future heals towards strategies that worked. Before I put it in the nightly I would like to know how much bias, and whether running it is reversible.`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2025-09-09',
        votes: 22,
        body: `Small, and yes.

The flag writes \`heal-history.json\` beside the artifacts directory, holding one entry per heal description with its success and failure counts and the strategy and selector that last worked. On the next run, a candidate whose strategy and selector match a remembered winner gets a bonus of successes over total, scaled by 0.1 and capped there, added after the multipliers.

So the most it can ever do is lift a candidate by a tenth. In practice that matters in exactly one place: it lets a candidate that keeps landing just short of \`minScore\` clear it, and it breaks ties between two otherwise equal candidates. It cannot promote a CSS candidate above the default threshold, and it cannot make a candidate that matches nothing win, because a zero count is a zero score before the bonus is added.

Reversible: delete the file. A missing or corrupt one is ignored rather than fatal, and the counts rebuild the next time you run with the flag.

> [!NOTE]
> The bias is keyed on strategy and selector, not on the description alone. Change the selector the element is found by and the history stops applying to it, which is what you want after a rename.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-healed-to-the-wrong-element-when-three-matched',
    title: 'Healing picked the wrong one of three matching elements and the test still passed',
    askedBy: 'devon-marsh',
    askedOn: '2025-12-11',
    tags: ['heal', 'locators', 'ui'],
    votes: 9,
    views: 2380,
    body: `Product grid, several cards, each with an "Add" button. The context on our add-to-basket locator is:

\`\`\`ts
{ role: 'button', name: 'Add', text: 'Add', description: 'add to basket' }
\`\`\`

The primary broke after a class rename. The healer found three matching buttons, scored the candidate above \`minScore\` anyway, took the first one and added the wrong product. The scenario passed, because the assertion afterwards only checks the basket count.

The event records \`count: 3\`, so the healer knew. I understand that uniqueness lowers the score rather than disqualifying the candidate, and that it resolves to the first match. What I would like to know is whether there is a supported way to say "refuse to heal when more than one thing matches", short of raising \`minScore\` far enough that non-unique candidates fall below it — which also takes out plenty of heals I do want.`,
    answers: [],
  },

  {
    slug: 'heal-turn-healing-off-for-a-single-scenario',
    title: 'Can I turn healing off for one scenario without touching the whole project?',
    askedBy: 'bea-lindqvist',
    askedOn: '2026-01-22',
    tags: ['heal', 'config', 'ci'],
    votes: 15,
    views: 4620,
    body: `We have one scenario whose entire job is to assert that the design system has not moved the primary action button. Healing makes it unfalsifiable — it heals to the role and passes no matter what we do to the markup.

Everything I can find is project or environment scoped. Is there a per-scenario or per-tag switch?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2026-01-22',
        votes: 18,
        body: `No per-scenario switch. Heal configuration resolves through the config layers and lands on the project, so the smallest unit you can disable it for is an environment.

For your case you do not want the switch anyway, you want the locator. Use \`.raw\` and assert on the primary directly:

\`\`\`ts
async assertPrimaryActionUnchanged() {
  await expect(this.submit.raw).toBeVisible();
}
\`\`\`

\`raw\` hands you the underlying Playwright locator with no healer in front of it, so the assertion fails the moment the primary stops matching. Two lines, scoped exactly to the thing you care about.`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2026-01-24',
        votes: 7,
        body: `Same conclusion from a different direction. A scenario asserting "the markup has not changed" is really a contract test, and contract tests should not share a mechanism with the scenarios that are supposed to be resilient. We keep ours in a separate feature and reach for \`raw\` throughout it — no config, and no surprises when somebody edits \`sdods.project.yaml\`.

If you ever do want it environment-wide, \`heal: { enabled: false }\` in \`envs/<env>.yaml\` works, since the env layer may override \`heal\`.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-probe-timeout-too-short-on-slow-staging',
    title: 'probeTimeoutMs of 1500 is too short on our staging box — every candidate scores 0',
    askedBy: 'rasha-halabi',
    askedOn: '2026-03-12',
    tags: ['heal', 'config', 'perf'],
    votes: 17,
    views: 5030,
    body: `Locally everything heals. On staging the same locators fail with \`HEAL_FAILED\` and every candidate in the hint reads 0.00, including ones I know match, because I can open the page and see them.

Staging is a shared box and slow, so my guess is that the probes are timing out. What I cannot tell from the event is the difference between "probe timed out" and "matched nothing" — both come out as zero.`,
    answers: [
      {
        id: 'a1',
        by: 'ingrid-solberg',
        on: '2026-03-12',
        votes: 16,
        body: `Your guess is right and the ambiguity is real. A probe that times out is caught and recorded as \`count: 0, visible: false, enabled: false, score: 0\`, which in the hint is indistinguishable from a candidate that genuinely matched nothing.

The \`ms\` field on each candidate is the tell — anything sitting right at your \`probeTimeoutMs\` timed out rather than answered.

Also worth knowing: \`probeTimeoutMs\` caps the whole probe, not each call inside it. The count, the visibility check and the enabled check all race the same deadline, so three round trips inside 1500 ms on a slow environment is tight.

Raise it for that environment only, since the env layer may override \`heal\`:

\`\`\`yaml
heal:
  probeTimeoutMs: 4000
\`\`\`

in \`envs/staging.yaml\`. Budget for it, though — the worst case per failing locator is \`primaryTimeoutMs\` plus \`probeTimeoutMs\`, so you have just moved four and a half seconds to seven.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2026-03-13',
        votes: 11,
        body: `Agreed on the fix. Before you settle there, look at \`primaryTimeoutMs\` too. If staging needs four seconds to render, the primary is timing out on elements that are merely late rather than gone, and you are paying the full heal cost on locators that were never broken. Those show up in \`sdods heal report --last\` as heals whose winning selector is effectively the primary.

Raising \`primaryTimeoutMs\` on that environment is cheaper than healing your way through it.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-heal-events-vs-locator-stats-vs-heal-report',
    title: 'heal_events, heal_locator_stats and sdods heal report — which do I use for what?',
    askedBy: 'zeynep-arslan',
    askedOn: '2026-06-30',
    tags: ['heal', 'mcp', 'reporting'],
    votes: 12,
    views: 3410,
    body: `Building a small internal dashboard on top of the MCP server. There appear to be three ways to get at healing data and I cannot tell from the tool descriptions where the boundaries are:

- \`heal_events\`
- \`heal_locator_stats\`
- \`sdods heal report\`

Do any of them need a database? And is \`heal_locator_stats\` the same aggregation the CLI does, or a different one?`,
    answers: [
      {
        id: 'a1',
        by: 'ingrid-solberg',
        on: '2026-06-30',
        votes: 11,
        body: `None of the three needs a database. All of them read the \`heal.jsonl\` files under the artifacts directory.

- \`heal_events\` is one run: pass a \`runId\`, or omit it and it takes the most recent, optionally filtered by \`project\`. Each event comes back decorated with the scenario fingerprint, the retry number and the scenario name, which is the part the CLI table does not give you.
- \`heal_locator_stats\` aggregates across recent runs — thirty by default — keyed on the original selector, with occurrences, a count per winning strategy and the suggested selector.
- \`sdods heal report\` is the same shape of aggregation, over one run by default or every run with \`--all\`.

For a dashboard I would use \`heal_locator_stats\` for the table and \`heal_events\` for the drill-down, because the fingerprint is what lets you join a heal back to a scenario.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2026-07-01',
        votes: 8,
        body: `One correction worth building in. The two aggregations key differently: the CLI keys on description plus original selector, the MCP tool keys on the original selector alone. If two page objects declare different descriptions over the same selector you get two rows from one and one row from the other. Neither is wrong, but do not diff them and conclude something is broken.

A database only enters the picture a level up, at insights — locator fragility is computed from \`locator_stats\`, which needs ingested runs.`,
      },
      {
        id: 'a3',
        by: 'owen-brackley',
        on: '2026-07-03',
        votes: 4,
        body: `From having built roughly this: put \`pageUrl\` on the drill-down. Selector and description tell you what healed, the URL tells you where, and without the third one you spend a lot of time guessing which of four pages a shared component was on.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'heal-locator-fragility-table-is-empty-in-insights',
    title: 'Locator fragility table is empty in insights but heal report has plenty of rows',
    askedBy: 'paulo-mendes',
    askedOn: '2026-08-20',
    tags: ['heal', 'reporting', 'config'],
    votes: 4,
    views: 890,
    body: `\`\`\`bash
sdods heal report -p portal --all
\`\`\`

gives me eleven rows, two of them with double-digit occurrences.

\`\`\`bash
sdods insights show -p portal
\`\`\`

prints suite health and the scenario table, and the locators section is empty.

Runs are being ingested — there is a database configured and I can see scenarios from the same runs in the flakiness table, so it is not that nothing reached it. Is locator fragility computed from something other than the heal events, or is there a separate ingest step for those?`,
    answers: [],
  },
];
