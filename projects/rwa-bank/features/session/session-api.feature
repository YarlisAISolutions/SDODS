@api @session
Feature: Session API
  The same sign-in the browser performs, without a browser.

  @regression
  Scenario: Signing in returns the customer
    When I send a POST request to "/login" with body:
      """
      { "username": "Heath93", "password": "{{rwaPassword}}" }
      """
    Then the response status should be 200
    And the response time should be under 2000 ms
    And the response JSON path "user.username" should equal "Heath93"
    And the response JSON path "user.balance" should exist

  @regression @har:profile
  Scenario: A public profile exposes a name and nothing else
    When I send a GET request to "/users/profile/Heath93"
    Then the response status should be 200
    And the response JSON path "user.firstName" should equal "Ted"
    And the response JSON path "user.avatar" should exist

  @regression
  Scenario: Rejected credentials do not create a session
    When I send a POST request to "/login" with body:
      """
      { "username": "Heath93", "password": "wrong" }
      """
    Then the response status should be 401
