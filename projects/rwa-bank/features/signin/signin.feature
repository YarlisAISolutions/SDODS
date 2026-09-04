@ui @signin
Feature: Signin pages
  Generated smoke checks: every known route of the signin module renders.

  @smoke
  Scenario: The signin page loads
    Given I navigate to the "signin" page
    Then the page URL should contain "/signin"
