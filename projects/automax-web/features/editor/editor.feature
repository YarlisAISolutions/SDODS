@ui @editor
Feature: Feature editor
  The editor loads Gherkin from the project, lints it, and refuses to save a scenario without a layer tag.

  @regression @user:admin
  Scenario: The editor loads a feature of the demo project
    Given I open the "editor" page
    Then the feature editor should show "Feature: Login"

  @regression @user:admin
  Scenario: Removing the layer tag blocks saving
    Given I open the "editor" page
    When I replace the editor text "@ui @auth" with "@auth"
    Then the save button should be disabled
    And the editor should report "layer tag"
