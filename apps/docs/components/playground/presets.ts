/**
 * The scenarios the playground ships with.
 *
 * Each one starts from a business rule someone at the fictional Demo Shop actually cares about,
 * then shows the scenario that proves it and the command that runs it for real. The Gherkin uses
 * the same step phrasings as the feature files in `projects/demo-shop/features/`, so a reader who
 * likes what they ran can paste those lines into their own project and have them resolve.
 */
import type { StepLayer } from './steps';

export type PresetId = 'api-read' | 'api-chain' | 'ui-login' | 'ui-cart' | 'hybrid-seed';

export interface Preset {
  id: PresetId;
  layer: StepLayer;
  /** The tab the panel opens on. */
  panel: 'browser' | 'network';
  title: string;
  /** Who wants this and why — the business use case in one sentence. */
  story: string;
  /** What "done" means to the person who asked for it. */
  acceptance: string[];
  /** The line the tutor opens with. */
  intro: string;
  command: string;
  gherkin: string;
}

const PRESETS: Record<PresetId, Preset> = {
  'api-read': {
    id: 'api-read',
    layer: 'api',
    panel: 'network',
    title: 'The catalog service answers a product lookup',
    story:
      'Nadia runs the Friday release at Demo Shop. Before she ships, she wants proof that the catalog service still returns a product by id, in the shape the storefront expects, fast enough that the page does not stall.',
    acceptance: [
      'Asking for a known product returns 200, not a redirect or an error page.',
      'The record carries the id that was asked for and a non-empty title.',
      'The shape matches the contract the storefront was built against.',
      'The answer arrives inside the two-second budget on the product page.',
    ],
    intro:
      'Hi — I am Maxi. Nadia needs four facts before she ships. Press Run scenario and watch each one turn green. The request really leaves your browser: this sandbox stands in for Demo Shop’s catalog service.',
    command: 'sdods run -p demo-shop -e staging -l api -t @smoke',
    gherkin: `@api @smoke
Feature: Catalog service
  Scenario: Read a single product
    When I send a GET request to "/posts/1"
    Then the response status should be 200
    And the response JSON path "id" should equal "1"
    And the response JSON path "title" should match ".+"
    And the response should match the JSON schema "post"
    And the response time should be under 2000 ms
`,
  },
  'api-chain': {
    id: 'api-chain',
    layer: 'api',
    panel: 'network',
    title: 'A listing created through the API can be read back',
    story:
      'Raj, who runs support, keeps getting tickets that say “I created a listing and it vanished”. He wants one scenario that creates a listing and immediately asks for it by the id the service handed back.',
    acceptance: [
      'Creating a listing returns 201 with a server-assigned id.',
      'The id flows into the next request without anyone copying it by hand.',
      'The read-back is asserted honestly — this public sandbox never stores what you post.',
    ],
    intro:
      'Two calls, one scenario. Watch the id the create returns get saved as a variable and reused in the next line. The read-back is where it gets interesting — stay for the last step.',
    command: 'sdods run -p demo-shop -e staging -l api -t @regression',
    gherkin: `@api @regression
Feature: Catalog service
  Scenario: Create a listing and chain its id
    Given I set the variable "title" to "SDODS created this"
    When I send a POST request to "/posts" with body:
      """json
      { "title": "{{title}}", "body": "hello from SDODS", "userId": 1 }
      """
    Then the response status should be 201
    And the response JSON path "title" should equal "{{title}}"
    When I save the response JSON path "id" as "postId"
    And I send a GET request to "/posts/{{postId}}"
    Then the response status should be one of "200, 404"
`,
  },
  'ui-login': {
    id: 'ui-login',
    layer: 'ui',
    panel: 'browser',
    title: 'A shopper can sign in',
    story:
      'Sign-in is the door to the whole store. If it breaks, nothing else matters, so Demo Shop runs this one on every pull request, on all three browsers.',
    acceptance: [
      'A known shopper reaches the products page.',
      'The browser really lands on /inventory.html, not a half-loaded login screen.',
      'The check is fast enough to sit in front of every merge.',
    ],
    intro:
      'This panel is a stand-in for the storefront, with the same ids and data-test attributes as the real one. Press Run scenario and watch the steps type, click and land on the products page.',
    command: 'sdods run -p demo-shop -e staging -l ui -b chromium -t @smoke',
    gherkin: `@ui @smoke
Feature: Login
  Scenario: A standard shopper signs in
    Given I am on the login page
    When I login with "standard_user" and "{{standardPassword}}"
    Then the page URL should contain "/inventory.html"
    And the inventory title should be "Products"
`,
  },
  'ui-cart': {
    id: 'ui-cart',
    layer: 'ui',
    panel: 'browser',
    title: 'Adding a product updates the cart',
    story:
      'The cart badge is the shop’s promise that it heard you. Nadia wants it proven end to end: add a product on the listing page, and find that product in the cart.',
    acceptance: [
      'Adding a product raises the badge to exactly one item.',
      'The cart page lists the product that was added, by name.',
      'The scenario cleans up after itself: it starts from a signed-out browser every time.',
    ],
    intro:
      'Same storefront, a longer flow. Try editing the product name in the scenario — "Sauce Labs Bike Light" works, "Sauce Labs Hoodie" does not, and the failure message tells you why.',
    command: 'sdods run -p demo-shop -e staging -l ui -b chromium -t @regression',
    gherkin: `@ui @regression
Feature: Cart
  Scenario: A product added on the listing page appears in the cart
    Given I am on the login page
    When I login with "standard_user" and "{{standardPassword}}"
    And I add "{{defaultProduct}}" to the cart
    Then the cart badge should show 1 item
    When I open the cart
    Then the cart should list "{{defaultProduct}}"
`,
  },
  'hybrid-seed': {
    id: 'hybrid-seed',
    layer: 'hybrid',
    panel: 'browser',
    title: 'What the API stores is what the page shows',
    story:
      'A merchandiser renames a listing and the storefront keeps showing the old title for an hour. Nadia wants a scenario that creates a listing over HTTP and then proves the page renders that exact title — no clicking through a form to get there.',
    acceptance: [
      'The scenario starts already signed in, using an account leased from the pool.',
      'The listing is created over HTTP, in one step, not through the UI.',
      'The page is asserted against the value the API returned, not a hard-coded string.',
    ],
    intro:
      'This is the one frameworks usually cannot do: one scenario, one set of fixtures, an HTTP call and a browser assertion that share their variables. Watch the value travel.',
    command: 'sdods run -p demo-shop -e staging -l hybrid -b chromium',
    gherkin: `@hybrid @regression
Feature: Seed through the API, verify in the browser
  Scenario: A listing created through the API is rendered by the UI
    Given I use a leased user with role "standard"
    When I seed via POST "/posts" with body:
      """json
      { "title": "SDODS hybrid {{username}}", "body": "seeded", "userId": 1 }
      """
    Then the response status should be 201
    When I save the response JSON path "title" as "title"
    And I mock "**/inventory.html" with HTML:
      """
      <main><h1>{{title}}</h1><p>rendered from the seeded API response</p></main>
      """
    And I navigate to the "inventory" page
    Then the UI should show the text from JSON path "title"
`,
  },
};

export function getPreset(id: PresetId): Preset {
  return PRESETS[id];
}

/** Variables the environment file supplies before a scenario starts. */
export const ENV_VARS: Record<string, string> = {
  standardPassword: 'secret_sauce',
  defaultProduct: 'Sauce Labs Backpack',
};
