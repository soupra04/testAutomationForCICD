import { Page, expect, FrameLocator } from '@playwright/test';

export class SalesforceUtils {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async login(username: string, password: string, loginUrl: string): Promise<void> {
    await this.page.goto(loginUrl);
    await this.page.fill('#username', username);
    await this.page.fill('#password', password);
    await this.page.click('#Login');
    await this.page.waitForLoadState('domcontentloaded');
  }

  async waitForLightningLoad(): Promise<void> {
    await this.page.waitForFunction(() => document.readyState === 'complete');
  }

  async openAppLauncherAndSearch(appName: string): Promise<void> {
    await this.page.click('div[title="App Launcher"]');
    await this.page.click('button[aria-label="View All Applications"]');
    await this.page.fill('input[placeholder="Search apps or items..."]', appName);
    await this.page.click(`text="${appName}"`);
    await this.waitForLightningLoad();
  }

  async clickOnQuoteButton(buttonName: string): Promise<void> {
    await this.page.getByRole('menuitem', { name: buttonName }).click();
  }

  async clickTab(tabName: string): Promise<void> {
    await this.page.click(`role=link[name="${tabName}"]`);
  }

  async clickButton(label: string): Promise<void> {
    await this.page.click(`button:has-text("${label}")`);
  }

  async clickMenuItem(label: string): Promise<void> {
    await this.page.click(`text="${label}"`);
  }

  async fillFieldByLabel(label: string, value: string): Promise<void> {
    const input = this.page.locator(`xpath=//label[contains(text(), "${label}")]/following-sibling::input`);
    await input.fill(value);
  }

  async getUpperToastMessage() {
      // Locator for the first message element for unsuccessful import
      const message = await this.page.locator("div[class='toastTitle slds-text-heading--small']").first().textContent();    
      return message?.trim() || "";     
  }

  async getToastMessage(): Promise<string> {
    const message = await this.page.locator('span[class="toastMessage forceActionsText"][data-aura-class="forceActionsText"]').first().textContent();
    // await expect(toastLocator).toBeVisible({ timeout: 10000 });
    return (message) ?? '';
  }
  

  async getItemByRoleandClick(role: string, name: string | RegExp): Promise<void> {
    if (typeof name === 'string'){
      const locator =  this.page.locator(`role=${role}[name="${name}"]`).nth(0);
      console.log(`Waiting for "${name}" ${role} to be visible and enabled...`);
      await locator.waitFor({state: 'visible', timeout:50000});

      let clicked = false;
      for (let i = 0; i <= 5; i++) {
        if (await locator.isEnabled()){
          console.log(`"${name}" ${role} is enabled and clicking`);
          await locator.click();
          clicked = true;
          break;
        }

        console.log(`"${name}" ${role} is not enabled, retrying (${i + 1}/6)...`);
        await this.page.waitForTimeout(2500);
      }

      if (!clicked) {
        throw new Error(`Unable to click visible ${role} with name "${name}" after multiple retries.`);
      }
      return;
    }

    const locator = this.page.locator(`role=${role}[name=${name}]`).nth(0);
    await locator.waitFor({ state: 'visible', timeout: 20000 });
    await locator.click();
    // await this.page.getByRole("textbox", { name: "*BoM ID" }).click();
  }

  async getItemByRoleandFill(role: string, name: string, value: string): Promise<void> {
    const input = this.page.locator(`role=${role}[name="${name}"]`);
    await input.fill(value);
  }

  async selectComboboxOption(comboboxName: string | RegExp, optionText: string): Promise<void> {
    const combobox = this.page.getByRole('combobox', { name: comboboxName });
    const currentValue = ((await combobox.innerText()) || '').trim();
    if (currentValue === optionText) {
      return;
    }

    await combobox.click();
    const listbox =
      typeof comboboxName === 'string'
        ? this.page.getByRole('listbox', { name: comboboxName })
        : this.page.locator('div[role="listbox"]:visible').last();
    await expect(listbox).toBeVisible({ timeout: 10000 });

    const option =
      listbox.getByRole('option', { name: optionText, exact: true }).or(
        listbox.locator('.slds-truncate', { hasText: optionText }).first()
      );
    await expect(option).toBeVisible({ timeout: 10000 });
    await option.click({ force: true });
    await expect(combobox).toContainText(optionText, { timeout: 10000 });
  }

  async timeout(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getButtonByText(text: string): Promise<void> {
    await this.page.locator(`text=${text}`).click();
  }

  async logout(): Promise<void> {
    await this.page.click('button[class*="slds-avatar"]');
    await this.page.click('text=Log Out');
  }

  async frameInEQG(): Promise<FrameLocator> {
        return this.page.locator('iframe[name^="vfFrameId_"]').contentFrame();
    }

  async clickRecordPageButton(buttonLabel: string): Promise<void> {
    const directButton = this.page.getByRole('button', { name: buttonLabel });
    const moreActionsButton = this.page.getByRole('button', { name: 'Show more actions' });

    // Wait for action buttons to render after the record page loads
    await directButton.or(moreActionsButton).first().waitFor({ state: 'visible', timeout: 60000 });

    if (await directButton.isVisible()) {
      await this.getItemByRoleandClick('button', buttonLabel);
      return;
    }

    if (await moreActionsButton.isVisible()) {
      await this.getItemByRoleandClick('button', 'Show more actions');
      await this.getItemByRoleandClick('menuitem', buttonLabel);
      return;
    }

    throw new Error(`Button with label "${buttonLabel}" not found on the record page.`);
  }

}
