import { expect } from '@playwright/test';
import { Fixture, Given, Then, When } from 'playwright-bdd/decorators';
import { BasePage } from '@sdods/core/pages';
import type { test } from '../steps/fixtures.js';

/**
 * The sign-in form.
 *
 * The application puts `data-test` on the Material UI wrapper rather than on the control, so the
 * locators end in ` input`. That detail belongs here, in one file, instead of in every scenario —
 * which is the reason page objects exist.
 */
@Fixture<typeof test>('signInPage')
export class SignInPage extends BasePage {
  readonly username = this.h(this.page.locator('[data-test="signin-username"] input'), {
    description: 'username input',
    testId: 'signin-username',
    placeholder: 'Username',
  });
  readonly password = this.h(this.page.locator('[data-test="signin-password"] input'), {
    description: 'password input',
    testId: 'signin-password',
    placeholder: 'Password',
  });
  readonly submit = this.h(this.page.locator('[data-test="signin-submit"]'), {
    description: 'sign in button',
    role: 'button',
    name: 'Sign In',
    testId: 'signin-submit',
  });
  readonly error = this.page.getByTestId('signin-error');

  @Given('I am on the sign-in page')
  async open() {
    await this.goto('signin');
  }

  @When('I sign in as {string} with {string}')
  async signIn(username: string, password: string) {
    await this.username.fill(this.render(username));
    await this.password.fill(this.render(password));
    await this.submit.click();
  }

  @Then('I should see the sign-in error {string}')
  async assertError(message: string) {
    await expect(this.error).toContainText(message);
  }
}
