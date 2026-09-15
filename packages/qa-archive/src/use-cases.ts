import type { UseCase } from './types';

/**
 * Twelve hard surfaces, drawn from a real programme that put a 1,600-scenario SDODS suite over a
 * large workflow-automation product.
 *
 * These are application defects and testability gaps, not SDODS bugs, which is exactly why they
 * belong here rather than in the question archive: nobody is stuck, there is nothing to fix in the
 * framework, and the interesting part is the shape of the surface. Where SDODS cannot do the thing
 * the surface needs — canvas drag, an inbox, a second tab, an axe run, a perf budget — each entry
 * says so and gives the honest alternative, because a use-case page that implies a missing feature
 * exists is worse than no page at all.
 */
export const USE_CASES: UseCase[] = [
  {
    slug: 'auth-surfaces-with-no-test-ids',
    title: 'Testing an eight-screen auth funnel that has no test ids',
    surface:
      'Login, signup, email verification, 2FA, the device flow, OAuth consent, invitation acceptance and password reset',
    tags: ['ui', 'locators', 'page-objects'],
    problem: `Eight screens stand between a stranger and a session, and not one of them carries a \`data-testid\`. Every control is reachable only by its visible copy, and that copy comes out of a translation catalogue.

That has a consequence people usually miss. \`I click the "Sign in" button\` is not a locale-neutral assertion — it is an English assertion, silently, on a product that ships six catalogues. The suite is pinned to one of them and nobody wrote that down.

The state machines are worse than the fields:

- the device-authorisation card has four states — code entry, consent, authorised, error — and the only thing that distinguishes them is prose
- the invitation page has one error screen per redirect code, all of them rendered as a sentence
- OAuth consent lists a variable number of scopes, and a scenario needs to assert which ones

> [!NOTE]
> A form field is the easy half. Ask which states a screen has before you ask which controls it has — states are what a rename actually breaks.`,
    approach: `Start from the locator order and be honest about where this surface lands in it: role and accessible name, then label, then test id, then placeholder, then text, then CSS. With no test ids, role plus name genuinely is the best available handle — the problem is that the name is translated, not that the strategy is wrong.

So do two things at once.

- Pin the locale in the environment file (\`use.locale\`) so the implicit assertion becomes an explicit one. A suite that only passes in English should say so in \`envs/<env>.yaml\`, not in a reviewer's memory.
- Put the test id you have asked for into the heal context now, before it exists. It costs nothing while it is missing, and the day it lands it becomes the recovery path without a feature-file edit.

\`\`\`ts
readonly submit = this.heal.locator(
  this.page.getByRole('button', { name: 'Sign in' }),
  { role: 'button', name: 'Sign in', testId: 'login-submit', description: 'login submit' },
);
\`\`\`

The healer only probes alternatives when the primary fails, so this is not a fallback you pay for on the happy path.

What to ask the application team for, in priority order: one test id per control; a data attribute carrying the state on any card that has more than one (\`data-device-state="input|consent|authorized|error"\`), so a scenario asserts a state machine instead of matching a sentence; and an error code on each refusal screen rather than only a message.

Two things SDODS will not do for you here, plainly:

- there is no email assertion of any kind, so the verification link and the invitation link are unreachable from Gherkin. Seed the accepted state through the API and let the UI scenario start after the link, or stop the scenario honestly at "the code was sent".
- there is no multi-tab step, so an OAuth popup cannot be driven from a shared step. \`BasePage\` does expose \`waitForPopup()\`, so a project step in a page object can drive it — the shared library will not.`,
    sketch: `\`\`\`gherkin
@ui @smoke @user:unverified
Scenario: An unverified account is held at the verification screen
  Given I use a leased user with role "unverified"
  When I navigate to the "login" page
  And I fill the "Email" field with "{{email}}"
  And I fill the "Password" field with "{{password}}"
  And I click the "Sign in" button
  Then the page URL should contain "/verify"
  And I should see the text "Enter the code we sent"

@ui @regression
Scenario: The device flow refuses a code that has expired
  Given I navigate to the "device" page
  When I fill the "Code" field with "{{expiredDeviceCode}}"
  And I click the "Continue" button
  Then the element with test id "device-card" should contain "error"
\`\`\`

The second scenario is written against a test id and a state attribute that do not exist yet. That is deliberate: it is the request, in the form the application team can act on, and it stays \`@fixme\`-free by being the one scenario you keep red on purpose until the attribute lands.

Further reading: [locator strategy](https://docs.sdods.com/docs/best-practices/locator-strategy/) and [page objects](https://docs.sdods.com/docs/guides/page-objects/).`,
  },

  {
    slug: 'denials-that-must-not-be-cached',
    title: 'A 403 that a shared cache is free to replay',
    surface: 'Authorisation refusals on an API served through a CDN',
    tags: ['api', 'regression'],
    problem: `A refusal carried no \`Cache-Control\` header. The CDN in front of the application applies a default positive max-age to any response that declares nothing, and its cache key does not vary on the session cookie. So a 403 built for one caller becomes a 403 stored under a URL and handed to the next one — including, on one occasion, the legitimate owner of the resource.

An audit found the same shape on somewhere north of sixty routes: logs, webhooks, deployments, knowledge bases, invitations, permission groups, organisation members, and the platform admin surface. Exactly one shared HTTP helper stamped \`private, no-store\` on a 4xx, and most routes were hand-rolling their refusals instead of going through it.

The part that matters for testing: every one of those routes returned the correct status code. A suite that asserts \`the response status should be 403\` was green on the day the bug shipped and stayed green for months. The status is the easy half of a denial; the caching semantics are the half that decides whether the denial is a security control or a suggestion.`,
    approach: `The shared library has the step this needs. It is in \`@sdods/core/steps\` and it is not in the docs table, so people miss it:

\`\`\`gherkin
Then the response header "cache-control" should contain "no-store"
\`\`\`

Assert three things on every negative scenario, not one:

1. the status
2. the reason, from the body — \`the response JSON path "error" should equal "..."\`, so a red run names the cause instead of making somebody re-probe by hand
3. the header

Do the deny direction as a wrong actor rather than as no actor wherever you can. \`I use a leased user with role "viewer"\` exercises the authorisation code; \`I use no authentication\` exercises the session guard in front of it. Both are real steps and they prove different things — the unauthenticated one sets the API context's auth to \`null\` explicitly, so it does not silently fall back to the environment's credential.

> [!WARNING]
> There is no negative header step. \`should contain\` exists; \`should not contain\` does not, for a header or for a body. If your contract is "the enforcing response must not carry \`public\`", that is a project step in your own \`api.steps.ts\`. Do not write an assertion the library will not parse and assume lint caught it — an unknown step is a missing-step error at generate time, which is a fine failure, but it is not the same as an assertion.

This is also the argument for scenario outlines over copy-paste. One outline over a table of routes and roles is the difference between sixty scenarios you maintain and sixty scenarios you inherit.`,
    sketch: `\`\`\`gherkin
@api @regression @data-driven
Scenario Outline: A refusal is never storable by a shared cache
  Given I use a leased user with role "<role>" for API calls
  When I send a <method> request to "<path>"
  Then the response status should be <status>
  And the response header "cache-control" should contain "no-store"
  And the response JSON path "error" should exist

  Examples:
    | role   | method | path                        | status |
    | viewer | POST   | /workflows/{{id}}/variables | 403    |
    | viewer | DELETE | /workspaces/{{id}}/members  | 403    |
    | member | GET    | /admin/role-policies        | 403    |
    | member | POST   | /custom-domains             | 403    |

@api @sanity
Scenario: An unauthenticated caller is refused and the refusal is not stored
  Given I use no authentication
  When I send a GET request to "/workspaces/{{workspaceId}}"
  Then the response status should be 401
  And the response header "cache-control" should contain "no-store"
\`\`\`

Exactly one layer tag and one suite tag per scenario, as [the taxonomy](https://docs.sdods.com/docs/guides/tags-and-suites/) requires; \`@data-driven\` is optional and documents the outline.`,
  },

  {
    slug: 'plan-caps-and-spending-limits',
    title: 'Plan caps, spending limits, and a gate that never fired',
    surface: 'Billing, usage and spending-limit routes behind plan entitlements',
    tags: ['api', 'data', 'regression'],
    problem: `Entitlements are the deny direction of a product, and the deny direction is where the money is.

One route issued presigned upload URLs. A global validation refused anything over 100 MB, and that worked. The plan-tier attachment cap did not run at all: an account on the free plan was issued a working, immediately usable signed URL for a 100 MB object, valid for an hour. The refusal that was supposed to name the entitlement never fired.

Note where the spend happens. Storage is written at the upload. A cap enforced later, in the route that consumes the file, refuses the use and does not reclaim the object. A user interface that hides the upload control on the free plan looks entirely correct while this route stays open.

A second finding in the same surface: a seat denial returned 400 with a seat object while every plan denial returned 403 with a \`PLAN_REQUIRED\` code. Two shapes for one concept means the upgrade prompt cannot be driven from a seat refusal, and it means a test suite has to pin both shapes and can never assert one.

And a third: the entitlement check did not re-evaluate at the effective tier, so a member of an organisation on the top plan was refused features that organisation pays for.`,
    approach: `Three assertions per gate, always: the status, the code in the body, and the absence of the thing that was being gated.

The third one is where the shared library stops. There is \`the response JSON path {string} should exist\`; there is no negative form. A refusal that still hands out the URL is a total bypass for any client that ignores the status code, so this assertion genuinely matters and you need a way to make it.

The clean way, without writing a step, is a JSON schema — \`the response should match the JSON schema {string}\` runs ajv with formats, so the schema can forbid the key:

\`\`\`json
{
  "type": "object",
  "required": ["error", "code"],
  "not": { "required": ["presignedUrl"] }
}
\`\`\`

That is a real assertion with a real failure message, and it lives in \`schemas/\` next to the project rather than in a step nobody else reuses.

For the boundaries themselves, drive the sizes from a dataset rather than from copy-pasted scenarios — \`I load dataset "attachment-caps" row 1\`, or an outline over the table. A cap test is only interesting at the edges: one under, one at, one over, and the global limit above all of them, so the run can distinguish "the plan gate refused" from "the size validator refused".

> [!TIP]
> Assert the two refusals apart. If the plan gate and the global validator both return a 4xx, a scenario that only checks the status cannot tell you which one is doing the work — which is exactly how the missing gate went unnoticed here.

Two more things this surface wants:

- entitlements that change per tier belong in a dataset keyed by plan, so a new tier is a row and not a rewrite
- a refusal shape is a contract. Pin it with a schema, and when the product unifies 400-with-an-object and 403-with-a-code, one schema file changes.`,
    sketch: `\`\`\`gherkin
@api @regression @data-driven
Scenario Outline: The attachment cap is enforced before a URL is issued
  Given I use a leased user with role "free" for API calls
  When I send a POST request to "/files/presigned" with body:
    """json
    { "uploadType": "assistant", "contentType": "text/plain", "fileSize": <bytes> }
    """
  Then the response status should be <status>
  And the response should match the JSON schema "schemas/<schema>.json"

  Examples:
    | bytes     | status | schema           |
    | 1048576   | 200    | presigned-issued |
    | 6291456   | 403    | plan-refusal     |
    | 104857600 | 403    | plan-refusal     |

@api @sanity
Scenario: The refusal names the entitlement it enforced
  Given I use a leased user with role "free" for API calls
  When I send a POST request to "/files/presigned" with body:
    """json
    { "uploadType": "assistant", "contentType": "text/plain", "fileSize": 104857600 }
    """
  Then the response status should be 403
  And the response JSON path "code" should equal "PLAN_REQUIRED"
  And the response JSON path "feature" should equal "chatAttachmentMbPerMessage"
  And the response header "cache-control" should contain "no-store"
\`\`\`

\`schemas/plan-refusal.json\` is where \`"not": { "required": ["presignedUrl"] }\` lives — the assertion the step library cannot make on its own.`,
  },

  {
    slug: 'a-drag-canvas-with-193-block-types',
    title: 'A workflow canvas SDODS cannot drag',
    surface:
      'A node-graph editor: 193 block types, edges, handles, sub-block inputs and subflow containers',
    tags: ['ui', 'locators', 'page-objects'],
    problem: `This is the hardest UI surface in the product and the one the framework serves worst.

- Node elements carry a uuid. A test that has just added a block can only find it by diffing the node list before and after, which is a race dressed as an assertion.
- The sub-block inputs — short text, long text, dropdown, combobox, code — carry neither an id nor a test id. Only the wrapper is addressable, so every field fill degrades to a descendant CSS guess like \`[data-nodeid] [data-subblock-id] input\`.
- The single most important control in the product, Run, was addressable only through a product-tour attribute. A tour refactor would have removed it silently.
- The two subflow containers, loop and parallel, have no selector of their own and their nesting is invisible in the DOM entirely.
- 48 OAuth connectors have no obtainable grant in CI, so the only assertable thing about them is the connect affordance.

And 193 block types is not a number you write 193 scenarios for.`,
    approach: `Say the honest thing first: SDODS ships no canvas, drag or graph steps. There is no \`I drag ... onto ...\`, no handle-to-handle connect step, no node-count assertion, and \`BasePage\` has no drag helper either. A design exists on the roadmap; it is not in the library today.

What you can do, in the order I would do it:

1. Add through the palette, not through drag. Clicking a palette item adds the block on this product, so \`I click the element with test id "toolbar-block-<type>"\` covers the whole add case with a shared step — provided the palette items carry test ids. That single request is worth more than a drag step.
2. Assert the graph through the API. The canvas is a view over a document. Seed the workflow with \`I seed via POST\` and assert the persisted shape with JSON path and a schema. Nesting that is invisible in the DOM is perfectly visible in the saved graph, and an API assertion cannot be flaky about a node that has not finished animating.
3. Ask for one attribute. \`data-blocktype\` alongside the uuid removes the diff-the-node-list class across all 193 types at once. It is the cheapest testability change in the whole backlog.
4. Keep drag in a page object. If you genuinely need the drag interaction — and for most coverage you do not — write it as a project step over Playwright's \`dragTo\` inside a page object with a heal context, and give it a phrasing in the house style so it reads like the shared steps around it.

Also worth asking for: a serialisable projection of the block registry. A parity check between "what the palette offers" and "what the registry declares" is a good test, and it should not require importing an application module that pulls in icons and a feature-flag system.

> [!NOTE]
> Coverage of a 193-type catalogue is a data-driven problem, not a scenario-count problem. One \`Scenario Outline\` over a generated table, plus a deny-direction outline for the types that must not be offered on this plan or in this tab, is the whole catalogue.`,
    sketch: `\`\`\`gherkin
@hybrid @regression
Scenario: A block added on the canvas is persisted into the graph
  Given I use a leased user with role "member"
  When I seed via POST "/workflows" with body:
    """json
    { "name": "sdods-canvas-{{runId}}", "workspaceId": "{{fixtureWorkspaceId}}" }
    """
  And I save the response JSON path "id" as "workflowId"
  And I register cleanup DELETE "/workflows/{{workflowId}}"
  And I navigate to the "workflow" page
  And I click the element with test id "toolbar-block-condition"
  And I click the element with test id "run-workflow"
  Then the element with test id "block-error-message" should be visible

@api @regression @data-driven
Scenario Outline: The palette offers exactly what the registry declares
  When I send a GET request to "/internal/blocks/registry"
  Then the response status should be 200
  And the response JSON path "$..[?(@.type=='<type>')].addable" should equal "<addable>"

  Examples:
    | type      | addable |
    | condition | true    |
    | starter   | false   |
\`\`\`

The first scenario is \`@hybrid\` on purpose: it seeds through the API so the browser starts on a workflow that exists, which is both faster and the only version of it that is deterministic. Drag is absent from both sketches because there is no step for it — not because the interaction does not matter.`,
  },

  {
    slug: 'a-fixture-workspace-that-hit-its-plan-cap',
    title: 'Ten scenarios said "Forbidden" and meant "you are out of workflows"',
    surface:
      'A shared fixture workspace on a free plan with a three-workflow cap, holding twenty-three',
    tags: ['data', 'pool', 'api', 'cli'],
    problem: `Every scenario whose background created a workflow failed. The reported error was:

\`\`\`text
Error: creating the hitl fixture workflow (Forbidden)
  expect(received).toBe(expected)
  Expected: 200
  Received: 403
\`\`\`

Which reads like a permissions regression, and is not one. Probed directly, the server was saying something completely different:

\`\`\`json
{
  "error": "Plan limit reached",
  "message": "You've reached the 3 workflow limit on the free plan.",
  "upgradeRequired": "starter",
  "current": 23,
  "limit": 3
}
\`\`\`

Ten scenarios pointed an investigation at authorisation for most of a day while the cause was billing. The step had wrapped the response in the HTTP reason phrase and thrown the body away.

The second half is worse than the first. Of the 23 workflows, two were test artefacts. The other 21 were human work, created over three weeks by people using the same workspace — and the environment file itself describes that environment as shared with people. So the "every creating scenario registers cleanup" rule was not what failed. The environment design failed: three workflows is not headroom for a 1,600-scenario suite, and it is not headroom for one scenario.

One genuine leak was visible in the list — a fixture from a deny-direction scenario which, by construction, the actor under test cannot delete.`,
    approach: `Three separate lessons, and only one of them is about the application.

Fail fast, at the top, with the real message. A \`BeforeAll\` hook in the project's steps that reads the plan and the current count and aborts when the workspace is within N of its cap would have replaced the entire investigation. It is about five lines.

\`sdods doctor\` will not do this for you, and it is worth being precise about why: its variables check resolves every \`\${VAR}\` reference declared under \`envs/<env>.yaml\` \`vars:\` against the \`.env\` files and the shell. It checks that your configuration is resolvable, not that the environment behind it is usable. Those are different questions and only the first one is generic.

Assert the body next to the status. Any step that creates a fixture should surface what the server said. In feature files, that means the reason travels with the status:

\`\`\`gherkin
Then the response status should be 403
And the response JSON path "error" should equal "Plan limit reached"
\`\`\`

A red run that names its own cause is worth more than a red run that is merely red.

Fixture hygiene is environment design. The roles in an RBAC fixture must differ only inside the fixture workspace — but the contents of that workspace being unpredictable is what broke here. A workspace nobody works in costs nothing and removes a whole class of failure. Then: \`I register cleanup {method} {string}\` on every creating scenario, and an owner-level teardown for the deny-direction fixtures that the actor under test deliberately cannot remove.

> [!WARNING]
> Do not fix this by deleting the twenty-one workflows. They are somebody's work, and that decision belongs to their owner. Move the suite, not the humans.`,
    sketch: `\`\`\`gherkin
@api @sanity
Scenario: The fixture workspace has headroom before the suite runs
  Given I use a leased user with role "member" for API calls
  When I send a GET request to "/billing?workspaceId={{fixtureWorkspaceId}}"
  Then the response status should be 200
  And the response JSON path "plan" should equal "{{expectedFixturePlan}}"
  When I send a GET request to "/workflows?workspaceId={{fixtureWorkspaceId}}"
  Then the response status should be 200
  And the response JSON path "items" should have at least 1 items

@api @regression
Scenario: The plan cap refuses with a message that names the cap
  Given I use a leased user with role "free" for API calls
  When I send a POST request to "/workflows" with body:
    """json
    { "name": "sdods-cap-{{runId}}", "workspaceId": "{{cappedWorkspaceId}}" }
    """
  Then the response status should be 403
  And the response JSON path "error" should equal "Plan limit reached"
  And the response JSON path "limit" should equal "3"
\`\`\`

Run the first as its own \`@sanity\` pass before the suite: \`sdods run -p <slug> -e staging -t @sanity -l api\`. If it is red, nothing downstream of it is telling you anything about the product.`,
  },

  {
    slug: 'a-nav-label-that-was-renamed',
    title: 'Ten scenarios, one stale label: "Fleet" became "AGENTS"',
    surface: 'A sidebar navigation entry that a product rename moved out from under the suite',
    tags: ['locators', 'heal', 'ui', 'config'],
    problem: `Ten of ten scenarios in a module failed, all on the same navigation step. The heal log makes the cause unambiguous:

\`\`\`json
{
  "action": "click",
  "originalSelector": "getByRole('link', { name: 'Fleet' })",
  "candidates": [
    { "strategy": "role",         "count": 0 },
    { "strategy": "text-exact",   "count": 0 },
    { "strategy": "text-partial", "count": 0 }
  ],
  "succeeded": false
}
\`\`\`

Every strategy returned zero. The string was not on the page in any form — the section had been renamed. Self-healing cannot invent a name that does not exist; it recovers from a moved element, not from a deleted one.

Two details made it worse than a rename:

- the project YAML still carried \`title: "Fleet"\` for the module, so the report labelled the failure with a name nobody in the product would recognise
- the destination was no longer a link at all. It had become a collapsible section header showing a count. Even the correct name would not have satisfied a click.

Ten heal attempts, zero heals, across the whole run. Which is the one piece of good news: no pass in that run was carried by a healed selector.`,
    approach: `This is the locator-priority rule presenting its bill. Visible copy is the most volatile thing on a page — it changes for a product decision, a marketing decision or a translation, none of which anyone tells the test team about. A test id survives all three; \`getByRole('link', { name: 'Fleet' })\` survives none of them.

Concretely:

- Move navigation onto a test id and ask for \`data-testid="nav-<key>"\` per row. Navigation is the single highest-fan-in locator in any suite; it is worth an attribute.
- Give the heal context every handle you have, and one you do not yet have:

\`\`\`ts
readonly agentsNav = this.heal.locator(
  this.page.getByTestId('nav-agents'),
  { role: 'link', name: 'Agents', testId: 'nav-agents', description: 'agents nav entry' },
);
\`\`\`

- Read the heal report before you re-run anything. \`sdods heal report --last\` summarises the original selector, the strategy that won, the score and the suggested locator. Zero heals over ten attempts told the whole story in one command; \`--write-history\` persists \`heal-history.json\` so future runs bias toward strategies that have actually worked on this application.
- Keep \`sdods.project.yaml\` in step. A module \`title:\` that no longer matches the product turns every report into a translation exercise.
- Re-check the scenario's intent, not only its selector. An expandable section header is not a link, so the fix here was not a new name — it was a different interaction.

> [!TIP]
> Before assuming a straight rename, check whether the old name survives behind a feature flag or on another plan tier. Renaming a locator back is a second outage.

\`analyze_locators\` over the MCP server, or the reviewer agent, will find the CSS-only and copy-bound locators in a project before the next rename does.`,
    sketch: `\`\`\`gherkin
@ui @smoke
Scenario: The agents section is reachable from the workspace shell
  Given I use a leased user with role "member"
  When I navigate to the "workspace" page
  And I click the element with test id "nav-agents"
  Then the page URL should contain "/agents"
  And the element with test id "fleet-list" should be visible
\`\`\`

\`\`\`bash
sdods heal report --last
\`\`\`

More on the scoring and the probe order in [self-healing](https://docs.sdods.com/docs/guides/self-healing/).`,
  },

  {
    slug: 'a-brand-colour-below-the-contrast-floor',
    title: 'One design token, eighteen failing nodes, and the landing-page CTA',
    surface: 'Colour contrast across a marketing site and an authenticated application',
    tags: ['a11y', 'ui', 'visual'],
    problem: `Thirty-three of forty accessibility tests failed. That reads like a module in trouble; it was two design tokens.

The brand primary was below the 4.5:1 floor for normal text in every single usage:

- white on the primary, which is the signup call to action on the landing page, at 14px: 2.83:1
- badge text on its own tint: 2.50:1
- link text on a near-white card: 2.78:1

Two muted text steps on the dark hero failed as well, at 4.48:1 and 3.15:1 — one of them marginal enough that it would pass on a rounding change and fail again on the next.

Eighteen failing nodes on the landing page alone, and all eighteen were repetitions of those five combinations across repeated cards. The primary call to action on the highest-traffic page in the product was the worst offender.

The reporting shape is the lesson. Thirty-three failures across five feature files looks like thirty-three defects and gets triaged as a suite problem. Every one of them resolved to a single custom property.`,
    approach: `Be exact about what SDODS gives you here, because it is a floor rather than a verdict.

- \`@a11y\` audits the page a UI scenario ends on with axe-core (WCAG A and AA) and fails on anything at or above \`a11y.failOn\`, which is \`serious\` unless the project says otherwise. The full result is attached as \`sdods/a11y-scenario\`.
- \`the page should have no colour-contrast violations\` isolates the contrast rule, so a token change fails on contrast rather than inside a general violation list. It has a \`within {string}\` form for one region.
- \`gates.a11y\` on a process fails \`sdods run --process\` when an audit found a blocking violation, or when no audit ran at all.

What axe will not do for you is group findings or read your design tokens. That part is still project-local.

What the failure shape teaches, which is the transferable part:

- Report by token, not by node. Eighteen nodes that resolve to one custom property is one fix. Have the step group violations by the resolved colour pair before it reports, and the run tells you there are two problems rather than thirty-three.
- A visual baseline will not catch this. \`the page should match the visual baseline {string}\` compares against a screenshot that was captured with the failing colour in it. It is happy forever. Contrast is a computed property, not a pixel diff — this is one of the clearest cases where \`@visual\` and \`@a11y\` are genuinely different tests.
- Push the check left. A contrast assertion belongs in the design-token pipeline, where a failing pair cannot merge. The suite should be the second line, catching a token used in a combination nobody modelled.
- Root-cause the halves separately. The public surfaces were root-caused to the token; the authenticated and admin surfaces, which were the larger half, had not been. Keyboard order, focus visibility and landmark semantics are separate assertions with separate causes, and folding them into one number hides that.`,
    sketch: `\`\`\`gherkin
@ui @regression @a11y
Scenario: The landing page has no contrast violations
  Given I navigate to the "landing" page
  Then the page should have no colour-contrast violations

@ui @regression @a11y
Scenario: The primary call to action meets the normal-text threshold
  Given I navigate to the "landing" page
  Then the element with test id "hero-cta-signup" should meet a contrast ratio of 4.5
\`\`\`

The first \`Then\` is in \`@sdods/core/steps\`, and the \`@a11y\` tag audits the whole page again at the end of each scenario. The second is project-local: nothing in the shared library asserts a ratio on one element, so write it in your project's steps directory and phrase it in the same style as the shared steps.

Gate on it in CI with a process whose \`gates\` include \`a11y: true\`, and let \`sdods run --process\` fail the run.`,
  },

  {
    slug: 'seo-artefacts-that-describe-another-environment',
    title: 'Staging serving production’s robots.txt, and a sitemap missing the pricing page',
    surface: 'robots.txt, sitemap.xml and canonical hints, per environment',
    tags: ['api', 'smoke', 'config'],
    problem: `Three separate problems, none of which a status-code check can see.

- The employee intranet path was absent from the disallow list while resolving (a 307 to auth, so not an exposure — but the URLs, and any login or error page under them, are crawlable and indexable). Two sibling paths were already disallowed, which makes this an omission rather than a decision.
- The primary acquisition page was missing from a seven-URL sitemap, while a lower-traffic page next to it was listed. Seven URLs is also low for a site with a blog, a templates gallery and a documentation site, so the generator is probably missing more than one page.
- Both files were byte-identical between staging and production. So the staging host named the production host in \`Host:\`, pointed \`Sitemap:\` at the production file, and listed production URLs — handing crawlers production canonical hints from a duplicate, publicly reachable copy of the marketing site. Nothing declared the staging host itself unindexable.

The third one is the interesting one for a test author, because the expected value differs per environment and the assertion the suite currently makes is the production expectation applied to staging.`,
    approach: `These are text artefacts on the browser-facing origin, and you do not need a browser for them.

The API steps accept an absolute URL — anything matching \`^https?://\` is passed straight through instead of being joined to \`api.baseUrl\` — so an \`@api\` scenario can fetch a file from the UI host directly. Put that origin in \`envs/<env>.yaml\` under \`vars:\` and reference it through the template renderer:

\`\`\`yaml
vars:
  uiOrigin: https://\${UI_BASE_URL}
  robotsDisallow: 'Disallow: /'
\`\`\`

Then \`the response should contain {string}\` gives you a raw-body substring assertion, which is exactly the right granularity for a text file.

Two honest limits:

- there is no \`should not contain\` for a body or a header, so "staging must not advertise the production host" needs a project step. \`the response JSON path {string} should match {string}\` will not help — it is JSON only.
- \`@env:<name>\` is validated by lint against \`envs.available\`, so it documents the intent, but do not rely on it to keep a scenario off an environment at runtime. Select environments with \`-e\` and with a tag expression you control.

The design point is bigger than the assertion. Put the expected policy in \`vars:\` per environment and have one scenario read \`{{robotsDisallow}}\`. Then the environment-aware fix — serve \`Disallow: /\` and \`X-Robots-Tag: noindex\` on every non-production host — does not break the test that found the problem. Decide the contract before you write the assertion, or you will write it twice.`,
    sketch: `\`\`\`gherkin
@api @smoke
Scenario: robots.txt states this environment's crawl policy
  Given I use no authentication
  When I send a GET request to "{{uiOrigin}}/robots.txt"
  Then the response status should be 200
  And the response should contain "{{robotsDisallow}}"
  And the response should contain "Disallow: /internal/"

@api @smoke
Scenario: The sitemap lists every acquisition surface
  Given I use no authentication
  When I send a GET request to "{{uiOrigin}}/sitemap.xml"
  Then the response status should be 200
  And the response should contain "{{uiOrigin}}/pricing"
  And the response should contain "{{uiOrigin}}/enterprise"
\`\`\`

The second scenario asserts against \`{{uiOrigin}}\` rather than a literal host, which is what turns "the sitemap has the right pages" and "the sitemap describes the right environment" into one assertion instead of two.`,
  },

  {
    slug: 'an-enforcing-csp-that-allows-unsafe-inline',
    title: 'The strict policy was report-only and the enforced one allowed unsafe-inline',
    surface: 'Content-Security-Policy on an unauthenticated login page',
    tags: ['api', 'smoke'],
    problem: `Two headers came back on the same response, carrying the same policy with one difference:

\`\`\`text
content-security-policy:
  script-src 'self' 'unsafe-inline' https://... ;

content-security-policy-report-only:
  script-src 'nonce-<base64>' 'self' https://... ;
\`\`\`

The enforced policy substituted \`'unsafe-inline'\` exactly where the report-only one carried the nonce. So the nonce is being generated correctly — the plumbing works — it is simply attached to the header nobody enforces. \`'unsafe-inline'\` in \`script-src\` permits any injected inline script or inline handler to execute, which is the whole thing the policy exists to prevent.

This is the shape of a deliberate rollout that was never promoted: ship strict in report-only, collect violations, flip it. The flip did not happen and nothing noticed, because every check anybody had written asked whether a CSP header was present.

The login page is the worst possible place for it. Unauthenticated, handles credentials, and it is the redirect target for every gated route in the product.

Worth recording that the rest of the policy was correct and enforced — \`frame-ancestors\` and \`object-src\` were fine. A header-level pass/fail would have called this green.`,
    approach: `A shared step gets you the positive half:

\`\`\`gherkin
Then the response header "content-security-policy" should contain "'nonce-"
\`\`\`

Name the header exactly. \`content-security-policy-report-only\` is a different header, and an assertion phrased loosely enough to match either one passes on the observed-and-ignored policy — which is precisely the failure being tested for.

The half that matters has no shared step. There is no negative header assertion in the library, so "the enforcing policy must not contain \`'unsafe-inline'\`" is a project step. Write it; do not settle for the positive assertion alone, because the positive one would have gone green the moment somebody added a nonce alongside \`'unsafe-inline'\`, which changes nothing about the security posture.

Two more design notes:

- Headers arrive on every response, so this is an \`@api\` scenario at \`@smoke\`. There is no reason to start a browser to read a header, and a security-headers module that runs in seconds gets run.
- Assert per surface, not once. The policy can differ by route, and the unauthenticated pages are the ones that matter most. An outline over the public routes costs one table.

> [!NOTE]
> Verified on one environment only. Policies commonly differ per environment, and a security assertion that has only ever run against staging is a claim about staging. Run the module against each environment you care about before you report the finding as fixed.`,
    sketch: `\`\`\`gherkin
@api @smoke @data-driven
Scenario Outline: The enforcing policy is nonce-based on every public page
  Given I use no authentication
  When I send a GET request to "{{uiOrigin}}<path>"
  Then the response status should be 200
  And the response header "content-security-policy" should contain "'nonce-"
  And the response header "content-security-policy" should contain "frame-ancestors 'self'"
  And the enforcing content security policy should not allow "'unsafe-inline'"

  Examples:
    | path    |
    | /login  |
    | /signup |
    | /       |
\`\`\`

The last \`Then\` is a project step. Everything above it is the shared library; that one line is yours to write, and it is the line that would have caught this.`,
  },

  {
    slug: 'a-module-that-cannot-run-without-a-password',
    title: 'A gated documentation site, and a variable no tooling knew about',
    surface: 'A password-gated static documentation build that an entire module drives',
    tags: ['config', 'data', 'cli', 'ci'],
    problem: `Every scenario in the module failed on staging, with a message the step itself had written:

\`\`\`text
Error: this docs build is password-gated and DOCS_GATE_PASSWORD is not set — export it
\`\`\`

The failure screenshot showed the gate: "This documentation is private. Enter the password to continue."

The variable was read directly by a project step. It was absent from \`.env.example\`, which the repository states is the contract for what an operator must supply. It was absent from the \`env:\` blocks of both CI workflows. And \`sdods doctor\` passed clean.

That last one is the finding. Doctor's variables check resolves every \`\${VAR}\` reference declared under \`envs/<env>.yaml\` \`vars:\` against the \`.env\` files and the shell. A variable that only a step reads is not in that set, so doctor reported a fully configured workspace for an environment where a whole module could not run. An operator who followed the setup instructions exactly ended up red.

It is a small bug with a general shape: configuration that bypasses the configuration system is invisible to the tools that check configuration.`,
    approach: `The fix is one line of YAML and it generalises.

Declare the variable in the environment file, so it enters the set doctor knows about:

\`\`\`yaml
vars:
  docsGatePassword: \${DOCS_GATE_PASSWORD}
\`\`\`

Then read it in the step through the template renderer rather than from \`process.env\`. Every \`{string}\` argument and every doc string is rendered, and variables resolve in order: values captured with \`I save the response JSON path ... as ...\`, then the current dataset row, then \`vars:\` from the environment file. \`\${VAR}\` references are resolved earlier, by configuration. Secrets stay references; they are never literals in a feature file or a YAML.

Now \`sdods doctor -p <slug>\` reports it missing instead of passing, and the same variable name goes into the workflow \`env:\` blocks as a repository secret.

The second half is a testing question rather than a configuration one. There was no scenario proving the gate works. A gate that nothing asserts is a gate nobody knows is closed. Two scenarios, and the more valuable one needs no secret at all:

- the gate refuses without a password — runnable by anyone, on any machine, with nothing configured
- the gate opens with the right password — the one that needs the secret, and the one that should skip cleanly when it is absent rather than failing the module

> [!TIP]
> This is the general rule worth taking away: any value a test needs should be declared where \`sdods doctor\` can see it. If a step reaches around the environment file for something, the first symptom will be a green doctor over a red module, and that combination costs more to diagnose than either failure alone.`,
    sketch: `\`\`\`gherkin
@ui @sanity
Scenario: The documentation gate refuses an empty password
  Given I navigate to the "docs" page
  Then I should see the text "This documentation is private"
  And the "Unlock" button should be visible

@ui @smoke
Scenario: The documentation gate opens for the deploy password
  Given I navigate to the "docs" page
  When I fill the "Password" field with "{{docsGatePassword}}"
  And I click the "Unlock" button
  Then I should not see the text "This documentation is private"
  And the element with test id "docs-sidebar" should be visible
\`\`\`

\`\`\`bash
sdods doctor -p <slug> --json
\`\`\`

Once the variable is declared under \`vars:\`, that command is the thing that tells a new operator what to export — which is what \`.env.example\` was trying to be, and what doctor can actually enforce.`,
  },

  {
    slug: 'coverage-that-counts-what-was-never-built',
    title: 'A green coverage guard over nine feature files that do not exist',
    surface: 'A coverage manifest, a CI guard, and the gap between planned and delivered',
    tags: ['cli', 'ci', 'reporting'],
    problem: `The guard ran in CI, printed the drift in its own output, and exited zero:

\`\`\`text
coverage: 87/87 modules implemented · 269 feature file(s) · 1608 scenario(s) on disk · 1640 planned
✅ every feature file belongs to a declared module.
\`\`\`

It asserted one direction — every file on disk belongs to a declared module — and never the reverse. Nine planned feature files, thirty-eight scenarios, were never written. The numbers needed to fail were already computed and on the screen.

Two of the nine mattered far more than the rest.

The suite never completed a purchase. Thirteen checkout scenarios existed and every one stopped at the session URL. Nothing proved that a payment completes, that a subscription row is written, that entitlements change, or that the upgrade prompt goes away. For a product whose revenue path is a hosted checkout, that is the single most important scenario in the repository and it was planned, counted and never built.

The deny direction of a catalogue was dropped. "What must NOT be offered" was a planned file; what shipped was a generated positive-direction outline over what is offered. Those are not substitutes, and the deny half is the half that catches a gate failing open.

Three files on disk were absent from the manifest, consistent with a consolidation nobody recorded — which is the deeper problem. A planned file that was deliberately merged and a planned file nobody wrote look identical in a directory listing.`,
    approach: `\`sdods coverage\` measures a plan, which is the thing a file-count guard structurally cannot do.

\`\`\`bash
sdods coverage -p <slug> -e staging --routes --endpoints --roles --uncovered
\`\`\`

It joins three declared things — the routes in \`sdods.project.yaml\` and its modules, each module's \`endpoints:\` (and, with \`--openapi\`, the paths of the spec named by \`env.api.openapi\`) and the pool \`roles:\` — against the scenarios that reference them, split by suite tag. \`--uncovered\` names what nothing touches, and it exits \`1\` when a module has no covered target.

![The sdods coverage table, showing declared routes and endpoints against the scenarios that reference them](/questions/coverage.png "sdods coverage joins the plan to the scenarios, not the files to the modules")

So declare the target first. A route that exists in the module and in no scenario becomes a red build, not a line of output nobody reads. That inverts the guard's direction for free, and it does it against the product's own surface rather than against a hand-written manifest that drifts.

Around that:

- record a consolidation as a consolidation. A per-file status — implemented, consolidated into another path, or dropped with a reason — is what separates a decision from an omission.
- make the guard fail on the drift it already prints. It computed 269 against 1,640; the only missing part was an exit code.
- keep the deny direction as its own file. If it is folded into a generated positive outline it will not come back.

One honest framework note on the checkout gap: there is no iframe step in the shared library, so a card field rendered inside a payment iframe is not reachable from Gherkin today. \`BasePage\` exposes \`frame(name)\`, so a project step in a page object can reach it — but the shared library will not do it for you, and pretending otherwise is how a planned file stays planned.`,
    sketch: `\`\`\`bash
sdods coverage -p <slug> -e staging --uncovered
sdods features list -p <slug> --scenarios
\`\`\`

\`\`\`gherkin
@hybrid @regression
Scenario: A completed purchase writes the subscription and lifts the gate
  Given I use a leased user with role "purchaser"
  When I seed via POST "/billing/checkout" with body:
    """json
    { "plan": "starter", "workspaceId": "{{purchaserWorkspaceId}}" }
    """
  And I save the response JSON path "sessionUrl" as "checkoutUrl"
  And I complete the hosted checkout with the test card
  When I poll GET "/billing?workspaceId={{purchaserWorkspaceId}}" until JSON path "plan" equals "starter" within 60 seconds
  Then the response JSON path "isPaid" should equal "true"
  When I navigate to the "workspace" page
  Then I should not see the text "Upgrade to create more"
\`\`\`

\`I complete the hosted checkout with the test card\` is a project step wrapping \`BasePage.frame()\`. Everything else on that scenario is the shared library, including the poll — which is the right way to wait for a webhook to land, and the reason this reads as \`@hybrid\` rather than as two disconnected tests.`,
  },

  {
    slug: 'scenarios-that-never-run',
    title: 'A suite where one scenario in eight was dark, and the report said otherwise',
    surface: 'Parked scenarios: the ones the runner skips and the ones every recipe excludes',
    tags: ['lint', 'cli', 'regression'],
    problem: `207 of 1,609 scenarios never executed. All 1,609 were reported as coverage.

Two mechanisms, and only one of them is visible.

\`@quarantine\` — 120 scenarios — is an ordinary tag, excluded by hand in each run recipe's tag expression. Clumsy and drift-prone, but at least an operator reading the expression can see it.

\`@fixme\` — 87 scenarios — is not visible at all. It matches the runner's special-tag pattern:

\`\`\`js
export const RUNNER_SPECIAL_TAGS =
  /^@(only|skip|fixme|fail|slow|timeout:\\d+|retries:\\d+|mode:(parallel|serial|default))$/;
\`\`\`

Lint deliberately skips validating anything that matches, which is correct behaviour and not a lint hole — but it means \`sdods lint\` reports no findings over 87 uses of a tag that is not declared anywhere in the project. The runner turns each one into a skipped test no matter what tag expression is passed. Adding \`and not @fixme\` changes nothing. Passing \`@fixme\` cannot bring them back. They are unreachable without editing the feature files, and the run summary does not distinguish "deliberately parked" from "not selected".

Where they sat made it worse. Half the parked \`@fixme\` scenarios were in two modules, one of them described in the project YAML as a security surface. Forty-six of the quarantined ones were in the authorisation and multi-tenancy modules — the deny direction, which is the half that matters.

And there was no record anywhere of why any of the 207 were parked, or what would un-park them.`,
    approach: `Make the parked set observable through one mechanism, then count the runnable set rather than the written one.

One mechanism. \`@quarantine\` is an ordinary project tag: declare it under \`tags.extra\` in \`sdods.project.yaml\` and it stops raising an unknown-tag warning, appears in tag expressions, and is selectable through \`sdods features list --tags\`. Converting the \`@fixme\` scenarios to it trades an invisible exclusion for a visible one. That is a real improvement even though it fixes nothing about the coverage — an operator can now see the dark slice.

Count what runs.

\`\`\`bash
sdods run -p <slug> -e staging -t @regression --list
sdods features list -p <slug> --scenarios
\`\`\`

\`--list\` prints the run targets and the tests that would run, then stops. Diff it against the scenario inventory and the difference is your dark slice. That number belongs in the headline, next to the total, not underneath it.

Require a reason. A parked scenario with no linked issue and no comment is indistinguishable from an abandoned one six months later. \`@jira:PROJ-123\` and \`@github:123\` are pattern-checked value tags — use one, so the park has an owner and an exit condition.

Two honest notes:

- quarantine is not enforced by the runner. The exclusion lives in each \`processes:\` recipe's \`tags:\` expression and is maintained by hand, which is exactly why it drifts between recipes.
- the underlying rule is the same one that makes a vacuous assertion worthless, one level up: a scenario that cannot fail is not coverage, and a scenario that never runs cannot fail.

> [!WARNING]
> Do not park the deny direction. Quarantining a flaky positive scenario costs you a little confidence. Quarantining nineteen authorisation scenarios costs you the assertion that the gate is closed, and nothing in the report will tell you that is what happened.`,
    sketch: `\`\`\`gherkin
@ui @regression @quarantine @jira:QA-1184
Scenario: A viewer cannot promote themselves to owner
  Given I use a leased user with role "viewer"
  When I navigate to the "members" page
  Then the element with test id "member-permission-{{viewerId}}" should contain "Viewer"
\`\`\`

Parked, and parked legibly: \`@quarantine\` puts it in every tag expression that mentions it, and \`@jira:QA-1184\` says who owns getting it back. Declare \`quarantine\` under \`tags.extra\` first, or lint warns on every use.

\`\`\`bash
sdods lint -p <slug>
sdods run -p <slug> -e staging -t "@regression and not @quarantine" --list
\`\`\`

The tag rules those scenarios still have to satisfy — exactly one layer tag, exactly one suite tag — are in [tags and suites](https://docs.sdods.com/docs/guides/tags-and-suites/).`,
  },
];
