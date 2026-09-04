import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://www.saucedemo.com/');
  await page.locator('#user-name').fill('standard_user');
  await page.locator('#password').fill('secret_sauce');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL('https://www.saucedemo.com/inventory.html');
  await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
  await page.getByTestId('shopping-cart-link').click();
  await expect(page.locator('.cart_item')).toBeVisible();
  await page.locator('//button[@id="checkout"]').click();
  await page.goto('https://cdn.example.net/help');
});
