@ui @cart
Feature: Cart
  Adding products and reviewing them in the cart.

  Background:
    Given I am on the login page
    And I login with "standard_user" and "{{standardPassword}}"

  @smoke
  Scenario: A product added on the inventory page appears in the cart
    When I add "Sauce Labs Backpack" to the cart
    And I open the cart
    Then the cart should list "Sauce Labs Backpack"

  @regression
  Scenario: Continue shopping returns to the inventory
    When I open the cart
    And I click the "Continue Shopping" button
    Then I should be on the inventory page

  @regression
  Scenario: Checkout form is reachable from the cart
    When I add "Sauce Labs Bolt T-Shirt" to the cart
    And I open the cart
    And I click the "Checkout" button
    Then the page URL should contain "/checkout-step-one.html"
    When I fill the form:
      | field           | value |
      | First Name      | Auto  |
      | Last Name       | Max   |
      | Zip/Postal Code | 12345 |
    And I click the "Continue" button
    Then the page URL should contain "/checkout-step-two.html"
