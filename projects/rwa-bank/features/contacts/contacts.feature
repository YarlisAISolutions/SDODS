@ui @contacts
Feature: Contacts pages
  Generated smoke checks, then corrected: this route is behind the sign-in form, so the
  scenario leases a pool user and starts from cached login state.

  @smoke @user:standard
  Scenario: The contacts page loads
    Given I navigate to the "contacts" page
    Then the page URL should contain "/contacts"
