import { test as base, createBdd } from '@sdods/core/fixtures';
import { LoginPage } from '../pages/LoginPage.js';
import { ShellPage } from '../pages/ShellPage.js';
import { RunsPage } from '../pages/RunsPage.js';
import { EditorPage } from '../pages/EditorPage.js';
import { SettingsPage } from '../pages/SettingsPage.js';
import { auth } from './auth.js';

/** Project test object: SDODS merged fixtures + this project's auth strategy and page objects. */
export const test = base.extend<{
  loginPage: LoginPage;
  shell: ShellPage;
  runsPage: RunsPage;
  editorPage: EditorPage;
  settingsPage: SettingsPage;
}>({
  auth: [auth, { scope: 'worker', option: true }],
  loginPage: async ({ pages }, use) => {
    await use(pages.get(LoginPage));
  },
  shell: async ({ pages }, use) => {
    await use(pages.get(ShellPage));
  },
  runsPage: async ({ pages }, use) => {
    await use(pages.get(RunsPage));
  },
  editorPage: async ({ pages }, use) => {
    await use(pages.get(EditorPage));
  },
  settingsPage: async ({ pages }, use) => {
    await use(pages.get(SettingsPage));
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
