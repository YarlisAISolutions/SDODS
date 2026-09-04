@ui @signup
Feature: Signup pages
  Generated smoke checks: every known route of the signup module renders.

  @smoke
  Scenario: The signup page loads
    Given I navigate to the "signup" page
    Then the page URL should contain "/signup"
