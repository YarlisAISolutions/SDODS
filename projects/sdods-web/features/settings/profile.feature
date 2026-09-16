@ui @settings
Feature: Account menu and profile
  The account menu at the foot of the sidebar opens the signed-in user's profile, and a saved
  display name replaces the username in the menu.

  @smoke @user:admin
  Scenario: The account menu opens the profile page
    Given I open the "dashboard" page
    When I open the account menu item "Profile"
    Then the page URL should contain "/settings/profile"
    And I should see the text "Member since"

  # Writes to the shared admin account, so it runs in one browser only: parallel browsers would
  # overwrite each other's display name between saving and reading it back.
  @regression @user:admin @skip:firefox @skip:webkit
  Scenario: A saved display name shows in the account menu
    Given I open the "profile" page
    When I set my display name to "Dogfood Admin"
    Then the account menu should show "Dogfood Admin"
    When I set my display name to ""
    Then the account menu should show "admin"
