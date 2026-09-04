Feature: Lint fixture with problems

  Scenario: No layer or suite tag
    Given I navigate to the "home" page

  @ui @smoke @regression
  Scenario: Two suite tags
    Given I navigate to the "home" page

  @ui @smoke @jira:not-a-key
  Scenario: Bad jira key
    Given I navigate to the "home" page
