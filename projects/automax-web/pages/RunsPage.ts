import { expect } from '@playwright/test';
import { Fixture, Then, When } from 'playwright-bdd/decorators';
import { BasePage } from '@automax/core/pages';
import type { test } from '../steps/fixtures.js';

@Fixture<typeof test>('runsPage')
export class RunsPage extends BasePage {
  readonly startRun = this.h(this.page.getByTestId('start-run'), {
    description: 'start run button',
    role: 'button',
    name: 'Start run',
    testId: 'start-run',
  });
  readonly dialog = this.page.getByRole('dialog');

  @Then('the start run button should be visible')
  async assertStartVisible() {
    await this.startRun.expectVisible();
  }

  @Then('the start run button should not be available')
  async assertStartHidden() {
    await expect(this.page.getByTestId('start-run')).toHaveCount(0);
  }

  @When('I open the start run dialog')
  async openDialog() {
    await this.startRun.click();
    await expect(this.dialog).toBeVisible();
  }

  @Then('the start run dialog should offer project {string}')
  async assertProjectOption(slug: string) {
    const option = this.dialog.getByLabel('Project').locator(`option[value="${slug}"]`);
    await expect(option).toHaveCount(1);
  }

  @Then('the start run dialog should offer process {string}')
  async assertProcessOption(name: string) {
    const select = this.dialog.getByLabel('Process (optional)');
    await expect(select.locator(`option[value="${name}"]`)).toHaveCount(1);
  }

  @When('I close the start run dialog')
  async closeDialog() {
    await this.dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(this.dialog).toHaveCount(0);
  }
}
