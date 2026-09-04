@api @posts @har:posts
Feature: Posts API
  JSONPlaceholder CRUD through the shared API step library: status codes, JSON-path assertions,
  schema validation, variable chaining and response-time budgets.

  @smoke
  Scenario: List posts
    When I send a GET request to "/posts"
    Then the response status should be 200
    And the response body should be an array
    And the response JSON path "$.length" should equal "100"
    And the response JSON path "[0].id" should equal "1"
    And the response time should be under 3000 ms

  @smoke @contract
  Scenario: Get a single post and validate its shape
    When I send a GET request to "/posts/1"
    Then the response status should be 200
    And the response JSON path "id" should equal "1"
    And the response JSON path "userId" should equal "1"
    And the response JSON path "title" should match ".+"
    And the response should match the JSON schema "post"
    And the response header "content-type" should contain "application/json"

  @regression
  Scenario: Nested resource - comments of a post
    When I send a GET request to "/posts/1/comments"
    Then the response status should be 200
    And the response JSON path "$.length" should equal "5"
    And the response JSON path "[0].postId" should equal "1"
    And the response JSON path "[0].email" should match "@"

  @regression
  Scenario: Query parameters filter posts by user
    Given I set the query parameter "userId" to "2"
    When I send a GET request to "/posts"
    Then the response status should be 200
    And the response JSON path "$.length" should equal "10"
    And the response JSON path "[0].userId" should equal "2"

  @regression @contract
  Scenario: Create a post and chain its id
    Given I set the variable "title" to "SDODS created this"
    When I send a POST request to "/posts" with body:
      """json
      { "title": "{{title}}", "body": "hello from SDODS", "userId": 1 }
      """
    Then the response status should be 201
    And the response JSON path "title" should equal "{{title}}"
    And the response should match the JSON schema "post"
    When I save the response JSON path "id" as "postId"
    And I send a GET request to "/posts/{{postId}}"
    Then the response status should be one of "200, 404"

  @regression
  Scenario: Update a post
    When I send a PUT request to "/posts/1" with body:
      """json
      { "id": 1, "title": "updated by SDODS", "body": "changed", "userId": 1 }
      """
    Then the response status should be 200
    And the response JSON path "title" should equal "updated by SDODS"
    When I send a PATCH request to "/posts/1" with body:
      """json
      { "title": "patched by SDODS" }
      """
    Then the response status should be 200
    And the response JSON path "title" should equal "patched by SDODS"

  @regression
  Scenario: Delete a post
    When I send a DELETE request to "/posts/1"
    Then the response status should be 200

  @regression
  Scenario: Unknown post returns 404
    When I send a GET request to "/posts/999999"
    Then the response status should be 404

  @regression
  Scenario: Data-driven request from the posts dataset
    Given I load dataset "posts" row 0
    When I send a GET request to "/posts/{{id}}"
    Then the response status should be 200
    And the response JSON path "userId" should equal "{{userId}}"

  @regression
  Scenario: Polling until a condition holds
    When I poll GET "/posts/2" until JSON path "id" equals "2" within 10 seconds
    Then the response status should be 200
