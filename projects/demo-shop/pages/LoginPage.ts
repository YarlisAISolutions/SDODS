import { expect } from '@playwright/test';
import { Fixture, Given, Then, When } from 'playwright-bdd/decorators';
import { BasePage } from '@automax/core/pages';
import type { test } from '../steps/fixtures.js';

@Fixture<typeof test>('loginPage')
export class LoginPage extends BasePage {
  readonly username = this.h(this.page.locator('#user-name'), {
    description: 'username input',
    placeholder: 'Username',
    testId: 'username',
  });
  readonly password = this.h(this.page.locator('#password'), {
    description: 'password input',
    placeholder: 'Password',
    testId: 'password',
  });
  readonly submit = this.h(this.page.locator('#login-button'), {
    description: 'login button',
    role: 'button',
    name: 'Login',
    testId: 'login-button',
  });
  readonly error = this.page.getByTestId('error');

  @Given('I am on the login page')
  async open() {
    await this.goto('login');
  }

  @When('I login with {string} and {string}')
  async login(username: string, password: string) {
    await this.username.fill(this.render(username));
    await this.password.fill(this.render(password));
    await this.submit.click();
  }

  @Then('I should see the login error {string}')
  async assertError(message: string) {
    await expect(this.error).toContainText(message);
  }
}
