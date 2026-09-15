@ui @cart @perf
Feature: Cart performance
  The @perf tag records the vitals of every document the scenario loads and judges them against
  perf.budgets (pageLoadMs and lcpMs from the project, pageLoadMs overridden in envs/staging.yaml).

  # WebKit does not implement largest-contentful-paint, and a vital a budget applies to that never
  # fired fails the scenario rather than passing it, so this runs on Chromium and Firefox only.
  @regression @skip:webkit
  Scenario: The login and cart pages load within their budgets
    Given I am on the login page
    When I login with "standard_user" and "{{standardPassword}}"
    And I add "{{defaultProduct}}" to the cart
    And I navigate to the "cart" page
    Then the cart should list "{{defaultProduct}}"
