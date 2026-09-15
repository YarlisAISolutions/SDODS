@ui @inventory @visual
Feature: Inventory visual baseline
  Pixel comparison against a per-browser, per-platform baseline. Review a failure with
  `sdods baselines diff` and accept it with `sdods baselines accept inventory --run <id>`.

  @regression
  Scenario: Inventory page matches its baseline
    Given I am on the login page
    And I login with "standard_user" and "{{standardPassword}}"
    Then I should be on the inventory page
    And the page should match the visual baseline "inventory"
