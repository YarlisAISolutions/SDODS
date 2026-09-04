import { Fixture, Given } from 'playwright-bdd/decorators';
import { BasePage } from '@sdods/core/pages';
import type { test } from '../steps/fixtures.js';

@Fixture<typeof test>('homePage')
export class HomePage extends BasePage {
  readonly title = this.heal.locator(this.page.locator('h1').first(), {
    role: 'heading',
    description: 'page title',
  });

  @Given('I open the home page')
  async open() {
    await this.goto('home');
  }
}
