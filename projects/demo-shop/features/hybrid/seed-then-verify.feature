@hybrid @hybrid-demo
Feature: Seed through the API, verify in the browser
  One scenario, both layers: the API client and the page share the same fixtures and variables.

  @regression
  Scenario: A post created through the API is rendered by the UI
    Given I use a leased user with role "standard"
    When I seed via POST "/posts" with body:
      """json
      { "title": "AutoMax hybrid {{username}}", "body": "seeded", "userId": 1 }
      """
    Then the response status should be 201
    When I save the response JSON path "title" as "title"
    And I mock "**/inventory.html" with HTML:
      """
      <main><h1>{{title}}</h1><p>rendered from the seeded API response</p></main>
      """
    And I navigate to the "inventory" page
    Then the UI should show the text from JSON path "title"

  @regression
  Scenario: API state and UI state in one flow
    When I send a GET request to "/users/1"
    Then the response status should be 200
    When I save the response JSON path "username" as "apiUser"
    Given I am on the login page
    When I fill the element with test id "username" with "{{apiUser}}"
    Then the element with test id "username" should be visible
