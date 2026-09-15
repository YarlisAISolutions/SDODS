import type { Thread } from '../types';

/**
 * Test data, datasets, factories, user pools and cleanup.
 *
 * The pool threads carry the load here: leasing is per worker, not per scenario, and almost every
 * question in this family is a consequence of that one fact meeting an account estate that was
 * sized for a person rather than for eight of them.
 */
export const dataThreads: Thread[] = [
  {
    slug: 'data-dataset-not-declared-known-datasets',
    title: 'DATASET_NOT_FOUND says my dataset is not declared, but the CSV is right there',
    askedBy: 'dperera',
    askedOn: '2020-11-12',
    tags: ['data', 'config', 'cli'],
    votes: 21,
    views: 9140,
    body: `Trying to drive the login scenarios from a CSV instead of an Examples table. The file is at \`projects/demo-shop/data/common/users.csv\` and previewing it works:

\`\`\`bash
sdods data preview projects/demo-shop/data/common/users.csv
\`\`\`

Six rows, columns id, username, password, role, displayName. Exactly what I want.

The scenario dies on the first step though:

\`\`\`text
✖ DATASET_NOT_FOUND: Dataset "users" is not declared for project demo-shop.
  hint: Known datasets: logins, posts. Add it under data.sources in sdods.project.yaml.
\`\`\`

The step is:

\`\`\`gherkin
Given I load dataset "users" row 0
\`\`\`

If the file is on disk and the CLI can read it, why does the runner care what the yaml says?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2020-11-12',
        votes: 19,
        body: `The name in the step is a key in \`data.sources\`, not a file name. The provider looks \`users\` up in the resolved project config and never goes near the filesystem until it has a source spec, so a file with the right name in the right place is invisible to it.

The hint is telling you what somebody already declared. You have \`logins\` and \`posts\`, so either the CSV was declared under the name \`logins\`, or nothing points at it at all.

\`\`\`yaml
data:
  sources:
    users: { type: csv, path: 'data/{env}/users.csv', fallback: data/common/users.csv }
\`\`\`

\`sdods data preview\` takes a path, not a dataset name, which is why it works without any of this — it is a file viewer, not the loader.

[Test data and user pools](https://docs.sdods.com/docs/guides/test-data-and-user-pools/)`,
      },
      {
        id: 'a2',
        by: 'mkuiper',
        on: '2020-11-15',
        votes: 6,
        body: `Adding to that: after you edit the yaml, check what actually resolved rather than what you typed.

\`\`\`bash
sdods config show -p demo-shop -e staging
\`\`\`

The merged project tree comes out with the \`data.sources\` block in it. I have twice edited a yaml in one project directory and run the suite in another.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-no-data-file-for-env-tried-candidates',
    title: 'No data file for "data/{env}/users.csv" in env "staging" when the common file exists',
    askedBy: 'annika-solheim',
    askedOn: '2021-03-22',
    tags: ['data', 'config'],
    votes: 16,
    views: 7380,
    body: `\`\`\`bash
sdods run -p shop -e staging -l ui -t @data-driven
\`\`\`

\`\`\`text
✖ DATASET_NOT_FOUND: No data file for "data/{env}/users.csv" in env "staging".
  hint: Tried: /work/shop/projects/shop/data/staging/users.csv, /work/shop/projects/shop/data/common/users.csv
\`\`\`

Declared like this:

\`\`\`yaml
data:
  sources:
    users: { type: csv, path: 'data/{env}/users.csv' }
\`\`\`

There is no \`data/staging/\` directory, which is fine, that was the plan — every environment was supposed to fall back to the common file. And there is a common file. It is called \`data/common/logins.csv\`.

I read the resolution order as "try the env path, then fall back to common", so I expected it to find it.`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2021-03-23',
        votes: 15,
        body: `Four candidates get tried, in this order:

1. \`path\` with \`{env}\` substituted
2. \`data/<env>/<basename>\`
3. \`fallback\`
4. \`data/common/<basename>\`

The basename is taken from the resolved \`path\`, so for \`data/{env}/users.csv\` it is \`users.csv\` in every one of them. Candidate 4 is \`data/common/users.csv\`, which does not exist. \`logins.csv\` is never a candidate — nothing in the config mentions that name.

Two candidates in the hint rather than four because it de-duplicates, and with no \`fallback\` set the list collapses.

Say it explicitly:

\`\`\`yaml
data:
  sources:
    users: { type: csv, path: 'data/{env}/users.csv', fallback: data/common/logins.csv }
\`\`\`

The hint prints absolute paths in the order tried, so it is worth reading top to bottom before changing anything — it usually tells you which of the four you meant.`,
      },
      {
        id: 'a2',
        by: 'rgarrido',
        on: '2021-03-30',
        votes: 4,
        body: `Or rename the file to \`users.csv\` and delete the \`fallback\` line. Candidate 4 then picks it up for every environment and there is one less thing in the yaml. We keep the rule "the file is named after the dataset" for exactly this reason.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-scenario-outline-or-dataset-for-twenty-rows',
    title:
      'Scenario Outline with 20 Examples rows, or a CSV dataset? What do reviewers expect here',
    askedBy: 'j-okonkwo',
    askedOn: '2021-06-09',
    tags: ['data', 'data-driven'],
    votes: 27,
    views: 11260,
    body: `We have a shipping tax table: twenty countries, each with a rate and an expected label on the confirmation page. I wrote it as a Scenario Outline and the feature file is now a wall of pipes — the twenty rows are longer than the rest of the file put together, and two of the rates are different on staging than they are on production.

I could move it into a CSV. But then the feature file no longer says what the expected behaviour is, and the whole point of Gherkin was that a person can read it.

Where do people draw the line? Is there a row count where an Outline stops being the right thing?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2021-06-10',
        votes: 22,
        body: `It is not a row count, it is whether the table is documentation or input.

An Outline earns its place when the rows are the requirement — a handful of variants a reader needs to see to understand the behaviour. A dataset earns its place when the rows are many, or when they differ per environment. Yours does both: twenty rows nobody reads line by line, and two values that change with the environment. That settles it.

\`\`\`gherkin
Given I load dataset "shipping" where "country" is "DE"
When I check out with "{{firstName}}" "{{lastName}}" "{{postalCode}}"
Then I should see the text "{{expectedTax}}"
\`\`\`

Then keep a small Outline for the two or three cases that document the behaviour — zero-rated, standard, and whatever the interesting edge is — and let the dataset carry the other seventeen as coverage.

The environment half is the part that does not survive an Outline at all. \`data/common/shipping.csv\` is the baseline and \`data/staging/shipping.csv\` overrides it, and the feature file does not have to know.

[Data-driven design](https://docs.sdods.com/docs/best-practices/data-driven-design/)`,
      },
      {
        id: 'a2',
        by: 'hsu-wei-lin',
        on: '2021-06-16',
        votes: 8,
        body: `One thing to know before you move: an Outline reports each row as its own scenario, so a failure names the row. A dataset-driven scenario is one scenario, and a failure names the scenario.

That is a real loss, and the mitigation is to give the dataset a stable identifier column and put it somewhere the failure will show it — in the step arguments, or in the assertion text. If the only thing your report says is "checkout applies the right tax" and it failed, you are opening a trace to find out which country.

Outlines have a \`# title-format:\` comment for the same reason, so the generated scenario titles are readable.`,
      },
      {
        id: 'a3',
        by: 'lena-hartwig',
        on: '2021-09-24',
        votes: 6,
        body: `Also tag it \`@data:shipping\`. It does not do anything at run time, but lint checks the dataset exists, and when somebody edits the CSV you can run everything that depends on it:

\`\`\`bash
sdods run -p shop -e staging -t "@data:shipping"
\`\`\``,
      },
    ],
  },
  {
    slug: 'data-user-pool-no-users-with-role-admin',
    title: 'USER_POOL_EXHAUSTED: No users with role "admin" in dataset "users" (env staging)',
    askedBy: 'elsa-nyman',
    askedOn: '2021-10-21',
    tags: ['pool', 'data', 'config'],
    votes: 23,
    views: 10410,
    body: `Tagged a scenario \`@user:admin\` and the run fails before a browser even opens:

\`\`\`text
✖ USER_POOL_EXHAUSTED: No users with role "admin" in dataset "users" (env staging).
  hint: Roles present: standard, locked_out.
\`\`\`

There is definitely an admin in the CSV, I am looking at it. Roles in the file are standard, locked_out and admin. Where does "Roles present: standard, locked_out" come from? Those are two of my three.`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2021-10-21',
        votes: 20,
        body: `The hint lists the roles in the rows that were actually loaded, so it is telling you the file you are looking at is not the file that was read.

\`data/<env>/<name>.csv\` wins over \`data/common/<name>.csv\`, and they do not merge — the environment file replaces the common one wholesale. You almost certainly have a \`data/staging/users.csv\` with two rows in it, and the admin lives only in \`data/common/users.csv\`.

Add the admin row to the staging file, or delete the staging file if it was not doing anything the common one does not.

Two related things while you are in there:

- \`admin\` has to be listed under \`tags.roles\` in the project yaml or lint rejects the tag before the run starts.
- \`@user:<role>\` leases before the browser context is created, which is why this fails ahead of the first step rather than inside it. That is deliberate: the scenario starts already logged in.`,
      },
      {
        id: 'a2',
        by: 'kmoreau',
        on: '2021-10-26',
        votes: 5,
        body: `The quickest way to see which file won is to preview both and compare:

\`\`\`bash
sdods data preview projects/demo-shop/data/staging/users.csv
\`\`\`

We got bitten by the same thing after somebody added a staging file to pin two accounts and quietly dropped the other four.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-row-index-is-zero-based-not-a-spreadsheet-row',
    title: 'Dataset "users" has 3 row(s); row 5 does not exist (0-based) — is the header counted?',
    askedBy: 'gcastellano',
    askedOn: '2022-02-15',
    tags: ['data', 'data-driven'],
    votes: 14,
    views: 6820,
    body: `I wrote \`Given I load dataset "users" row 5\` because the account I want is on line 5 of the spreadsheet. Got:

\`\`\`text
DATASET_ROW_NOT_FOUND: Dataset "users" has 3 row(s); row 5 does not exist (0-based).
\`\`\`

Three rows? The file has four lines. And when I tried \`row 1\` earlier it gave me the second person, not the first. So either the header counts or it does not, and I cannot work out which from the message.`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2022-02-15',
        votes: 17,
        body: `The header is not a row. The CSV is parsed with columns taken from the first line, so a four-line file has three rows, and the message is counting those.

Indexes are 0-based, so with three rows the valid ones are 0, 1 and 2. \`row 1\` giving you the second person is correct and not an off-by-one — it is the second data row.

Positional lookup is fragile anyway, because it silently changes meaning the moment somebody sorts the file. Name the row instead:

\`\`\`gherkin
Given I load dataset "users" where "username" is "problem_user"
\`\`\`

That fails with \`No row in dataset "users" where username = "problem_user".\` when the row is gone, which is a failure you can read, rather than quietly handing you a different account.`,
      },
      {
        id: 'a2',
        by: 'sam-orbison',
        on: '2022-02-17',
        votes: 5,
        body: `We banned \`row <n>\` in review after somebody alphabetised a CSV and three scenarios kept passing against the wrong accounts. \`where\` costs nothing and the step reads better out loud.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-one-account-per-worker-or-the-lease-times-out',
    title: 'All 4 user(s) with role "standard" are leased — passes locally, four failures in CI',
    askedBy: 'owen-brackley',
    askedOn: '2022-06-30',
    tags: ['pool', 'data', 'ci'],
    votes: 44,
    views: 15920,
    body: `Suite is green on my machine and fails in CI, and the difference is the worker count. Local:

\`\`\`bash
sdods run -p demo-shop -e staging -l ui -t @regression -w 4
\`\`\`

CI runs the same thing with \`-w 8\`. Four scenarios pass, four sit there for what looks like half a minute and then fail with:

\`\`\`text
USER_POOL_EXHAUSTED: All 4 user(s) with role "standard" are leased.
\`\`\`

There are four standard accounts in \`data/staging/users.csv\`. I assumed a lease was per scenario, so eight workers would just take turns — a scenario takes six seconds, there is plenty of time. It clearly does not work like that. What is the actual unit?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2022-06-30',
        votes: 36,
        body: `The unit is the worker, not the scenario.

A lease is owned by \`runId:shardOffset+parallelIndex\`. The first scenario on a worker that needs a \`standard\` account takes one; the worker holds it for the rest of its life and releases at teardown. So the number of accounts with a role is a hard cap on how many workers can run that role's scenarios concurrently — four accounts, eight workers, four workers wait and then fail.

That is the right model when scenarios mutate user-scoped state, which is the common case: two workers on one identity see each other's carts, sessions and sign-outs. Sharing accounts turns a passing suite into a flaky one and the failures look like application bugs.

Three ways out, in the order I would try them:

1. Seed more accounts with that role. The account count is a capacity number now — plan it like one.
2. Cap \`-w\` at the number of accounts for your busiest role.
3. Split the role's scenarios into their own run with its own worker count, and let the rest of the suite run wide.

One thing to know before you go to CI with sharding: the owner key includes a shard offset so two shards never generate the same owner string. With \`leaseStore: file\` each machine has its own lease directory anyway, so three shards at four workers each need twelve accounts, not four. \`leaseStore: db\` is in the schema too, but nothing implements it yet, so do the arithmetic per machine.`,
      },
      {
        id: 'a2',
        by: 'mina-farouk',
        on: '2022-07-05',
        votes: 12,
        body: `We hit this the week we turned on parallelism and the fix that stuck was making account count a CI concern rather than a repo concern: a pre-step calls the app's admin API and provisions N accounts per role, where N is the worker count, and the users CSV is generated from the response.

It sounds heavier than it is, about forty lines, and it means nobody ever has to remember to add a row when they raise \`-w\`.`,
      },
      {
        id: 'a3',
        by: 'nadia-belkacem',
        on: '2022-08-04',
        votes: 7,
        body: `Careful with the obvious-looking fix: \`users.poolSize\` in the environment file does not create accounts. It caps how many the run may use. Raising it when the file has four rows changes nothing, and lowering it is a good way to reproduce this on purpose.`,
      },
      {
        id: 'a4',
        by: 'petrov-k',
        on: '2022-09-12',
        votes: 4,
        body: `Something that saved us a lot of confusion — the wait is not instant failure, it is thirty seconds of retrying and then the error. So the symptom in CI is a suite that appears to hang near the end and then reports failures, which reads like a timeout problem rather than a capacity one. If your suite got slower before it got red, check the pool first.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-factory-not-found-known-factories-none',
    title: 'Factory "user" not found, hint says Known factories: (none), but the file exports it',
    askedBy: 'lars-vinter',
    askedOn: '2022-11-29',
    tags: ['data', 'config'],
    votes: 12,
    views: 5610,
    body: `\`\`\`gherkin
Given I generate a "user" from the factory as "newUser"
\`\`\`

\`\`\`text
DATASET_NOT_FOUND: Factory "user" not found.
  hint: Known factories: (none). Define it in data/factories.ts.
\`\`\`

\`projects/shop/data/factories.ts\` exists and exports a \`user\`. The hint even names the file it says I should create.`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2022-11-30',
        votes: 13,
        body: `\`Known factories: (none)\` means the map came back empty, not that the name is wrong. There are two ways to get an empty map and neither of them is a missing file:

1. \`data.factories\` is not set in \`sdods.project.yaml\`. With no path configured the loader returns an empty map without looking at anything, and the fallback text in the hint is a suggestion, not the path it tried.
2. The path is set, the file is there, but it does not default-export the map. A named \`export const user = ...\` is not found — the loader takes \`default\` or a named \`factories\` export.

\`\`\`yaml
data:
  factories: ./data/factories.ts
\`\`\`

\`\`\`ts
import { defineFactories } from '@sdods/core/data';

export default defineFactories({
  user: (f) => ({ email: f.internet.email(), firstName: f.person.firstName() }),
});
\`\`\`

Once it loads, the hint becomes useful: it lists the names it does know, which is usually enough to spot a typo.`,
      },
      {
        id: 'a2',
        by: 'petrov-k',
        on: '2022-12-07',
        votes: 4,
        body: `And the path resolves against the project root, not the repo root, so \`./data/factories.ts\` means \`projects/<slug>/data/factories.ts\`. We had it pointing one directory too high for a month and never noticed because the empty map is not an error.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-keep-real-passwords-out-of-a-committed-users-csv',
    title: 'How do people keep real passwords out of a users.csv that has to be committed?',
    askedBy: 'ify-adeyemi',
    askedOn: '2023-03-02',
    tags: ['data', 'config', 'pool'],
    votes: 31,
    views: 12180,
    body: `Our pool CSV has a plaintext password column and security review flagged it, fairly. Options I can see are all bad:

- gitignore the file, and every new joiner spends an afternoon working out why nothing runs
- one shared password nobody minds leaking, which is a lie we will forget we told
- generate the file in CI, and lose the ability to run anything locally

Is there a fourth thing?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2023-03-02',
        votes: 28,
        body: `There is. Cell values are interpolated the same way configuration is, so a password column can hold a reference instead of a value:

\`\`\`text
id,username,password,role,displayName
1,Heath93,\${RWA_PASSWORD:-s3cret},standard,Ted Parisian
\`\`\`

The file stays committed, reviewable and diffable, and the actual secret comes from \`.env\`, \`.env.<env>\` in the repo root or the project directory, or from the real environment in CI.

The \`:-default\` form is worth using deliberately. For a public sandbox the default is the demo credential and the file works out of the box. For a real environment, leave the default off so an unset variable is loud rather than wrong.

\`sdods data preview\` shows you the file, not the resolved row, so what you see is the placeholder:

![Preview of a users CSV where the password column holds a variable reference rather than a password](/questions/data-preview.png "sdods data preview reads the file, so the placeholder is what is on screen")

The same rule is enforced in the yaml — a key that looks like a secret with a literal value is a \`CONFIG_SECRET_LITERAL\` error, so \`env.vars.standardPassword: hunter2\` will not resolve at all. The data files are the one place you can still do the wrong thing by hand, so review for it.

[Security](https://docs.sdods.com/docs/guides/security/)`,
      },
      {
        id: 'a2',
        by: 'renata-kohl',
        on: '2023-03-21',
        votes: 9,
        body: `What we settled on, if it helps: the committed CSV carries only ids, usernames, roles and display names, and every password cell is the same \`\${QA_ACCOUNT_PASSWORD}\` reference. The accounts are provisioned by a seeding script that sets them all to that one value in the test environment.

It means the CSV tells you nothing an attacker wants and still runs unchanged on any machine that has the variable.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-no-row-in-dataset-where-role-is-admin',
    title: 'No row in dataset "users" where role = "admin" and the value is in the file',
    askedBy: 'yusuf-demir',
    askedOn: '2023-05-24',
    tags: ['data', 'data-driven'],
    votes: 10,
    views: 4870,
    body: `\`\`\`gherkin
Given I load dataset "users" where "role" is "admin"
\`\`\`

\`\`\`text
DATASET_ROW_NOT_FOUND: No row in dataset "users" where role = "admin".
\`\`\`

\`grep -c admin\` on the CSV says 1. The column is spelled \`role\`. I have restarted, cleared \`.sdods\`, and read the line about forty times.`,
    answers: [
      {
        id: 'a1',
        by: 'mina-farouk',
        on: '2023-05-24',
        votes: 11,
        body: `Two things to check, in this order.

The comparison is exact. Both sides get stringified and compared with \`===\` — no case folding, no partial match. If the cell says \`Admin\` and the step says \`admin\`, that is a miss, and \`grep -c admin\` would still find it because grep matched the substring in \`Administrator\` or the case-insensitive habit in your head. Look at the actual cell.

The second thing is which file you grepped. \`data/<env>/users.csv\` replaces \`data/common/users.csv\` for that environment, so the admin can be in the file you searched and absent from the file that was loaded.

\`\`\`bash
sdods data preview projects/shop/data/staging/users.csv
\`\`\`

If the row is there and spelled exactly right, come back with the preview output.`,
      },
      {
        id: 'a2',
        by: 'renata-kohl',
        on: '2023-05-25',
        votes: 4,
        body: `Worth knowing that CSV values are cast — \`42\` arrives as a number, \`true\` as a boolean — but the \`where\` comparison stringifies both sides, so casting almost never causes this. Case does, and trailing punctuation in a hand-edited file does.`,
      },
    ],
  },
  {
    slug: 'data-deleting-the-records-a-scenario-created',
    title: 'What is the accepted way to delete the records a scenario created?',
    askedBy: 'thom-vasseur',
    askedOn: '2023-08-16',
    tags: ['data', 'api'],
    votes: 22,
    views: 8340,
    body: `Our regression suite has left about nine hundred posts behind in the sandbox and the list endpoint is getting slow. Right now the deletes are in an after-hook in our own step file, which works for the happy path and does nothing when the scenario fails halfway — which is exactly when there is a half-created record to clean.

Is there a first-class way to do this, or is a hook the answer and I should write a better one?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2023-08-16',
        votes: 20,
        body: `There is a step for it, and the point of it is that you register the cleanup at the moment the thing exists rather than at the end:

\`\`\`gherkin
When I send a POST request to "/posts" with body:
  """
  { "title": "{{title}}", "userId": 1 }
  """
When I save the response JSON path "id" as "postId"
Given I register cleanup DELETE "/posts/{{postId}}"
\`\`\`

Registered cleanups run last-in-first-out at the end of the scenario, pass or fail, so a scenario that dies three steps later still deletes what it made. LIFO matters when you create a parent and a child — the child's cleanup was registered second and runs first.

A cleanup that fails is attached to the result and never fails the scenario. That is deliberate: a green test turned red by its own teardown teaches people to ignore red.

[Test data and user pools](https://docs.sdods.com/docs/guides/test-data-and-user-pools/)`,
      },
      {
        id: 'a2',
        by: 'chandra-p',
        on: '2023-08-17',
        votes: 7,
        body: `The other half of not leaving nine hundred posts behind is not creating them through the UI in the first place. If the scenario is about the list page, seed the post over the API and drive the browser only for the thing you are actually asserting. It is faster, it fails for one reason instead of two, and the cleanup is one line next to the create.`,
      },
      {
        id: 'a3',
        by: 'helle-borg',
        on: '2023-11-06',
        votes: 5,
        body: `We do both of the above and still run a nightly sweep, because cleanups do not run when a worker is killed. Everything our factories generate carries a recognisable prefix, so the sweep is a filter and a delete rather than a judgement call.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-db-dataset-needs-env-db-in-the-env-file',
    title: 'Dataset table needs env.db in envs/staging.yaml — which database is it asking for?',
    askedBy: 'helle-borg',
    askedOn: '2023-11-08',
    tags: ['data', 'config'],
    votes: 8,
    views: 4090,
    body: `Added a \`db\` dataset for our reference data:

\`\`\`yaml
data:
  sources:
    orders: { type: db, table: td_demo_shop_orders, envColumn: env }
\`\`\`

Works on local, fails on staging:

\`\`\`text
✖ DB_REQUIRED: Dataset table "td_demo_shop_orders" needs env.db in envs/staging.yaml.
\`\`\`

We already have a database configured — \`DATABASE_URL\` is set in CI and \`sdods db status\` is happy. So which database does the dataset want, and why is the environment file involved when the other one is not?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2023-11-09',
        votes: 9,
        body: `They are two different databases and the naming does not help.

\`DB_DRIVER\` / \`DATABASE_URL\` / \`SQLITE_PATH\` configure the platform database — runs, scenarios, steps, heal events, proposals. It is where results go.

\`env.db\` configures the test-data database for that environment: the one holding your \`td_<slug>_<name>\` tables. It lives in the environment file because staging's fixture data is not local's fixture data, and it is legitimate for one environment to have one and another not to.

\`\`\`yaml
db:
  driver: postgres
  url: '\${TEST_DATA_DATABASE_URL}'
\`\`\`

Then load the table for that environment:

\`\`\`bash
sdods data import orders ./seed/orders.csv -p demo-shop -e staging --to table --truncate
\`\`\`

\`--truncate\` replaces the rows scoped to that environment rather than appending, which is what you want on a re-seed. The \`envColumn\` in your source spec is the column that scoping is written to, and it is stripped from the rows the steps see.

[Database](https://docs.sdods.com/docs/guides/database/)`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-does-the-data-tag-load-the-dataset',
    title: 'Does @data:orders load the dataset, or do I still need the Given step?',
    askedBy: 'bea-lindqvist',
    askedOn: '2024-02-20',
    tags: ['data-driven', 'data', 'lint'],
    votes: 15,
    views: 5930,
    body: `Tagged a scenario \`@data:orders\` on the assumption that it would put the columns in scope the way \`@user:standard\` puts an account in scope. The scenario runs, lint is clean, and the assertion fails with the placeholder still in it:

\`\`\`text
Expected to see the text "{{orderId}}"
\`\`\`

So it clearly did not load. Is the tag broken, is it doing something else, or did I invent the behaviour?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2024-02-20',
        votes: 16,
        body: `You invented the behaviour, but it was a reasonable guess because the two tags look symmetrical and are not.

\`@user:<role>\` has a run-time effect: it leases an account before the browser context is created so the scenario starts logged in. \`@data:<dataset>\` is a fact about the scenario, not an instruction — lint validates that the dataset exists in \`data.sources\`, and that is the whole of it. Nothing is loaded.

Load rows explicitly:

\`\`\`gherkin
Given I load dataset "orders" row 0
\`\`\`

The literal \`{{orderId}}\` in your failure is the general tell, by the way. An unresolved placeholder renders as itself rather than as an empty string, precisely so this shows up in the assertion instead of quietly comparing against nothing.

The tag still earns its keep: when the dataset changes, it is how you find everything that depends on it.

\`\`\`bash
sdods run -p shop -e staging -t "@data:orders"
\`\`\`

[Tags and suites](https://docs.sdods.com/docs/guides/tags-and-suites/)`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-forty-seconds-of-ui-signup-before-every-checkout-test',
    title:
      'Every checkout scenario spends 40 seconds registering a user through the sign-up form first',
    askedBy: 'fiona-mcallister',
    askedOn: '2024-05-14',
    tags: ['api', 'data', 'hybrid'],
    votes: 25,
    views: 8810,
    body: `Thirteen checkout scenarios, and each one starts by filling in the six-field registration form, confirming an email, and setting a password. That is about forty seconds before the scenario reaches the thing it is testing, and when registration breaks, thirteen checkout tests go red and the actual registration test is lost in the noise.

I know this is wrong. What I do not know is what the right shape looks like when the setup genuinely has to happen.`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2024-05-14',
        votes: 23,
        body: `The registration form is one scenario's subject and thirteen scenarios' setup, and those are different jobs. Do the setup through the API and keep the browser for the part under test:

\`\`\`gherkin
@hybrid @regression
Scenario: A registered member can check out
  Given I generate a "user" from the factory as "newUser"
  When I send a POST request to "/members" with body:
    """
    { "email": "{{newUser.email}}", "name": "{{newUser.firstName}}" }
    """
  Then the response status should be 201
  When I save the response JSON path "id" as "memberId"
  Given I register cleanup DELETE "/members/{{memberId}}"
  When I navigate to the "checkout" page
\`\`\`

Three things you get: forty seconds back, a failure that means one thing, and a cleanup registered next to the create rather than in a hook that never runs.

When registration then breaks, exactly one scenario goes red, and it is the one named after registration.`,
      },
      {
        id: 'a2',
        by: 'bruno-teixeira',
        on: '2024-08-06',
        votes: 10,
        body: `Worth knowing how the factory behaves before you build on it: faker is seeded from the scenario fingerprint, so a retry of the same scenario regenerates the same values. That is what you want for a retry — the second attempt hits the same data as the first, so a flake is a flake and not a different test.

The corollary is that two different scenarios have different fingerprints and get different values, so it is not a source of collisions. But it does mean the "unique" email in your scenario is stable across runs of that scenario, which matters if the app rejects a duplicate. Add the run id or use the cleanup, do not assume the value is fresh every time.`,
      },
      {
        id: 'a3',
        by: 'anouk-devries',
        on: '2024-09-25',
        votes: 6,
        body: `And where the app has no create API at all — ours does not, registration is a UI-only flow behind a captcha — the answer is not to script the UI faster, it is to stop creating accounts per scenario. Pre-provision a handful, put them in the pool, and let the pool hand them out. The scenarios then test checkout with an account, which is what they were about.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-stale-lease-files-after-a-cancelled-run',
    title: 'Cancelled a run with ctrl-c and now every pool account looks leased',
    askedBy: 'bruno-teixeira',
    askedOn: '2024-08-21',
    tags: ['pool', 'data', 'ci'],
    votes: 19,
    views: 7240,
    body: `Killed a run halfway through. The next run fails immediately-ish with:

\`\`\`text
USER_POOL_EXHAUSTED: All 4 user(s) with role "standard" are leased.
\`\`\`

Nothing is running. \`.sdods/leases/demo-shop/staging/\` has four \`.lock\` files in it, each with an owner and a timestamp from the run I killed.

Am I supposed to delete these by hand? It feels like the kind of thing that should not need a human, but I also do not want to delete a lock some other person's run is holding.`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2024-08-21',
        votes: 18,
        body: `You can delete them and it is safe when nothing is running, but you do not have to — the wait it out path works.

Each lock holds the owner and the time it was taken. When a worker wants an account and finds the lock held by somebody else, it compares the age against \`data.userPool.leaseTtlMs\` and, if the lease is older than that, treats it as abandoned, removes it, and takes the account. Default is ten minutes, so a cancelled run costs you at most ten minutes of confusion.

Deleting the directory is the fast path and what I do locally.

> [!WARNING]
> Do not lower \`leaseTtlMs\` to make recovery quicker. The TTL is also the answer to "how long may a live worker legitimately hold this", so a TTL shorter than your longest scenario lets a second worker steal an account out from under a running test — and that failure looks like an application bug, not a configuration one.`,
      },
      {
        id: 'a2',
        by: 'mina-farouk',
        on: '2024-08-22',
        votes: 7,
        body: `For CI it is a non-problem: ephemeral runners start with an empty workspace, so there are no locks to inherit. We still clear the directory in the pre-step for the self-hosted pool, one line, and it has never cost us anything.

This is really a local-machine problem, and only with \`leaseStore: file\`.`,
      },
      {
        id: 'a3',
        by: 'sergio-alcaraz',
        on: '2025-02-04',
        votes: 4,
        body: `Following on: do not reach for \`leaseStore: db\` to make leases visible across machines. It is in the schema, but as of today nothing implements it and the file store runs whatever you set. If you are sharding across machines against a shared account estate, the file store is not doing what you think it is doing.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-db-dataset-but-the-db-package-is-not-available',
    title:
      'Dataset uses type "db" but @sdods/db is not available — is the package optional or not?',
    askedBy: 'anouk-devries',
    askedOn: '2024-11-19',
    tags: ['data', 'config'],
    votes: 6,
    views: 3280,
    body: `We keep the test workspace deliberately thin — the runner and nothing else — because it is installed on machines that only ever execute suites. One scenario reads reference rows from a table and it dies at run time:

\`\`\`text
✖ DB_REQUIRED: Dataset uses type "db" but @sdods/db is not available.
  hint: Install @sdods/db and configure env.db in envs/<env>.yaml.
\`\`\`

\`env.db\` is configured, so it is the first half of the hint that applies.

What I cannot work out is whether this is a supported configuration or an accident. \`sdods config validate\` is clean, so the config layer clearly does not consider a \`db\` source to imply the dependency. Nothing fails until that one scenario runs, which in our case is forty minutes in.

Two questions, really. Is the package meant to be present in every install and we have broken ours? And if it is genuinely optional, is there a way to make the missing dependency a configuration error at validate time rather than a run-time failure three quarters of the way through a nightly?`,
    answers: [],
  },
  {
    slug: 'data-project-has-no-userpool-configured',
    title:
      'CONFIG_INVALID: Project demo-shop has no data.userPool configured, but data.sources.users exists',
    askedBy: 'sergio-alcaraz',
    askedOn: '2025-02-11',
    tags: ['pool', 'config', 'data'],
    votes: 13,
    views: 4720,
    body: `Added \`@user:standard\` to a scenario. The run stops before the first step:

\`\`\`text
✖ CONFIG_INVALID: Project demo-shop has no data.userPool configured.
  hint: Add data.userPool: { dataset: users, roleColumn: role } to sdods.project.yaml.
\`\`\`

The confusing part is that \`data.sources.users\` is declared and works — \`Given I load dataset "users" row 0\` loads accounts fine in another scenario. So the runner can obviously find the accounts. What is the second block for?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2025-02-11',
        votes: 13,
        body: `\`data.sources\` says where rows come from. \`data.userPool\` says which of those datasets is accounts and which column holds the role. They are separate because most datasets are not accounts, and the pool needs to be told, not to guess.

\`\`\`yaml
data:
  sources:
    users: { type: csv, path: 'data/{env}/users.csv', fallback: data/common/users.csv }
  userPool:
    dataset: users
    roleColumn: role
    leaseStore: file
    leaseTtlMs: 600000
\`\`\`

\`roleColumn\` defaults to \`role\`, \`leaseStore\` to \`file\` and \`leaseTtlMs\` to ten minutes, so the two-line version in the hint is enough to start.

What the pool reads out of each row: \`username\` and \`password\` as the credential, and an id taken from the \`id\` column, falling back to \`username\`, falling back to the row position. Give the rows a stable \`id\` — the lock file is named after it, and a pool whose ids move when the file is sorted is a pool whose leases mean nothing.

Also add \`standard\` to \`tags.roles\` or lint rejects the tag before any of this matters.`,
      },
      {
        id: 'a2',
        by: 'tanvi-bhatt',
        on: '2025-03-12',
        votes: 4,
        body: `After you add it, confirm the block actually landed where you think:

\`\`\`bash
sdods config show -p demo-shop -e staging
\`\`\`

The resolved project tree prints \`data.userPool\` with the defaults filled in. I had mine indented one level too deep under \`sources\` and the yaml was valid, just wrong.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-auth-capture-index-is-per-role-not-per-file',
    title: 'sdods auth capture --index 3 says Role "admin" has 2 user(s); index 3 does not exist',
    askedBy: 'tanvi-bhatt',
    askedOn: '2025-04-23',
    tags: ['pool', 'cli', 'data'],
    votes: 11,
    views: 4260,
    body: `\`\`\`bash
sdods auth capture -p rwa-bank -e local -u admin --index 3
\`\`\`

\`\`\`text
✖ USER_POOL_EXHAUSTED: Role "admin" has 2 user(s); index 3 does not exist.
\`\`\`

The CSV has six rows and the admin I want is on the fourth one, so index 3 by my counting. Where does "2 user(s)" come from?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2025-04-23',
        votes: 12,
        body: `\`--index\` is the position within the role, not the row number in the file. Filter to the admins, number them from zero: two admins means index 0 and index 1, and the fourth row of the file is one of those two.

It is the same number that names the cached state, which is the easiest way to see it:

![Cached login states for two pool users showing role, age, freshness and the storage-state file each was written to](/questions/auth-list.png "the number in the file name is the position within the role")

\`\`\`bash
sdods auth list -p rwa-bank -e local
\`\`\`

If you want all of them rather than one, skip the counting:

\`\`\`bash
sdods auth capture -p rwa-bank -e local -u admin --all
\`\`\``,
      },
      {
        id: 'a2',
        by: 'koen-vermeulen',
        on: '2025-06-04',
        votes: 4,
        body: `One more thing that had us puzzled for a while: capture skips a user whose cached state is still fresh, so re-running it can look like it did nothing. \`--force\` recaptures regardless, and \`auth.maxAgeMinutes\` in the project yaml is what "fresh" means.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-json-dataset-must-contain-an-array-of-rows',
    title:
      'products.json must contain an array of rows (or { rows: [...] }) — mine is keyed by sku',
    askedBy: 'koen-vermeulen',
    askedOn: '2025-06-17',
    tags: ['data', 'config'],
    votes: 9,
    views: 3540,
    body: `The export from our catalogue service is an object keyed by sku, which is the shape everything downstream of it expects:

\`\`\`json
{
  "SKU-1": { "name": "Backpack", "price": 29.99 },
  "SKU-2": { "name": "Bike light", "price": 9.99 }
}
\`\`\`

Pointing a dataset at it gives:

\`\`\`text
✖ CONFIG_INVALID: /work/shop/projects/shop/data/common/products.json must contain an array of rows (or { rows: [...] }).
\`\`\`

Odd part: \`sdods data preview\` on the same file does not complain at all. So one of the two is wrong about the file and I would like to know which.`,
    answers: [
      {
        id: 'a1',
        by: 'bruno-teixeira',
        on: '2025-06-17',
        votes: 8,
        body: `Neither is wrong, they are lenient in different places, and preview is the lenient one.

A dataset is rows. The loader accepts two shapes: a top-level array, or an object with a \`rows\` array — the second so you can keep metadata beside the data without it becoming a column. A map keyed by sku is neither, hence the error.

Preview falls back to wrapping a bare object as a single row, so your keyed map previews as one row with a column per sku. If preview ever shows you \`1 row(s)\` and a hundred columns, that is this shape problem and not a successful read.

Keep the key by promoting it to a column:

\`\`\`json
{
  "rows": [
    { "sku": "SKU-1", "name": "Backpack", "price": 29.99 },
    { "sku": "SKU-2", "name": "Bike light", "price": 9.99 }
  ]
}
\`\`\`

Then \`Given I load dataset "products" where "sku" is "SKU-1"\` does what you meant. Same two shapes for a YAML source.`,
      },
      {
        id: 'a2',
        by: 'renata-kohl',
        on: '2025-06-19',
        votes: 3,
        body: `If the export shape is not yours to change, we generate the dataset file from it in a small script and commit both. The transform is four lines and it means the failure happens at the transform, with a file name in it, rather than inside a scenario.`,
      },
    ],
  },
  {
    slug: 'data-poolsize-slices-the-dataset-before-the-role-filter',
    title: 'users.poolSize is 4 and now a row that exists in the CSV is not in the pool',
    askedBy: 'rasha-halabi',
    askedOn: '2025-09-30',
    tags: ['pool', 'data', 'config'],
    votes: 20,
    views: 6420,
    body: `\`envs/staging.yaml\` has:

\`\`\`yaml
users: { poolSize: 4 }
\`\`\`

\`data/staging/users.csv\` has five rows. Row five is \`visual_user\`, role \`standard\`.

\`\`\`gherkin
Given I use the user "visual_user" from the pool
\`\`\`

\`\`\`text
DATASET_ROW_NOT_FOUND: No pool user named "visual_user".
\`\`\`

The name is in the file, spelled the same, and the role exists. Raising poolSize to 5 fixes it, which I only tried by accident. What is poolSize actually doing — I read it as a limit on concurrent leases, not on which accounts exist.`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2025-09-30',
        votes: 24,
        body: `It is a slice, not a concurrency limit, and it is taken before anything else looks at the rows. The pool is the first N rows of the dataset in file order. With \`poolSize: 4\` the pool is rows 0 to 3 and \`visual_user\` is not in it — not leased, not busy, simply not a member. That is why the failure is a lookup failure rather than a lease failure: the name lookup runs over the same sliced list.

The sharper version of the same problem is roles. If your first four rows are standard, problem, performance and locked, and the only admin is row five, then \`@user:admin\` fails with \`No users with role "admin"\` and a hint listing four roles that do not include it — while the admin sits there in the file you are staring at. The slice happens before the role filter, so a small poolSize can delete a role.

Two fixes. Raise \`poolSize\` to cover the rows you need, or reorder the CSV so every role appears inside the slice. Ordering a data file to satisfy a number in a different file is a smell — raise poolSize.

What poolSize is genuinely for is a guard: an environment where the accounts are shared with other teams and a run must not take more than its share.`,
      },
      {
        id: 'a2',
        by: 'mina-farouk',
        on: '2025-10-07',
        votes: 8,
        body: `We set \`poolSize\` to the row count and control concurrency with \`-w\`, which is the knob that actually controls concurrency. Two numbers that both look like "how many accounts" and mean different things is one too many.`,
      },
      {
        id: 'a3',
        by: 'devon-marsh',
        on: '2025-11-24',
        votes: 5,
        body: `Late to this but worth adding: the same slice feeds \`sdods auth capture\`. So a role outside the slice is not just unleaseable, it never gets a cached login state either, and the symptom you see first might be an auth list that is missing a role rather than a pool error.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-custom-auth-strategy-needs-an-auth-export',
    title: 'auth.strategy "custom" needs an auth export in steps/auth.ts, and I wrote one',
    askedBy: 'devon-marsh',
    askedOn: '2025-12-03',
    tags: ['config', 'pool', 'ui'],
    votes: 10,
    views: 3610,
    body: `Our login is a two-step form — email, continue, then password on the next screen — so the four selectors in \`auth.form\` do not cover it. Set the strategy to custom and wrote the file:

\`\`\`text
✖ CONFIG_INVALID: auth.strategy "custom" needs an \`auth\` export in projects/shop/steps/auth.ts.
  hint: export const auth = defineAuth({ strategy: 'custom', login: async ({ page, user }) => { ... } })
\`\`\`

\`projects/shop/steps/auth.ts\` exists and exports \`auth\`. It is a \`defineAuth\` call with \`strategy: 'custom'\` in it. What is it looking for that I have not given it?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2025-12-03',
        votes: 11,
        body: `A \`login\` function. The loader imports \`steps/auth.ts\` (also \`steps/auth.js\`, also \`auth.ts\` at the project root), takes the \`auth\` export or the default export, and then checks that it has a callable \`login\`. Anything without one is ignored — it falls through to deriving a strategy from the yaml, and \`custom\` has nowhere to derive to, which is the error you are reading.

So the object is being found and rejected, not missed. Usual cause is a \`defineAuth({ strategy: 'custom' })\` with the login still to be written, or the login living on some other key.

\`\`\`ts
import { defineAuth } from '@sdods/core/auth';

export const auth = defineAuth({
  strategy: 'custom',
  async login({ browser, config, user }) {
    const context = await browser.newContext({ baseURL: config.env.ui.baseUrl });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByLabel('Email').fill(user.username);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    return context;
  },
});
\`\`\`

Return the context and SDODS saves the storage state and closes it. \`user\` is the leased pool account, so the two-step form gets the same credentials the pool would have handed a \`form\` strategy.

[Auth strategies and storage state](https://docs.sdods.com/docs/guides/auth-and-storage-state/)`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-read-only-suite-serialised-behind-one-shared-account',
    title: 'One viewer account, twelve read-only scenarios, and the suite behaves as if -w 1',
    askedBy: 'rasha-halabi',
    askedOn: '2026-01-27',
    tags: ['pool', 'data', 'ci'],
    votes: 22,
    views: 5830,
    body: `A partner gives us exactly one \`viewer\` account and will not create more — it is their system, their policy, and no amount of asking has moved it.

Twelve scenarios carry \`@user:viewer\`. Every one of them only reads: open a report, assert some numbers, leave. With \`-w 4\` one worker gets the account and the other three wait and then fail on the lease.

So the suite runs at one worker's pace for the viewer scenarios and I cannot fix it by adding accounts, because there are no accounts to add. Is serialising them into their own run with \`-w 1\` the only shape available?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2026-01-28',
        votes: 26,
        body: `No — this is what \`mode\` is for.

Exclusive leasing is the default because two workers on one identity see each other's writes, and that turns a passing suite into an intermittently failing one that looks like an application bug. For a read-only suite that reasoning does not apply, and the cost of applying it anyway is exactly what you are seeing: eleven scenarios queueing behind one lease and then timing out.

\`\`\`yaml
data:
  userPool:
    dataset: users
    roleColumn: role
    mode: shared
\`\`\`

A shared pool hands out an account without taking a lease at all. The choice is deterministic by worker index, so workers get different accounts when the pool has them and the same one when it does not — which is the point. Nothing to release, nothing to time out.

Two caveats worth being precise about:

- \`mode\` is a property of the pool, not of a role. If any scenario anywhere mutates user-scoped state, do not flip the whole thing. The safe shape is a pool of genuinely read-only accounts, and separate accounts for the scenarios that write.
- If you would rather queue than share, \`data.userPool.waitMs\` sets how long a worker waits for a free account before failing. Thirty seconds by default, which is why your failures arrive in a batch after a pause.

[Test data and user pools](https://docs.sdods.com/docs/guides/test-data-and-user-pools/)`,
      },
      {
        id: 'a2',
        by: 'ingrid-solberg',
        on: '2026-03-05',
        votes: 7,
        body: `We landed somewhere between the two. The read-only scenarios use a shared pool. The four that write live in their own module and run separately, which also means a failure there does not need triaging against "did another worker do this".

Splitting by what the scenario does to the account turned out to be a better line than splitting by role.`,
      },
      {
        id: 'a3',
        by: 'zeynep-arslan',
        on: '2026-07-02',
        votes: 5,
        body: `Slightly meta, but the \`USER_POOL_EXHAUSTED\` hint spells out the options in order — shared mode first, then more accounts, then the wait, then fewer workers — and it names the \`poolSize\` trap at the end. It is a long hint and easy to skim past when you are annoyed. Reading it would have saved me an afternoon.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-var-placeholder-in-a-csv-is-not-interpolated-locally',
    title:
      'Pool leased an account whose username is the literal ${TEST_MEMBER_EMAIL} and auth rejected it',
    askedBy: 'ingrid-solberg',
    askedOn: '2026-03-19',
    tags: ['data', 'pool', 'config'],
    votes: 29,
    views: 6940,
    body: `Local runs only. CI has been green throughout, which is why this took a day.

\`projects/mybotbox/data/staging/users.csv\`:

\`\`\`text
id,username,password,role
1,\${TEST_MEMBER_EMAIL},\${TEST_MEMBER_PASSWORD},member
\`\`\`

\`\`\`bash
sdods run -p mybotbox -e staging -l ui -t @smoke
\`\`\`

The failure is not from SDODS. It is from the auth provider, in the middle of the login step:

\`\`\`text
INVALID_EMAIL: the email address "\${TEST_MEMBER_EMAIL}" is badly formatted.
\`\`\`

So the pool leased an account whose username is the placeholder, as a string, and handed it to the login.

Both variables are in \`projects/mybotbox/.env.staging\`. That file is definitely being read — \`env.vars\` in the environment yaml references the same two variables and \`sdods config show -p mybotbox -e staging\` resolves them fine, values and all. So the dotenv layer exists and works, and then somewhere between there and the CSV it stops applying. Where?

And why is CI green?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2026-03-20',
        votes: 27,
        body: `Cause first: the dotenv layer that resolved your \`env.vars\` is not the scope the dataset cell is interpolated against, and an unresolved \`\${VAR}\` in a cell is kept verbatim without a warning. Two behaviours, and neither one is visibly wrong on its own.

\`.env\` files are parsed into a layer and merged into the resolved configuration — they are never injected into \`process.env\`. That is deliberate: it is what makes a shell variable beat a file, and it is why the precedence table has them as separate rows. Config interpolation uses the merged layer, which is why \`env.vars\` resolves.

The data provider does not see that layer, so a cell reference can only resolve against the real environment. Locally that is empty, so nothing resolves.

The second half is why it takes a day to find. An unresolved reference in a data cell is kept as written rather than throwing. That is the right default for a data file — a body of test text containing a literal \`\${\` should not blow up a suite — but it means the value travels intact through the loader, the pool, the lease and the auth cache, and the first thing that objects is whatever finally consumes it. Here that is the auth provider's email validator, about a hundred frames from the cause, with an error that names their product and not ours.

CI is green because CI passes the variables as real \`env:\` entries in the job. They land in \`process.env\`, the provider finds them, the cell resolves.

The workaround that works today is to put the file in your shell before the run.

\`\`\`bash
set -a; . projects/mybotbox/.env.staging; set +a
\`\`\`

\`\`\`bash
sdods run -p mybotbox -e staging -l ui -t @smoke
\`\`\`

> [!NOTE]
> Status, because it matters for what you do next: the cause was that the merged dotenv layer was
> built for interpolating the yaml and then never handed to the data provider, so the provider fell
> back to bare \`process.env\` — which the config loader deliberately never writes to. Current
> \`data/provider.ts\` resolves through \`config.vars\` before that fallback, so if you are still
> seeing it you are on a build from before that change and \`set -a\` is your fix until you move.

Two things that make it survivable in the meantime:

- Use the \`\${VAR:-default}\` form where a default is meaningful. A reference with a default always resolves, so it can never leak the literal — that is why the sample projects write passwords that way, and it is also why nobody hits this on the demo projects.
- Where a default is not meaningful, fail early on purpose. A first step that asserts the username does not contain \`\${\` gives you the error next to the cause instead of two layers down.`,
      },
      {
        id: 'a2',
        by: 'paulo-mendes',
        on: '2026-04-15',
        votes: 7,
        body: `Adding the boring version of the same fix: an \`.envrc\` with the same exports, so the shell has them whenever you are in the directory and you never have to remember the \`set -a\` dance. Same mechanism, it just gets the values into the environment for you.

Does not help CI, but CI was never the broken one.`,
      },
      {
        id: 'a3',
        by: 'zeynep-arslan',
        on: '2026-06-25',
        votes: 8,
        body: `We hit this with a password rather than an email, which was worse — the auth provider returned a plain 401 and we spent two days convinced the account was locked. There is no signal at all when the literal is a password, because a wrong password and a placebo-shaped password fail identically.

The tell we go by now is any error containing \`\${\`. And a warning: \`sdods data preview\` is no help here. It shows the file, not the resolved row, so the output is identical whether the variables are set or not — which is correct behaviour for a file viewer and exactly the wrong tool for confirming this.`,
      },
      {
        id: 'a4',
        by: 'bruno-teixeira',
        on: '2026-08-11',
        votes: 4,
        body: `For anyone finding this from the CI direction rather than the local one: the same class of bug can point the other way. If a variable is set in your shell and only in your shell, local passes and CI leases a literal. Worth having one scenario that asserts the leased username matches an email shape, tagged \`@sanity\`, so whichever side is misconfigured says so in ten seconds.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
  {
    slug: 'data-twelve-thousand-reference-rows-csv-or-db-dataset',
    title: '12k rows of reference data: commit the CSV or import it into a db dataset?',
    askedBy: 'paulo-mendes',
    askedOn: '2026-05-28',
    tags: ['data', 'config'],
    votes: 8,
    views: 2870,
    body: `Our pricing rules are about twelve thousand rows and they change roughly weekly, on a schedule that has nothing to do with our release schedule. Today they are a committed CSV, resolved per environment, and it works — scenarios load a row by rule id and assert the computed price.

What I am unsure about is whether it should stay that way. Arguments I can make on both sides:

- The CSV is diffable and a review of a pricing change is a review of a diff, which is genuinely useful. It also needs no database in CI, and our API-layer runs currently need nothing but the runner.
- A \`db\` dataset can be reloaded with \`sdods data import --to table --truncate\` without a commit, and the weekly churn currently produces a weekly pull request that nobody reads and everybody approves.

Has anyone moved a fixture of roughly this size and regretted it in either direction? Specifically interested in whether the parse cost per worker turns out to matter at this scale, or whether that is the wrong thing to be thinking about.`,
    answers: [],
  },
  {
    slug: 'data-cleanup-delete-returned-404-and-the-scenario-passed',
    title: 'A cleanup DELETE returned 404 and the scenario still passed — is that intended?',
    askedBy: 'zeynep-arslan',
    askedOn: '2026-07-14',
    tags: ['data', 'api', 'reporting'],
    votes: 14,
    views: 2680,
    body: `We register cleanups the way the guide shows:

\`\`\`gherkin
Given I register cleanup DELETE "/posts/{{postId}}"
\`\`\`

The records are not being deleted. Looking at the run detail, the cleanup ran and the request 404'd, and the scenario is green.

Two things I would like to understand. Why does a failed cleanup not fail the scenario — I can see arguments both ways. And is there something that would have told me, short of noticing the sandbox filling up three weeks later?`,
    answers: [
      {
        id: 'a1',
        by: 'priya-venkatesh',
        on: '2026-07-15',
        votes: 13,
        body: `The first one is a deliberate trade. A cleanup failure is attached to the result and never fails the scenario, because the alternative is a green test going red for something that is not the behaviour under test. Do that a few times and people learn to ignore red, which costs more than the leaked records.

The second one is where your actual bug is. Look at what the attachment says the request was. Cleanups are stored with a description built from the method and the rendered path at registration time, so if it reads

\`\`\`text
DELETE /posts/{{postId}}
\`\`\`

then \`{{postId}}\` was not set when the cleanup was registered, and the literal placeholder is what got sent — an unresolved template renders as itself, so the request went to a path with braces in it and the server said 404, correctly.

Two ways to get there. Either the save step never ran, or it saved under a different name than the cleanup references. And there is an ordering trap: cleanups run last-in-first-out at the end of the scenario, but the path is rendered when you register, not when it runs. Registering before the create step means rendering a variable that does not exist yet.

\`\`\`gherkin
When I send a POST request to "/posts" with body:
  """
  { "title": "hello", "userId": 1 }
  """
When I save the response JSON path "id" as "postId"
Given I register cleanup DELETE "/posts/{{postId}}"
\`\`\`

Create, save, register, in that order.`,
      },
      {
        id: 'a2',
        by: 'mina-farouk',
        on: '2026-07-21',
        votes: 5,
        body: `The rendered-at-registration behaviour is the part that surprises people, and it is the right choice — a cleanup that re-renders at the end would pick up whatever the variable had become by then, which for a scenario that reuses a name is a different record.

We caught our leak by checking the attachments on a nightly rather than by counting rows in the sandbox. Anything with a \`{{\` in the cleanup description is a bug, and it is one grep.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },
];
