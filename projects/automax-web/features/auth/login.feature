@ui @auth
Feature: Sign in to AutoMax
  The platform admin signs in and lands in the shell with the organization and its workspaces.

  Background:
    Given I am on the AutoMax sign-in page

  @smoke
  Scenario: The admin signs in and sees the organization and workspaces with roles
    When I sign in as "admin" with password "{{adminPassword}}"
    Then the organization selector should show "{{orgName}}"
    And the sidebar should list workspace "default" with role "admin"
    And the sidebar should list workspace "platform-qa" with role "admin"

  @regression
  Scenario: A wrong password is rejected with a clear message
    When I sign in as "admin" with password "definitely-wrong"
    Then I should see the sign-in error "Invalid"
    And the page URL should contain "/login"

  @regression
  Scenario: Signing out returns to the sign-in page
    When I sign in as "admin" with password "{{adminPassword}}"
    And I sign out
    Then the page URL should contain "/login"
