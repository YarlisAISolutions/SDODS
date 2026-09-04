@ui @inventory
Feature: Inventory
  Products page: listing, cart badge and sorting.

  Background:
    Given I am on the login page
    And I login with "standard_user" and "{{standardPassword}}"

  @smoke @har:products
  Scenario: Products are displayed
    Then the inventory title should be "Products"
    And there should be 6 products listed

  @regression
  Scenario: Add a product to the cart
    When I add "{{defaultProduct}}" to the cart
    Then the cart badge should show 1 item

  @regression
  Scenario: Remove a product from the cart
    When I add "Sauce Labs Bike Light" to the cart
    And I remove "Sauce Labs Bike Light" from the cart
    Then the cart badge should be hidden

  @regression
  Scenario: Sort products by price ascending
    When I sort products by "Price (low to high)"
    Then the product prices should be sorted ascending

  @regression
  Scenario: Sort products by name descending
    When I sort products by "Name (Z to A)"
    Then the product names should be sorted descending

  @regression @skip:webkit
  Scenario: Open the menu (browser-specific exclusion example)
    When I click the "Open Menu" button
    Then the "Logout" link should be visible
