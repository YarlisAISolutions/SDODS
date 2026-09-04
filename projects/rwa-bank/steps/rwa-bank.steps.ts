import { expect } from '@playwright/test';
import { Then } from './fixtures.js';

// Project-specific steps. Generic UI/API/data steps come from @sdods/core/steps.
Then('the RWA Bank title should be visible', async ({ homePage }) => {
  await expect(homePage.title).toBeVisible();
});
