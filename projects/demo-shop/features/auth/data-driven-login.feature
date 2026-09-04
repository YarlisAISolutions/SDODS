@ui @auth @data-driven
Feature: Data-driven login
  Credentials come from the users dataset (data/<env>/users.csv with data/common fallback).

  @regression
  Scenario: Login with the first user of the dataset
    Given I load dataset "users" row 0
    And I am on the login page
    When I login with "{{username}}" and "{{password}}"
    Then I should be on the inventory page

  @regression
  Scenario: Login with the user whose role is problem
    Given I load dataset "users" where "role" is "problem"
    And I am on the login page
    When I login with "{{username}}" and "{{password}}"
    Then I should be on the inventory page
