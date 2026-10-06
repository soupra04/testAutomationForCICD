import { expect, Locator, Page } from '@playwright/test';
import {
  getCpiConfigurationTabUrl,
  getSfJsforceConnection,
  getSfOrgPrefix,
} from '../utils/cpiOrg';
import { escapeRegExp, normalizeCpiEffectiveDate } from '../utils/excelTestDataParsers';
import { SalesforceUtils } from '../utils/sfUtils';

export type CpiToast = {
  title: string;
  message: string;
  type: string;
};

export type PviGridRow = {
  portfolio: string;
  applicablePvi: string;
  effectiveStartDate: string;
  effectiveEndDate: string;
  tier: string;
};

/**
 * CPI Configuration tab POM (Lightning LWC).
 * Locators verified via Playwright MCP against live page.
 */
export class CpiConfigurationPage {
  private sf: SalesforceUtils;

  readonly heading: Locator;
  readonly businessEntityCombobox: Locator;
  readonly addOrUpdatePviButton: Locator;
  readonly pviGrid: Locator;
  constructor(private page: Page) {
    this.sf = new SalesforceUtils(page);
    this.heading = page.getByRole('heading', {
      name: 'Cisco Partners Incentive Configuration',
      exact: true,
    });
    this.businessEntityCombobox = page.getByRole('combobox', { name: 'Business Entity' });
    this.addOrUpdatePviButton = page.getByRole('button', { name: 'Add or update PVI' });
    this.pviGrid = page
      .getByRole('grid')
      .filter({ has: page.getByRole('columnheader', { name: 'Portfolio' }) })
      .first();
  }

  private orgPrefix(): string {
    return getSfOrgPrefix();
  }

  async gotoCpiConfigurationTab(): Promise<void> {
    // Session comes from playwright storageState (SF_SESSION_ID via globalSetup).
    await this.page.goto(getCpiConfigurationTabUrl());
    await this.waitForPageReady();
  }

  async waitForPageReady(): Promise<void> {
    await this.sf.waitForLightningLoad();
    await expect(this.heading).toBeVisible({ timeout: 60000 });
    await expect(this.businessEntityCombobox).toBeVisible({ timeout: 60000 });
    await this.waitForConfigIdle();
  }

  /** Wait until CPI Configuration loading overlay is gone (blocks pointer events while visible). */
  async waitForConfigIdle(timeoutMs = 60000): Promise<void> {
    const overlay = this.page.locator('#cpi-configuration-page-loading-overlay');
    await expect
      .poll(
        async () => {
          if ((await overlay.count()) === 0) return true;
          return !(await overlay.isVisible().catch(() => false));
        },
        { timeout: timeoutMs, intervals: [100, 250, 500, 1000] }
      )
      .toBe(true);
  }

  /**
   * Format PVI for Configuration UI input.
   * - Keeps >2 decimals intact (Excel validation cases like 7.259).
   * - Other values use two decimals ("4.99", "7.50").
   */
  formatApplicablePviInput(value: string): string {
    const trimmed = String(value).trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
    const decimals = trimmed.includes('.') ? (trimmed.split('.')[1]?.length ?? 0) : 0;
    if (decimals > 2) return trimmed;
    const n = Number.parseFloat(trimmed);
    if (Number.isNaN(n)) return trimmed;
    return n.toFixed(2);
  }

  /**
   * When "Mark Existing Rebates as Invalid" is on, the LWC/API rejects whole-number
   * payloads that get stringified as "4.0". Nudge Excel whole numbers by .01 so the
   * save succeeds while staying faithful to the Excel from/to intent.
   */
  formatPviForMarkInvalidSave(value: string): string {
    const trimmed = String(value).trim();
    const n = Number.parseFloat(trimmed);
    if (Number.isNaN(n)) return trimmed;
    if (Number.isInteger(n)) return (n + 0.01).toFixed(2);
    return n.toFixed(2);
  }

  async selectBusinessEntity(name: string): Promise<void> {
    await this.waitForConfigIdle();
    await this.sf.selectComboboxOption('Business Entity', name);
    await this.waitForConfigIdle();
    await expect(this.pviGrid).toBeVisible({ timeout: 30000 });
  }

  private async readComboboxOptionLabel(opt: Locator): Promise<string> {
    // Prefer visible label text — data-value is often a Salesforce record Id.
    const raw =
      (await opt
        .locator('.slds-truncate, span, lightning-base-combobox-formatted-text')
        .first()
        .innerText()
        .catch(() => '')) ||
      (await opt.innerText().catch(() => '')) ||
      (await opt.getAttribute('title')) ||
      '';
    return raw.replace(/\s+/g, ' ').trim();
  }

