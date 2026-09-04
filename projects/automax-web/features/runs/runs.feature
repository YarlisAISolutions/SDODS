@ui @runs
Feature: Runs
  Editors start runs from the Runs page; the dialog mirrors `automax run` (project, env, process, tags, layers, browsers).

  @smoke @user:admin
  Scenario: The Runs page offers a start run action to an editor
    Given I open the "runs" page
    Then I should see the text "Runs"
    And the start run button should be visible

  @regression @user:admin
  Scenario: The start run dialog lists the demo project and its processes
    Given I open the "runs" page
    When I open the start run dialog
    Then the start run dialog should offer project "demo-shop"
    And the start run dialog should offer process "pr-check"
    And the start run dialog should offer process "nightly-regression"
    When I close the start run dialog
