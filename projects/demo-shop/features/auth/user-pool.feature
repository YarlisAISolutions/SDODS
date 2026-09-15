@ui @auth @pool
Feature: User pool
  Accounts are leased per scenario from the pool dataset; login state is cached as storageState.

  @sanity @user:standard
  Scenario: A leased standard user starts logged in through cached storage state
    Given I navigate to the "inventory" page
    Then I should be on the inventory page
    And the inventory title should be "Products"

  @sanity
  Scenario: Leasing a user by role inside the scenario
    Given I use a leased user with role "problem"
    And I navigate to the "inventory" page
    Then I should be on the inventory page

  @sanity @user:performance
  Scenario: A second role leases a different account
    Given I navigate to the "inventory" page
    Then I should be on the inventory page
