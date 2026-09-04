/**
 * What Maxi says.
 *
 * A line is chosen from the step that just ran, so the tutor explains the thing on screen rather
 * than a script written in advance. Steps can carry their own `teach` line when the point is
 * specific to that moment; everything else falls back to the table here, keyed by the step
 * phrasing so an edited scenario is still narrated.
 */

const PASS_LINES: Array<[RegExp, string]> = [
  [
    /^I send a .* request to/,
    'The request left your browser and the exchange is attached to the step — that attachment is what makes a failed API test debuggable at 2am.',
  ],
  [
    /^the response status should be one of/,
    'Two acceptable answers, stated on purpose. This public sandbox pretends to create records but never stores them, so the read-back is a 404 — and the scenario says so instead of pretending otherwise.',
  ],
  [
    /^the response status should be/,
    'Status first. Almost every confusing API failure turns out to be a status nobody asserted.',
  ],
  [
    /^the response JSON path .* should equal/,
    'A value assertion, not a body comparison. Assert the fields the business cares about and the test survives the next harmless field the API adds.',
  ],
  [
    /^the response JSON path .* should match/,
    'A regular expression where the exact text is not the point — the title changes, the fact that there is one does not.',
  ],
  [
    /^the response should match the JSON schema/,
    'This is the contract check. A field that changes type or disappears fails here, one layer before it reaches the storefront.',
  ],
  [
    /^the response time should be under/,
    'A budget is an assertion. Without it a service that slows from 200 ms to 3 s stays green all the way to production.',
  ],
  [
    /^I save the response JSON path/,
    'Saved. That variable is now readable by every later step, in either layer — this is how the API and the browser stay in the same conversation.',
  ],
  [
    /^I set the variable/,
    'Variables come from the environment file, the dataset row, or a line like this one.',
  ],
  [
    /^I am on the login page/,
    'A page object opened this, using the route name from sdods.project.yaml — not a URL glued into the feature file.',
  ],
  [
    /^I login with/,
    'Three heal-aware locators just did their work: id first, then the label, placeholder and test id that let SDODS find the field again when the id changes.',
  ],
  [
    /^the page URL should contain/,
    'A landing assertion. It is the cheapest way to prove the sign-in really happened rather than the form quietly rejecting you.',
  ],
  [
    /^I add .* to the cart/,
    'The click went through the product’s own test id. Notice the feature file says the product name, and the page object works out the selector.',
  ],
  [
    /^the cart badge should show/,
    'A user-visible fact, asserted the way a shopper would state it — not by reading a class name.',
  ],
  [
    /^the cart should list/,
    'The state survived a page change. That is the part of a cart that actually breaks in production.',
  ],
  [
    /^I use a leased user with role/,
    'The pool handed this worker its own account and the browser started signed in — parallel workers never fight over one login.',
  ],
  [
    /^I seed via/,
    'State set up over HTTP in one step. The browser is only asked to do the thing the scenario is actually about.',
  ],
  [
    /^I mock .* with (HTML|JSON)/,
    'The route is answered from the scenario. It keeps this demo honest against a public sandbox; against your own app you would assert the real page.',
  ],
  [
    /^I navigate to the .* page/,
    'Route names live in the project file, so a path change is one edit, not a find-and-replace across features.',
  ],
  [
    /^the UI should show the text from JSON path/,
    'That is the hybrid payoff: the string came out of an HTTP response and was found in the rendered page, inside one scenario, with one set of fixtures.',
  ],
];

const FAIL_LINES: Array<[RegExp, string]> = [
  [
    /^the response status should be/,
    'A status assertion failed. Open the Request & response tab — the exact exchange is attached, so you can see what the service actually said.',
  ],
  [
    /^the response time should be under/,
    'Over budget. This is the failure that catches a slow release before a customer does; on a shared network it can also just be a bad minute — run it again.',
  ],
  [
    /^I login with/,
    'The storefront refused the sign-in. In a real run the report would carry the screenshot of this exact screen, error banner and all.',
  ],
  [
    /^I add .* to the cart/,
    'The product in the scenario is not one this storefront sells. A locator that cannot be found fails here, and self-healing only helps when the element exists under a different name.',
  ],
];

export function narratePass(pattern: string, detail: string, teach?: string): string {
  if (teach) return teach;
  const found = PASS_LINES.find(([re]) => re.test(pattern));
  return found ? found[1] : `Green: ${detail}.`;
}

export function narrateFail(pattern: string, message: string): string {
  const found = FAIL_LINES.find(([re]) => re.test(pattern));
  return found ? `${found[1]} — ${message}` : message;
}

export function narrateUnknown(text: string): string {
  return `There is no step phrased “${text}”. That is exactly what a run says when a feature file invents a step: reuse an existing phrasing from the list below, or add the step to the library first.`;
}

export function narrateDone(passed: number, failed: number, skipped: number): string {
  if (failed === 0)
    return `${passed} steps passed. That is the whole loop: a business rule someone cares about, written as a scenario, run for real, with the evidence attached — press Reset and change something to see it fail.`;
  return `${passed} passed, ${failed} failed, ${skipped} never ran. A run stops the scenario at the first failure, because everything after it would only tell you about the failure you already have.`;
}

export function narrateLint(messages: string[]): string {
  return `sdods lint would refuse this file: ${messages.join(' ')} Tagging is not decoration — it is how a run selects what to execute.`;
}
