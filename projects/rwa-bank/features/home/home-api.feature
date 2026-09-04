@api @home
Feature: Home API
  Generated reachability checks: every known endpoint of the home module answers (any non-5xx status).

  @smoke
  Scenario: GET / responds
    When I send a GET request to "/"
    Then the response status should be one of "200,201,204,301,302,400,401,403,404,405"
    And the response time should be under 5000 ms

  @smoke
  Scenario: GET /{entity} responds
    When I send a GET request to "/1"
    Then the response status should be one of "200,201,204,301,302,400,401,403,404,405"
    And the response time should be under 5000 ms

  @smoke
  Scenario: GET /{username} responds
    When I send a GET request to "/1"
    Then the response status should be one of "200,201,204,301,302,400,401,403,404,405"
    And the response time should be under 5000 ms
