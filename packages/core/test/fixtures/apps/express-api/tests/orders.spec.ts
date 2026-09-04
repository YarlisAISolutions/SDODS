import { test, expect } from '@playwright/test';
test('orders list', async ({ request, page }) => {
  const res = await request.get('/api/orders');
  expect(res.status()).toBe(200);
  await page.locator('#orders-table tr').first().click();
  await page.locator('xpath=//button[@id="save"]').click();
});
