import { Fixture, Given, Then } from 'playwright-bdd/decorators';
import { BasePage } from '@sdods/core/pages';
import type { test } from '../steps/fixtures.js';

/** The signed-in account overview: the side navigation carries the identity of the session. */
@Fixture<typeof test>('accountPage')
export class AccountPage extends BasePage {
  readonly username = this.h(this.page.getByTestId('sidenav-username'), {
    description: 'signed-in username',
    testId: 'sidenav-username',
  });
  readonly balance = this.h(this.page.getByTestId('sidenav-user-balance'), {
    description: 'account balance',
    testId: 'sidenav-user-balance',
  });
  readonly signOut = this.page.getByTestId('sidenav-signout');

  @Given('I am on the account overview')
  async open() {
    await this.goto('home');
  }

  @Then('the account overview should belong to {string}')
  async assertUser(username: string) {
    // Healed assertion: if the primary locator stops matching, the healer scores the
    // alternatives from the context above and records what it used.
    await this.username.expectText(this.render(username));
  }

  @Then('the account balance should be shown')
  async assertBalance() {
    await this.balance.expectVisible();
  }
}
