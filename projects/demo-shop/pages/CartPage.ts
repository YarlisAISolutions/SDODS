import { expect } from '@playwright/test';
import { Fixture, Then } from 'playwright-bdd/decorators';
import { BasePage } from '@automax/core/pages';
import type { test } from '../steps/fixtures.js';

@Fixture<typeof test>('cartPage')
export class CartPage extends BasePage {
  readonly items = this.page.locator('[data-test="inventory-item"]');
  readonly names = this.page.locator('[data-test="inventory-item-name"]');

  @Then('the cart should list {string}')
  async assertListed(product: string) {
    await expect(this.names.filter({ hasText: this.render(product) })).toHaveCount(1);
  }

  @Then('the cart should contain {int} item(s)')
  async assertCount(count: number) {
    await expect(this.items).toHaveCount(count);
  }
}
