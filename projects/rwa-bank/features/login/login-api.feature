@api @login
Feature: Login API
  Generated reachability checks: every known endpoint of the login module answers (any non-5xx status).

  @smoke
  Scenario: GET /login responds
    When I send a GET request to "/login"
    Then the response status should be one of "200,201,204,301,302,400,401,403,404,405"
    And the response time should be under 5000 ms
