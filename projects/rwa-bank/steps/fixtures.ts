import { test as base, createBdd } from '@sdods/core/fixtures';
import { HomePage } from '../pages/HomePage.js';
import { SignInPage } from '../pages/SignInPage.js';
import { AccountPage } from '../pages/AccountPage.js';
import { auth } from './auth.js';

/**
 * Project-level test object: extends the SDODS merged fixtures with this project's
 * auth strategy and page objects. playwright-bdd imports this file (importTestFrom).
 */
export const test = base.extend<{
  homePage: HomePage;
  signInPage: SignInPage;
  accountPage: AccountPage;
}>({
  auth: [auth, { scope: 'worker', option: true }],
  homePage: async ({ pages }, use) => {
    await use(pages.get(HomePage));
  },
  signInPage: async ({ pages }, use) => {
    await use(pages.get(SignInPage));
  },
  accountPage: async ({ pages }, use) => {
    await use(pages.get(AccountPage));
  },
});

export const { Given, When, Then, Step, BeforeScenario, AfterScenario, BeforeStep, AfterStep, BeforeWorker, AfterWorker } =
  createBdd(test);
