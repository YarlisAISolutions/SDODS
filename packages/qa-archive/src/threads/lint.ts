import type { Thread } from '../types';

export const lintThreads: Thread[] = [
  {
    slug: 'lint-scenario-must-carry-exactly-one-layer-tag',
    title: 'sdods lint: "Scenario must carry exactly one layer tag" on every scenario I have',
    askedBy: 'mkuiper',
    askedOn: '2020-11-16',
    tags: ['lint', 'ui'],
    votes: 34,
    views: 12840,
    body: `Ported a feature file over from our old cucumber project and lint rejects all of it.

\`\`\`bash
sdods lint -p demo-shop
\`\`\`

\`\`\`text
✖ features/auth/login.feature:7  tags/layer  Scenario must carry exactly one layer tag (@ui, @api, @hybrid); found none.
✖ features/auth/login.feature:7  tags/suite  Scenario must carry exactly one suite tag (@smoke, @regression, @sanity); found none.
✖ features/auth/login.feature:14  tags/layer  Scenario must carry exactly one layer tag (@ui, @api, @hybrid); found none.
✖ features/auth/login.feature:14  tags/suite  Scenario must carry exactly one suite tag (@smoke, @regression, @sanity); found none.
1 feature file(s), 4 error(s), 0 warning(s)
\`\`\`

The Gherkin is valid — it parses, the steps exist. What is a "layer tag", and does it belong on the Feature or on every single Scenario?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2020-11-16',
        votes: 41,
        body: `The layer tag is not decoration, it picks the runner target. \`@ui\` runs in a browser context, \`@api\` runs with the API client and no browser, \`@hybrid\` gets both. Without it there is nothing to run the scenario as, so it is an error rather than a warning.

You do not have to repeat it. Tags on the \`Feature:\` line are inherited by every scenario under it, so a whole file that is one layer gets one tag:

\`\`\`gherkin
@ui @auth
Feature: Login
  As a shopper I want to sign in so that I can see the inventory.

  @smoke @har:login
  Scenario: Successful login shows the products
    When I login with "standard_user" and "{{standardPassword}}"
    Then I should be on the inventory page

  @regression
  Scenario: Generic UI steps work against the login form
    When I fill the element with test id "username" with "standard_user"
    Then the page URL should contain "/inventory.html"
\`\`\`

Suite tags I would keep per scenario, because they are the thing you filter a run on and they differ inside a file.

If the layout already makes the layer obvious, \`--fix-tags\` will write it in for you:

\`\`\`bash
sdods lint -p demo-shop --fix-tags
\`\`\`

It only inserts a tag when it can derive one — a \`features/ui/\` path segment or the module's declared \`layers\`. It will not guess a suite tag for you.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2020-11-18',
        votes: 12,
        body: `Adding to that: the reason inheritance is safe for the layer and awkward for the suite is that the suite tag also selects the screenshot policy. In the project yaml:

\`\`\`yaml
screenshots:
  policy:
    default: on-failure
    '@smoke': scenario
    '@regression': step
    '@sanity': scenario
\`\`\`

If you put \`@regression\` on the Feature line you have quietly signed every scenario in the file up for a screenshot per step. Fine for a five-step file, less fine for a big one.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-found-smoke-and-regression-two-suite-tags',
    title: 'Lint says "found @smoke @regression" — why can a scenario not be in both suites?',
    askedBy: 'annika-solheim',
    askedOn: '2021-03-22',
    tags: ['lint', 'smoke', 'regression'],
    votes: 22,
    views: 8410,
    body: `I tagged our happy-path checkout scenario with both suite tags because I want it in the pull-request smoke run and in the nightly regression run. Lint disagrees:

\`\`\`text
✖ features/cart/checkout.feature:18  tags/suite  Scenario must carry exactly one suite tag (@smoke, @regression, @sanity); found @smoke @regression.
1 feature file(s), 1 error(s), 0 warning(s)
\`\`\`

Surely wanting a scenario in two suites is normal? Or am I meant to duplicate the scenario?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2021-03-22',
        votes: 30,
        body: `Do not duplicate it. The suite tag is a classification, not a subscription list — it answers "what kind of check is this", and a scenario that is both the smoke check and the regression check is really just the smoke check.

Selection is done by the tag expression, not by the tag alone. Your nightly run does not have to say \`-t @regression\`:

\`\`\`bash
sdods run -p demo-shop -t "@smoke or @regression"
\`\`\`

Or put it in the project yaml so nobody has to remember it:

\`\`\`yaml
processes:
  - name: release-gate
    title: Release gate
    trigger: release
    tags: '@smoke or @regression'
    browsers: [chromium, firefox, webkit]
\`\`\`

then \`sdods run -p demo-shop --process release-gate\`.

The other reason for exactly one is the screenshot policy, which is keyed on the suite tag. With two of them there is no single answer to "how much do we capture for this scenario".`,
      },
      {
        id: 'a2',
        by: 'hsu-wei-lin',
        on: '2021-03-25',
        votes: 9,
        body: `We hit this too and settled on a rule that has held up: if the scenario is allowed to break the pull request, it is \`@smoke\`. Everything else is \`@regression\`. Then the nightly expression is \`or\` and nothing needs two tags.

Worth knowing the error text is generated from your project, not hardcoded — the list in the message comes from \`tags.suites\`. If you renamed suites, the message names your names.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-exit-code-3-not-1-in-ci',
    title: 'Our CI step passes even when lint fails — checking for exit code 1 was wrong?',
    askedBy: 'rgarrido',
    askedOn: '2021-06-14',
    tags: ['lint', 'ci', 'cli'],
    votes: 26,
    views: 9930,
    body: `Someone wrote our pipeline step defensively:

\`\`\`bash
sdods lint -p demo-shop
if [ "$?" = "1" ]; then echo "lint failed"; exit 1; fi
\`\`\`

A branch went in last week with two scenarios missing their suite tag and the step was green. Running it by hand I can see the findings printed, so lint is definitely finding them. What does it actually exit with?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2021-06-15',
        votes: 33,
        body: `\`3\`. Lint errors get their own code precisely so a pipeline can tell "your features are wrong" apart from "a test failed" and from "your config is wrong":

- \`0\` success
- \`1\` failure — scenario failures, a gate not met, an unexpected runtime error
- \`2\` configuration or usage error — unknown project, missing environment file, invalid YAML, bad flag value
- \`3\` lint errors, including when \`sdods run\` lints first
- \`130\` cancelled

So delete the \`if\` entirely and let the non-zero exit fail the step:

\`\`\`bash
sdods lint -p demo-shop
\`\`\`

If you want the findings as data rather than as text, \`--json\` gives you \`{ ok, errors, warnings, filesChecked }\` on stdout and you can key off \`ok\`.

Full table: [Exit codes](https://docs.sdods.com/docs/reference/exit-codes/).`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-ui-and-api-on-the-same-scenario',
    title: 'Can a scenario be tagged @ui and @api at once? Lint says "found @hybrid @ui @api"',
    askedBy: 'vikram-r',
    askedOn: '2021-10-05',
    tags: ['lint', 'ui', 'hybrid'],
    votes: 19,
    views: 7620,
    body: `The scenario seeds a record over the API and then checks it renders in the browser, so it genuinely is both. I tagged it as both and got:

\`\`\`text
✖ features/hybrid/seed-then-view.feature:6  tags/layer  Scenario must carry exactly one layer tag (@ui, @api, @hybrid); found @hybrid @ui @api.
\`\`\`

Three? I only wrote two. The \`@hybrid\` is on the \`Feature:\` line, left over from before I split this file. So are feature-level tags counted as part of a scenario's tags, and if they are, how do I say "this one scenario is both layers"?`,
    answers: [
      {
        id: 'a1',
        by: 'lena-hartwig',
        on: '2021-10-05',
        votes: 24,
        body: `Both halves of that have the same answer: feature-level tags are counted, and that is why you have two.

Lint reads the effective tag set — Feature tags, plus Rule tags if you use them, plus Scenario tags, plus any tags on an \`Examples:\` block, all merged. So your \`@hybrid\` on the Feature line and your \`@ui @api\` on the scenario add up to three layer tags on that scenario.

The thing you actually want is the one you already have on the Feature line. \`@hybrid\` is exactly "this scenario uses the API client and a browser context in the same test":

\`\`\`gherkin
@hybrid
Feature: Seed then view

  @smoke
  Scenario: A post created over the API shows on the page
    Given I create a post with title "Ship it"
    When I am on the posts page
    Then I should see the text "Ship it"
\`\`\`

Drop \`@ui @api\` from the scenario and the file lints.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2021-10-07',
        votes: 11,
        body: `One consequence of the merge that catches people later: it also applies to a Feature that is tagged with one layer and holds a stray scenario of another. If \`@ui\` is on the Feature line you cannot make one scenario in that file \`@api\` — you get \`found @ui @api\` on that scenario and nothing you write on the scenario removes the inherited tag. Move it to its own file under the module for that layer.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-feature-is-not-under-a-declared-module-directory',
    title: 'Warning: "Feature is not under a declared module directory" — but the file runs fine',
    askedBy: 'gcastellano',
    askedOn: '2022-03-14',
    tags: ['lint', 'config'],
    votes: 15,
    views: 6180,
    body: `I put a new file at \`features/smoke-checks.feature\`, straight under \`features/\`. It runs, it passes, but every lint gives me:

\`\`\`text
⚠ features/smoke-checks.feature:1  module/unassigned  Feature is not under a declared module directory (features/auth, features/inventory, features/cart, features/api, features/hybrid).
1 feature file(s), 0 error(s), 1 warning(s)
\`\`\`

It is only a warning so nothing is blocked, but it is noise on every run. Is the fix to add a module, or to move the file?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2022-03-14',
        votes: 20,
        body: `Move the file, in almost every case. Modules are the unit that carries ownership and expectations — owner, jira component, the routes and endpoints it covers, the tags every scenario in it should have, and the testing types it is allowed to declare. A feature outside all of them has none of that, and it will not show up under a module in coverage.

The list in the message is built from your own \`modules\` block, so it is telling you the whole set of valid homes:

\`\`\`yaml
modules:
  - name: cart
    title: Cart
    path: cart
    layers: [ui]
    testingTypes: [functional, regression]
    tags: ['@cart']
    routes: [cart, checkout]
\`\`\`

\`path\` defaults to \`name\`, which is why \`features/cart/\` works with no \`path\` line at all. If your file really is a cross-cutting set of checks that belongs to nothing, declare a module for it — that is cheaper than living with the warning and eventually ignoring warnings generally.`,
      },
      {
        id: 'a2',
        by: 'mkuiper',
        on: '2022-03-16',
        votes: 6,
        body: `Worth adding that the rule only fires when you have modules at all. A project with an empty \`modules\` list never gets this warning, so if you are early and still shuffling directories you can leave modules out until the shape settles.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-user-admin-is-not-a-declared-role',
    title: '"@user:admin is not a declared role (standard, locked_out)" — where is that list?',
    askedBy: 'sam-orbison',
    askedOn: '2022-05-11',
    tags: ['lint', 'pool', 'config'],
    votes: 17,
    views: 6740,
    body: `Added an admin-only scenario:

\`\`\`gherkin
@ui @regression @user:admin
Scenario: An admin can void an order
\`\`\`

\`\`\`text
✖ features/orders/void.feature:22  tags/user  @user:admin is not a declared role (standard, locked_out).
\`\`\`

We do have an admin account in the users CSV, with \`role\` set to \`admin\`. So why does lint not see it?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2022-05-11',
        votes: 21,
        body: `Because lint does not read your CSV. It validates \`@user:<role>\` against \`tags.roles\` in the project yaml, which is a deliberately separate, hand-maintained list:

\`\`\`yaml
tags:
  suites: [smoke, regression, sanity]
  extra: [mock, visual, a11y, perf, data-driven, pool]
  roles: [standard, locked_out]
\`\`\`

Add \`admin\` there and the error goes.

The separation is on purpose. The pool dataset is environment-specific and can be a file that does not exist on the machine running lint, or a database table, or fifty rows of which two are admins. \`tags.roles\` is the vocabulary you have agreed to use in features; the dataset is where the credentials live. A typo like \`@user:adnim\` is caught at lint time instead of at 3am when the lease fails.

Do check the two agree, though. A role that lints but has no row in the pool gives you a \`USER_POOL_EXHAUSTED\` at run time instead, which is a much slower way to learn the same thing.`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2022-05-12',
        votes: 7,
        body: `Small note on the check itself: it is skipped entirely when \`tags.roles\` is empty. So a project that has never declared roles accepts \`@user:anything\` silently. Once you add the first role you are opting into validation for all of them, which surprised us the day we added one.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-choosing-between-smoke-regression-sanity',
    title: 'How do you actually decide between @smoke, @regression and @sanity?',
    askedBy: 'sunita-kale',
    askedOn: '2022-10-03',
    tags: ['smoke', 'regression', 'sanity', 'lint'],
    votes: 44,
    views: 15920,
    body: `Lint makes me pick exactly one, which is fine, but the three names do not tell me much and everyone on the team has a different theory. Right now roughly everything is \`@regression\` and \`@smoke\` has four scenarios in it that somebody picked at random in the first week.

Is there a definition that survives contact with a real suite, or is this just taste?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2022-10-03',
        votes: 38,
        body: `The definitions that hold up are about when the suite runs and what happens when it goes red, not about how important the feature is.

- \`@smoke\` is a budget. It runs on every pull request, on one browser, and it has to stay under a few minutes. If adding a scenario to it would push it over, something else has to leave. Being in smoke means "this may block a merge".
- \`@regression\` is the truth. Everything with product value, run nightly on every browser. This is the default; a new scenario is regression unless there is a reason.
- \`@sanity\` is targeted. A small set you point at something after a hotfix or a data migration, when you want an answer in ninety seconds and you do not want the nightly.

The budget framing is what makes the smoke set stable. Without it people add "just this one" until smoke is twenty minutes and gets skipped.`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2022-10-04',
        votes: 14,
        body: `Two practical consequences that made the choice concrete for us.

The suite tag selects the screenshot policy, so the choice has a cost:

\`\`\`yaml
screenshots:
  policy:
    default: on-failure
    '@smoke': scenario
    '@regression': step
    '@sanity': scenario
\`\`\`

\`@regression\` captures a screenshot per step. That is what you want when the nightly fails and nobody was watching; it is not what you want on a pull request.

And the names are configurable. \`tags.suites\` is a list, and lint enforces "exactly one of whatever is in it". If your team genuinely thinks in \`critical\`/\`extended\` you can say so — the lint message then names your suites.`,
      },
      {
        id: 'a3',
        by: 'petrov-k',
        on: '2022-10-11',
        votes: 5,
        body: `We renamed ours and regretted it. Every doc page, every example and every new joiner arrives expecting smoke/regression/sanity, and you spend the rest of the project translating. If the default three can be made to fit, make them fit.`,
      },
    ],
  },

  {
    slug: 'lint-env-qa-is-not-in-envs-available',
    title:
      '@env:qa rejected with "is not in envs.available (local, staging)" — we do have a qa env',
    askedBy: 'ade-oyinlola',
    askedOn: '2023-02-20',
    tags: ['lint', 'config', 'api'],
    votes: 13,
    views: 5240,
    body: `We added \`projects/shop/envs/qa.yaml\` last week and it works — \`sdods run -p shop -e qa -l api\` runs against it. But the moment I pin a scenario to it:

\`\`\`gherkin
@api @regression @env:qa
Scenario: The rate limiter returns 429 after the tenth call
\`\`\`

\`\`\`text
✖ features/api/rate-limit.feature:12  tags/env  @env:qa is not in envs.available (local, staging).
\`\`\`

The file exists. What else is it looking at?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2023-02-20',
        votes: 18,
        body: `The declared list, not the directory. Add it to the project yaml:

\`\`\`yaml
envs:
  default: staging
  available: [local, staging, qa]
\`\`\`

The env file being loadable and the env being a declared target are two different facts on purpose — you can keep a scratch env file on disk without it becoming something scenarios are allowed to pin themselves to, and \`envs.available\` is what the run viewer, the scheduler and this lint rule all read.

Same list, same message, everywhere: the parenthesised names in the error are just \`envs.available\` joined.`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2023-02-22',
        votes: 6,
        body: `While you are in there — think about whether you want \`@env:qa\` at all. It is a real restriction, so that scenario silently does not run on staging or local, and six months later somebody wonders why coverage for the rate limiter is missing. We ended up using it only for things that are genuinely impossible elsewhere (a third-party sandbox that only exists in one env) and leaving everything else unpinned.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-duplicate-scenario-title-different-capitalisation',
    title: 'Duplicate scenario title error but the two titles are not identical',
    askedBy: 'yusuf-demir',
    askedOn: '2023-06-06',
    tags: ['lint'],
    votes: 16,
    views: 5910,
    body: `\`\`\`text
✖ features/cart/cart.feature:41  scenario/duplicate  Duplicate scenario title "add an item to the cart" (first at line 12).
\`\`\`

Line 12 is \`Scenario: Add an item to the cart\` and line 41 is \`Scenario: add an item to the cart \`. Different capital letter, and the second one has a trailing space. I would not call those the same title. Is this intentional or is the comparison just sloppy?`,
    answers: [
      {
        id: 'a1',
        by: 'renata-kohl',
        on: '2023-06-06',
        votes: 19,
        body: `Intentional. The comparison trims the title and lowercases it before checking, so capitalisation and surrounding whitespace do not create two scenarios that are the same scenario.

The reason is downstream: the title is the human-facing identity of a test everywhere it appears — the run viewer, the html report, \`--scenario\` filtering, flake history keyed by test. Two scenarios whose titles differ only by a capital letter produce a report nobody can read and a flake record split across two rows that are secretly one test.

The message names the line of the first one so you can see them side by side, which usually makes the answer obvious: one of the two is a copy someone forgot to rename.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2023-06-08',
        votes: 8,
        body: `The check is per feature file, not per project, so the same title in two different files is allowed — \`Add an item to the cart\` can exist in \`cart.feature\` and in \`checkout.feature\` without complaint. Whether that is a good idea is another question, but lint will not stop you.

Also note it counts a Scenario Outline once, by its outline title. The generated example rows get their names from the \`# title-format:\` comment and are not compared here.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-outline-has-no-title-format-comment',
    title:
      'Where exactly does the "# title-format:" comment go? Lint still warns after I added one',
    askedBy: 'chandra-p',
    askedOn: '2023-08-09',
    tags: ['lint', 'data-driven'],
    votes: 21,
    views: 7130,
    body: `Trying to clear this:

\`\`\`text
⚠ features/auth/login.feature:15  outline/title-format  Scenario Outline has no "# title-format:" comment; examples will be titled "Example #N".
\`\`\`

I added the comment and the warning did not move. My file:

\`\`\`gherkin
# title-format: <username> → <error>

@ui @regression
Scenario Outline: Failed login shows a clear error
  When I login with "<username>" and "<password>"
  Then I should see the login error "<error>"

  Examples:
    | username        | password     | error                                   |
    | locked_out_user | secret_sauce | Sorry, this user has been locked out.   |
    | standard_user   | wrong        | Username and password do not match      |
\`\`\`

Does it have to be in a particular place?`,
    answers: [
      {
        id: 'a1',
        by: 'lena-hartwig',
        on: '2023-08-09',
        votes: 25,
        body: `Yes. The comment is only picked up if it sits inside the outline's own span — from two lines above the \`Scenario Outline:\` keyword down to the last row of the last \`Examples:\` table. Yours is three lines up, above the tag line, so it falls one line outside the window and belongs to nothing.

Put it directly above \`Examples:\`, which is also where it reads best:

\`\`\`gherkin
@ui @regression
Scenario Outline: Failed login shows a clear error
  When I login with "<username>" and "<password>"
  Then I should see the login error "<error>"

  # title-format: <username> → <error>
  Examples:
    | username        | password     | error                                   |
    | locked_out_user | secret_sauce | Sorry, this user has been locked out.   |
    | standard_user   | wrong        | Username and password do not match      |
\`\`\`

The match is case-insensitive and tolerates missing space after the hash, so \`#Title-Format:\` also counts — but the position is not negotiable.`,
      },
      {
        id: 'a2',
        by: 'renata-kohl',
        on: '2023-08-10',
        votes: 11,
        body: `It is worth doing rather than suppressing. Without the comment, a failing row is reported as \`Example #3\` and you have to open the feature file and count table rows to find out which data broke. With it, the failure reads \`locked_out_user → Sorry, this user has been locked out.\` and the report tells you the answer.

The placeholders are the column names in angle brackets, same as in the steps, and you can put literal text around them.`,
      },
      {
        id: 'a3',
        by: 'priya-venkatesh',
        on: '2023-09-04',
        votes: 4,
        body: `Late addition for anyone who finds this while cleaning up an old project: it is a warning, so it never blocks a run — unless somebody has \`--strict\` in the pipeline, in which case all warnings become exit 3 and this is usually the one that trips first.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-jira-tag-must-look-like-proj-123',
    title: '@jira:demo12 must look like PROJ-123 — what patterns do the issue tags accept?',
    askedBy: 'helle-borg',
    askedOn: '2023-11-13',
    tags: ['lint', 'reporting'],
    votes: 11,
    views: 4380,
    body: `Two errors from the same commit:

\`\`\`text
✖ features/cart/coupon.feature:9  tags/jira  @jira:demo12 must look like PROJ-123.
✖ features/cart/coupon.feature:20  tags/github  @github:abc must be an issue number.
\`\`\`

I get that the second one wants a number. What is wrong with \`demo12\`? Our board key really is lowercase in the URL.`,
    answers: [
      {
        id: 'a1',
        by: 'renata-kohl',
        on: '2023-11-14',
        votes: 14,
        body: `The lowercase is the problem, and so is the missing dash. \`@jira:\` wants the canonical issue key shape: an uppercase letter, then more uppercase letters or digits, then a dash, then digits. \`DEMO-12\` passes. \`demo12\`, \`DEMO12\` and \`demo-12\` all fail.

Jira itself renders keys uppercase and its URLs are case-insensitive, so the one you see in the address bar is not evidence. Take the key from the issue header.

\`@github:\` is stricter still — digits only, no \`#\`, no owner/repo prefix:

\`\`\`gherkin
@ui @regression @jira:DEMO-12 @github:412
Scenario: A coupon below the minimum spend is rejected
\`\`\`

Both tags exist so the run viewer can link the scenario back to the issue, which is why the shape has to be exact rather than nearly right.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-unknown-tag-warns-but-jira-tag-errors',
    title: 'Why is a completely made-up tag only a warning while @jira:demo12 fails the build?',
    askedBy: 'nikhil-sane',
    askedOn: '2024-03-19',
    tags: ['lint', 'ci'],
    votes: 39,
    views: 13470,
    body: `Trying to understand the severity model, because it looks backwards to me.

\`\`\`text
✖ features/cart/cart.feature:22  tags/jira  @jira:demo12 must look like PROJ-123.
✖ features/cart/cart.feature:31  tags/skip  @skip:safari must name a browser (chromium, firefox, webkit, mobile-chrome, mobile-safari).
⚠ features/cart/cart.feature:8  tags/unknown  Unknown tag @wip. Declare it under tags.extra or a module's tags in sdods.project.yaml.
⚠ features/cart/cart.feature:14  tags/unknown  Unknown value tag @foo:bar.
2 feature file(s), 2 error(s), 2 warning(s)
\`\`\`

\`@foo:bar\` is total nonsense and it only warns. \`@jira:demo12\` is an obvious typo of a real thing and it stops the build. What is the rule?`,
    answers: [
      {
        id: 'a1',
        by: 'bea-lindqvist',
        on: '2024-03-19',
        votes: 18,
        body: `It is not "how wrong is this", it is "does SDODS have to do something with it".

A tag it does not recognise at all — \`@wip\`, \`@foo:bar\` — is inert. Nothing reads it, nothing branches on it, the run is identical with or without it. So it warns: you probably meant something, and the warning makes the typo visible, but there is nothing to get wrong at run time.

A tag whose key it does recognise is a promise about behaviour. \`@jira:\` becomes a link in the run viewer. \`@skip:\` removes the scenario from a browser. \`@user:\` leases a pool account before the context starts. If the value is wrong, that behaviour silently does not happen — \`@skip:safari\` excludes the scenario from nothing at all, because there is no engine called safari, and you find out when webkit goes red. That is worth stopping for.

Short version: unknown key, warning. Known key, bad value, error.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2024-03-20',
        votes: 27,
        body: `That is right, and the boundary is worth spelling out because the set of "known keys" is fixed while the set of known plain tags is yours.

Errors — the key is recognised and the value is checked against the project:

- \`@env:\` against \`envs.available\`
- \`@user:\` against \`tags.roles\` (skipped when that list is empty)
- \`@data:\` against the keys of \`data.sources\`
- \`@jira:\` and \`@github:\` against their patterns
- \`@skip:\` against the supported browsers

Warnings — nothing is claimed, so nothing can be broken:

- a plain tag that is not a layer, not a suite, not in \`tags.extra\` and not in any module's \`tags\`
- a value tag whose key is not one of the recognised ones at all
- \`@har:\` naming a file that has not been recorded yet, which is a legitimate intermediate state

And a small set is passed through untouched because the runner owns them, not lint: \`@only\`, \`@skip\`, \`@fixme\`, \`@fail\`, \`@slow\`, \`@timeout:30000\`, \`@retries:2\`, \`@mode:serial\`.

Note \`@skip\` bare is in that list and \`@skip:safari\` is not. Bare \`@skip\` is the runner's own "do not run this"; \`@skip:<browser>\` is ours, and it is validated.`,
      },
      {
        id: 'a3',
        by: 'lena-hartwig',
        on: '2024-03-22',
        votes: 9,
        body: `The practical follow-on is that warnings do not police themselves. \`@wip\` warns forever and everybody stops reading the output. Either declare the tag:

\`\`\`yaml
tags:
  extra: [mock, visual, a11y, perf, data-driven, pool, wip]
\`\`\`

or run \`--strict\` in the pipeline so warnings are exit 3 and the drift cannot accumulate. Doing neither is how you end up with forty warnings and a team that has learned to scroll past them.`,
      },
      {
        id: 'a4',
        by: 'renata-kohl',
        on: '2024-05-02',
        votes: 3,
        body: `One more that bit us: a tag counts as declared if it appears in any module's \`tags\`, not only the module the file happens to live in. So \`@cart\` on a scenario under \`features/auth/\` does not warn as unknown — it is a real tag, just in the wrong place. You get \`module/tags\` telling you the auth tag is missing instead, which reads oddly until you know why.`,
      },
    ],
    acceptedAnswerId: 'a2',
  },

  {
    slug: 'lint-tag-expression-combined-with-layer',
    title: 'Does -t "@regression and not @mock" replace the layer filter or add to it?',
    askedBy: 'fiona-mcallister',
    askedOn: '2024-05-21',
    tags: ['cli', 'regression', 'lint'],
    votes: 24,
    views: 8760,
    body: `I want the nightly regression minus anything that runs against mocked network, so:

\`\`\`bash
sdods run -p demo-shop -e staging -l ui -t "@regression and not @mock"
\`\`\`

It ran fewer scenarios than \`-t @regression\` on the same layer, which is what I wanted, but I cannot tell whether \`-l ui\` was actually honoured or whether my expression replaced it and the ui-only result was a coincidence of what we have tagged. How do the two combine?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2024-05-21',
        votes: 26,
        body: `They combine, they do not compete. The layer is applied as a tag of its own and your expression is wrapped in parentheses next to it, so what actually runs is:

\`\`\`text
(@ui) and (@regression and not @mock)
\`\`\`

That is per layer — if you pass \`-l ui -l api\` you get two run targets, each with its own layer wrapped around the same expression, which is why \`-t "@ui or @api"\` is never the way to ask for both. Use \`-l\` for the layer and \`-t\` for everything else.

The parentheses matter more than they look. Without them an expression starting with \`not\` would bind against the layer and quietly invert the wrong thing.`,
      },
      {
        id: 'a2',
        by: 'bea-lindqvist',
        on: '2024-05-22',
        votes: 11,
        body: `To convince yourself rather than infer it from counts, ask what would run without running it:

\`\`\`bash
sdods run -p demo-shop -e staging -l ui -t "@regression and not @mock" --list
\`\`\`

That prints the run targets and the tests each one selected. It is also the fastest way to catch an expression that matched nothing, which otherwise looks like a healthy green run.`,
      },
      {
        id: 'a3',
        by: 'thom-vasseur',
        on: '2024-06-03',
        votes: 5,
        body: `Since you are excluding \`@mock\` — check that it is declared in \`tags.extra\`. \`not @mock\` against a tag nobody has declared still works as an expression, but if the tag was a typo somewhere you are excluding nothing and the run is just regression. The lint warning for the misspelled one is your signal.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-tag-typo-made-the-pipeline-green',
    title: 'A typo in -t made CI green for three weeks — why does matching nothing exit 0?',
    askedBy: 'bruno-teixeira',
    askedOn: '2024-08-13',
    tags: ['ci', 'cli', 'smoke'],
    votes: 57,
    views: 19240,
    body: `Someone renamed our pull-request step and dropped a letter:

\`\`\`bash
sdods run -p shop -e staging -l ui -t @smok
\`\`\`

Three weeks of green pull requests. Nothing ran. The output even says so if you scroll up:

\`\`\`text
⚠ No scenarios matched the selection (tags @smok · layers ui).

✔ passed  0 passed, 0 failed, 0 skipped, 0 flaky  (11s)
\`\`\`

A green tick under a warning that says nothing ran is a bad combination. Why is that not a failure, and what do we put in the pipeline so it never happens again?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2024-08-13',
        votes: 48,
        body: `There is no flag for it, which is the uncomfortable part of the answer. An empty selection warns on stderr and exits 0:

\`\`\`text
⚠ No scenarios matched the selection (tags: @smok).
\`\`\`

The reason it is a warning rather than an error is that an empty selection is legitimately fine in plenty of runs — a shard that gets nothing, \`--scenario\` filtering while you iterate, a module with no api-layer scenarios yet in a matrix that covers every module. Failing all of those by default would be worse than the bug you hit.

So the pipeline has to assert it itself. Two ways that work today:

\`\`\`bash
# 1. Ask what would run, and fail if the answer is nothing.
test -n "$(sdods run -p shop -e staging -l ui -t @smoke --list)" || exit 1

# 2. Or treat the warning as fatal.
sdods run -p shop -e staging -l ui -t @smoke 2>&1 | tee run.log
grep -q 'No scenarios matched' run.log && exit 1
\`\`\`

The first is better — it costs a second and it fails before anything runs.

But there is nothing interactive about CI, so turn it on there. It is one flag and it is exactly the failure you wanted three weeks ago.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2024-08-13',
        votes: 22,
        body: `Also worth understanding why lint did not save you: \`@smok\` was never in a feature file. It was on the command line. Lint reads features, so a tag that exists only in a pipeline script is invisible to it — nothing is misspelled in the repository.

That is the whole class of bug. Tag typos inside features are caught by lint; tag typos in an expression are caught by whatever you put around the command, or not at all.

The other half of the fix is not to write the expression on the command line. Name it once in the project and let the pipeline call it:

\`\`\`yaml
processes:
  - name: pr-check
    title: Pull request check
    trigger: pr
    tags: '@smoke'
    browsers: [chromium]
    gates: { minPassRate: 100 }
\`\`\`

\`\`\`bash
sdods run -p shop -e staging --process pr-check
\`\`\`

Now the expression is reviewed like code, and a bad process name is a usage error rather than a silent empty run.`,
      },
      {
        id: 'a3',
        by: 'bea-lindqvist',
        on: '2024-08-14',
        votes: 13,
        body: `Worth saying that a gate is not a substitute for the check. A pass-rate gate answers "was everything that ran green"; the \`--list\` check answers "did anything run". You want both, because the green tick is claiming both.

For the immediate audit: \`sdods run ... --list\` on your current pipeline arguments tells you in seconds whether every step selects a non-empty set. We found two more after this thread.`,
      },
      {
        id: 'a4',
        by: 'anouk-devries',
        on: '2024-11-27',
        votes: 6,
        body: `Coming to this late after doing exactly the same thing with \`-l\` instead of \`-t\` — \`-l recorded\` on a project with no recorded specs. Same silent zero, same green.

One thing that helped afterwards: the warning goes to stderr and the summary to stdout, so a pipeline that only captures stdout never shows the line that would have explained it. Worth checking how your CI collects output before you conclude the warning was not printed.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-fix-tags-did-not-add-the-suite-tag',
    title: '--fix-tags added @ui everywhere but left every suite-tag error untouched',
    askedBy: 'anouk-devries',
    askedOn: '2024-10-08',
    tags: ['lint', 'cli'],
    votes: 18,
    views: 6320,
    body: `Inherited a project with about ninety scenarios and no tags at all. Ran:

\`\`\`bash
sdods lint -p shop --fix-tags
\`\`\`

It rewrote the files and the layer errors are gone, which is great. But every \`tags/suite\` error is still there, and it also did not touch some of the layer ones. Is this a bug, or is it refusing on purpose?`,
    answers: [
      {
        id: 'a1',
        by: 'bea-lindqvist',
        on: '2024-10-08',
        votes: 22,
        body: `On purpose, and the rule is that it only writes a tag it can derive from something you already told it.

It fixes two things:

- a missing layer tag, when the path contains a \`features/ui/\`, \`features/api/\` or \`features/hybrid/\` segment, or when the owning module declares \`layers\`. Note "missing" — if the scenario already has two layer tags it will not pick one to delete.
- a missing module tag, because the module says which tag its scenarios carry.

It never guesses a suite tag, because nothing in your project says whether a given scenario is smoke, regression or sanity. That is a judgement about what the scenario is for, and a tool that guessed it would fill your smoke suite with ninety scenarios and be wrong about most of them.

The layer ones it skipped are the ones where neither signal was available — a file under a module with no \`layers\` and no layer segment in the path. Declare \`layers\` on those modules and run it again.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2024-10-09',
        votes: 9,
        body: `Two practical notes since it edits your working tree in place.

It appends to an existing tag line when there is one directly above the scenario, and inserts a new line at the scenario's indentation when there is not. That is fine but it is a real edit — commit or stash before running it so the diff is reviewable.

For the suite backlog, do it per module rather than per file. Decide "everything in \`features/checkout/\` is regression except these three", add the tag, re-lint. Ninety scenarios is two afternoons, and the alternative is a suite nobody trusts.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-data-users-is-not-a-declared-dataset',
    title: '@data:users errors with "is not a declared dataset (logins, posts)" after a rename',
    askedBy: 'tobi-schrader',
    askedOn: '2024-12-04',
    tags: ['lint', 'data', 'data-driven'],
    votes: 12,
    views: 4610,
    body: `We renamed the dataset from \`users\` to \`logins\` in the yaml and updated the steps. Lint now fails on the tags we forgot:

\`\`\`text
✖ features/auth/data-driven-login.feature:6  tags/data  @data:users is not a declared dataset (logins, posts).
✖ features/auth/pool.feature:11  tags/data  @data:users is not a declared dataset (logins, posts).
\`\`\`

Easy enough to fix, but it raises a question — the scenario reads the dataset through a step, and the step works. What is \`@data:\` for if it is not what actually loads the data?`,
    answers: [
      {
        id: 'a1',
        by: 'renata-kohl',
        on: '2024-12-04',
        votes: 15,
        body: `It is documentation that is checked. The tag does not load anything — your \`Given I load dataset "logins" ...\` step does that. What the tag buys you is that the dependency is visible before the run: coverage can tell you which scenarios depend on which dataset, and change analysis can tell you which scenarios to re-run when a dataset changes.

Which is exactly what you just used it for. The step and the yaml agreed, so nothing broke; the tags disagreed, and lint told you which two files still carry a stale claim. Without the tag the rename would have been invisible.

Valid values are the keys under \`data.sources\`:

\`\`\`yaml
data:
  sources:
    logins: { type: csv, path: 'data/{env}/logins.csv', fallback: data/common/logins.csv }
    posts: { type: yaml, path: 'data/{env}/posts.yaml' }
\`\`\`

so \`@data:logins\` and \`@data:posts\`, and nothing else.`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2024-12-06',
        votes: 7,
        body: `Worth pairing the tag with \`@data-driven\` while you are editing those files. \`@data:logins\` says which dataset; \`@data-driven\` says the scenario's shape is one behaviour times N rows. They answer different questions and reports use both.

And do not put \`@data:\` on a scenario that merely happens to log in with a pool user — that relationship is \`@user:<role>\` and \`@pool\`. Overusing \`@data:\` makes the change-impact answer useless because everything depends on everything.`,
      },
    ],
  },

  {
    slug: 'lint-skip-safari-must-name-a-browser',
    title: '@skip:safari rejected — how do I skip a scenario on Safari?',
    askedBy: 'sergio-alcaraz',
    askedOn: '2025-02-11',
    tags: ['lint', 'ui'],
    votes: 14,
    views: 5080,
    body: `\`\`\`text
✖ features/checkout/apple-pay.feature:19  tags/skip  @skip:safari must name a browser (chromium, firefox, webkit, mobile-chrome, mobile-safari).
\`\`\`

The scenario genuinely cannot pass on Safari. The error lists five names and none of them is safari. What am I meant to write?`,
    answers: [
      {
        id: 'a1',
        by: 'bea-lindqvist',
        on: '2025-02-11',
        votes: 19,
        body: `\`@skip:webkit\`. Safari is the browser; WebKit is the engine underneath it, and that is what actually gets driven. There is no separate Safari target, so the engine name is the only honest thing to write.

\`\`\`gherkin
@ui @regression @skip:webkit
Scenario: Apple Pay is offered at checkout
\`\`\`

If it is really the mobile Safari viewport you cannot support, \`@skip:mobile-safari\` is a distinct target and skipping one does not skip the other.

Two things not to do instead. Do not use bare \`@skip\` — that removes the scenario from every browser, and lint passes it through without comment because it is a runner control tag. And do not branch on the browser inside a step; the point of the tag is that the exclusion shows up in the report as a skip against a named engine, so the gap is visible rather than hidden in code.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-run-lints-first-and-no-lint-skips-it',
    title: 'sdods run refuses to start with LINT_FAILED — can I run anyway while I fix the tags?',
    askedBy: 'tanvi-bhatt',
    askedOn: '2025-04-02',
    tags: ['lint', 'cli', 'ci'],
    votes: 27,
    views: 9140,
    body: `Mid-refactor, half my tags are wrong, and I want to run the six scenarios that are fine to check a page object change. Instead:

\`\`\`bash
sdods run -p shop -e staging -l ui -t @smoke
\`\`\`

\`\`\`text
✖ features/checkout/checkout.feature:22  tags/suite  Scenario must carry exactly one suite tag (@smoke, @regression, @sanity); found none.
✖ features/checkout/checkout.feature:38  tags/layer  Scenario must carry exactly one layer tag (@ui, @api, @hybrid); found none.
2 feature file(s), 2 error(s), 0 warning(s)
✖ LINT_FAILED: 2 lint error(s) in project shop. Fix them or pass --no-lint.
\`\`\`

Nothing ran. The broken scenarios are not even in \`@smoke\`. Why does it lint files I am not running?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2025-04-02',
        votes: 24,
        body: `Because the specs are generated from the whole project before anything is selected, and a scenario with no layer tag has no run target to be generated into. Selecting a subset happens after that, so it cannot rescue a file that failed to compile into anything.

The escape hatch is in the message:

\`\`\`bash
sdods run -p shop -e staging -l ui -t @smoke --no-lint
\`\`\`

That is the right tool for exactly your situation and the wrong tool in a pipeline. A run started with \`--no-lint\` will happily not run scenarios whose tags are broken, which is the silent-zero failure mode all over again.

Note the exit code is 3, not 1, when the run stops this way — same code as \`sdods lint\` itself. A pipeline that distinguishes them can say "your features are wrong" instead of "your tests failed".`,
      },
      {
        id: 'a2',
        by: 'anouk-devries',
        on: '2025-04-03',
        votes: 10,
        body: `While you are mid-refactor, lint the one file you are editing rather than the project:

\`\`\`bash
sdods lint -p shop --file projects/shop/features/checkout/checkout.feature
\`\`\`

\`--file\` is repeatable, and bare paths work as positional arguments too. Much shorter feedback loop than the full project, and when it comes back clean you know \`sdods run\` will get past the gate.

![sdods lint -p rwa-bank reporting 15 feature files linted with no findings](/questions/lint.png "What you are aiming for before running")`,
      },
      {
        id: 'a3',
        by: 'lena-hartwig',
        on: '2025-04-09',
        votes: 8,
        body: `One asymmetry that confused us for a while: \`sdods run\` only prints lint warnings when you pass \`--verbose\`. Errors always print because they stop the run; warnings are held back so a normal run is not buried in output about files you are not touching.

So a project can accumulate warnings for months without anyone running \`sdods lint\` seeing them. Run the linter on its own periodically, or with \`--strict\` in a nightly job, otherwise "the run was clean" and "the features are clean" quietly stop meaning the same thing.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-examples-block-tags-count-as-scenario-tags',
    title:
      'Two Examples blocks, one @smoke and one @regression — lint says found @smoke @regression',
    askedBy: 'koen-vermeulen',
    askedOn: '2025-06-18',
    tags: ['lint', 'data-driven', 'regression'],
    votes: 23,
    views: 7480,
    body: `I wanted one outline with a small set of rows in smoke and the long tail in regression:

\`\`\`gherkin
@ui
Scenario Outline: Shipping is calculated per country
  Given I am on the checkout page
  When I choose the country "<country>"
  Then the shipping cost should be "<cost>"

  # title-format: <country> → <cost>
  @smoke
  Examples: The two we always check
    | country | cost  |
    | DE      | 4.90  |
    | FR      | 6.50  |

  # title-format: <country> → <cost>
  @regression
  Examples: Everything else
    | country | cost  |
    | ES      | 6.50  |
    | PL      | 7.20  |
\`\`\`

\`\`\`text
✖ features/checkout/shipping.feature:4  tags/suite  Scenario must carry exactly one suite tag (@smoke, @regression, @sanity); found @smoke @regression.
\`\`\`

Both tables are tagged once. Is this rule just not aware of Examples-level tags?`,
    answers: [
      {
        id: 'a1',
        by: 'bea-lindqvist',
        on: '2025-06-18',
        votes: 21,
        body: `It is aware of them — that is the problem. Lint builds one tag set per Scenario Outline: the Feature tags, plus the outline's own tags, plus the tags of every \`Examples:\` block flattened together. So your outline has \`@ui @smoke @regression\` and two suite tags is an error, even though no individual row would ever carry both.

The rule is checked per outline, not per generated example, so there is no way to express "this table is smoke and that one is regression" on a single outline and have it lint.

Split it:

\`\`\`gherkin
@ui @smoke
Scenario Outline: Shipping is calculated for the countries we always check
  Given I am on the checkout page
  When I choose the country "<country>"
  Then the shipping cost should be "<cost>"

  # title-format: <country> → <cost>
  Examples:
    | country | cost |
    | DE      | 4.90 |
    | FR      | 6.50 |

@ui @regression
Scenario Outline: Shipping is calculated for the remaining countries
  Given I am on the checkout page
  When I choose the country "<country>"
  Then the shipping cost should be "<cost>"

  # title-format: <country> → <cost>
  Examples:
    | country | cost |
    | ES      | 6.50 |
    | PL      | 7.20 |
\`\`\`

Note the two outlines need different titles or you trade the suite error for \`scenario/duplicate\`.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2025-06-20',
        votes: 12,
        body: `The flattening is deliberate and it is what makes the useful case work: a tag on one \`Examples:\` block that is not a suite tag — \`@skip:webkit\`, \`@mock\`, \`@jira:SHOP-42\` — is still seen and still validated. Ignoring Examples tags entirely would mean a misspelled \`@user:\` on a table went unchecked.

The cost is your case, where the same merge makes a legal per-table distinction look illegal. Two outlines with a shared Background is the shape we use; the duplication is four lines and it makes the smoke budget visible in the file rather than hidden in a table.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-can-a-scenario-belong-to-two-modules',
    title: 'Can one scenario belong to two modules? It touches cart and checkout',
    askedBy: 'rasha-halabi',
    askedOn: '2025-09-01',
    tags: ['lint', 'config'],
    votes: 20,
    views: 6890,
    body: `Our modules each declare a tag, and lint reminds me when a scenario is missing its module's tag:

\`\`\`text
⚠ features/cart/checkout-flow.feature:14  module/tags  Scenario lacks module "cart" tag(s): @cart.
\`\`\`

Fine. But the scenario adds an item to the cart and then completes checkout, and checkout is a different module. If I add \`@checkout\` as well, is it in two modules, or does the file's directory win regardless of what I tag it?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2025-09-01',
        votes: 22,
        body: `The directory wins, always. Module membership is derived from where the feature file sits, not from tags — a file belongs to exactly one module, and if module directories are nested the deepest match is the one that owns it. Tags never move a file between modules.

So \`features/cart/checkout-flow.feature\` is in \`cart\`, full stop. Adding \`@checkout\` does not make it a checkout scenario; it adds a tag you can filter on.

That is not useless — it is often exactly what you want for a flow that crosses a boundary. But be clear about what you are buying: \`-t @checkout\` will find it, and module coverage will still count it under cart.

![sdods features list showing each feature file with the module it belongs to and its scenario count](/questions/features-list.png "Module assignment comes from the directory, not the tags")

If the crossing bothers you, the usual answer is that the scenario belongs to whichever module owns the outcome it asserts. Checkout completing is a checkout outcome; the cart steps are setup, and setup is better done through the API anyway.`,
      },
      {
        id: 'a2',
        by: 'renata-kohl',
        on: '2025-09-02',
        votes: 9,
        body: `One thing that surprises people the first time: a tag that belongs to any module's \`tags\` list counts as declared everywhere. So \`@checkout\` on a file under \`features/cart/\` will not warn as an unknown tag — it is a real tag, just not this module's. You only get the \`module/tags\` warning about the one that is missing.

Which means a file in the wrong directory can look almost clean. If a scenario carries \`@checkout\` and nothing else module-shaped, and lint is telling you it lacks \`@cart\`, that is worth reading as "this file may be in the wrong folder" rather than "add another tag".`,
      },
      {
        id: 'a3',
        by: 'bea-lindqvist',
        on: '2025-09-05',
        votes: 6,
        body: `And \`--fix-tags\` will resolve that warning for you by adding \`@cart\`, which is fine when the file is where it should be and unhelpful when it is not. Read the warnings before you fix them in bulk; this one is sometimes telling you something about your directory layout rather than about your tags.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-har-tag-warns-before-the-file-is-recorded',
    title:
      '@har:checkout warns that no recorded file exists — is there a way to declare it up front?',
    askedBy: 'devon-marsh',
    askedOn: '2025-11-24',
    tags: ['lint', 'har', 'mock'],
    votes: 3,
    views: 214,
    body: `Writing the scenario before recording the traffic, which I thought was the intended order:

\`\`\`text
⚠ features/checkout/payment.feature:9  tags/har  @har:checkout has no recorded file under har/<env>/checkout.har (or checkout.api.har) yet.
\`\`\`

It is only a warning and I understand why — the file genuinely is not there yet. But we run \`sdods lint --strict\` in the pipeline, so the warning is an error there, and the branch cannot merge until somebody records against staging.

Is there something that says "recorded on purpose later", or do we just carve an exception into the pipeline for files under \`features/checkout/\`? Recording first would mean writing the scenario twice.`,
    answers: [],
  },

  {
    slug: 'lint-undefined-steps-flag-and-what-it-costs',
    title:
      'Lint passes but the run fails on a missing step — why is undefined-step checking opt-in?',
    askedBy: 'ingrid-solberg',
    askedOn: '2026-03-10',
    tags: ['lint', 'cli', 'api'],
    votes: 21,
    views: 5730,
    body: `Clean lint, then the run dies immediately on a step nobody wrote. Turning the flag on finds it:

\`\`\`bash
sdods lint -p shop --undefined-steps
\`\`\`

\`\`\`text
✖ features/checkout/payment.feature:14  steps/undefined  Undefined step: Given I am on the checkout page
1 feature file(s), 1 error(s), 0 warning(s)
\`\`\`

If it can find it, why is it not on by default? Feels like the most valuable check of the lot.`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-03-10',
        votes: 20,
        body: `Cost. Every other rule is a parse of the feature files and some string comparison against your project yaml — milliseconds, no build. Finding undefined steps means actually generating the specs and letting the generator report what it could not bind, which is the slow part of a run happening before the run.

On a small project the difference is not worth arguing about. On a large one it turns lint from something you can put in a file-save hook into something you wait for, and a check people stop running is worth less than a slower check that runs.

The compromise most teams land on: bare \`sdods lint\` in the editor loop and the pre-commit hook, \`--undefined-steps\` in CI where the wait is somebody else's.`,
      },
      {
        id: 'a2',
        by: 'anouk-devries',
        on: '2026-03-11',
        votes: 11,
        body: `Also worth saying it is not the only safety net — a run generates specs too, so an undefined step always fails, just later and with a worse message. The flag buys you the failure at lint time with a file and a line number instead of mid-run.

Before you add a new step, check whether the phrasing already exists:

\`\`\`bash
sdods steps list -p shop --grep "checkout page"
\`\`\`

Most undefined steps we hit turned out to be a near-miss of a step already in the catalogue — "I am on the checkout page" against "I navigate to the checkout page". Reusing the existing phrasing is better than writing a second step that does the same thing.`,
      },
      {
        id: 'a3',
        by: 'bea-lindqvist',
        on: '2026-03-16',
        votes: 7,
        body: `Worth knowing the opposite direction is a separate command rather than a lint rule. Steps nobody calls do not stop anything, so they are not part of this:

\`\`\`bash
sdods steps list -p shop --unused
\`\`\`

Different risks, which is why they are split. A feature referring to a step that does not exist cannot run at all; a step definition nobody calls is dead code you clean up when you feel like it.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-strict-means-different-things-on-lint-and-run',
    title: '--strict on sdods run did not turn warnings into failures like it does on sdods lint',
    askedBy: 'paulo-mendes',
    askedOn: '2026-04-29',
    tags: ['lint', 'ci', 'cli'],
    votes: 16,
    views: 4260,
    body: `We wanted the nightly to fail on lint warnings, so somebody moved the flag onto the run:

\`\`\`bash
sdods run -p shop -e staging -l ui -t @regression --strict
\`\`\`

It ran, it passed, and the eleven warnings we were trying to catch are still there. On \`sdods lint --strict\` the same eleven give exit 3. Same flag name, different behaviour?`,
    answers: [
      {
        id: 'a1',
        by: 'bea-lindqvist',
        on: '2026-04-29',
        votes: 18,
        body: `Same name, different command, genuinely different meaning.

On \`sdods lint\`, \`--strict\` means treat warnings as errors — the exit becomes 3 when there are warnings and no errors.

On \`sdods run\`, \`--strict\` is the HAR modifier. It pairs with \`--har-replay\` and means abort on any request that is not in the recorded file, so the run is properly offline instead of quietly falling through to the network. Nothing to do with lint at all, which is why yours did nothing: without \`--har-replay\` there was nothing for it to modify.

What you want is the two as separate steps:

\`\`\`bash
sdods lint -p shop --strict
\`\`\`

\`\`\`bash
sdods run -p shop -e staging -l ui -t @regression
\`\`\`

Which is better anyway — a lint failure and a test failure are different problems, and as separate steps the pipeline tells you which one you have without reading the log.`,
      },
      {
        id: 'a2',
        by: 'priya-venkatesh',
        on: '2026-05-04',
        votes: 9,
        body: `Before you turn \`--strict\` on for a project with eleven existing warnings, look at what they are. A couple of the warning rules describe legitimate intermediate states — \`@har:\` naming a file not yet recorded is the usual one, and an outline missing its \`# title-format:\` comment is cosmetic. Making those hard failures on day one tends to produce an exemption list, and an exemption list is how a strict gate becomes decorative.

Clear them first, then turn it on, then it stays at zero.`,
      },
    ],
  },

  {
    slug: 'lint-comma-shorthand-in-tag-expressions-is-or',
    title: 'Does -t smoke,sanity mean both tags or either tag?',
    askedBy: 'zeynep-arslan',
    askedOn: '2026-07-09',
    tags: ['cli', 'smoke', 'sanity'],
    votes: 9,
    views: 2180,
    body: `Reading a colleague's script:

\`\`\`bash
sdods run -p shop -e staging -l ui -t smoke,sanity
\`\`\`

No at-signs, a comma, no quotes. It runs more scenarios than \`-t @smoke\` alone, so I assume it is an or — but I want to be sure it is not something odd like "smoke,sanity" being treated as one tag name that happens to match nothing. And is dropping the \`@\` supported or just tolerated?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-07-09',
        votes: 14,
        body: `It is an or, and the missing at-signs are supported.

The shorthand is applied only when the string contains no expression syntax. If there is no \`and\`, \`or\`, \`not\` or parenthesis anywhere in it, the value is split on commas and whitespace, each part gets an \`@\` if it does not have one, and the parts are joined with \`or\`. So \`smoke,sanity\` becomes \`@smoke or @sanity\`, and so does \`"@smoke @sanity"\`.

Anything containing expression syntax is passed through untouched — \`"@regression and not @mock"\` is your expression exactly, no rewriting. Which is also the trap: \`-t "smoke,regression"\` is an or, but the moment you write a real expression you are on your own for the at-signs, because nothing is added there.

The layer is then wrapped around whichever you ended up with, giving \`(@ui) and (@smoke or @sanity)\`.

Then confirm rather than assume, with \`--list\`. A tag expression that matches nothing is a warning and a green run, so "it ran more scenarios" is better evidence than most, but it is not proof.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'lint-json-output-for-a-pre-commit-hook-on-staged-files',
    title: 'Linting only the staged feature files in a pre-commit hook — is --json stable enough?',
    askedBy: 'ingrid-solberg',
    askedOn: '2026-08-25',
    tags: ['lint', 'cli', 'ci'],
    votes: 2,
    views: 96,
    body: `Trying to keep the hook under a second on a repo with about four hundred feature files, so linting the whole project every commit is out. This is what I have:

\`\`\`bash
sdods lint -p shop --json --file projects/shop/features/cart/cart.feature
\`\`\`

\`\`\`json
{
  "ok": false,
  "errors": [
    {
      "severity": "error",
      "rule": "tags/suite",
      "message": "Scenario must carry exactly one suite tag (@smoke, @regression, @sanity); found none.",
      "file": "features/cart/cart.feature",
      "line": 12,
      "project": "shop"
    }
  ],
  "warnings": [],
  "filesChecked": 1
}
\`\`\`

Two things I cannot find an answer to. Is \`rule\` a stable identifier I can filter on — we want to allow \`outline/title-format\` through in the hook and block everything else — or is it an implementation detail that might get renamed? And is \`file\` always relative to the project root even though I passed an absolute path, because that is what it looks like here and my hook has to map it back to the repo path to annotate the diff.

Happy to be told the hook is the wrong shape and I should just run the whole project.`,
    answers: [],
  },
];
