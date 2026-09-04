@api @platform
Feature: Platform REST API
  The same REST API the web UI uses, exercised with a free scoped token (AUTOMAX_TOKEN).

  Background:
    Given I authenticate with bearer token from "AUTOMAX_TOKEN"

  @smoke @contract
  Scenario: Health reports the database driver and migrations
    When I send a GET request to "/api/health"
    Then the response status should be 200
    And the response JSON path "ok" should exist
    And the response JSON path "driver" should exist
    And the response should contain "0001_platform_init"

  @smoke
  Scenario: Workspaces are listed with the caller's effective role
    When I send a GET request to "/api/workspaces"
    Then the response status should be 200
    And the response body should be an array
    And the response should contain "platform-qa"
    And the response should contain "\"role\""

  @smoke
  Scenario: Projects include the demo project and its modules
    When I send a GET request to "/api/projects"
    Then the response status should be 200
    And the response should contain "demo-shop"
    And the response should contain "inventory"

  @regression
  Scenario: MCP info lists the platform tools
    When I send a GET request to "/api/mcp/info"
    Then the response status should be 200
    And the response should contain "project_list"
    And the response should contain "run_tests"

  @regression
  Scenario: Unauthenticated calls are rejected
    Given I use no authentication
    When I send a GET request to "/api/workspaces"
    Then the response status should be 401
