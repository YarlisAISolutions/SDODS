import type { Thread } from '../types';

export const mcpThreads: Thread[] = [
  {
    slug: 'mcp-tools-registered-but-claude-code-shows-none',
    title: 'sdods mcp is registered but Claude Code lists no tools from it',
    askedBy: 'ade-oyinlola',
    askedOn: '2023-04-11',
    tags: ['mcp', 'cli'],
    votes: 24,
    views: 9310,
    body: `Registered the server the way the guide says:

\`\`\`bash
claude mcp add sdods -- npx sdods mcp --project demo-shop --env staging
\`\`\`

\`claude mcp list\` shows \`sdods\`. But when I ask it to list projects it says it has no such tool
and starts reading files instead. No error anywhere. Where do I even look?`,
    answers: [
      {
        id: 'a1',
        by: 'petrov-k',
        on: '2023-04-11',
        votes: 30,
        body: `\`claude mcp list\` only proves the entry is in the config. It does not prove the server
started. Run it by hand first:

\`\`\`bash
sdods mcp --project demo-shop --env staging --list-tools
\`\`\`

That prints the catalogue and exits. If it prints, the server is fine and the client is the problem;
if it throws, you get the real error instead of a silent client.

The usual real error is that the project or env does not resolve from the directory the client
launched \`npx\` in. \`sdods mcp\` is started with the client's cwd, not yours.

Second thing to check: \`--caps\`. The default is \`core,analyze,run,data,schedules\`. If the tool
you were expecting is an agent or issue tool it is genuinely not there:

\`\`\`bash
sdods mcp --project demo-shop --caps all --list-tools
\`\`\``,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2023-04-14',
        votes: 16,
        body: `Adding one failure mode to Kostya's answer, because it bites people once and never again.

stdio MCP is a protocol on stdout. Anything else written there corrupts the stream and the client
drops the server without a message. If you have a shell profile that prints a banner, or an \`npx\`
that logs an install line on first use, that is enough.

Pre-install so \`npx\` has nothing to say, then re-add:

\`\`\`bash
npm i -g sdods
claude mcp remove sdods
claude mcp add sdods -- sdods mcp --project demo-shop --env staging
\`\`\``,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-install-windsurf-unknown-client',
    title: 'sdods mcp install windsurf says Unknown client — is Windsurf just not supported?',
    askedBy: 'yusuf-demir',
    askedOn: '2023-07-19',
    tags: ['mcp', 'cli', 'install'],
    votes: 11,
    views: 4120,
    body: `Half the team uses Windsurf. Tried the obvious thing:

\`\`\`bash
sdods mcp install windsurf -p demo-shop
\`\`\`

\`\`\`text
Unknown client "windsurf".
  → Use one of claude, cursor, vscode, codex.
\`\`\`

Do I have to hand-write the config, or is there a flag I am missing?`,
    answers: [
      {
        id: 'a1',
        by: 'petrov-k',
        on: '2023-07-19',
        votes: 14,
        body: `Hand-write it, but do not hand-write it from scratch — Windsurf reads the same
\`mcpServers\` shape Cursor does, so generate Cursor's and paste:

\`\`\`bash
sdods mcp install cursor -p demo-shop --print
\`\`\`

\`--print\` writes nothing; it shows the target file and the snippet. Drop the JSON into
\`.windsurf/mcp.json\` under the same \`mcpServers\` key and restart the editor.

The installer's list is only about which config file it knows how to merge without clobbering
somebody else's servers. The server itself does not care which client is on the other end of the
pipe — it is stdio either way.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-can-an-agent-commit-the-feature-it-wrote',
    title:
      'Can an SDODS agent commit the feature it wrote, or does a person always have to accept?',
    askedBy: 'chandra-p',
    askedOn: '2023-10-05',
    tags: ['agents', 'mcp', 'cli'],
    votes: 31,
    views: 12480,
    body: `We want to run \`sdods agent generate\` nightly against the new endpoints and have the
features land on a branch by morning. Right now every run leaves something in \`proposals/\` that
somebody has to pick up.

Is there an \`--apply\` or an auto-accept mode? Or is the proposal step deliberate?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2023-10-05',
        votes: 38,
        body: `Deliberate, and it is the one thing about the agent roles that will not be made
optional. Agents never write to the working tree. Every role output is a directory under
\`proposals/<id>/\` with a manifest, the files and a diff, and the only thing that applies it is a
person running:

\`\`\`bash
sdods proposals accept <id> --branch sdods/<id>
\`\`\`

\`accept\` copies the files in, optionally onto a new git branch, and runs \`sdods lint\` unless you
pass \`--no-lint\`. So the branch you wanted does exist — it is one command, run by a human, after
reading the diff.

The reason is not distrust of a model. It is that a proposal that is wrong costs you a review, and
a merged feature that is wrong costs you a week of a suite everyone stops believing.`,
      },
      {
        id: 'a2',
        by: 'petrov-k',
        on: '2023-10-06',
        votes: 12,
        body: `Practical version of the nightly job: let the agent run unattended, and have the job
finish at \`proposals list\`.

\`\`\`bash
sdods agent generate -p demo-shop --goal "the new /invoices endpoints"
sdods proposals list --status pending
\`\`\`

Then the morning ritual is \`sdods proposals show <id>\` and one accept per proposal you like. That
is about two minutes per proposal, which is roughly what a code review of the same diff would cost
you anyway.`,
      },
      {
        id: 'a3',
        by: 'thom-vasseur',
        on: '2023-10-11',
        votes: 5,
        body: `We tried to get clever about this and wrapped \`accept\` in CI so the branch appeared
automatically. It worked, and it was a mistake — nobody read the diffs any more, they read the PR,
and a PR full of generated Gherkin gets rubber-stamped.

Went back to accepting by hand. Reject rate is about one in four, which is exactly the number that
tells you the review is doing something.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-http-mode-needs-a-bearer-token',
    title: 'sdods mcp --http exits immediately with HTTP mode needs a bearer token',
    askedBy: 'nikhil-sane',
    askedOn: '2024-02-27',
    tags: ['mcp', 'config', 'cli'],
    votes: 18,
    views: 6740,
    body: `Trying to reach the server from a container on the same box, so stdio is out.

\`\`\`bash
sdods mcp --http --port 4001
\`\`\`

\`\`\`text
AUTH_FAILED  HTTP mode needs a bearer token.
  → Pass --token <secret> (dev) or set SDODS_MCP_TOKEN. Production deployments use scoped tokens
    from \`sdods tokens create\` via the web server.
\`\`\`

Exit code 2. I did not expect auth on localhost. Is there a way to turn it off for a dev box?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2024-02-27',
        votes: 22,
        body: `There is not, and that is on purpose: the moment the server speaks HTTP it is
reachable by anything on the machine, including any page a browser has open. So it refuses to start
without something to check.

For a dev box, one shared secret is fine:

\`\`\`bash
SDODS_MCP_TOKEN=$(openssl rand -hex 32) sdods mcp --http --port 4001
\`\`\`

or \`--token <secret>\` if you would rather see it in the command. That path accepts exactly that one
token and has no notion of scopes.

For anything a second person will use, do not use \`sdods mcp --http\` at all. Run the web server,
which serves MCP at \`/mcp\` and checks real tokens:

\`\`\`bash
sdods serve
sdods tokens create --user qa-bot --name mcp --scopes projects:read,features:read,runs:read
\`\`\`

Then the token's scopes decide which tools the client is even shown.
[MCP](https://docs.sdods.com/docs/guides/mcp/) has the transport table.`,
      },
      {
        id: 'a2',
        by: 'petrov-k',
        on: '2024-02-28',
        votes: 7,
        body: `Worth knowing for the container case: exit code 2 is the configuration-or-usage code,
so a supervisor that restarts on non-zero will just spin. Set the variable in the unit or the
compose env rather than letting it retry.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-unknown-capability-agent-vs-agents',
    title: 'caps core,agent gives Unknown capability "agent" and I cannot find the real list',
    askedBy: 'fiona-mcallister',
    askedOn: '2024-04-30',
    tags: ['mcp', 'cli', 'config'],
    votes: 9,
    views: 3180,
    body: `\`\`\`bash
sdods mcp -p demo-shop --caps core,analyze,agent
\`\`\`

\`\`\`text
Unknown capability "agent". Known: core, analyze, run, data, agents, issues, schedules
\`\`\`

Right, plural. Fine. But is there a page that lists these, or do I read them out of the error every
time?`,
    answers: [
      {
        id: 'a1',
        by: 'petrov-k',
        on: '2024-04-30',
        votes: 11,
        body: `The error is the list, and it is generated from the same constant the parser uses, so
it cannot drift. Beyond that:

- \`--caps all\` turns everything on.
- The default when you pass nothing is \`core,analyze,run,data,schedules\` — note that \`agents\`
  and \`issues\` are deliberately off.
- \`sdods mcp --list-tools\` prints what your combination actually resolves to, which is the answer
  you usually want rather than the capability names.

The reference table maps every tool to its capability and access level:
[MCP tools](https://docs.sdods.com/docs/reference/mcp-tools/).`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-what-to-check-in-a-proposal-before-accepting',
    title: 'What should I actually look at in a proposal before running sdods proposals accept?',
    askedBy: 'bea-lindqvist',
    askedOn: '2024-06-12',
    tags: ['agents', 'mcp', 'lint'],
    votes: 27,
    views: 10250,
    body: `First week of using the generator role. \`sdods proposals show <id>\` gives me a diff and a
manifest and I am reading it the way I read any PR, which I suspect is the wrong instinct — a model
gets different things wrong than a colleague does.

What are the failure modes that are specific to a generated proposal?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2024-06-12',
        votes: 24,
        body: `The one that costs the most is scope. A generator asked about checkout will
occasionally decide a step in the login module needs "fixing" on the way past. Look at the file list
before the diff, and reject anything that touches a module you did not ask about — it is never worth
untangling.

After that, in the order they bite:

1. Reuse. New steps should exist only where nothing in the shared vocabulary matched. The manifest
   records the \`step_find\` suggestions the agent saw, so you can tell a genuine gap from a phrasing
   the model preferred.
2. Assertions. A generated scenario that ends with a navigation and no assertion passes forever.
3. Tags. One layer, one suite. \`accept\` runs lint for you, so this one is cheap to get wrong.

Checklist version: [Reviewing agent
proposals](https://docs.sdods.com/docs/best-practices/reviewing-proposals/).`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2024-06-13',
        votes: 19,
        body: `Locators, specifically, because that is my corner of this.

The healer works from an ARIA snapshot and locator statistics. When the element it needs is not in
that snapshot — behind a portal, inside a canvas, rendered after the snapshot was taken — it falls
back to whatever it can see, and what it can see is CSS. So a CSS locator in a proposal is not
laziness, it is a signal that the snapshot was missing something.

Do not just tidy it into a role locator and accept. Find out why the accessible name was not there,
because a missing accessible name is usually a real defect in the page.

A heal proposal must also never loosen an assertion to make a scenario pass. That one is an
automatic reject.`,
      },
      {
        id: 'a3',
        by: 'petrov-k',
        on: '2024-06-19',
        votes: 8,
        body: `Read the bottom of the manifest too. It records the model, the turns and the cost, and
which scenarios the agent ran and with what result.

A proposal that took thirty turns and never ran the scenario it patched is a different object from
one that took four and re-ran green, even when the diffs look the same.`,
      },
    ],
  },

  {
    slug: 'mcp-what-does-agent-dry-run-actually-do',
    title: 'Does sdods agent generate --dry-run call the model at all?',
    askedBy: 'bruno-teixeira',
    askedOn: '2024-09-03',
    tags: ['agents', 'cli', 'mcp'],
    votes: 14,
    views: 5390,
    body: `Before I point this at a paid key I would like to see what it is going to send. Does
\`--dry-run\` do a cheap call, or no call?`,
    answers: [
      {
        id: 'a1',
        by: 'petrov-k',
        on: '2024-09-03',
        votes: 20,
        body: `No call, and no credential needed. \`--dry-run\` selects the fake adapter and prints
the prompt, the tool list and the budget, then stops:

\`\`\`bash
sdods agent generate -p demo-shop --goal "checkout with a discount code" --dry-run
\`\`\`

The output ends with a line telling you no files were written. Nothing is billed, nothing lands in
\`proposals/\`, and \`--adapter fake\` on its own does the same without the printing.

The tool list is the part worth reading. That is the menu the model gets, and it is where you find
out you enabled a capability you did not mean to, or that the role you picked has no browser
attached.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2024-09-04',
        votes: 9,
        body: `It is also the cheapest way to check that the project and env resolve, since the
prompt carries the resolved config. If the dry run shows the wrong base URL, a real run would have
spent money to tell you the same thing.

Habit worth forming: dry run, read the tool list, then drop the flag.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-healer-proposed-a-css-locator-i-disagree-with',
    title: 'The healer proposed a CSS locator when there is a perfectly good label — reject it?',
    askedBy: 'anouk-devries',
    askedOn: '2024-11-19',
    tags: ['agents', 'locators', 'heal', 'mcp'],
    votes: 22,
    views: 8120,
    body: `Scenario broke, ran the healer, got a proposal. The patch swaps a page-object locator for
a class chain:

\`\`\`ts
this.heal.locator('.f-row--2 .f-ctl input', { description: 'promo code' })
\`\`\`

The input has a visible label reading "Promo code". So there is an obviously better locator and it
picked the worst one on the list. Do I reject and re-run, or fix it in place and accept?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2024-11-19',
        votes: 26,
        body: `Reject it, but not because the locator is bad. Reject it because the proposal is
telling you something true and you would be deleting the message.

The healer picks from what the failing run actually gave it: the error, the ARIA snapshot and the
locator statistics. \`getByLabel('Promo code')\` is only available to it if that label is associated
with the input in the accessibility tree. A visible label that is not wired to the control — no
\`for\`, no \`aria-labelledby\`, wrapped in a div instead of a \`label\` — is invisible to the
snapshot, and to a screen reader.

So the CSS chain is the healer honestly reporting that the element has no accessible name.

\`\`\`bash
sdods proposals reject <id> --reason "input has no accessible name; fixing the page instead"
\`\`\`

Fix the markup, re-run the scenario, and the locator you wanted becomes available to everyone
including the next heal.

If the label really is wired up and the healer still went to CSS, that is worth a separate thread —
paste \`heal_locator_stats\` for the fingerprint.`,
      },
      {
        id: 'a2',
        by: 'petrov-k',
        on: '2024-11-20',
        votes: 10,
        body: `On the mechanical part of the question: do not edit files under \`proposals/<id>/\` and
then accept. The manifest is the record of what the agent proposed, and hand-editing the staged
files makes that record disagree with what you actually applied — which matters the first time
somebody asks why a locator in \`main\` is not the one in the proposal they reviewed.

Accept it or reject it as it stands; make your own change as your own commit.`,
      },
      {
        id: 'a3',
        by: 'lena-hartwig',
        on: '2024-11-22',
        votes: 6,
        body: `We hit this often enough that we started running \`analyze_locators\` over a module
before letting the healer near it. It flags the controls with no accessible name up front, so the
first heal proposal on that module is usually a sensible one instead of a class chain.

Not a fix, just less annoying.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-proposal-was-rejected-cannot-accept',
    title: 'Accepting a proposal I rejected yesterday fails with Proposal ... was rejected',
    askedBy: 'sergio-alcaraz',
    askedOn: '2025-02-11',
    tags: ['agents', 'cli'],
    votes: 13,
    views: 4470,
    body: `Rejected this one in a hurry, then realised two of the three files were fine.

\`\`\`bash
sdods proposals accept 20250210-171204-generate-c41b8e
\`\`\`

\`\`\`text
Proposal 20250210-171204-generate-c41b8e was rejected
\`\`\`

The directory is still there with all the files in it. Is there an un-reject, or do I re-run the
agent and pay for it twice?`,
    answers: [
      {
        id: 'a1',
        by: 'petrov-k',
        on: '2025-02-11',
        votes: 17,
        body: `No un-reject. The status in the manifest is the audit trail, and flipping it back
would make "rejected" mean nothing.

You do not need to re-run anything, though. The proposal directory is just files:

\`\`\`bash
sdods proposals show 20250210-171204-generate-c41b8e
\`\`\`

The two files you want are under \`proposals/<id>/files/\`. Copy them into place yourself, run
\`sdods lint\`, commit. That is exactly what \`accept\` would have done, minus the manifest stamp.

Cheaper habit for next time: reject with a reason, so the thing you are throwing away is recorded.

\`\`\`bash
sdods proposals reject <id> --reason "step naming; keeping the page object"
\`\`\``,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2025-02-12',
        votes: 8,
        body: `And if you are undecided, leave it pending. \`sdods proposals list --status pending\`
is a working queue; nothing expires it. Rejecting is for "this was wrong", not for "not today".`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-local-model-describes-tool-calls-instead-of-making-them',
    title: 'Local model writes out the tool call as text instead of actually calling it',
    askedBy: 'tanvi-bhatt',
    askedOn: '2025-04-16',
    tags: ['agents', 'mcp', 'config'],
    votes: 29,
    views: 9840,
    body: `Running the generator on my own machine because the source cannot leave it:

\`\`\`bash
sdods agent generate -p rwa-bank --adapter ollama --model qwen2.5-coder:7b --goal "add a contact"
\`\`\`

It does not call anything. It writes a paragraph about what it is going to do, then a line that
looks like this in the answer text:

\`\`\`text
step_find({"project":"rwa-bank","text":"I navigate to the Contacts page"})
\`\`\`

and stops. The structured tool-call field is empty. Same model calls tools fine in other tooling, so
I do not think it is the model.`,
    answers: [
      {
        id: 'a1',
        by: 'petrov-k',
        on: '2025-04-16',
        votes: 33,
        body: `It is not the model, it is the size of the menu you handed it. From the MCP guide:

> SDODS exposes 33–35 tools to a role and Playwright adds about 24; a 7–8B local model starts
> describing tool calls in prose instead of making them somewhere past that.

That is the behaviour you are looking at, and it is remarkably consistent: past roughly twenty
functions a 7–8B model stops choosing and starts narrating.

The fix is the small profile, which is supposed to be picked for you:

\`\`\`bash
sdods agent generate -p rwa-bank --adapter ollama --model qwen2.5-coder:7b --profile small --goal "add a contact"
\`\`\`

Under \`small\` the generator sees five tools — \`step_find\`, \`feature_list\`, \`feature_read\`,
\`feature_parse\`, \`feature_write\` — one call per turn, no browser server attached, and the system
prompt carries sixty of your project's real step patterns instead of the general conventions.

Check what you actually got with \`--dry-run\` first; it prints the profile, the reason it was chosen
and the tool list.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2025-04-17',
        votes: 15,
        body: `One detail that will change what you are seeing: under the small profile a call the
model wrote as prose is read back out of the answer and executed. The run says so, in those words:

\`\`\`text
recovered a step_find call the model wrote as text
\`\`\`

So the exact output you pasted is the case that profile was built for. Under \`full\` it is ignored,
which is why it looks like nothing happened.

Also worth checking before you blame the profile: \`ollama ps\` and the CONTEXT column. A 4096-token
context truncates an agent prompt silently on the first turn, and a truncated prompt looks exactly
like a stupid model. [Local models](https://docs.sdods.com/docs/guides/local-models/) has the
numbers.`,
      },
      {
        id: 'a3',
        by: 'thom-vasseur',
        on: '2025-04-23',
        votes: 6,
        body: `We ended up mixing: \`agents.models\` takes a model per role, so planning runs on a
hosted model and generation stays local. Planning was the role the 7B could never finish anyway.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-37-tools-or-33-35-which-is-it',
    title: 'The reference says 37 tools, the MCP guide says 33 to 35 — which number is right?',
    askedBy: 'koen-vermeulen',
    askedOn: '2025-06-10',
    tags: ['mcp', 'agents'],
    votes: 20,
    views: 6980,
    body: `Writing an internal page about what our agents can reach and I cannot make the docs agree
with themselves. The MCP tools reference is titled as the 37 tools. The MCP guide says SDODS exposes
33 to 35 tools to a role.

Which one do I put in the wiki?`,
    answers: [
      {
        id: 'a1',
        by: 'petrov-k',
        on: '2025-06-10',
        votes: 24,
        body: `Neither, put a command in the wiki. But the two numbers are both right and they count
different things.

- 37 is the whole catalogue the reference page documents: every tool the registry registers.
- 33 to 35 is what one agent role is shown, once the role drops what it cannot use. A reviewer has
  no business calling \`run_tests\`; a planner does not need \`schedule_next\`.

That is why it is a range rather than a number: it depends on the role. \`--caps\` can shrink it
further on top of that — the default is \`core,analyze,run,data,schedules\`, so anything under
\`agents\` or \`issues\` is off unless you ask — but that is not where the 37-to-35 gap comes from.

The live answer, which is the one that will still be true next quarter:

\`\`\`bash
sdods mcp -p demo-shop --caps all --list-tools
\`\`\`

and for what a specific role gets, \`sdods agent review -p demo-shop --dry-run\`, which prints the
tool list it would have used.`,
      },
      {
        id: 'a2',
        by: 'tanvi-bhatt',
        on: '2025-06-11',
        votes: 9,
        body: `The number matters for one practical reason and it is worth putting in your wiki next
to it: Playwright's MCP server adds about 24 more for the roles that drive a browser, and the total
is what a small model chokes on. So "how many tools" is really "which profile", not trivia.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-openai-adapter-does-not-see-mcp-servers',
    title: 'My mcp.servers block is ignored when the agent runs with the openai adapter',
    askedBy: 'thom-vasseur',
    askedOn: '2025-07-22',
    tags: ['agents', 'mcp', 'config'],
    votes: 17,
    views: 5610,
    body: `Project yaml has the usual:

\`\`\`yaml
mcp:
  servers:
    playwright: { transport: stdio, command: npx, args: [playwright, mcp, --headless] }
\`\`\`

With \`--adapter claude\` the planner browses the app and the plan is full of real page names. With
\`--adapter openai\` against our internal endpoint, the same command produces a plan invented out of
the route file. No error, no warning, and the dry run tool list has no \`browser_*\` entries at all.

Is the block being read?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2025-07-22',
        votes: 21,
        body: `It is being read and then not used. This is a listed limitation, not a config
mistake on your side:

> The OpenAI-compatible adapter runs a plain tool loop and ignores \`mcp.servers\`; only the Claude
> adapter can drive the bundled Playwright MCP server.

Workaround is the one on the limitations page: use the Claude adapter for the roles whose job is
looking at the application — \`plan\`, \`generate\`, \`heal\`. The roles that read the repository
rather than the app (\`review\`, \`upgrade\`) are unaffected and can stay on your endpoint.

\`agents.provider\` is a single value, not a per-role one, so this is a flag on the command rather
than a yaml change:

\`\`\`yaml
agents:
  provider: openai-compatible
\`\`\`

\`\`\`bash
sdods agent plan -p demo-shop --goal "checkout" --adapter claude
sdods agent review -p demo-shop
\`\`\`

\`agents.models\` does take a model per role, but that picks the model, not the adapter — the
provider is still whatever \`--adapter\` or \`agents.provider\` says.

[Known limitations](https://docs.sdods.com/docs/reference/known-limitations/) is worth a read
before you design around any of this.`,
      },
      {
        id: 'a2',
        by: 'koen-vermeulen',
        on: '2025-07-24',
        votes: 11,
        body: `Flagging the thing that cost me an afternoon on the same problem: the MCP guide reads
as though every adapter bridges those servers in and presents them as \`mcp__<server>__<tool>\`
functions. The limitations page says the opposite. The limitations page is the one that matches what
the binary does.

The tell is exactly what you found — the dry-run tool list. If \`browser_navigate\` is not in it, no
amount of yaml is going to make the model browse anything.

\`\`\`bash
sdods agent plan -p demo-shop --goal x --adapter openai --dry-run
\`\`\``,
      },
    ],
  },

  {
    slug: 'mcp-scoping-a-token-for-a-shared-server',
    title: 'How do I give the team coding agents read-only access to our SDODS server?',
    askedBy: 'rasha-halabi',
    askedOn: '2025-09-08',
    tags: ['mcp', 'config', 'cli'],
    votes: 33,
    views: 11200,
    body: `We host one SDODS server for the QA group. Everyone wants to point their editor at
\`/mcp\` so they can ask about runs and coverage without a checkout.

What I do not want is somebody's editor deciding to start a regression run against staging at four
in the afternoon. Can I hand out a token that can read and nothing else?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2025-09-08',
        votes: 29,
        body: `Yes, and it is the intended shape of a shared server. Over HTTP the bearer token's
scopes decide which tools even appear in the client's list — a tool the token cannot call is not
advertised, so the model never tries and never has to be told no.

\`\`\`bash
sdods tokens create --user koen --name editor --scopes projects:read,features:read,runs:read,artifacts:read --expires 90d
\`\`\`

Roughly:

- read scopes only: they get \`project_*\`, \`feature_*\`, \`step_*\`, \`run_*\` reads, \`analyze_*\`,
  \`heal_*\`, \`data_*\`, \`schedule_*\`.
- add \`runs:write\`: \`run_tests\` and \`run_tests_async\` appear. This is the one you are worried
  about.
- add \`features:write\`: \`feature_write\` appears, and it still only writes a proposal.

Tokens are free, unlimited and revocable, so issue one per person rather than one for the team. That
way revoking is not an event.`,
      },
      {
        id: 'a2',
        by: 'koen-vermeulen',
        on: '2025-09-09',
        votes: 14,
        body: `The Settings page does the whole thing without the CLI, and it also hands you the
client snippets already filled in with your endpoint, which saved me from typing the header wrong
twice.

![Settings, MCP clients tab: the /mcp endpoint, the tool list a token resolves to, a connection test and copy-ready snippets for Claude Code, Cursor and VS Code](/questions/ui-settings-mcp.png "Settings → MCP clients: the endpoint, the tools the token resolves to, and per-client config snippets.")

The Test connection box is the useful bit — paste the token, press Test, and the tool chips above
update to what that token actually resolves to. Faster than restarting an editor to find out.`,
      },
      {
        id: 'a3',
        by: 'petrov-k',
        on: '2025-09-09',
        votes: 10,
        body: `One rule that catches people: a token's scopes must be a subset of its owner's role,
both when it is created and every time it is used. So a token created by an admin for a viewer
account does not grant admin, and demoting somebody quietly narrows every token they own.

If a colleague's tools disappear one morning, check their role before you check the token.`,
      },
      {
        id: 'a4',
        by: 'priya-venkatesh',
        on: '2025-09-15',
        votes: 7,
        body: `Separate token for CI, separate scopes: \`runs:ingest,runs:read\` and nothing else.
Do not reuse a person's editor token in a workflow — when they leave, the pipeline goes with them.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-claude-mcp-add-failed-and-nothing-was-written',
    title: 'sdods mcp install claude dies with claude mcp add failed and writes nothing',
    askedBy: 'helle-borg',
    askedOn: '2025-10-14',
    tags: ['mcp', 'install', 'cli'],
    votes: 12,
    views: 4030,
    body: `On a locked-down work laptop:

\`\`\`bash
sdods mcp install claude -p demo-shop -e staging
\`\`\`

\`\`\`text
claude mcp add failed: EACCES: permission denied, open '/Users/hb/.claude.json'
  → Re-run with --file to write the config file directly.
\`\`\`

I do not have write access to that file and IT will not change it this quarter. Does the hint
actually help me, or is it just a different way to fail?`,
    answers: [
      {
        id: 'a1',
        by: 'petrov-k',
        on: '2025-10-14',
        votes: 15,
        body: `It helps. Those are two different files.

By default the installer prefers the client's own CLI — \`claude mcp add -s project sdods -- npx
sdods mcp ...\` — so the client's config format stays authoritative. That writes into the CLI's own
config in your home directory, which is the one you cannot open.

\`--file\` skips the CLI entirely and merges \`.mcp.json\` in the repository instead:

\`\`\`bash
sdods mcp install claude -p demo-shop -e staging --file
\`\`\`

Project-scoped \`.mcp.json\` is read by Claude Code the same way, it lives in a directory you own,
and it has the side benefit that it is committable, so your colleagues get the same registration
without running anything.

The merge does not clobber other servers in that file.`,
      },
      {
        id: 'a2',
        by: 'koen-vermeulen',
        on: '2025-10-15',
        votes: 6,
        body: `Look before you write, if you are nervous about a locked-down box:

\`\`\`bash
sdods mcp install claude -p demo-shop -e staging --print
\`\`\`

Prints the target path and the exact snippet, touches nothing. Then decide between \`--file\` and
pasting it yourself.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-agent-job-failed-with-no-detail',
    title: 'sdods agent heal ends with Agent job ... failed: unknown and I cannot find a log',
    askedBy: 'devon-marsh',
    askedOn: '2025-12-02',
    tags: ['agents', 'heal', 'cli'],
    votes: 3,
    views: 610,
    body: `\`\`\`bash
sdods agent heal -p demo-shop --scenario 4b19e0 --max-turns 30
\`\`\`

\`\`\`text
Agent job 20251202-093311-heal-a7d0f1 failed: unknown
\`\`\`

Nothing under \`proposals/\`. \`sdods agent jobs\` lists the job with the same empty error. Adding
\`--events\` prints the turns up to about turn eleven and then just stops, mid tool call, no error
line.

Same scenario heals fine with \`--adapter fake\` obviously, and fine on a colleague's machine with
the same project. Difference is I am on the Codex adapter and they are on a key. Where does the
adapter's own stderr go? Is there anything under \`.sdods/agent-jobs/\` beyond what \`jobs\` prints?`,
    answers: [],
  },

  {
    slug: 'mcp-proposals-accept-branch-could-not-switch',
    title: 'proposals accept --branch fails with Could not switch to branch and no reason why',
    askedBy: 'devon-marsh',
    askedOn: '2026-01-19',
    tags: ['agents', 'cli'],
    votes: 10,
    views: 2740,
    body: `\`\`\`bash
sdods proposals accept 20260119-084402-generate-b3e91c --branch sdods/checkout
\`\`\`

\`\`\`text
Could not switch to branch sdods/checkout: Command failed: git checkout -B sdods/checkout
\`\`\`

That is the whole message. Nothing applied, which I am glad about, but git's own reason is nowhere —
not on stdout, not with \`--json\`. Am I supposed to guess?`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-01-19',
        votes: 13,
        body: `You are not, but you do have to ask git yourself. \`accept\` runs the checkout with its
output discarded and only wraps the exit status, so the message you get is the shape of the failure
and not the cause of it. Run the same command by hand and git will tell you:

\`\`\`bash
git checkout -B sdods/checkout
\`\`\`

The causes I have actually seen, in the order they turn up:

- the directory is not a git repository at all. Far and away the most common one — a project folder
  that was copied rather than cloned, and nobody noticed because nothing else in SDODS cares.
- the branch is checked out in another worktree: \`fatal: 'sdods/checkout' is already checked out
  at '...'\`.
- a name git will not take as a ref.
- a half-finished merge with unresolved paths in the index.

Note that a dirty tree is not on that list. \`-B\` creates or resets the branch at the commit you are
already on, so nothing in your working tree moves and uncommitted changes come along with you.

The proposal is untouched by a failed accept, so nothing was lost either way. You can also skip the
flag entirely — switch yourself, then accept onto whatever branch you are standing on:

\`\`\`bash
git switch -c sdods/checkout
sdods proposals accept 20260119-084402-generate-b3e91c
\`\`\`

Lint runs afterwards either way, unless you pass \`--no-lint\`.`,
      },
      {
        id: 'a2',
        by: 'koen-vermeulen',
        on: '2026-01-20',
        votes: 8,
        body: `Since you are looking at that flag anyway, know what it does when it succeeds: the
checkout is \`-B\`, so a branch of that name that already exists is reset to where you are standing
now. It will not refuse and it will not warn you.

Which is fine for a throwaway review branch and quietly awful if you reuse one branch for several
proposals and had commits on it.

We name branches after the proposal id rather than the topic — \`--branch sdods/<id>\` — precisely
so nothing is ever reused. Ugly branch names, nothing lost.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-one-server-for-the-team-or-one-each',
    title: 'Should each tester run sdods mcp locally, or should we host one server for the team?',
    askedBy: 'ingrid-solberg',
    askedOn: '2026-03-05',
    tags: ['mcp', 'config', 'ci'],
    votes: 26,
    views: 7150,
    body: `Eight testers, one repo, one staging environment. Right now everybody has stdio in their
editor and their own checkout. It works, but nobody can ask about a run somebody else did, and the
answers people get differ depending on how stale their branch is.

Is there a reason not to just host one server and point everyone at \`/mcp\`?`,
    answers: [
      {
        id: 'a1',
        by: 'koen-vermeulen',
        on: '2026-03-05',
        votes: 22,
        body: `We run both and they are not really alternatives, they answer different questions.

The hosted server owns the shared history: runs, artifacts, schedules, insights. That is what you
want everyone pointed at, and it is the half your current setup is missing — a stdio server reads
the runs in that person's \`.sdods/\` and nothing else.

The local stdio server owns the working tree: the features on your branch, the steps you just wrote,
lint against your changes. That cannot be hosted, because the files are not there.

So: register both. The catch is that \`install\` always writes the key \`sdods\`, so running it twice
just overwrites the first entry — you get one server, not two. Let the installer write the local
one and add the hosted one by hand under a different name:

\`\`\`bash
sdods mcp install claude -p demo-shop -e staging --file
\`\`\`

\`\`\`bash
claude mcp add -s project --transport http sdods-hosted https://sdods.example.com/mcp --header "Authorization: Bearer $SDODS_TOKEN"
\`\`\`

\`sdods mcp install claude --http-url https://sdods.example.com/mcp --print\` gives you the same
snippet if you would rather paste it into \`.mcp.json\` and rename the key there.

Give the hosted one read scopes only. The local one is you, on your machine, and can do what you can
do.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2026-03-06',
        votes: 14,
        body: `Do not use \`sdods mcp --http\` for the shared one. That mode takes a single bearer
token and has no notion of who is calling or what they may reach; it exists for a development box.

The web server is the multi-user path: it serves MCP at \`/mcp\`, checks real tokens, and filters the
tool list by the token's scopes.

\`\`\`bash
sdods serve
\`\`\`

Everything else — the dashboard, run detail, the scheduler — comes with it, which is usually the
point at which a team stops thinking of it as an MCP endpoint.`,
      },
      {
        id: 'a3',
        by: 'devon-marsh',
        on: '2026-03-11',
        votes: 8,
        body: `One thing we got wrong at first: we pointed the hosted registration at the wrong
project and nobody noticed for a week, because the tools were all there and the answers were merely
about a different suite.

Put \`-p\` and \`-e\` in the registration and then check them from inside the client once —
\`project_list\` and \`project_get_config\` will tell you what the server thinks it is serving.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-doctor-which-credential-row-do-i-need',
    title: 'sdods doctor lists six credential rows for agents — which one do I actually need?',
    askedBy: 'paulo-mendes',
    askedOn: '2026-04-22',
    tags: ['agents', 'config', 'cli'],
    votes: 19,
    views: 5240,
    body: `New to this. \`sdods doctor\` gives me a tidy screen and then a token section that lists
what looks like six different ways to pay for the same thing.

![sdods doctor output: green rows for node, bun, the runner, three browsers, projects, per-environment variable resolution, the database, and the claude and codex CLI logins](/questions/doctor.png "sdods doctor, with the cli:claude and cli:codex rows at the bottom.")

\`ANTHROPIC_API_KEY\`, a claude CLI login, a codex CLI login, \`OPENAI_API_KEY\` with a base URL,
local models through ollama, and \`SDODS_TOKEN\`. Do I need all of them? Any of them?`,
    answers: [
      {
        id: 'a1',
        by: 'devon-marsh',
        on: '2026-04-22',
        votes: 21,
        body: `You need zero of them to use SDODS, and exactly one of the first five to use the agent
roles. The docs call that group "one-of" and the doctor prints them together for that reason.

- \`ANTHROPIC_API_KEY\` — the \`claude\` adapter. Billed per token by Anthropic. The row's own hint
  says it: or log in to Claude Code (\`claude login\`) — no key needed.
- claude CLI login — \`npm i -g @anthropic-ai/claude-code && claude login\`. No key; your
  subscription pays.
- codex CLI login — same idea on a ChatGPT account.
- \`OPENAI_API_KEY\` (+ \`OPENAI_BASE_URL\`) — any OpenAI-compatible endpoint, including your own.
- local models (ollama) — \`ollama serve && ollama pull qwen2.5-coder:7b\`. No key, no bill, nothing
  leaves the machine.

\`SDODS_TOKEN\` (+ \`SDODS_SERVER_URL\`) is not in that group at all. It is SDODS's own token, it is
free and self-issued, and it is only needed to talk to a hosted SDODS server — MCP over HTTP, or
uploading run results. It never buys you a model.

Running suites, screenshots, lint, analyze, the dashboard and the stdio MCP server need no
credential whatsoever.`,
      },
      {
        id: 'a2',
        by: 'petrov-k',
        on: '2026-04-23',
        votes: 9,
        body: `And if you set more than one, the order that decides is fixed:
\`ANTHROPIC_API_KEY\` → \`claude\` CLI → \`codex\` CLI → \`OPENAI_API_KEY\` → a local Ollama →
\`fake\`. SDODS prints which one it picked at the start of a job.

Which trips people up when they add a key for one experiment and then wonder why their local model
stopped being used. \`--adapter\` on the command, or \`agents.provider\` in the project yaml, beats
the detection.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-vscode-mcp-json-written-but-no-tools',
    title: 'VS Code wrote .vscode/mcp.json but the chat still has no sdods tools',
    askedBy: 'ingrid-solberg',
    askedOn: '2026-05-11',
    tags: ['mcp', 'install'],
    votes: 8,
    views: 2110,
    body: `\`sdods mcp install vscode -p demo-shop\` reported that it created
\`.vscode/mcp.json\` and the file looks right to me. Reloaded the window twice. The chat has the
built-in tools and nothing from sdods.

Claude Code on the same repo works, so the server itself is fine.`,
    answers: [
      {
        id: 'a1',
        by: 'petrov-k',
        on: '2026-05-11',
        votes: 11,
        body: `VS Code does not start a server because the config exists — it starts it when you
tell it to, from the MCP section, and it will happily sit there showing nothing until you do. Open
the file and use the start action on the \`sdods\` entry; the output panel then shows the handshake
or the reason there isn't one.

Two things to check in the file while it is open. It needs \`servers\` (not \`mcpServers\`, which is
the Claude and Cursor shape), and the entry needs \`"type": "stdio"\`:

\`\`\`json
{
  "servers": {
    "sdods": {
      "type": "stdio",
      "command": "npx",
      "args": ["sdods", "mcp", "--project", "demo-shop"]
    }
  }
}
\`\`\`

If the panel shows the server dying on start, run the same argv yourself — \`npx sdods mcp --project
demo-shop --list-tools\` — from the folder VS Code has open, and you will get the real error rather
than a silent one.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-local-model-goes-in-circles-on-generate',
    title: 'Local model loops on agent generate, calling the same tool until it hits max turns',
    askedBy: 'paulo-mendes',
    askedOn: '2026-06-03',
    tags: ['agents', 'mcp', 'config'],
    votes: 23,
    views: 6480,
    body: `\`\`\`bash
sdods agent generate -p rwa-bank --adapter ollama --model llama3.1:8b --plan docs/test-plans/contacts.md --events
\`\`\`

It calls \`feature_list\`, reads the result, calls \`feature_list\` again with the same arguments,
and keeps going until the turn budget stops it. No proposal. It is not confused about the tool — it
just never seems to remember it already called it.

Budget never fires, which I assume is because nothing is billed.`,
    answers: [
      {
        id: 'a1',
        by: 'tanvi-bhatt',
        on: '2026-06-03',
        votes: 26,
        body: `Repeating the same call with the same arguments is almost always the model not
seeing its own previous turn, and on Ollama that means context.

\`\`\`bash
ollama ps
\`\`\`

Look at the CONTEXT column. Ollama loads a model with a 4096-token context by default whatever the
weights allow, and it truncates a longer prompt silently. An agent prompt carries the tool schemas,
so it is over 4096 on turn one; by turn three the earlier tool results have fallen off the front and
the model genuinely does not know it called anything.

\`\`\`yaml
agents:
  provider: ollama
  local:
    contextTokens: 16384
\`\`\`

or server-wide with \`OLLAMA_CONTEXT_LENGTH=16384 ollama serve\`.

SDODS is supposed to refuse a job whose prompt cannot fit rather than let it be truncated, so if you
got no such refusal, check that the adapter really is \`ollama\` and not \`openai\` pointed at the
same endpoint — the OpenAI protocol has no way to set or read the context size, which is exactly why
the native adapter exists.`,
      },
      {
        id: 'a2',
        by: 'devon-marsh',
        on: '2026-06-04',
        votes: 12,
        body: `Do not raise it to the model's maximum, though. An oversized \`num_ctx\` on a laptop
spills the KV cache out of memory and ten-second turns become minutes, which looks like a different
bug entirely.

Raise it to what the job needs. 16k was enough for generate here; 32k for anything reading a long
plan.`,
      },
      {
        id: 'a3',
        by: 'petrov-k',
        on: '2026-06-04',
        votes: 9,
        body: `On the budget: correct, \`budgetUsd\` never fires on a local model because nothing is
billed, so \`maxTurns\` is the only bound that matters there. Set it deliberately per role rather
than leaving the default:

\`\`\`yaml
agents:
  maxTurns: { healer: 30, generator: 20 }
\`\`\`

A loop that costs nothing still costs you an afternoon.`,
      },
      {
        id: 'a4',
        by: 'koen-vermeulen',
        on: '2026-06-09',
        votes: 5,
        body: `Once the context is right, \`llama3.1:8b\` is honestly a reviewing and reading model
rather than a generating one. It calls tools reliably, which is the hard part, but generate from a
plan is patchy at 8B and usually fine at 14B.

\`qwen2.5-coder:14b\` is the one that changed our results, at the cost of a slower first turn.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'mcp-screenshot-resource-says-no-such-screenshot',
    title: 'sdods://screenshot resource returns No such screenshot for a run I can open in the UI',
    askedBy: 'zeynep-arslan',
    askedOn: '2026-07-16',
    tags: ['mcp', 'reporting'],
    votes: 2,
    views: 380,
    body: `Asking the model to compare the before and after images of a failed step. It resolves the
run fine — \`run_get_scenario\` comes back with the screenshot URIs — but reading one of them fails:

\`\`\`text
No such screenshot: 02-after.png
\`\`\`

The same file opens in the run detail page in the web UI, so it exists somewhere. The URI the tool
handed back has the shape \`sdods://screenshot/{runId}/{fingerprint}/{retry}/{file}\`, and I am
passing it back verbatim.

Is the retry segment the attempt index or the retry count? Wondering whether the first attempt is
\`0\` and I am off by one on a scenario that passed on retry.`,
    answers: [],
  },

  {
    slug: 'mcp-proving-agents-never-touched-the-working-tree',
    title: 'Audit wants proof the agents cannot write to our repo — what do I actually show them?',
    askedBy: 'zeynep-arslan',
    askedOn: '2026-08-20',
    tags: ['agents', 'mcp', 'config'],
    votes: 15,
    views: 3260,
    body: `Internal audit has heard the words "AI writes our tests" and wants a control, not a
paragraph. Saying that agents only write proposals is exactly the kind of claim they will ask me to
evidence.

What is the concrete answer? Ideally something they can verify themselves rather than take from me.`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-08-21',
        votes: 18,
        body: `Show them three things, in this order.

The write path. Every agent role and every write tool produces a directory under
\`proposals/<id>/\` — a manifest, the files, a diff. \`feature_write\` over MCP does the same. There
is no code path from a role to your feature files; the only thing that applies a proposal is
\`sdods proposals accept <id>\`, run by a person, and the manifest records who accepted it and when.

The tool surface. Have them read it themselves rather than believing the list:

\`\`\`bash
sdods mcp -p demo-shop --caps all --list-tools
\`\`\`

Every tool carries an access level — \`read\`, \`run\` or \`write\` — and \`write\` means "produces a
proposal", not "edits a file". That output is generated from the registry, so it cannot be stale.

The sandbox, if you are running roles through a coding CLI. The \`claude-code\` adapter is invoked
with \`--disallowedTools Bash Write Edit\`, and the \`codex\` adapter with a read-only sandbox. So
even the general-purpose file tools those CLIs have are off.

For an auditor, the second one is usually the persuasive one, because they run it.`,
      },
      {
        id: 'a2',
        by: 'devon-marsh',
        on: '2026-08-24',
        votes: 9,
        body: `Add the token side if the agents reach a hosted server, since that is the boundary an
auditor recognises: scopes are checked at creation and at use, a token's scopes must be a subset of
its owner's role, and a tool the token cannot call is never advertised to the client.

We gave audit a viewer token and let them point their own editor at \`/mcp\`. Watching the write
tools simply not be there ended the conversation faster than any document did.

\`\`\`bash
sdods tokens create --user audit --name review --scopes projects:read,features:read,runs:read --expires 30d
\`\`\``,
      },
    ],
  },
];
