@ui @account @visual
Feature: The sign-in page does not drift
  A baseline is a promise about pixels; it belongs to one platform and one browser.

  @regression @visual
  Scenario: The sign-in page matches its baseline
    Given I am on the sign-in page
    Then the page should match the visual baseline "signin"
