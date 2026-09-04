import { expect } from '@playwright/test';
import { Fixture, Given, Then, When } from 'playwright-bdd/decorators';
import { BasePage } from '@sdods/core/pages';
import type { test } from '../steps/fixtures.js';

@Fixture<typeof test>('loginPage')
export class LoginPage extends BasePage {
  readonly username = this.h(this.page.getByLabel('Username'), {
    description: 'username input',
    label: 'Username',
    css: ['input[autocomplete="username"]'],
  });
  readonly password = this.h(this.page.getByLabel('Password'), {
    description: 'password input',
    label: 'Password',
    css: ['input[type="password"]'],
  });
  readonly submit = this.h(this.page.getByRole('button', { name: 'Sign in' }), {
    description: 'sign in button',
    role: 'button',
    name: 'Sign in',
    css: ['form button'],
  });

  @Given('I am on the SDODS sign-in page')
  async open() {
    await this.goto('login');
  }

  @When('I sign in as {string} with password {string}')
  async signIn(username: string, password: string) {
    await this.username.fill(this.render(username));
    await this.password.fill(this.render(password));
    await this.submit.click();
    // settle: either the shell (workspace list) or the inline error appears
    await Promise.race([
      this.page.locator('[data-testid^="workspace-"]').first().waitFor({ timeout: 30_000 }),
      this.page.locator('.text-red-500').first().waitFor({ timeout: 30_000 }),
    ]).catch(() => undefined);
  }

  @Then('I should see the sign-in error {string}')
  async assertError(message: string) {
    await expect(this.page.getByText(message, { exact: false })).toBeVisible();
  }
}
