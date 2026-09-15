@ui @inventory @a11y
Feature: Inventory accessibility
  The @a11y tag audits the page each scenario ends on with axe (WCAG 2.x A and AA) and fails on
  anything at or above a11y.failOn (serious by default). SauceDemo's login, inventory and cart
  pages have no WCAG A/AA violation axe can detect, so nothing is scoped out with include/exclude.

  @regression
  Scenario: The inventory page has no serious accessibility violations
    Given I am on the login page
    When I login with "standard_user" and "{{standardPassword}}"
    Then I should be on the inventory page
    And there should be 6 products listed
