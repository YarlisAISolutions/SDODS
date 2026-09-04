@ui @personal
Feature: Personal pages
  Generated smoke checks, then corrected: this route is behind the sign-in form, so the
  scenario leases a pool user and starts from cached login state.

  @smoke @user:standard
  Scenario: The personal page loads
    Given I navigate to the "personal" page
    Then the page URL should contain "/personal"
