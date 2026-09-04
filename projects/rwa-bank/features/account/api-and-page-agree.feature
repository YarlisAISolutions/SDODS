@hybrid @account
Feature: The API and the page agree
  What the API returns for a customer is what their pages show, checked in one scenario.

  @regression @user:standard
  Scenario: The name the API returns is the name the account overview shows
    When I send a GET request to "/users/profile/Heath93"
    Then the response status should be 200
    Given I am on the account overview
    Then the UI should show the text from JSON path "user.firstName"
    And the account overview should belong to "Heath93"
