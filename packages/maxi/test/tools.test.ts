import { describe, expect, it } from 'vitest';
import { expressionToRegExp, runTool, StepCatalog, validateFeature } from '../src/tools.js';

const catalog = new StepCatalog([
  { keyword: 'Given', pattern: 'I am on the login page', source: 'project' },
  { keyword: 'When', pattern: 'I login with {string} and {string}', source: 'project' },
  { keyword: 'Then', pattern: 'the cart should contain {int} item(s)', source: 'project' },
  { keyword: 'Then', pattern: 'the page URL should contain {string}', source: 'project' },
  { keyword: 'Then', pattern: 'the response status is/should be {int}', source: 'shared' },
]);

const LOGIN = `@ui @smoke
Feature: Login
  Scenario: A standard user logs in
    Given I am on the login page
    When I login with "standard_user" and "\${DEMO_SHOP_PASSWORD}"
    Then the page URL should contain "/inventory.html"
`;

describe('expressionToRegExp', () => {
  it('matches Cucumber parameters, optional text and alternation', () => {
    expect(
      expressionToRegExp('I login with {string} and {string}').test('I login with "a" and \'b\''),
    ).toBe(true);
    expect(
      expressionToRegExp('the cart should contain {int} item(s)').test(
        'the cart should contain 1 item',
      ),
    ).toBe(true);
    expect(
      expressionToRegExp('the cart should contain {int} item(s)').test(
        'the cart should contain 3 items',
      ),
    ).toBe(true);
    expect(
      expressionToRegExp('the cart should contain {int} item(s)').test(
        'the cart should contain three items',
      ),
    ).toBe(false);
    expect(
      expressionToRegExp('the response status is/should be {int}').test(
        'the response status should be 200',
      ),
    ).toBe(true);
  });

  it('lets an Outline placeholder stand in for any parameter', () => {
    expect(
      expressionToRegExp('I login with {string} and {string}').test(
        'I login with "<user>" and <password>',
      ),
    ).toBe(true);
  });

  it('treats regex characters in step text literally', () => {
    expect(expressionToRegExp('the total is $5.00').test('the total is $5.00')).toBe(true);
    expect(expressionToRegExp('the total is $5.00').test('the total is X5a00')).toBe(false);
    expect(expressionToRegExp('price [USD] is {float}').test('price [USD] is 4.5')).toBe(true);
  });
});

describe('validateFeature', () => {
  it('passes a well-tagged feature built from existing steps', () => {
    expect(validateFeature(LOGIN, catalog)).toEqual({
      valid: true,
      scenarios: 1,
      syntaxErrors: [],
      tagProblems: [],
      stepsNotInCatalog: [],
    });
  });

  it('flags a missing layer tag and a doubled suite tag', () => {
    const report = validateFeature(LOGIN.replace('@ui @smoke', '@smoke @regression'), catalog);
    expect(report.valid).toBe(false);
    expect(report.tagProblems.join('\n')).toMatch(/exactly one layer tag/);
    expect(report.tagProblems.join('\n')).toMatch(/exactly one suite tag/);
  });

  it('reports syntax errors and features without scenarios', () => {
    expect(
      validateFeature('Scenario without a feature', catalog).syntaxErrors.length,
    ).toBeGreaterThan(0);
    const empty = validateFeature('@ui @smoke\nFeature: Empty\n', catalog);
    expect(empty.valid).toBe(false);
    expect(empty.syntaxErrors).toEqual(['The feature has no scenarios']);
  });

  it('lists steps with no definition without failing the feature', () => {
    const report = validateFeature(
      LOGIN.replace('Given I am on the login page', 'Given I open the moon base'),
      catalog,
    );
    expect(report.valid).toBe(true);
    expect(report.stepsNotInCatalog).toEqual(['I open the moon base']);
  });
});

describe('runTool', () => {
  it('ranks steps for find_steps', () => {
    const { content, isError } = runTool(
      'find_steps',
      { query: 'login with username and password' },
      catalog,
    );
    expect(isError).toBe(false);
    expect(content.split('\n')[0]).toBe('When I login with {string} and {string}  (project)');
  });

  it('returns a JSON report for validate_feature', () => {
    const { content } = runTool('validate_feature', { feature: LOGIN }, catalog);
    expect(JSON.parse(content)).toMatchObject({ valid: true, scenarios: 1 });
  });

  it('marks unknown tools and an empty catalog as errors', () => {
    expect(runTool('rm_rf', {}, catalog).isError).toBe(true);
    expect(runTool('find_steps', { query: 'x' }, new StepCatalog([])).isError).toBe(true);
  });
});
