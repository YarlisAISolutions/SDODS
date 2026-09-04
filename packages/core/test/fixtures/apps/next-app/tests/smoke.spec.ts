import { test, expect } from '@playwright/test';
test('home', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.getByRole('link', { name: 'Cart' }).click();
});
