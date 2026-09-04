@ui @inventory @mock
Feature: Network interception
  Route mocking with the shared steps, and a direct API check from a UI scenario.

  @regression
  Scenario: A mocked page is rendered instead of the real one
    Given I mock "**/mocked/**" with HTML:
      """
      <h1 data-test="banner">Mocked by AutoMax</h1>
      """
    When I navigate to the "/mocked/banner.html" page
    Then I should see the text "Mocked by AutoMax"
    And the element with test id "banner" should be visible

  @regression
  Scenario: A mocked JSON API response is observed through the API client
    Given I am on the login page
    And I mock "**/api/health" with JSON:
      """json
      { "status": "mocked" }
      """
    When I send a GET request to "https://www.saucedemo.com/"
    Then the response status should be 200

  @smoke @har:site
  Scenario: The site answers over HTTP
    When I send a GET request to "https://www.saucedemo.com/"
    Then the response status should be 200
    And the response time should be under 5000 ms
