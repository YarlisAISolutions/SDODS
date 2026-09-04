@ui @account
Feature: Account overview
  A signed-in customer sees their own account, and a rejected sign-in says why.

  @regression @user:standard
  Scenario: The overview belongs to the signed-in customer
    Given I am on the account overview
    Then the account overview should belong to "Heath93"
    And the account balance should be shown

  @regression
  Scenario Outline: A rejected sign-in explains itself
    Given I am on the sign-in page
    When I sign in as "<username>" with "<password>"
    Then I should see the sign-in error "<error>"

    # title-format: <username> → <error>
    Examples:
      | username  | password | error                     |
      | Heath93   | wrong    | Username or password is invalid |
      | not_a_user| s3cret   | Username or password is invalid |
