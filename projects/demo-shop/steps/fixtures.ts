import { test as base, createBdd } from '@automax/core/fixtures';
import { LoginPage } from '../pages/LoginPage.js';
import { InventoryPage } from '../pages/InventoryPage.js';
import { CartPage } from '../pages/CartPage.js';
import { auth } from './auth.js';

/**
 * Project test object: the AutoMax merged fixtures plus this project's auth strategy and
 * page objects. playwright-bdd imports this file (importTestFrom) for generated specs.
 */
export const test = base.extend<{
  loginPage: LoginPage;
  inventoryPage: InventoryPage;
  cartPage: CartPage;
}>({
  auth: [auth, { scope: 'worker', option: true }],
  loginPage: async ({ pages }, use) => {
    await use(pages.get(LoginPage));
  },
  inventoryPage: async ({ pages }, use) => {
    await use(pages.get(InventoryPage));
  },
  cartPage: async ({ pages }, use) => {
    await use(pages.get(CartPage));
  },
});

export const {
  Given,
  When,
  Then,
  Step,
  BeforeScenario,
  AfterScenario,
  BeforeStep,
  AfterStep,
  BeforeWorker,
  AfterWorker,
} = createBdd(test);
