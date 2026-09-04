@api @search
Feature: Search API
  Generated reachability checks: every known endpoint of the search module answers (any non-5xx status).

  @smoke
  Scenario: GET /search responds
    When I send a GET request to "/search"
    Then the response status should be one of "200,201,204,301,302,400,401,403,404,405"
    And the response time should be under 5000 ms
