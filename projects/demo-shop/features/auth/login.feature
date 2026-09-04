@ui @auth
Feature: Login
  As a shopper I want to sign in so that I can see the inventory.

  Background:
    Given I am on the login page

  @smoke @har:login
  Scenario: Successful login shows the products
    When I login with "standard_user" and "{{standardPassword}}"
    Then I should be on the inventory page
    And the inventory title should be "Products"

  @regression
  Scenario Outline: Failed login shows a clear error
    When I login with "<username>" and "<password>"
    Then I should see the login error "<error>"

    # title-format: <username> → <error>
    Examples:
      | username        | password     | error                                                                     |
      | locked_out_user | secret_sauce | Epic sadface: Sorry, this user has been locked out.                       |
      | standard_user   | wrong        | Epic sadface: Username and password do not match any user in this service |
      |                 | secret_sauce | Epic sadface: Username is required                                        |
      | standard_user   |              | Epic sadface: Password is required                                        |

  @regression
  Scenario: Generic UI steps work against the login form
    When I fill the element with test id "username" with "standard_user"
    And I fill the element with test id "password" with "{{standardPassword}}"
    And I click the element with test id "login-button"
    Then the page URL should contain "/inventory.html"
