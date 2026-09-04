import { expect } from '@playwright/test';
import { Fixture, Then, When } from 'playwright-bdd/decorators';
import { BasePage } from '@sdods/core/pages';
import type { test } from '../steps/fixtures.js';

@Fixture<typeof test>('settingsPage')
export class SettingsPage extends BasePage {
  readonly newToken = this.h(this.page.getByRole('button', { name: 'New token' }), {
    description: 'new token button',
    role: 'button',
    name: 'New token',
  });
  readonly revealed = this.page.getByTestId('revealed-token');

  @When('I create an API token named {string}')
  async createToken(name: string) {
    await this.newToken.click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('textbox').first().fill(this.render(name));
    await dialog.getByRole('button', { name: /create/i }).click();
  }

  @Then('a token starting with {string} should be revealed once')
  async assertRevealed(prefix: string) {
    await expect(this.revealed).toBeVisible();
    await expect(this.revealed).toContainText(prefix);
  }

  @Then('the MCP clients page should list the tool {string}')
  async assertTool(name: string) {
    await expect(this.page.getByText(name, { exact: false }).first()).toBeVisible();
  }
}