  async getBusinessEntityOptions(): Promise<string[]> {
    await this.waitForConfigIdle();
    const combo = this.businessEntityCombobox;
    await expect(combo).toBeVisible({ timeout: 15000 });

    // Ensure a clean open: close if already expanded, then open.
    if ((await combo.getAttribute('aria-expanded')) === 'true') {
      await this.page.keyboard.press('Escape');
      await expect(combo).toHaveAttribute('aria-expanded', 'false', { timeout: 5000 }).catch(() => undefined);
    }
    await combo.click();

    const listbox = this.page.locator('[role="listbox"]:visible').last();
    await expect(listbox).toBeVisible({ timeout: 15000 });
    const optionLoc = listbox.locator('[role="option"], lightning-base-combobox-item');
    await expect(optionLoc.first()).toBeVisible({ timeout: 15000 });

    // Combobox lists can be virtualized — scroll + keyboard to collect all labels.
    const texts: string[] = [];
    const collectVisible = async () => {
      const count = await optionLoc.count();
      for (let i = 0; i < count; i++) {
        const cleaned = await this.readComboboxOptionLabel(optionLoc.nth(i));
        if (cleaned && !texts.includes(cleaned)) texts.push(cleaned);
      }
    };

    await collectVisible();
    let stableRounds = 0;
    for (let pass = 0; pass < 30 && stableRounds < 2; pass++) {
      const before = texts.length;
      await listbox.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await combo.press('ArrowDown').catch(() => undefined);
      await collectVisible();
      if (texts.length === before) stableRounds += 1;
      else stableRounds = 0;
    }

    await this.page.keyboard.press('Escape');
    return texts;
  }

  /**
   * Label text is a sibling of the switch row (not the switch accessible name).
   * Use the innermost container that has both the exact label and a switch.
   */
  private configSwitch(label: string): Locator {
    return this.page
      .locator('div')
      .filter({ has: this.page.getByText(label, { exact: true }) })
      .filter({ has: this.page.getByRole('switch') })
      .last()
      .getByRole('switch')
      .first();
  }

  /** @returns true when the switch was clicked (state changed). */
  async setSwitchByLabel(label: string, enabled: boolean): Promise<boolean> {
    await this.waitForConfigIdle();
    const labelLoc = this.page.getByText(label, { exact: true }).last();
    await labelLoc.scrollIntoViewIfNeeded();
    const sw = this.configSwitch(label);
    await expect(sw).toBeVisible({ timeout: 15000 });
    const checked = await sw.isChecked();
    if (checked === enabled) return false;

    // LWC toggle: faux span intercepts pointer events on the input
    const toggle = sw.locator(
      'xpath=ancestor::*[contains(@class,"slds-checkbox_toggle") or contains(@class,"slds-form-element")][1]'
    );
    const faux = toggle.locator('.slds-checkbox_faux, .slds-checkbox_faux_container, label').first();
    if (await faux.count()) {
      await faux.click();
    } else {
      await sw.click({ force: true });
    }
    // Keep this poll short/frequent — SF success toasts auto-dismiss quickly and
    // callers often wait for toast text immediately after this returns.
    await expect
      .poll(async () => sw.isChecked(), { timeout: 10000, intervals: [50, 100, 200, 500] })
      .toBe(enabled);
    return true;
  }

  async setAutomaticRebateCalculation(enabled: boolean): Promise<boolean> {
    return this.setSwitchByLabel('Enable Automatic Rebate Calculation', enabled);
  }

  async setMarkExistingRebatesInvalid(enabled: boolean): Promise<boolean> {
    return this.setSwitchByLabel('Mark Existing Rebates as Invalid when PVI Changes', enabled);
  }

  async setSpecialization(label: string, enabled: boolean): Promise<boolean> {
    return this.setSwitchByLabel(label, enabled);
  }

