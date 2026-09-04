import { expect } from '@playwright/test';
import { Fixture, Then, When } from 'playwright-bdd/decorators';
import { BasePage } from '@sdods/core/pages';
import type { test } from '../steps/fixtures.js';

@Fixture<typeof test>('inventoryPage')
export class InventoryPage extends BasePage {
  readonly title = this.h(this.page.locator('.title'), {
    description: 'page title',
    text: 'Products',
    testId: 'title',
  });
  readonly items = this.page.locator('[data-test="inventory-item"]');
  readonly names = this.page.locator('[data-test="inventory-item-name"]');
  readonly prices = this.page.locator('[data-test="inventory-item-price"]');
  readonly sort = this.h(this.page.locator('[data-test="product-sort-container"]'), {
    description: 'sort dropdown',
    role: 'combobox',
    testId: 'product-sort-container',
  });
  readonly cartBadge = this.page.locator('[data-test="shopping-cart-badge"]');
  readonly cartLink = this.h(this.page.locator('[data-test="shopping-cart-link"]'), {
    description: 'cart link',
    testId: 'shopping-cart-link',
    role: 'link',
  });

  private slug(product: string) {
    return this.render(product)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
  }

  @Then('I should be on the inventory page')
  async assertOnPage() {
    await this.expectUrlContains('/inventory.html');
  }

  @Then('the inventory title should be {string}')
  async assertTitle(text: string) {
    await this.title.expectText(text);
  }

  @Then('there should be {int} products listed')
  async assertCount(count: number) {
    await expect(this.items).toHaveCount(count);
  }

  @When('I add {string} to the cart')
  async addToCart(product: string) {
    await this.heal.click(this.page.locator(`[data-test="add-to-cart-${this.slug(product)}"]`), {
      description: `add ${this.render(product)} to cart`,
      role: 'button',
      name: 'Add to cart',
      testId: `add-to-cart-${this.slug(product)}`,
    });
  }

  @When('I remove {string} from the cart')
  async removeFromCart(product: string) {
    await this.heal.click(this.page.locator(`[data-test="remove-${this.slug(product)}"]`), {
      description: `remove ${this.render(product)} from cart`,
      role: 'button',
      name: 'Remove',
      testId: `remove-${this.slug(product)}`,
    });
  }

  @Then('the cart badge should show {int} item(s)')
  async assertBadge(count: number) {
    await expect(this.cartBadge).toHaveText(String(count));
  }

  @Then('the cart badge should be hidden')
  async assertBadgeHidden() {
    await expect(this.cartBadge).toHaveCount(0);
  }

  @When('I sort products by {string}')
  async sortBy(label: string) {
    await this.sort.selectOption(label);
  }

  @Then('the product prices should be sorted ascending')
  async assertPricesAscending() {
    const prices = (await this.prices.allTextContents()).map((p) =>
      Number(p.replace(/[^0-9.]/g, '')),
    );
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  }

  @Then('the product names should be sorted descending')
  async assertNamesDescending() {
    const names = await this.names.allTextContents();
    expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
  }

  @When('I open the cart')
  async openCart() {
    await this.cartLink.click();
    await this.expectUrlContains('/cart.html');
  }
}
