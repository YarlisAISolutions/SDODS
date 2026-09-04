import { expect } from '@playwright/test';
import { Fixture, Then, When } from 'playwright-bdd/decorators';
import { BasePage } from '@automax/core/pages';
import type { test } from '../steps/fixtures.js';

@Fixture<typeof test>('editorPage')
export class EditorPage extends BasePage {
  readonly editor = this.page.locator('.cm-content');
  readonly save = this.page.getByRole('button', { name: /^Save/ }).first();

  @Then('the feature editor should show {string}')
  async assertContains(text: string) {
    await expect(this.editor).toBeVisible();
    await expect(this.editor).toContainText(text);
  }

  @When('I replace the editor text {string} with {string}')
  async replaceText(from: string, to: string) {
    const current = await this.editor.innerText();
    const next = current.replace(from, to);
    await this.editor.click();
    await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await this.page.keyboard.insertText(next);
  }

  @Then('the save button should be disabled')
  async assertSaveDisabled() {
    await expect(this.save).toBeDisabled();
  }

  @Then('the editor should report {string}')
  async assertDiagnostic(text: string) {
    await expect(this.page.getByText(text, { exact: false }).first()).toBeVisible();
  }
}
