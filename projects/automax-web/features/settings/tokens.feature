@ui @settings
Feature: API tokens and MCP clients
  Tokens are free, scoped and revealed once; the MCP clients page lists the tools a token can call.

  @regression @user:admin
  Scenario: Creating a token reveals it once
    Given I open the "tokens" page
    When I create an API token named "dogfood-ui"
    Then a token starting with "amx_" should be revealed once

  @smoke @user:admin
  Scenario: The MCP clients page lists the platform tools
    Given I open the "mcp" page
    Then I should see the text "MCP"
    And the MCP clients page should list the tool "project_list"
