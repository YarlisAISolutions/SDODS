import type { Thread } from '../types';

export const pagesThreads: Thread[] = [
  {
    slug: 'po-where-do-page-objects-live',
    title: 'Where is a page object supposed to live? Mine is never picked up',
    askedBy: 'mkuiper',
    askedOn: '2020-09-29',
    tags: ['page-objects', 'ui'],
    votes: 26,
    views: 9640,
    body: `I put my page object in \`projects/demo-shop/support/pages/LoginPage.ts\` because that is how our
old framework was laid out. It compiles, the decorators are on the methods, and the class is
exported. Every scenario that uses it still fails as an undefined step.

\`\`\`bash
sdods lint -p demo-shop
\`\`\`

Is there a fixed folder for this, or a config key that tells the runner where to look?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2020-09-29',
        votes: 34,
        body: `The folder is fixed, and \`support/\` is not one of them. Per project the runner globs exactly
three things for step definitions: the core step library inside the package, \`steps/**/*.ts\` and
\`pages/**/*.ts\` under the project root. A decorated class anywhere else is never loaded, so the
steps it declares do not exist as far as generation is concerned.

\`\`\`text
projects/demo-shop/
  sdods.project.yaml
  envs/<env>.yaml
  features/<module>/*.feature
  pages/*.ts            <- page objects, nested as deep as you like
  steps/fixtures.ts     <- the project test object
  steps/auth.ts
\`\`\`

Move \`LoginPage.ts\` to \`projects/demo-shop/pages/\` and lint again. There is no key to add another
directory, and that is on purpose — the generated specs have to import from one predictable place.

[Page objects with decorators](https://docs.sdods.com/docs/guides/page-objects/)`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2020-09-30',
        votes: 15,
        body: `Adding to that: depth under \`pages/\` is free, the glob is recursive, so
\`pages/checkout/CartPage.ts\` is fine.

The second half people miss is registration. \`@Fixture<typeof test>('loginPage')\` names a fixture,
and if \`steps/fixtures.ts\` does not declare one with that exact name there is nothing to bind the
decorated methods to.

\`\`\`ts
export const test = base.extend<{ loginPage: LoginPage }>({
  auth: [auth, { scope: 'worker', option: true }],
  loginPage: async ({ pages }, use) => use(pages.get(LoginPage)),
});
\`\`\``,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-selenium-page-factory-to-decorators',
    title: 'Coming from Selenium PageFactory — what replaces @FindBy and initElements?',
    askedBy: 'dperera',
    askedOn: '2020-12-03',
    tags: ['page-objects', 'locators', 'ui'],
    votes: 44,
    views: 16320,
    body: `We have a Java suite, maybe 300 tests, built the way everyone built them: a \`BasePage\` holding the
driver and the waits, \`@FindBy(xpath = "//div[@class='cart']//button")\` fields, and
\`PageFactory.initElements(driver, this)\` in every constructor. Glue code in a separate package maps
Cucumber steps onto those page methods.

I am trying to work out what the equivalent shape is here before I start, because I do not want to
port the mistakes as well. Specifically: what constructs the page object, where do the waits go, and
does the glue layer survive?`,
    answers: [
      {
        id: 'a1',
        by: 'avery-hollis',
        on: '2020-12-04',
        votes: 51,
        body: `Did exactly this move over about four months. The mapping that held up:

- \`@FindBy(...)\` field becomes a readonly field built with \`this.heal.locator(primary, context)\`, where the primary is the locator you believe in and the context is what the healer may fall back to.
- \`PageFactory.initElements(driver, this)\` becomes nothing at all. \`pages.get(LoginPage)\` constructs the class lazily with the scenario's page, the resolved config and the healer, and caches one instance per class per scenario.
- The driver in your base class becomes \`BasePage\`, which gives you \`page\`, \`goto(routeName)\`, \`heal\` and \`shots\`, plus popup, frame, upload and download helpers.
- Explicit waits mostly disappear, because Playwright auto-waits and the assertions retry.
- The glue package disappears too, and this is the part that felt strange for a week: the step text sits on the method as a decorator, so the page object and the step definition are one file.

\`\`\`ts
@Fixture<typeof test>('cartPage')
export class CartPage extends BasePage {
  readonly checkout = this.heal.locator(this.page.getByRole('button', { name: 'Checkout' }), {
    role: 'button',
    name: 'Checkout',
    testId: 'checkout',
    description: 'checkout button',
  });

  @Given('I am on the cart page')
  async open() {
    await this.goto('cart');
  }

  @When('I check out')
  async checkOut() {
    await this.checkout.click();
  }
}
\`\`\`

The one thing I would not port is the XPath. Translate those fields to role and name while you have
the page open in front of you; you will never have a better moment to do it.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2020-12-07',
        votes: 22,
        body: `Agreeing with the above and adding the bit that decides how much value you get out of the move.

Every heal context needs a \`description\`. It is the label in reports and the key the fragility
statistics are aggregated under, so a context without one is a locator SDODS cannot say anything
useful about later.

> [!WARNING]
> Contexts that match several elements are worse than no context. \`text: 'Add'\` on a product grid
> lowers the score and can resolve to the wrong element.`,
      },
      {
        id: 'a3',
        by: 'mkuiper',
        on: '2020-12-15',
        votes: 9,
        body: `One ordering suggestion from doing a smaller version of this: port the base class last.

It is tempting to start there because it is shared, but you end up designing an abstraction for
pages you have not converted yet. Convert two modules end to end with everything inline, then look
at what actually repeats. In my case about half of what our old base class did was already in
\`BasePage\`, and a third of the rest was waits I no longer needed.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-undefined-step-checkout-page',
    title:
      'lint says Undefined step: Given I am on the checkout page, but the method is right there',
    askedBy: 'hsu-wei-lin',
    askedOn: '2021-03-16',
    tags: ['page-objects', 'lint', 'ui'],
    votes: 30,
    views: 11870,
    body: `\`\`\`bash
sdods lint -p demo-shop
\`\`\`

\`\`\`text
Undefined step: Given I am on the checkout page
\`\`\`

The class has it:

\`\`\`ts
@Given('I am on the checkout page')
async open() {
  await this.goto('checkout');
}
\`\`\`

Spelling matches character for character, I diffed it. The file is \`pages/CheckoutPage.ts\`. What
else is there to check?`,
    answers: [
      {
        id: 'a1',
        by: 'rgarrido',
        on: '2021-03-16',
        votes: 38,
        body: `Two causes, and the file location rules out the first one for you.

1. The file is not under \`pages/**/*.ts\` or \`steps/**/*.ts\`. Yours is, so skip it.
2. The class is not registered as a fixture. \`@Fixture<typeof test>('checkoutPage')\` names a fixture in \`steps/fixtures.ts\`, and if that name is not in the extend call — or is spelled \`checkoutPageObject\`, which is what bit me — the decorated methods have nothing to attach to and generation reports them as missing.

\`\`\`ts
export const test = base.extend<{ checkoutPage: CheckoutPage }>({
  checkoutPage: async ({ pages }, use) => use(pages.get(CheckoutPage)),
});
\`\`\`

Separately, and I would fix this before the other thing: that step probably should not exist. The
shared library already ships \`I navigate to the "checkout" page\`, which resolves the route name from
\`sdods.project.yaml\` and does the same navigation. Check before you write:

\`\`\`bash
sdods steps list -p demo-shop --grep checkout
\`\`\`

Keep the page object for the parts of checkout that are actually yours.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2021-03-17',
        votes: 17,
        body: `For context on where the message comes from: \`sdods lint\` runs generation with missing steps set
to fail, then parses the block it prints. So the finding is reported against the feature file and
line that used the step, not against the page object — which is why the location in the output looks
unhelpful when the real problem is in \`steps/fixtures.ts\`.

[sdods lint](https://docs.sdods.com/docs/reference/cli-commands/lint/)`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-shared-library-or-project-step',
    title: "When should a step go in the shared library instead of my project's steps folder?",
    askedBy: 'kmoreau',
    askedOn: '2021-08-05',
    tags: ['page-objects', 'ui', 'cli'],
    votes: 18,
    views: 6240,
    body: `Reviewing a colleague's proposal and we disagreed twice in one file, so I would like a rule rather
than a preference.

They wrote \`When I add the extended warranty to the basket\` as a project step, and
\`When I click the row action "Delete"\` also as a project step. The second one feels like something
every project would want. Where is the line?`,
    answers: [
      {
        id: 'a1',
        by: 'rgarrido',
        on: '2021-08-06',
        votes: 21,
        body: `The line I use: a shared step is true of any web application. Navigate to a route, click a control
by role and name, fill a field by its label, send a request, assert a status. None of them know what
your product sells.

Anything that names your domain belongs to the project, and it belongs on a page-object method
rather than in a loose steps file, because the awkward locator and the step text want to live
together. So the warranty one is right where it is.

The row action one is a shared step wearing a project hat. It already exists, more or less:

\`\`\`gherkin
When I click the "Delete" button
When I click the element with test id "row-delete"
\`\`\`

Before writing either, look:

\`\`\`bash
sdods steps list -p demo-shop --grep row
\`\`\``,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2021-08-11',
        votes: 12,
        body: `There is also a practical constraint. The shared library ships inside the core package and is
globbed from there, so you cannot add to it from a project even if you want to. A genuinely generic
phrasing has to go upstream; until it does, a project step in the same phrasing style is the
correct thing to write.

Worth running periodically on any project older than a few months:

\`\`\`bash
sdods steps list -p demo-shop --unused
\`\`\`

Steps nobody calls are the tell that the vocabulary drifted.`,
      },
    ],
  },

  {
    slug: 'po-unknown-route-checkuot',
    title: 'Unknown route "checkuot" for project demo-shop — where does that list come from?',
    askedBy: 'gcastellano',
    askedOn: '2022-02-16',
    tags: ['page-objects', 'config', 'ui'],
    votes: 12,
    views: 4980,
    body: `New page object, first run, immediate failure:

\`\`\`text
Unknown route "checkuot" for project demo-shop.
Known routes: login, inventory, cart, checkout. Add it under routes: in sdods.project.yaml or pass a path starting with "/".
\`\`\`

The call is \`await this.goto('checkuot')\`. I do not remember declaring routes anywhere, so where is
that list of four coming from and who put it there?`,
    answers: [
      {
        id: 'a1',
        by: 'rgarrido',
        on: '2022-02-16',
        votes: 19,
        body: `Read the two strings next to each other: \`checkuot\` and \`checkout\`. It is a typo, and the hint is
already telling you the correct spelling.

The list comes from \`routes:\` in \`projects/demo-shop/sdods.project.yaml\` — a map of route name to
path. \`goto()\` takes a route name, or a path starting with \`/\`, or a full URL; anything else that is
not a declared name raises exactly that error.

\`\`\`yaml
routes:
  login: /
  inventory: /inventory.html
  cart: /cart.html
  checkout: /checkout-step-one.html
\`\`\`

Use the name rather than the path in page objects. When the application moves checkout to a new URL
it is one line here instead of a search across every page object, and the same names drive
\`I navigate to the "checkout" page\` and the coverage report.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-component-on-six-pages',
    title: 'A header widget appears on six pages — one page object per page, or something else?',
    askedBy: 'nadia-belkacem',
    askedOn: '2022-05-11',
    tags: ['page-objects', 'ui', 'locators'],
    votes: 27,
    views: 9210,
    body: `Our header carries the cart badge, the account menu and a search box, and it is on six pages. Right
now the cart badge locator is copy-pasted into six page objects, which was fine until the badge got
a new test id and I had to fix it six times.

Splitting it out is obvious. What is not obvious is what the split looks like when the steps are
decorators on classes that are registered per page.`,
    answers: [
      {
        id: 'a1',
        by: 'rgarrido',
        on: '2022-05-12',
        votes: 33,
        body: `Nothing says a page object has to correspond to a URL. Give the header its own class, register it
as its own fixture, and put the header steps on it. They then work in any scenario regardless of
which page is open, because the fixture only needs the page.

\`\`\`ts
@Fixture<typeof test>('header')
export class HeaderComponent extends BasePage {
  readonly cartBadge = this.heal.locator(this.page.getByTestId('shopping-cart-badge'), {
    testId: 'shopping-cart-badge',
    description: 'cart badge',
  });

  @Then('the cart should show {int} item(s)')
  async cartCount(n: number) {
    await this.cartBadge.expectText(String(n));
  }
}
\`\`\`

\`\`\`ts
export const test = base.extend<{ header: HeaderComponent; cartPage: CartPage }>({
  header: async ({ pages }, use) => use(pages.get(HeaderComponent)),
  cartPage: async ({ pages }, use) => use(pages.get(CartPage)),
});
\`\`\`

The class has no route of its own and never calls \`goto\`, which is the signal to a reader that it is
a component and not a page.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2022-05-12',
        votes: 16,
        body: `One reason to do it this way beyond the obvious deduplication: the \`description\` in a heal context
is the key the fragility statistics are grouped under. Six copies of the same locator with six
slightly different descriptions give you six thin rows in the heal report instead of one row that
says clearly that the cart badge changed.

\`\`\`bash
sdods heal report --last
\`\`\``,
      },
      {
        id: 'a3',
        by: 'gcastellano',
        on: '2022-05-20',
        votes: 7,
        body: `Second approach, for the case where you do not want the component to own any step text: make it a
plain class that takes the page and the healer, and expose it as a field from the page objects that
need it.

\`\`\`ts
export class Header {
  constructor(
    private readonly page: Page,
    private readonly heal: Healer,
  ) {}

  get cartBadge() {
    return this.heal.locator(this.page.getByTestId('shopping-cart-badge'), {
      testId: 'shopping-cart-badge',
      description: 'cart badge',
    });
  }
}
\`\`\`

A getter rather than a field, because a field initialiser runs before the constructor assigns
\`heal\`. Page objects get away with writing fields only because \`BasePage\` has already assigned it by
the time the subclass initialises.

Then \`readonly header = new Header(this.page, this.heal)\` inside each page object. Locators shared,
steps still owned by the page they read best on. I use the fixture version when the steps are
genuinely global and this one when they are not.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-asserting-on-a-table-row',
    title: 'How do you assert on a row in a table without writing a CSS chain?',
    askedBy: 'sunita-kale',
    askedOn: '2022-09-27',
    tags: ['page-objects', 'locators', 'ui'],
    votes: 23,
    views: 8120,
    body: `Orders table, and the scenario I want reads:

\`\`\`gherkin
Then order "1042" should show status "Shipped"
\`\`\`

What I have in the page object is this, which works until someone sorts the table or the row moves
to page two:

\`\`\`ts
this.page.locator('tbody tr:nth-child(3) td:nth-child(4)');
\`\`\`

Is there a table-aware step I have missed, or is this a page-object job?`,
    answers: [
      {
        id: 'a1',
        by: 'rgarrido',
        on: '2022-09-28',
        votes: 26,
        body: `Page-object job, and the fix is to stop addressing the row by position and start addressing it by
what is in it.

\`\`\`ts
@Fixture<typeof test>('ordersPage')
export class OrdersPage extends BasePage {
  row(order: string) {
    return this.page.getByRole('row', { name: new RegExp(order) });
  }

  @Then('order {string} should show status {string}')
  async status(order: string, status: string) {
    await expect(this.row(this.render(order)).getByRole('cell', { name: status })).toBeVisible();
  }
}
\`\`\`

\`nth-child\` encodes the sort order of the table into your test, so the test fails when the sort
changes and passes when the wrong row happens to land in position three. The row helper is worth
having as a method because you will want it again for actions inside the row.

\`this.render()\` is there so \`order "{{orderId}}"\` works when the id came from an earlier API step.`,
      },
      {
        id: 'a2',
        by: 'lena-hartwig',
        on: '2022-10-04',
        votes: 11,
        body: `One thing not to do here, which I learned the slow way: do not wrap the row locator in a heal
context.

A heal context is supposed to identify one element, and \`text: '1042'\` in a table matches the row,
the cell and probably a total somewhere. Ambiguity lowers the score and the healer can resolve to
the wrong element, which in a table means a green test asserting on the wrong order.

Heal the container and the controls around it; keep the row addressing plain.

[Locator strategy](https://docs.sdods.com/docs/best-practices/locator-strategy/)`,
      },
    ],
  },

  {
    slug: 'po-cypress-custom-commands-and-cy-get',
    title: 'Inherited 900 Cypress specs: what maps to what, and what happens to custom commands?',
    askedBy: 'ade-oyinlola',
    askedOn: '2023-09-12',
    tags: ['page-objects', 'locators', 'ui', 'cli'],
    votes: 49,
    views: 19480,
    body: `I have inherited a Cypress suite. Roughly 900 specs, \`data-cy\` attributes throughout, about 60
custom commands in \`cypress/support/commands.js\`, and a \`cypress/fixtures\` folder nobody has audited
in two years.

Management has agreed to a migration but not to a rewrite, so I need an order of operations more
than I need a philosophy. What does \`cy.get\` become, what happens to custom commands, and what do I
do with the fixtures and the intercepts?`,
    answers: [
      {
        id: 'a1',
        by: 'chandra-p',
        on: '2023-09-13',
        votes: 57,
        body: `I moved a suite of about that size. Here is the mapping that survived contact.

- \`cy.visit('/checkout')\` becomes \`this.goto('checkout')\`, once the path is a named route in \`sdods.project.yaml\`.
- \`cy.get('[data-cy=submit]')\` becomes \`this.page.getByTestId('submit')\`, provided \`testIdAttribute: data-cy\` is set. Keep the attribute; renaming it in the application is a separate project and not this one.
- \`cy.contains('Shipped')\` becomes \`getByText\`, or better \`getByRole('cell', { name: 'Shipped' })\`.
- Custom commands split three ways: some already exist in the shared step library, some become decorated page-object methods, and a surprising number turn out to be dead.
- \`cy.intercept\` with a fixture becomes the mock step or a recorded HAR file.
- \`cypress/fixtures\` becomes datasets under \`data/\`.

Order that worked:

1. \`sdods analyze <app dir>\` first. It counts the test-id attribute in the source rather than guessing it, inventories the existing specs and reports how many of your locators are CSS. Cypress specs are inventoried rather than copied, so nothing is imported behind your back.
2. Apply the proposal, fix the two or three guesses it could not make — base URLs are the usual one — and get the generated health features green.
3. Migrate one module at a time, and do not start with the biggest.
4. Run coverage after each module so the remaining work is a number rather than a feeling.

Two modules in, \`features list\` is how I reported progress:

![Terminal output of sdods features list showing one row per feature with its module, name and scenario count](/questions/features-list.png "features list after the first two modules were ported")

\`\`\`bash
sdods features list -p rwa-bank
sdods coverage -p rwa-bank --routes --uncovered
\`\`\`

[Migrating from Playwright, Cypress and Cucumber](https://docs.sdods.com/docs/guides/migrating/)`,
      },
      {
        id: 'a2',
        by: 'rgarrido',
        on: '2023-09-13',
        votes: 24,
        body: `The trap in a migration this size is porting the 60 custom commands one to one. You end up with 60
steps, of which 12 are used everywhere and the rest are used once each by the spec they were written
for.

Port a command only when a feature file needs it, and check for an existing phrasing first. Then
after the first few modules:

\`\`\`bash
sdods steps list -p rwa-bank --unused
\`\`\`

Anything that comes back is something you carried across for nothing.`,
      },
      {
        id: 'a3',
        by: 'priya-venkatesh',
        on: '2023-09-14',
        votes: 18,
        body: `Two process notes, since you said order of operations.

Tag as you go, not afterwards. Every scenario needs exactly one layer tag and exactly one suite tag,
and lint refuses without them; \`sdods lint --fix-tags\` handles the obvious cases from the folder
layout, but it cannot decide that a flow is smoke rather than regression.

Keep the old suite running in CI until the module that replaces it is green. A migration where both
suites are red for six weeks is a migration that gets cancelled.`,
      },
      {
        id: 'a4',
        by: 'thom-vasseur',
        on: '2023-10-02',
        votes: 8,
        body: `Slightly late, but one thing to expect emotionally: the long \`cy.get(...).parent().contains(...)\`
chains have no direct translation, and people take that badly for about a week.

They are not missing. Those chains exist because there was no stable way to name the element, and
naming the element is the thing you are being asked to do now. Every one I unpicked turned into a
\`getByRole\` with a name, and about a third of them exposed a genuine accessibility gap in the
application, which our frontend team was less pleased about than I was.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-how-deep-should-page-objects-nest',
    title: 'How deep should page objects nest? We are four levels in and it hurts',
    askedBy: 'renata-kohl',
    askedOn: '2023-04-20',
    tags: ['page-objects', 'ui'],
    votes: 22,
    views: 7340,
    body: `Our hierarchy is \`BasePage\` to \`AuthenticatedPage\` to \`DashboardPage\` to \`ReportsPage\`, and there
is talk of a fifth level for the two report variants.

Nobody can say where a locator lives without opening four files. Is there a recommended depth, and
does the folder layout under \`pages/\` matter to the runner at all?`,
    answers: [
      {
        id: 'a1',
        by: 'rgarrido',
        on: '2023-04-21',
        votes: 28,
        body: `Recommended depth is one: your class extends \`BasePage\` and stops.

Everything you are using inheritance for is better done with composition. A component class held as
a field gives you the same reuse without the "where is this locator actually defined" problem, and
it composes in more than one direction — a header can appear on pages that have nothing else in
common.

\`AuthenticatedPage\` in particular is usually a smell. Being signed in is not a property of a page,
it is a property of the scenario, and the scenario says it with \`@user:standard\` and the cached
storage state that comes with it.

One class per meaningful surface. When two surfaces share three locators, extract a component, not
a superclass.`,
      },
      {
        id: 'a2',
        by: 'tomas-brekke',
        on: '2023-04-21',
        votes: 14,
        body: `On the folder question: it does not matter. The glob is \`pages/**/*.ts\`, so organise the directory
however reads best — by module is what most projects settle on. Folder depth is free; class depth is
not.

Keep the decorated steps on the class you register as a fixture. Spreading step decorators across a
class hierarchy makes it much harder to answer the only question that matters when generation fails,
which is which fixture a given step is bound to.`,
      },
      {
        id: 'a3',
        by: 'avery-hollis',
        on: '2023-04-27',
        votes: 11,
        body: `We arrived here with a five-deep hierarchy ported straight out of a Selenium suite and flattened it
over a couple of months. Nothing was lost. Two of the intermediate classes turned out to hold one
method each, and one held only waits that were no longer needed.

The flattening pass is also a good moment to notice which locators nobody references any more.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-page-object-needs-logged-in-session',
    title: 'My page object needs a signed-in session before goto() — where does the login belong?',
    askedBy: 'helle-borg',
    askedOn: '2023-11-08',
    tags: ['page-objects', 'ui', 'smoke', 'pool'],
    votes: 25,
    views: 8570,
    body: `Every one of our scenarios opens with the same three steps: go to login, fill two fields, submit.
Then the real scenario starts.

It is slow — about four seconds a scenario across roughly 200 scenarios — and it is the single
biggest source of flakiness we have, because a failure in the login form fails everything. I have
been tempted to put the login inside the page object's \`open()\` method, which feels wrong. What is
the intended shape?`,
    answers: [
      {
        id: 'a1',
        by: 'yusuf-demir',
        on: '2023-11-08',
        votes: 31,
        body: `It is wrong, and you do not need it. Do not sign in through the UI at all except in the scenarios
that are about signing in.

Tag the scenario with a role and the browser context starts with that user's cached storage state
already applied, so the first line of the scenario is the thing you actually want to test:

\`\`\`gherkin
@ui @smoke @user:standard
Scenario: The checkout page shows the basket
  Given I am on the checkout page
  Then I should see the text "Your cart"
\`\`\`

Capture the state once per user:

\`\`\`bash
sdods auth capture -p demo-shop -e staging --user standard
sdods auth list -p demo-shop -e staging
\`\`\`

It writes \`projects/demo-shop/.auth/staging/standard-0.json\`, indexed by the pool position, and the
strategy that produces it is declared in the project file:

\`\`\`yaml
auth:
  strategy: form
  storageState: true
  maxAgeMinutes: 120
  form:
    loginPath: /
    usernameSelector: '#user-name'
    passwordSelector: '#password'
    submitSelector: '#login-button'
    readyUrl: /inventory.html
\`\`\`

Your page object then only does \`await this.goto('checkout')\`, which is all it should ever have
done. Keep exactly one scenario that drives the login form itself, otherwise you lose coverage of
the door.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2023-11-09',
        votes: 16,
        body: `Two details that catch people out with this.

\`storageState: true\` has to be set, otherwise the fixture returns nothing and the context starts
anonymous with no error — the scenario just redirects to the login page and the failure looks like
an application bug.

\`maxAgeMinutes\` matters more than it looks. Cached \`form\` and \`token\` state is recaptured once it is
older than that, so a short session lifetime in the application under test wants a short value here
rather than a nightly manual capture.

The \`api\` layer skips storage state entirely, which is why an API-only run does not need any of
this.

[Auth strategies and storage state](https://docs.sdods.com/docs/guides/auth-and-storage-state/)`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-share-a-page-object-across-projects',
    title: 'Can two projects share one page object, or do we copy the file and live with it?',
    askedBy: 'nikhil-sane',
    askedOn: '2024-03-05',
    tags: ['page-objects', 'config', 'ui'],
    votes: 20,
    views: 6710,
    body: `We run two projects against the same design system: same header, same login form, same data grid,
different products around them. The login page object is now duplicated in
\`projects/storefront/pages/\` and \`projects/admin/pages/\`, and they have already drifted.

Is there a supported way to share the class, something at the workspace level maybe, or is copying
the intended answer?`,
    answers: [
      {
        id: 'a1',
        by: 'rgarrido',
        on: '2024-03-06',
        votes: 26,
        body: `There is no supported mechanism, and two things stand in the way of an obvious one.

The step glob per project is the core library plus that project's own \`steps/**/*.ts\` and
\`pages/**/*.ts\`. A class living in a package elsewhere in the monorepo is simply never loaded, so
its decorators do nothing. And \`@Fixture<typeof test>('loginPage')\` binds to the \`test\` exported from
that project's \`steps/fixtures.ts\` — a different project has a different \`test\` with a different
fixture map. Workspace defaults in \`sdods.workspace.yaml\` cover browsers, suites and the test-id
attribute; they do not cover code.

What we do, and what I have seen elsewhere: split the class in two.

\`\`\`ts
// packages/design-system-pages/src/LoginSurface.ts — no decorators, no @Fixture
export class LoginSurface extends BasePage {
  readonly username = this.heal.locator(this.page.getByLabel('Username'), {
    label: 'Username',
    testId: 'username',
    description: 'username input',
  });

  async signIn(user: string, password: string) {
    await this.username.fill(user);
  }
}
\`\`\`

\`\`\`ts
// projects/storefront/pages/LoginPage.ts — thin, decorated, project-owned
@Fixture<typeof test>('loginPage')
export class LoginPage extends LoginSurface {
  @Given('I am on the login page')
  async open() {
    await this.goto('login');
  }
}
\`\`\`

The locators are shared; the route names, the fixture registration and the step text stay with the
project that owns them.`,
      },
      {
        id: 'a2',
        by: 'reeta-nandal',
        on: '2024-03-08',
        votes: 13,
        body: `That is the right shape, with one caution about how far to take it.

Two projects that look like they share a page usually differ in exactly the places that matter: the
route path, the test-id attribute, whether a field is required. Sharing the locators is cheap.
Sharing the step text is where it goes wrong, because \`Given I am on the login page\` then means two
different things depending on which project the feature file is under, and the person reading a
failure has no way to tell which.

Share the surface. Let each project spell out its own Gherkin.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-chain-api-id-into-a-ui-assertion',
    title:
      'Chaining a created id into a UI assertion: JSON path $.id is undefined in the last response',
    askedBy: 'bea-lindqvist',
    askedOn: '2024-06-13',
    tags: ['hybrid', 'api', 'page-objects'],
    votes: 29,
    views: 10140,
    body: `Trying to seed through the API and assert in the browser, which is the whole reason we picked this
thing.

\`\`\`gherkin
@hybrid @regression
Scenario: A seeded order appears in the list
  When I seed via POST "/orders" with body:
    """json
    { "sku": "SD-1", "qty": 2 }
    """
  And I save the response JSON path "id" as "orderId"
  And I navigate to the "orders" page
  Then order "{{orderId}}" should show status "Pending"
\`\`\`

\`\`\`text
JSON path $.id is undefined in the last response; cannot save as {{orderId}}.
\`\`\`

The endpoint definitely returns an id, I checked with curl.`,
    answers: [
      {
        id: 'a1',
        by: 'fiona-mcallister',
        on: '2024-06-13',
        votes: 32,
        body: `The save step reads the last response, and it is telling you that the last response did not have an
\`id\` at the top level. Two usual causes:

The body is wrapped. A lot of APIs answer a create with \`{ "data": { "id": 41 } }\`, and curl makes
that easy to skim past. Then the path is \`data.id\`:

\`\`\`gherkin
And I save the response JSON path "data.id" as "orderId"
\`\`\`

Or something ran in between. Any step that issues a request replaces the last response, so a save
that is not immediately after the request it refers to may be reading a different one.

Do not guess which — read what actually came back. Every request attaches its exchange to the
scenario, and the files are in the run directory:

\`\`\`text
.sdods/runs/<runId>/<slug>/<fingerprint>/r0/api/NN-n-response.json
\`\`\`

Open that and the path is obvious in about ten seconds.`,
      },
      {
        id: 'a2',
        by: 'rgarrido',
        on: '2024-06-14',
        votes: 17,
        body: `Once the save works, the UI half. \`{{orderId}}\` is rendered in every \`{string}\` argument and doc
string, so your \`Then\` line is fine as written.

Inside the page object it is not automatic — you render it yourself:

\`\`\`ts
@Then('order {string} should show status {string}')
async status(order: string, status: string) {
  const id = this.render(order);
  await expect(this.page.getByTestId(\`order-\${id}\`).getByText(status)).toBeVisible();
}
\`\`\`

\`this.vars\` is the merged view: values saved in this scenario over the dataset row over \`vars\` from
the environment file, in that order. \`this.render()\` expands against it.`,
      },
      {
        id: 'a3',
        by: 'yusuf-demir',
        on: '2024-06-20',
        votes: 9,
        body: `For the simple case there is a shared step that skips the page object entirely:

\`\`\`gherkin
Then the UI should show the text from JSON path "sku"
\`\`\`

Worth knowing why any of this works at all: there is one merged fixture set, so the API client, the
page, the healer and the data provider are all fixtures on the same \`test\`. Frameworks that keep a
separate test object per layer cannot express this scenario without writing glue.

[A hybrid scenario](https://docs.sdods.com/docs/getting-started/hybrid-scenario/)`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-two-roles-in-one-scenario',
    title:
      'An admin approves what a standard user submitted — how do two roles fit in one scenario?',
    askedBy: 'anouk-devries',
    askedOn: '2024-10-02',
    tags: ['page-objects', 'pool', 'hybrid'],
    votes: 17,
    views: 5820,
    body: `The flow we need to cover: a standard user submits an expense claim, an admin approves it, and the
standard user sees it move to approved.

\`@user:standard\` gives me one role. I cannot see how to get a second one without splitting this into
two scenarios that depend on each other, which the tagging policy tells me not to do. What is the
intended way?`,
    answers: [
      {
        id: 'a1',
        by: 'yusuf-demir',
        on: '2024-10-04',
        votes: 21,
        body: `Give the browser one role and the second role the API.

\`\`\`gherkin
@hybrid @regression @user:standard
Scenario: An admin approves a submitted claim
  Given I am on the claims page
  When I submit a claim for "48.20"
  And I use a leased user with role "admin" for API calls
  And I send a POST request to "/claims/{{claimId}}/approve"
  Then the response status should be 200
  And the claim "{{claimId}}" should show status "Approved"
\`\`\`

The \`for API calls\` variant of the leased-user step leases an admin and leaves the browser context
alone, so the page keeps the standard user's session. It is in the core data steps. One caveat: it
only puts a bearer token on the API client when your auth strategy exposes one, or when
\`sdods auth capture\` already wrote one for that user. Otherwise it says so in the log and the
request goes out with the environment credential, which is usually not the admin you wanted.

That is not a workaround, incidentally — the approval is a state change, and driving it over HTTP is
faster and less brittle than driving a second person's UI. What you are testing in the browser is
that the standard user sees the result.

If you genuinely need two simultaneous browser sessions — a chat, a live-updating board — that is a
project step opening its own context, and you give up the cached storage state for the second one.
Worth being sure you need it first.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-check-whether-a-step-already-exists',
    title: 'How do I check whether a step already exists before I write another one?',
    askedBy: 'sergio-alcaraz',
    askedOn: '2025-02-11',
    tags: ['page-objects', 'cli', 'lint'],
    votes: 24,
    views: 7910,
    body: `Third proposal in a row bounced with "this step already exists in a different phrasing". Fair enough,
but I am clearly missing whatever everyone else is looking at, because I did search the repository
for the phrase before writing it.

What is the actual way to see everything a project can already say?`,
    answers: [
      {
        id: 'a1',
        by: 'rgarrido',
        on: '2025-02-11',
        votes: 27,
        body: `Grepping the repository will not find them, because most of what a project can say ships in the
core library rather than in your project folder. Ask the project instead:

\`\`\`bash
sdods steps list -p demo-shop
\`\`\`

\`\`\`bash
sdods steps list -p demo-shop --grep cart
\`\`\`

That is the shared library plus your project steps plus your decorated page-object methods, as the
generator sees them. It is also exactly what the editor's step catalogue is built from, which is the
version I use day to day because it sits next to the file I am editing:

![The SDODS feature editor with a login feature open and the step catalogue panel on the right listing the steps the project can use](/questions/ui-feature-editor.png "the step catalogue is the same list steps list prints")

Two more that help when the phrasing exists but you cannot remember where:

\`\`\`bash
sdods features list -p demo-shop --scenarios
\`\`\`

\`\`\`bash
sdods steps list -p demo-shop --unused
\`\`\``,
      },
      {
        id: 'a2',
        by: 'chandra-p',
        on: '2025-02-12',
        votes: 15,
        body: `Running \`steps list --grep\` before writing anything was the single practice that kept our migration
from producing a step per spec. We came out with a vocabulary of about a dozen project steps on top
of the shared ones, which is roughly what a person can hold in their head.

When nothing fits and you do have to add one, copy the phrasing style of its nearest neighbour.
\`I click the "Delete" button\` and \`When I press Delete\` doing the same thing is how a step list
becomes unsearchable.`,
      },
      {
        id: 'a3',
        by: 'fiona-mcallister',
        on: '2025-02-18',
        votes: 8,
        body: `If you are driving this through an agent rather than by hand, the same catalogue is exposed over
MCP as \`step_list\` and \`step_find\`, and \`feature_list\` for the features side. Worth wiring up,
because an agent that cannot see the existing vocabulary invents a new one every time.

[The MCP server](https://docs.sdods.com/docs/guides/mcp/)`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-is-xpath-actually-forbidden',
    title: 'Is XPath actually forbidden in a page object, or only discouraged?',
    askedBy: 'koen-vermeulen',
    askedOn: '2025-06-04',
    tags: ['locators', 'page-objects', 'heal', 'ui'],
    votes: 22,
    views: 7060,
    body: `Reviewer left "never XPath" on my proposal. The locator strategy page says CSS or XPath as a last
resort inside a page object with a heal context, which reads like "allowed but grudgingly".

The element in question is a legacy table cell with no role, no test id and no stable class, and the
only thing that identifies it is its position relative to a label. Which is it?`,
    answers: [
      {
        id: 'a1',
        by: 'tomas-brekke',
        on: '2025-06-04',
        votes: 25,
        body: `Both, and the difference is worth understanding rather than arguing about.

The order of preference is role and accessible name, then label, placeholder and text, then test id,
then CSS. XPath sits below all of it. What makes it worse than CSS here is not aesthetics: the heal
context supports \`description\`, \`role\`, \`name\`, \`testId\`, \`label\`, \`placeholder\`, \`text\`, \`title\`,
\`altText\` and \`css\`. There is no XPath field. So when your XPath stops matching, the healer can only
try what you wrote in the context — and if you were able to write a decent context, you were able to
write a better primary locator in the first place.

For your legacy cell, the position-relative-to-a-label problem has a direct answer:

\`\`\`ts
readonly total = this.heal.locator(
  this.page.getByRole('row', { name: 'Order total' }).getByRole('cell').last(),
  { description: 'order total cell' },
);
\`\`\`

If even that is impossible, use CSS, give it a real \`description\`, and open a ticket against the
application. To find out how much of this you are carrying, run \`analyze_locators\` over the project
through the MCP server, or point the reviewer agent at it — both report CSS-only locators and
strict-mode risks.`,
      },
      {
        id: 'a2',
        by: 'avery-hollis',
        on: '2025-06-09',
        votes: 12,
        body: `Speaking as someone who wrote XPath for years: the \`//div[contains(@class, 'row')][3]//span\` chains
were the first thing to break in every redesign we ever survived, and they broke silently, matching
something plausible instead of nothing.

The reviewer is saving you a bad afternoon in about eight months.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-cucumber-world-object-replacement',
    title: 'Migrating a Cucumber suite: what replaces the World object we keep scenario state in?',
    askedBy: 'rasha-halabi',
    askedOn: '2025-09-16',
    tags: ['page-objects', 'hybrid', 'api'],
    votes: 16,
    views: 5290,
    body: `Our Cucumber suite keeps everything on the World: the id of the record the last step created, the
current user, a couple of counters, and a response object that three later steps read.

Feature files copy across fine and the tags lint clean. The step definitions are where I am stuck,
because half of them are \`this.something = ...\` and there is no \`this\` to put it on.`,
    answers: [
      {
        id: 'a1',
        by: 'chandra-p',
        on: '2025-09-17',
        votes: 19,
        body: `There is no World, and most of what you were keeping on it has a home already.

Values captured from a response become scenario variables:

\`\`\`gherkin
When I save the response JSON path "id" as "orderId"
And I send a GET request to "/orders/{{orderId}}"
\`\`\`

Every \`{string}\` argument and doc string is rendered before the step runs, and the variables resolve
in order: values saved in this scenario, then the current dataset row, then \`vars\` from the
environment file. So the counters and the id stop being state you manage and become values you name.

The current user is not yours to track either — \`@user:standard\` or the leased-user step sets
\`username\`, \`password\`, \`userId\` and \`role\` as variables, and applies the storage state.

The response object needs nothing: the assertion steps already read the last response.

What is genuinely left — a piece of object state two steps on the same page share — lives on the
page object instance. \`pages.get(Class)\` caches one instance per class per scenario, so a field you
set in a \`When\` is there in the \`Then\`, and it is thrown away when the scenario ends. Read variables
from inside the class with \`this.vars\` and \`this.render()\`.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-one-fixture-set-and-worker-scope',
    title:
      'Why one fixture set for ui, api and hybrid, and which of the fixtures are worker-scoped?',
    askedBy: 'ingrid-solberg',
    askedOn: '2026-03-10',
    tags: ['page-objects', 'hybrid', 'api'],
    votes: 13,
    views: 3980,
    body: `Reading \`steps/fixtures.ts\` in the project I inherited and trying to work out what I am extending.

Two things I cannot find a straight answer to. Why is there one \`test\` rather than one per layer,
given an API scenario has no browser? And which fixtures are per worker rather than per scenario — I
want to know what a page object is allowed to assume is already resolved when it is constructed.`,
    answers: [
      {
        id: 'a1',
        by: 'reeta-nandal',
        on: '2026-03-10',
        votes: 18,
        body: `One \`test\` because a hybrid scenario needs both halves at once. Seeding over HTTP and asserting in
the browser inside a single scenario is only expressible if the API client and the page are fixtures
on the same test object; split them per layer and you are back to writing glue between two runners.
An API scenario simply never touches the page fixture, which costs nothing because fixtures are
lazy.

Worker-scoped, resolved once per worker process:

- \`sdods\` — the project and layer selection
- \`registry\` and \`config\` — the discovered projects and the resolved configuration
- \`env\`, \`runDir\`, \`harMode\`
- \`auth\` — the strategy, overridable per project
- \`db\`, \`userPool\`, \`authCache\`, \`healHistory\`

Per scenario: \`scenario\`, \`apiContext\`, \`api\`, \`data\`, \`user\`, \`storageState\`, \`heal\`, \`pages\`,
\`shots\`.

So a page object may assume the configuration and the healer are ready, and must not assume anything
about another scenario, because \`pages\` is per scenario.

You extend the same object in \`steps/fixtures.ts\`, and generation imports the test from there, which
is why that file path is not negotiable.`,
      },
      {
        id: 'a2',
        by: 'fiona-mcallister',
        on: '2026-03-14',
        votes: 9,
        body: `The practical consequence of \`pages\` being per scenario, since it surprises people:

\`pages.get(Class)\` caches one instance per class per scenario. Two steps in the same scenario get
the same page object, so a field set in the first is visible in the second. Two scenarios never
share one, even in the same worker, so nothing you set leaks sideways.

Also: your page-object fixtures have to end up on the \`test\` that \`steps/fixtures.ts\` exports.
Chaining \`extend\` is fine, but a second \`test\` built from a different base gives you a fixture the
generated specs cannot see, and the symptom is an undefined step rather than anything that mentions
fixtures.`,
      },
    ],
    acceptedAnswerId: 'a1',
  },

  {
    slug: 'po-page-object-for-a-multi-step-wizard',
    title: 'One page object for a five-step wizard, or five? The URL never changes',
    askedBy: 'zeynep-arslan',
    askedOn: '2026-07-14',
    tags: ['page-objects', 'ui'],
    votes: 2,
    views: 61,
    body: `Onboarding wizard, five panels, and the URL stays \`/onboarding\` the whole way through — the panel is
swapped client-side and there is no route to address for steps two to five.

Two shapes I can see. One class with methods per panel, which gets long and where half the locators
are invalid at any given moment. Or five classes, four of which have no route and cannot implement a
meaningful \`open()\`, so a scenario that starts at panel four has to walk through the first three
anyway.

Is there a third option I am not seeing, and does \`goto\` have anything to say about a surface that
is not addressable?`,
    answers: [],
  },
];
