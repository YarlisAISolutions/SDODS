import { expect } from '@playwright/test';
import { Fixture, Given, Then, When } from 'playwright-bdd/decorators';
import { BasePage } from '@sdods/core/pages';
import type { test } from '../steps/fixtures.js';

/** The application shell: organization select, workspace list with role badges, account menu. */
@Fixture<typeof test>('shell')
export class ShellPage extends BasePage {
  readonly organization = this.page.getByLabel('Organization');
  readonly workspaceList = this.page.getByRole('list', { name: 'Workspaces' });
  readonly userMenu = this.h(this.page.getByTestId('user-menu'), {
    description: 'account menu at the foot of the sidebar',
    testId: 'user-menu',
  });

  workspace(slug: string) {
    return this.page.getByTestId(`workspace-${slug}`);
  }

  @Given('I open the {string} page')
  async openRoute(route: string) {
    await this.goto(route);
  }

  @Then('the organization selector should show {string}')
  async assertOrganization(name: string) {
    await expect(this.organization).toBeVisible();
    // options arrive after /api/orgs resolves; poll instead of reading once
    await expect
      .poll(
        () =>
          this.organization.evaluate(
            (el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '',
          ),
        { timeout: 10_000 },
      )
      .toBe(this.render(name));
  }

  @Then('the sidebar should list workspace {string} with role {string}')
  async assertWorkspaceRole(slug: string, role: string) {
    const item = this.workspace(slug);
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute('data-role', role);
  }

  @Then('the sidebar should not list workspace {string}')
  async assertNoWorkspace(slug: string) {
    await expect(this.workspace(slug)).toHaveCount(0);
  }

  @When('I select workspace {string}')
  async selectWorkspace(slug: string) {
    // the list is populated after /api/workspaces resolves
    await this.workspace(slug).waitFor({ state: 'visible', timeout: 15_000 });
    await this.h(this.workspace(slug), {
      description: `workspace ${slug}`,
      testId: `workspace-${slug}`,
    }).click();
  }

  @When('I open the account menu item {string}')
  async openAccountMenuItem(item: string) {
    await this.userMenu.click();
    await this.page.getByRole('menuitem', { name: this.render(item) }).click();
  }

  @Then('the account menu should show {string}')
  async assertAccountMenu(text: string) {
    await expect(this.page.getByTestId('user-menu')).toContainText(this.render(text));
  }

  @When('I sign out')
  async signOut() {
    // Sign out lives in the account menu; the trigger is the avatar block in the sidebar footer.
    await this.userMenu.click();
    await this.page.getByRole('menuitem', { name: 'Sign out' }).click();
    await this.page.waitForURL('**/login**');
  }
}
