@ui @workspaces @roles
Feature: Organization, workspaces and roles
  One organization holds many workspaces; every user sees only the workspaces they can access,
  with the effective role (workspace membership or the role implied by the organization role).

  @smoke @user:admin
  Scenario: The org owner sees every workspace as admin
    Given I open the "workspaces" page
    Then I should see the text "Workspaces of SDODS"
    And the sidebar should list workspace "default" with role "admin"
    And the sidebar should list workspace "platform-qa" with role "admin"

  @regression
  Scenario: A workspace member sees only their workspace with their role
    Given I am on the SDODS sign-in page
    When I sign in as "vera" with password "{{memberPassword}}"
    Then the sidebar should list workspace "platform-qa" with role "viewer"
    And the sidebar should not list workspace "default"

  @regression
  Scenario: A viewer cannot start runs
    Given I am on the SDODS sign-in page
    When I sign in as "vera" with password "{{memberPassword}}"
    And I select workspace "platform-qa"
    And I open the "runs" page
    Then the start run button should not be available