  async assertSpecializationLabels(expected: string[]): Promise<void> {
    for (const label of expected) {
      await expect(this.page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  }

  /**
   * Discover specialization toggle labels from the live page
   * (Excel T4566 has no specialization names in Test Data).
   */
  async getSpecializationLabels(): Promise<string[]> {
    await this.waitForConfigIdle();
    const candidates = this.page.getByText(/Specialization$/i);
    const count = await candidates.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = ((await candidates.nth(i).innerText().catch(() => '')) || '')
        .replace(/\s+/g, ' ')
        .trim();
      // Require a full name (exclude bare section header "Specialization")
      if (/^.+\s+Specialization$/i.test(text) && !labels.includes(text)) {
        labels.push(text);
      }
    }
    return labels;
  }

  async assertSpecializationEnabled(label: string, enabled: boolean): Promise<void> {
    const sw = this.configSwitch(label);
    await expect(sw).toBeVisible();
    expect(await sw.isChecked()).toBe(enabled);
  }

  async assertConfigSwitch(label: string, enabled: boolean): Promise<void> {
    const sw = this.configSwitch(label);
    await expect(sw).toBeVisible();
    expect(await sw.isChecked()).toBe(enabled);
  }

  async assertAutomaticRebateCalculation(enabled: boolean): Promise<void> {
    await this.assertConfigSwitch('Enable Automatic Rebate Calculation', enabled);
  }

  async findPortfolioRowName(preferred?: string | RegExp): Promise<string> {
    const rows = await this.getPviGridRows();
    if (!rows.length) throw new Error('No PVI grid rows available');
    if (preferred) {
      const match = rows.find((r) =>
        preferred instanceof RegExp ? preferred.test(r.portfolio) : r.portfolio === preferred
      );
      if (match) return match.portfolio;
    }
    return rows[0].portfolio;
  }

  private portfolioRow(portfolio: string): Locator {
    return this.pviGrid.getByRole('row').filter({ hasText: portfolio }).first();
  }

  async getPviGridRows(): Promise<PviGridRow[]> {
    await expect(this.pviGrid).toBeVisible({ timeout: 30000 });
    const rows = this.pviGrid.getByRole('row');
    const count = await rows.count();
    const result: PviGridRow[] = [];

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);

      // Group/section headers use synthetic keys (pvi-topgroup-*, pvi-subgroup-*).
      // Real portfolio rows use Salesforce record Ids — do not filter by label text
      // (a real portfolio can be named "Others").
      const rowKey =
        (await row.getAttribute('data-recid')) ||
        (await row.getAttribute('data-rowind')) ||
        '';
      if (/^pvi-(topgroup|subgroup)-/i.test(rowKey)) continue;
      if (!/^[a-zA-Z0-9]{15,18}$/.test(rowKey)) continue;

      const cells = row.getByRole('gridcell');
      const cellCount = await cells.count();
      if (cellCount < 5) continue;

      const portfolio = ((await cells.nth(1).innerText()) || '').replace(/\s+/g, ' ').trim();
      if (!portfolio || portfolio === 'Portfolio') continue;

      result.push({
        portfolio,
        applicablePvi: ((await cells.nth(2).innerText()) || '').replace(/\s+/g, ' ').trim(),
        effectiveStartDate: ((await cells.nth(3).innerText()) || '').replace(/\s+/g, ' ').trim(),
        effectiveEndDate: ((await cells.nth(4).innerText()) || '').replace(/\s+/g, ' ').trim(),
        tier: ((await cells.nth(5).innerText()) || '').replace(/\s+/g, ' ').trim(),
      });
    }
    return result;
  }

  async getTierForPortfolio(portfolio: string): Promise<string> {
    const row = this.portfolioRow(portfolio);
    await expect(row).toBeVisible({ timeout: 15000 });
    const cells = row.getByRole('gridcell');
    return ((await cells.nth(5).innerText()) || '').replace(/\s+/g, ' ').trim();
  }

  async editApplicablePviForPortfolio(portfolio: string, value: string): Promise<void> {
    await this.waitForConfigIdle();
    const row = this.portfolioRow(portfolio);
    await expect(row).toBeVisible({ timeout: 15000 });
    const pviCell = row.getByRole('gridcell').nth(2);
    await expect(pviCell).toBeVisible();
    await this.waitForConfigIdle();
    await pviCell.dblclick();

    const editor = this.page
      .getByRole('textbox', { name: /Applicable PVI/i })
      .or(pviCell.locator('input, textarea'))
      .first();
    await expect(editor).toBeVisible({ timeout: 10000 });
    const formatted = this.formatApplicablePviInput(value);
    await editor.fill('');
    await editor.fill(formatted);
    await editor.press('Enter');
  }

  async clickSaveIcon(): Promise<void> {
    const saveButton = this.page
      .getByRole('button', { name: /^Save$/i })
      .or(this.page.locator('button[title="Save"], button[aria-label="Save"]'))
      .or(this.page.locator('button[title*="Save"], button[aria-label*="Save"]'))
      .first();
    if (await saveButton.isVisible().catch(() => false)) {
      await saveButton.click();
    }
    // Enter on the cell often commits without a separate Save control —
    // caller should assert toast immediately (toasts auto-dismiss).
  }

  async openAddOrUpdatePviDialog(): Promise<void> {
    await this.addOrUpdatePviButton.click();
    await expect(this.page.getByRole('heading', { name: 'Add or update PVI' })).toBeVisible({
      timeout: 15000,
    });
  }

  async fillAddOrUpdatePvi(options: {
    portfolio: string;
    applicablePvi: string;
    effectiveStartDate?: string;
  }): Promise<void> {
    await this.openAddOrUpdatePviDialog();
    await this.sf.selectComboboxOption('Portfolio', options.portfolio);

    const pviInput = this.page.getByRole('textbox', { name: 'Applicable PVI' });
    await pviInput.fill(this.formatApplicablePviInput(options.applicablePvi));

    if (options.effectiveStartDate) {
      const dateValue =
        /today/i.test(options.effectiveStartDate)
          ? normalizeCpiEffectiveDate(new Date().toISOString())
          : normalizeCpiEffectiveDate(options.effectiveStartDate);
      await this.page.getByRole('textbox', { name: 'Effective Start Date' }).fill(dateValue);
    }
  }

  async saveAddOrUpdatePviDialog(): Promise<void> {
    await this.page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  }

  async cancelAddOrUpdatePviDialog(): Promise<void> {
    await this.page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  }

  private toastLocator(): Locator {
    return this.page.locator(
      [
        '.forceToastMessage.slds-notify--toast',
        '.slds-notify--toast.forceToastMessage',
        '.slds-notify_toast',
        '.slds-notify--toast',
        '[role="status"]',
        '[role="alertdialog"]',
      ].join(', ')
    );
  }

  /** Strip Salesforce a11y keyboard help appended to toast textContent. */
  private sanitizeToastText(value: string): string {
    return (value || '')
      .replace(/\u200b/g, '')
      .replace(/Press\s+Control\s*\+\s*F6[\s\S]*$/i, '')
      .replace(/Press\s+Ctrl\s*\+\s*F6[\s\S]*$/i, '')
      .replace(/to navigate to the next toast notification[\s\S]*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async parseToastElement(toast: Locator): Promise<CpiToast> {
    let title = this.sanitizeToastText(
      (await toast.locator('.toastTitle').first().textContent().catch(() => '')) || ''
    );
    let message = this.sanitizeToastText(
      (await toast.locator('.toastMessage, .toastContent').first().textContent().catch(() => '')) || ''
    );
    if (!title && !message) {
      message = this.sanitizeToastText((await toast.innerText().catch(() => '')) || '');
    }
    const className = (await toast.getAttribute('class').catch(() => '')) || '';
    let type = 'other';
    if (/success/i.test(className)) type = 'success';
    else if (/error/i.test(className)) type = 'error';
    else if (/warning/i.test(className)) type = 'warning';
    else if (/info/i.test(className)) type = 'info';
    return { title, message, type };
  }

  async readVisibleToasts(): Promise<CpiToast[]> {
    const toasts = this.toastLocator();
    const count = await toasts.count();
    const parsed: CpiToast[] = [];
    for (let i = 0; i < count; i++) {
      const toast = toasts.nth(i);
      if (!(await toast.isVisible().catch(() => false))) continue;
      parsed.push(await this.parseToastElement(toast));
    }
    return parsed;
  }

  async waitForToastMatching(pattern: RegExp, timeoutMs = 30000): Promise<CpiToast> {
    // Prefer continuous locator wait — SF toasts can appear/dismiss between poll ticks.
    const matchingToast = this.toastLocator().filter({ hasText: pattern }).first();
    await matchingToast.waitFor({ state: 'visible', timeout: timeoutMs });

    const found = await this.parseToastElement(matchingToast);
    if (
      !pattern.test(found.message) &&
      !pattern.test(found.title) &&
      !pattern.test(`${found.title} ${found.message}`)
    ) {
      // Fallback poll in case filter matched a related node but text moved.
      let polled: CpiToast | undefined;
      await expect
        .poll(
          async () => {
            const toasts = await this.readVisibleToasts();
            polled = toasts.find(
              (t) =>
                pattern.test(t.message) ||
                pattern.test(t.title) ||
                pattern.test(`${t.title} ${t.message}`)
            );
            return !!polled;
          },
          { timeout: Math.min(5000, timeoutMs), intervals: [50, 100, 200] }
        )
        .toBe(true);
      if (!polled) throw new Error(`Toast matching ${pattern} not found`);
      return polled;
    }
    return found;
  }

  /**
   * Wait for inline/toast validation text matching `message` and return its textContent.
   * Used so specs can print UI actual vs Excel expected.
   */
  async readInlineErrorText(message: string | RegExp, timeoutMs = 20000): Promise<string> {
    const pattern = message instanceof RegExp ? message : new RegExp(escapeRegExp(message), 'i');
    const help = this.page.locator(
      '.slds-form-element__help, .slds-text-color_error, [data-help-message], .slds-notify, .forceToastMessage'
    );
    let matched = '';

    await expect
      .poll(
        async () => {
          const count = await help.count();
          for (let i = 0; i < count; i++) {
            const loc = help.nth(i);
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = this.sanitizeToastText(
              (await loc.innerText().catch(() => '')) || ''
            );
            if (text && pattern.test(text)) {
              matched = text;
              return true;
            }
          }
          const toasts = await this.readVisibleToasts();
          for (const t of toasts) {
            const combined = this.sanitizeToastText(`${t.title} ${t.message}`);
            if (
              pattern.test(t.message) ||
              pattern.test(t.title) ||
              pattern.test(combined)
            ) {
              matched = combined;
              return true;
            }
          }
          return false;
        },
        { timeout: timeoutMs, intervals: [200, 500, 1000] }
      )
      .toBe(true);

    return this.sanitizeToastText(matched);
  }

  async assertInlineError(message: string | RegExp): Promise<void> {
    await this.readInlineErrorText(message);
  }

  async assertTierForPortfolio(portfolio: string, expectedTier: string | RegExp): Promise<void> {
    const tier = await this.getTierForPortfolio(portfolio);
    expect(tier).toMatch(expectedTier);
  }

  async querySoql<T extends Record<string, unknown> = Record<string, unknown>>(
    soql: string
  ): Promise<T[]> {
    const conn = getSfJsforceConnection();
    const result = await conn.query<T>(soql);
    return (result.records || []) as T[];
  }

  async queryBusinessEntityNames(): Promise<string[]> {
    const prefix = this.orgPrefix();
    const rows = await this.querySoql<{ Name: string }>(
      `SELECT Id, Name FROM ${prefix}__Business_Entity__c where ${prefix}__Is_Active__c = true and ${prefix}__Own_Account__c = true`
    );
    return rows.map((r) => r.Name).filter(Boolean);
  }

  async queryActivePvisForBusinessEntity(businessEntityName: string): Promise<
    Array<{
      portfolio: string;
      applicablePvi: number | string;
      startDate: string;
      endDate: string;
    }>
  > {
    const prefix = this.orgPrefix();
    const rows = await this.querySoql<{
      [key: string]: unknown;
    }>(
      `SELECT ${prefix}__Portfolio__c, ${prefix}__Applicable_PVI__c, ` +
        `${prefix}__Effective_Start_Date__c, ${prefix}__Effective_End_Date__c ` +
        `FROM ${prefix}__PVI__c ` +
        `WHERE ${prefix}__Business_Entity__r.Name = '${businessEntityName.replace(/'/g, "\\'")}' ` +
        `AND ${prefix}__Is_Active__c = true ` +
        `AND ${prefix}__Effective_End_Date__c > TODAY ` +
        `ORDER BY ${prefix}__Effective_Start_Date__c ASC LIMIT 200`
    );
    return rows.map((r) => ({
      portfolio: String(r[`${prefix}__Portfolio__c`] ?? ''),
      applicablePvi: (r[`${prefix}__Applicable_PVI__c`] as number | string) ?? '',
      startDate: String(r[`${prefix}__Effective_Start_Date__c`] ?? ''),
      endDate: String(r[`${prefix}__Effective_End_Date__c`] ?? ''),
    }));
  }

  async queryLatestBqmJobNames(limit = 10): Promise<string[]> {
    const prefix = this.orgPrefix();
    const rows = await this.querySoql<{ Name?: string; [key: string]: unknown }>(
      `SELECT Id, Name, CreatedDate FROM ${prefix}__Batch_Queue_Manager__c ` +
        `ORDER BY CreatedDate DESC LIMIT ${limit}`
    );
    return rows.map((r) => String(r.Name ?? '')).filter(Boolean);
  }

  async openBatchQueueManager(): Promise<void> {
    await this.page.getByRole('button', { name: 'App Launcher' }).click();
    await this.page.getByRole('combobox', { name: /Search apps/i }).fill('Batch Queue Manager');
    await this.page.getByRole('option', { name: /Batch Queue Manager/i }).first().click();
    await this.sf.waitForLightningLoad();
  }

  async refreshPage(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.waitForPageReady();
  }
}
