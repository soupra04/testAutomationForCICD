import { expect, Locator, Page } from '@playwright/test';
import { getSearchQuotesTabUrl, getSfOrgPrefix } from '../utils/cpiOrg';
import { CpiCalculationPage } from './cpiCalculationPage';
import type {
  AssertNoNewBqmJobOptions,
  BqmJobBaseline,
  CpiToast,
} from './cpiCalculationPage';
import { SalesforceUtils } from '../utils/sfUtils';
import { XRLUtils } from '../utils/xrlUtils';
import { escapeRegExp, noEligibleQuoteItemsToastPattern } from '../utils/excelTestDataParsers';

export type LoadedItemsSummary = {
  text: string;
  loaded: number;
  total: number;
};

export type RecalculateCpiLaunchResult =
  | { outcome: 'dialog' }
  | { outcome: 'ineligible'; toast: CpiToast; quotes?: string[] };

/**
 * CPI ReCalculation POM — Search Quotes and Quote Items tab.
 *
 * Filter data-ids verified via Playwright UI inspection (Demo Int QA org):
 * - StrataVAR__CPI_Effective_Date__c (From)
 * - StrataVAR__CPI_Effective_Date__cTo (To)
 * - StrataVAR__CPI_Rebate_Status__c
 * - StrataVAR__Status__c (Quote Status)
 * - StrataVAR__Opportunity__r.StageName
 * - StrataVAR__Business_Entity__c
 */
export class CpiRecalculationPage {
  private sf: SalesforceUtils;
  private xrl: XRLUtils;
  private cpi: CpiCalculationPage;
  private quoteDetailPage?: Page;

  readonly searchQuotesPanel: Locator;
  readonly applyButton: Locator;
  readonly recalculateButton: Locator;
  readonly recalculateDialog: Locator;

  constructor(private page: Page) {
    this.sf = new SalesforceUtils(page);
    this.xrl = new XRLUtils(page);
    this.cpi = new CpiCalculationPage(page);
    this.searchQuotesPanel = page.getByRole('tabpanel', { name: 'Search Quotes' });
    this.applyButton = page.getByRole('button', { name: 'Apply', exact: true });
    this.recalculateButton = page.getByRole('button', {
      name: /Recalculate CPI on Selected Quote/i,
    });
    this.recalculateDialog = page.locator('section[role="dialog"].slds-modal').filter({
      has: page.getByRole('heading', { name: /Recalculate CPI/i }),
    });
  }

  private orgPrefix(): string {
    return getSfOrgPrefix();
  }

  private customerBomTableDataId(): string {
    return `${this.orgPrefix()}__CustomerBoM__c`;
  }

  async gotoSearchQuotesTab(): Promise<void> {
    await this.page.goto(getSearchQuotesTabUrl());
    await this.waitForPageReady();
  }

  async waitForPageReady(): Promise<void> {
    await this.sf.waitForLightningLoad();
    await expect(this.searchQuotesPanel).toBeVisible({ timeout: 90000 });
    await expect(this.applyButton).toBeVisible({ timeout: 90000 });
    await this.xrl
      .getFilter(`${this.orgPrefix()}__New_Total_Customer_Extended_Price__c`)
      .waitFor({ state: 'visible', timeout: 90000 });
  }

  async assertDefaultServerFiltersVisible(): Promise<void> {
    const prefix = this.orgPrefix();
    await expect(this.xrl.getFilter(`${prefix}__Account__c`)).toBeVisible();
    await expect(this.xrl.getFilter(`${prefix}__Opportunity__c`)).toBeVisible();
    await expect(this.xrl.getFilter(`${prefix}__New_Total_Customer_Extended_Price__c`)).toBeVisible();
    console.log("Default server filters visible");
  }

  private remainingFiltersDialog(): Locator {
    return this.page.getByRole('dialog').filter({
      has: this.page.locator(`c-multiselect[data-id="${this.orgPrefix()}__CPI_Rebate_Status__c"]`),
    });
  }

  private async assertRemainingDateFilterSelected(dataId: string, value: string): Promise<void> {
    const dialog = this.remainingFiltersDialog();
    const filter = dialog.locator(`c-multiselect[data-id="${dataId}"]`).first();
    const inputValue = ((await filter.locator('input').first().inputValue()) || '').trim();
    expect(inputValue, `Remaining filter ${dataId} input should not be empty`).not.toBe('');

    const year = value.match(/\d{4}/)?.[0];
    if (year) {
      expect(
        inputValue,
        `Remaining filter ${dataId} should show selected date for "${value}". UI input: "${inputValue}"`
      ).toMatch(new RegExp(year));
    } else {
      expect(
        inputValue,
        `Remaining filter ${dataId} should show preset "${value}". UI input: "${inputValue}"`
      ).toMatch(new RegExp(escapeRegExp(value), 'i'));
    }
    console.log(`[Date filter] ${dataId}="${inputValue}"`);
  }

  async openRemainingFiltersPopup(): Promise<void> {
    const dialog = this.remainingFiltersDialog();
    if (await dialog.isVisible().catch(() => false)) {
      console.log('Remaining filters popup already open');
      return;
    }
    await this.xrl.clickIconOnXRLGrid('ssFilter:dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });
    console.log('Remaining filters popup opened');
  }

  private async clearCreatedByInRemainingFilters(dialog: Locator): Promise<void> {
    const createdByFilter = dialog.locator('c-multiselect[data-id="CreatedById"]').first();
    if ((await createdByFilter.count()) === 0) {
      return;
    }

    const input = createdByFilter.locator('input[type="text"]').first();
    const inputValue = ((await input.inputValue()) || '').trim();
    const clearButton = createdByFilter.locator('button[title="Clear"]');

    if (!inputValue && (await clearButton.count()) === 0) {
      return;
    }

    if ((await clearButton.count()) > 0) {
      await clearButton.click();
    } else if (inputValue) {
      await input.fill('');
    }
    console.log('Created By filter cleared in remaining filters dialog');
  }

  async saveRemainingFilters(): Promise<void> {
    const dialog = this.remainingFiltersDialog();
    await this.clearCreatedByInRemainingFilters(dialog);
    await dialog
      .locator('.slds-modal__footer')
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
    console.log("Save button clicked");
  }

  async closeRemainingFiltersPopup(): Promise<void> {
    const dialog = this.remainingFiltersDialog();
    if (!(await dialog.isVisible().catch(() => false))) {
      return;
    }

    const cancelButton = dialog
      .locator('.slds-modal__footer')
      .getByRole('button', { name: 'Cancel', exact: true });
    if ((await cancelButton.count()) > 0) {
      await cancelButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await expect(dialog).toBeHidden({ timeout: 10000 });
    console.log('Remaining filters popup closed');
  }

  /** Set a remaining-filters popup multiselect by full data-id (MCP-verified ids). */
  async setRemainingFilterByDataId(dataId: string, value: string): Promise<void> {
    const dialog = this.remainingFiltersDialog();
    await expect(dialog).toBeVisible({ timeout: 15000 });
    const filter = dialog.locator(`c-multiselect[data-id="${dataId}"]`).first();
    await expect(filter).toBeVisible({ timeout: 15000 });

    const tagName = await filter.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'c-multiselect') {
      const input = filter.locator('input[type="text"]');
      await input.click();
      await input.fill(value);
      const listbox = this.page.locator('div[role="listbox"]');
      await listbox.waitFor({ state: 'visible', timeout: 20000 });
      const option = listbox.locator('.slds-truncate', { hasText: value }).first();
      await option.waitFor({ state: 'visible', timeout: 20000 });
      await option.click();
      return;
    }
    throw new Error(`Unsupported remaining filter tag for data-id=${dataId}`);
  }

  /** CPI Effective Date From — data-id StrataVAR__CPI_Effective_Date__c */
  async setCpiEffectiveDateFrom(value: string): Promise<void> {
    const dialog = this.remainingFiltersDialog();
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await this.xrl.pickDate(`${this.orgPrefix()}__CPI_Effective_Date__c`, value, dialog);
    await this.assertRemainingDateFilterSelected(
      `${this.orgPrefix()}__CPI_Effective_Date__c`,
      value
    );
    console.log(`CPI Effective Date From set to ${value}`);
  }

  /** CPI Effective Date To — data-id StrataVAR__CPI_Effective_Date__cTo */
  async setCpiEffectiveDateTo(value: string): Promise<void> {
    const dialog = this.remainingFiltersDialog();
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await this.xrl.pickDate(`${this.orgPrefix()}__CPI_Effective_Date__cTo`, value, dialog);
    await this.assertRemainingDateFilterSelected(
      `${this.orgPrefix()}__CPI_Effective_Date__cTo`,
      value
    );
    console.log(`CPI Effective Date To set to ${value}`);
  }

  async setRebateStatus(value: string): Promise<void> {
    await this.setRemainingFilterByDataId(`${this.orgPrefix()}__CPI_Rebate_Status__c`, value);
    console.log("Rebate Status set");
  }

  async setQuoteStatus(value: string): Promise<void> {
    await this.setRemainingFilterByDataId(`${this.orgPrefix()}__Status__c`, value);
    console.log("Quote Status set" + value);
  }

  async setOpportunityStage(value: string): Promise<void> {
    await this.setRemainingFilterByDataId(`${this.orgPrefix()}__Opportunity__r.StageName`, value);
    console.log("Opportunity Stage set" + " => " + value);
  }

  async setBusinessEntity(value: string): Promise<void> {
    await this.setRemainingFilterByDataId(`${this.orgPrefix()}__Business_Entity__c`, value);
  }

  async selectAccount(name: string): Promise<void> {
    await this.xrl.applyFilter('Account', name);
  }

  async selectOpportunity(name: string): Promise<void> {
    await this.xrl.applyFilter('Opportunity', name);
  }

  async clickApply(): Promise<void> {
    await this.closeRemainingFiltersPopup();
    await this.applyButton.click();
    await this.xrl.showErrors();
    console.log("Apply button clicked");
    await this.page.waitForTimeout(2000);
  }

  async clickLoadAllItems(): Promise<LoadedItemsSummary> {
    await this.xrl.clickIconOnXRLGrid('loadAll');
    await expect(this.page.getByRole('button', { name: 'Yes' })).toBeVisible({ timeout: 15000 });
    await this.xrl.clickYesOnconfirmation();
    const summary = await this.xrl.waitForLoadAllComplete();
    console.log(`Load all items complete: ${summary.text}`);
    return summary;
  }

  async setPagination(size: number | string): Promise<void> {
    await this.xrl.updateNoOfItemsPerPage(String(size));
    await this.page.waitForTimeout(2000);
    console.log(`Pagination set to ${size}`);
  }

  async assertPaginationSize(size: number | string): Promise<void> {
    const combobox = this.page.locator('button[aria-haspopup="listbox"][role="combobox"]').first();
    await expect(combobox).toContainText(String(size), { timeout: 15000 });
    console.log(`Pagination size verified on UI: ${size}`);
  }

  /** Rows currently loaded in the quotes XRL grid (from "Loaded X out of Y items" status). */
  async getLoadedRowCount(): Promise<number> {
    return this.xrl.getTotalRecords('client');
  }

  async assertVisibleRowCount(expected: number): Promise<void> {
    const loaded = await this.getLoadedRowCount();
    expect(loaded, `Expected ${expected} loaded rows on current page`).toBe(expected);
    console.log(`Loaded row count verified on UI: ${loaded}`);
  }

  private gridStatusBar(): Locator {
    return this.xrl.gridStatusBar();
  }

  async clickSelectAll(): Promise<void> {
    const headerCheckbox = this.page
      .locator('.slds-checkbox_faux');;
    await expect(headerCheckbox).toBeVisible({ timeout: 60000 });
    await headerCheckbox.click();
    console.log('Select all button clicked');
  }

  async selectQuoteByNumber(quoteNumber: string): Promise<void> {
    const row = this.page.locator('table tbody tr').filter({ hasText: quoteNumber }).first();
    await expect(row).toBeVisible({ timeout: 60000 });
    const checkbox = row.locator('input[type="checkbox"]').first();
    await checkbox.click();
  }

  async selectQuotesByNumbers(quoteNumbers: string[]): Promise<void> {
    for (const qt of quoteNumbers) {
      await this.selectQuoteByNumber(qt);
    }
  }

  async deselectQuoteByNumber(quoteNumber: string): Promise<void> {
    await this.selectQuoteByNumber(quoteNumber);
  }

  /** Parse "N item(s) selected out of M loaded items[, total items - T]" from grid status text. */
  parseSelectionSummary(text: string): { selected: number; loaded: number; total: number | null } | null {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const match = normalized.match(
      /(\d+)\s+item\(s\)\s+selected\s+out\s+of\s+(\d+)\s+loaded\s+items?(?:,\s*total\s+items\s*-\s*(\d+)|,\s*(\d+)\s+total\s+items?)?/i
    );
    if (!match) return null;
    return {
      selected: parseInt(match[1], 10),
      loaded: parseInt(match[2], 10),
      total: match[3] ? parseInt(match[3], 10) : match[4] ? parseInt(match[4], 10) : null,
    };
  }

  async assertSelectionSummary(pattern: RegExp): Promise<void> {
    const summary = this.gridStatusBar().filter({ hasText: pattern });
    await expect(summary).toBeVisible({ timeout: 30000 });
  }

  /**
   * After Select All + Load All: status bar shows highlighted summary like
   * "749 item(s) selected out of 749 loaded items, total items - 749".
   */
  async assertAllLoadedItemsSelectedSummary(expected: LoadedItemsSummary): Promise<void> {
    const summary = this.gridStatusBar();
    await expect(summary).toBeVisible({ timeout: 30000 });
    await expect(summary).toContainText(/item\(s\)\s+selected\s+out\s+of\s+\d+\s+loaded\s+items?/i, {
      timeout: 30000,
    });

    const text = ((await summary.innerText()) || '').replace(/\s+/g, ' ').trim();
    const selectionPrefix = text.split(/;\s*VAR Total Cost:/i)[0].trim();
    const counts = this.parseSelectionSummary(selectionPrefix);
    expect(
      counts,
      `Selection summary should show "N item(s) selected out of M loaded items". Actual: "${selectionPrefix}"`
    ).not.toBeNull();

    expect(
      counts!.selected,
      `Selected count should match Load All loaded count (${expected.loaded})`
    ).toBe(expected.loaded);
    expect(
      counts!.loaded,
      `Selection loaded count should match Load All loaded count (${expected.loaded})`
    ).toBe(expected.loaded);
    expect(
      counts!.total ?? expected.total,
      `Selection total should match Load All total (${expected.total})`
    ).toBe(expected.total);

    const highlighted = await summary.evaluate((el) => {
      const candidates = [el, ...Array.from(el.querySelectorAll('*'))];
      return candidates.some((node) => {
        const cls = typeof node.className === 'string' ? node.className : '';
        if (/slds-theme--(?:info|success|warning)|selection|selected/i.test(cls)) {
          return true;
        }
        const bg = window.getComputedStyle(node as Element).backgroundColor;
        return Boolean(bg && !/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/i.test(bg));
      });
    });
    expect(highlighted, `Selection summary section should be highlighted. Text: "${selectionPrefix}"`).toBe(
      true
    );
    console.log(`Selection summary verified against Load All (${expected.loaded}/${expected.total}): ${selectionPrefix}`);
  }

  async navigateToNextPage(): Promise<void> {
    await this.xrl.clickGridNextPage();
  }

  async getCurrentGridPageNumber(): Promise<number> {
    return this.xrl.getCurrentGridPageNumber();
  }

  async assertRowsSelectedOnCurrentPage(quoteNumbers: string[]): Promise<void> {
    for (const qt of quoteNumbers) {
      const row = this.page.locator('table tbody tr').filter({ hasText: qt }).first();
      const checkbox = row.locator('input[type="checkbox"]').first();
      await expect(checkbox).toBeChecked({ timeout: 15000 });
    }
  }

  /** Read visible data-table column labels from the quotes grid (aria-label preferred). */
  async getVisibleColumnHeaders(): Promise<string[]> {
    const table = this.page.locator(`c-data-table[data-ind='${this.customerBomTableDataId()}']`);
    await expect(table).toBeVisible({ timeout: 15000 });
    const headers = table.locator('table thead th');
    const count = await headers.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const th = headers.nth(i);
      const aria = await th.getAttribute('aria-label');
      const text = (aria || (await th.innerText()) || '').replace(/\s+/g, ' ').trim();
      if (text) labels.push(text);
    }
    return labels;
  }

  /** Assert UI column headers exactly match the Excel expected list (order + count). */
  async assertColumnHeadersMatchExpected(expectedHeaders: string[]): Promise<void> {
    const uiHeaders = await this.getVisibleColumnHeaders();
    console.log(`[Columns] Excel (${expectedHeaders.length}): ${expectedHeaders.join(' | ')}`);
    console.log(`[Columns] UI (${uiHeaders.length}): ${uiHeaders.join(' | ')}`);
    expect(
      uiHeaders,
      `UI column headers should match Excel.\nExpected: ${expectedHeaders.join(', ')}\nActual:   ${uiHeaders.join(', ')}`
    ).toEqual(expectedHeaders);
    console.log('UI column headers match Excel');
  }

  async getUiRecordCount(scope: 'server' | 'client' = 'server'): Promise<number> {
    return this.xrl.getTotalRecords(scope);
  }

  async assertUiCountMatchesSoql(soql: string): Promise<void> {
    const prefix = this.orgPrefix();
    let query = soql.replace(/\$\{process\.env\.SF_ORG_PREFIX\}/g, prefix);
    if (!/COUNT\s*\(\s*\)/i.test(query)) {
      const fromMatch = query.match(/FROM\s+(\S+)([\s\S]*)/i);
      if (fromMatch) {
        query = `SELECT COUNT() FROM ${fromMatch[1]}${fromMatch[2] || ''}`.trim();
      }
    }
    const dbCount = await this.cpi.querySoqlCount(query);
    const uiCount = await this.getUiRecordCount('server');
    console.log(`[SOQL] db=${dbCount} ui=${uiCount}`);
    expect(uiCount, `UI count ${uiCount} should match SOQL ${dbCount}`).toBe(dbCount);
  }

  /** Cell values for quote data rows only (excludes Account/Opportunity group rows). */
  private async getQuoteRowColumnValues(columnName: string): Promise<string[]> {
    const table = this.page.locator(`c-data-table[data-ind='${this.customerBomTableDataId()}']`);
    await expect(table).toBeVisible({ timeout: 15000 });

    const headers = table.locator('table thead th');
    const headerCount = await headers.count();
    let colIndex = -1;
    let quoteNumberColIndex = -1;

    for (let i = 0; i < headerCount; i++) {
      const th = headers.nth(i);
      const label = ((await th.getAttribute('aria-label')) || (await th.innerText()) || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (label === columnName) colIndex = i;
      if (label === 'Quote Number') quoteNumberColIndex = i;
    }

    if (colIndex < 0) throw new Error(`Column "${columnName}" not found in quotes grid`);
    if (quoteNumberColIndex < 0) throw new Error('Quote Number column not found in quotes grid');

    const rows = table.locator('table tbody tr');
    const rowCount = await rows.count();
    const values: string[] = [];

    for (let r = 0; r < rowCount; r++) {
      const row = rows.nth(r);
      const quoteText = (await row.locator('td').nth(quoteNumberColIndex).innerText())
        .replace(/\s+/g, ' ')
        .trim();
      if (!/^QT-/i.test(quoteText)) continue;

      const cellText = (await row.locator('td').nth(colIndex).innerText())
        .replace(/\s+/g, ' ')
        .trim();
      values.push(cellText);
    }

    return values;
  }

  async assertAllVisibleRowsMatchColumn(columnName: string, pattern: RegExp): Promise<void> {
    const values = await this.getQuoteRowColumnValues(columnName);
    expect(values.length, `Expected quote rows in column ${columnName}`).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toMatch(pattern);
    }
  }

  async assertColumnShowsNotCalculated(columnName: string): Promise<void> {
    const values = await this.getQuoteRowColumnValues(columnName);
    expect(
      values.length,
      `Expected quote rows with values in column "${columnName}"`
    ).toBeGreaterThan(0);
    for (const value of values) {
      expect(value, `${columnName} should show Not Calculated`).toMatch(/Not Calculated/i);
    }
    console.log(`${columnName}: all ${values.length} quote row(s) show Not Calculated`);
  }

  /** First Quote Number (QT-…) from the loaded quotes grid. */
  async getFirstQuoteNumberFromGrid(): Promise<string> {
    const quoteNumbers = await this.getQuoteRowColumnValues('Quote Number');
    const first = quoteNumbers.find((q) => /^QT-/i.test(q));
    if (!first) {
      throw new Error('No quote rows with Quote Number starting with QT- found in grid');
    }
    console.log(`First quote number in grid: ${first}`);
    return first;
  }

  private quoteNumberLinkInGrid(quoteNumber: string): Locator {
    const table = this.page.locator(`c-data-table[data-ind='${this.customerBomTableDataId()}']`);
    return table.getByRole('link', { name: quoteNumber, exact: true }).first();
  }

  /** Click the first QT- link in Quote Number column; opens detail in a new tab when supported. */
  async clickQuoteNumberLink(): Promise<string> {
    const quoteNumber = await this.getFirstQuoteNumberFromGrid();
    const link = this.quoteNumberLinkInGrid(quoteNumber);
    await expect(link, `Quote link ${quoteNumber} should be visible in grid`).toBeVisible({
      timeout: 15000,
    });

    const context = this.page.context();
    const pageEvent = context.waitForEvent('page', { timeout: 8000 });
    await link.click();

    let detailPage: Page;
    try {
      detailPage = await pageEvent;
    } catch {
      detailPage = this.page;
      await detailPage.waitForURL(
        (url) =>
          url.pathname.includes('/lightning/r/') ||
          /\/a[A-Za-z0-9]{12,18}(?:\/|$)/.test(url.pathname),
        { timeout: 60000 }
      );
    }

    this.quoteDetailPage = detailPage;
    await detailPage.bringToFront();
    await detailPage.waitForLoadState('domcontentloaded');
    await new SalesforceUtils(detailPage).waitForLightningLoad();
    console.log(`Opened quote detail for ${quoteNumber}`);
    return quoteNumber;
  }

  async assertQuoteDetailOpened(quoteNumber: string): Promise<void> {
    const detailPage = this.quoteDetailPage ?? this.page;
    const heading = detailPage
      .getByRole('heading', { name: new RegExp(escapeRegExp(quoteNumber), 'i') })
      .or(detailPage.getByRole('heading', { name: /^Quote\s+QT-/i }))
      .first();
    await expect(heading).toBeVisible({ timeout: 90000 });
    await expect(detailPage.getByText(quoteNumber, { exact: true }).first()).toBeVisible({
      timeout: 90000,
    });
    console.log(`Quote detail page verified for ${quoteNumber}`);
  }

  async assertRebateStatusDefaultIsAll(): Promise<void> {
    await this.openRemainingFiltersPopup();
    const dialog = this.remainingFiltersDialog();
    const filter = dialog
      .locator(`c-multiselect[data-id="${this.orgPrefix()}__CPI_Rebate_Status__c"]`)
      .first();
    const input = filter.locator('input[type="text"]').first();
    await expect(input).toHaveValue(/All/i);
    console.log('Rebate Status default is All');
    await this.closeRemainingFiltersPopup();
  }

  async assertRebateStatusOptions(options: string[]): Promise<void> {
    await this.openRemainingFiltersPopup();
    const dialog = this.remainingFiltersDialog();
    const filter = dialog
      .locator(`c-multiselect[data-id="${this.orgPrefix()}__CPI_Rebate_Status__c"]`)
      .first();
    const input = filter.locator('input[type="text"]').first();
    await input.click();
    const listbox = this.page.locator('div[role="listbox"]');
    await expect(listbox).toBeVisible({ timeout: 10000 });
  
    const uiOptions = await listbox.getByRole('option').allTextContents();
    console.log(`Rebate Status UI options: ${uiOptions.join(', ')}`);
  
    for (const option of options) {
      console.log(`Checking Rebate Status option: ${option}`);
      await expect(listbox.getByRole('option', { name: option, exact: true })).toBeVisible();
    }
  
    await this.closeRemainingFiltersPopup();
  }

  async assertNoErrorsOnApply(): Promise<void> {
    await this.clickApply();
    const errorToast = this.page.locator('.forceToastMessage').filter({ hasText: /error|exception/i });
    await expect(errorToast).toBeHidden({ timeout: 5000 }).catch(() => undefined);
  }

  async clickRecalculateCpiOnSelected(): Promise<void> {
    await this.closeRemainingFiltersPopup();
    await expect(this.recalculateButton).toBeVisible({ timeout: 30000 });
    await this.recalculateButton.click();
  }

  /**
   * After Recalculate CPI is clicked, the UI either opens the confirmation dialog
   * or shows an error toast when selected quotes have no eligible line items.
   */
  async waitForRecalculateDialogOrIneligibleToast(
    timeoutMs = 30000,
    quotes?: string[]
  ): Promise<RecalculateCpiLaunchResult> {
    const ineligiblePattern = noEligibleQuoteItemsToastPattern();
    const ineligibleToast = this.page
      .locator('.forceToastMessage, .slds-notify--toast, [role="status"]')
      .filter({ hasText: ineligiblePattern })
      .first();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await this.recalculateDialog.isVisible().catch(() => false)) {
        return { outcome: 'dialog' };
      }
      if (await ineligibleToast.isVisible().catch(() => false)) {
        const toast = await this.cpi.waitForToastMatching(ineligiblePattern, 5000);
        console.log(
          `[Recalculate CPI] ineligible quotes toast captured` +
            (quotes?.length ? ` for ${quotes.join(', ')}` : '') +
            `: ${toast.title} — ${toast.message}`
        );
        return { outcome: 'ineligible', toast, quotes };
      }
      await this.page.waitForTimeout(500);
    }

    throw new Error(
      `Neither Recalculate CPI dialog nor ineligible-quotes toast appeared within ${timeoutMs}ms` +
        (quotes?.length ? ` (quotes: ${quotes.join(', ')})` : '')
    );
  }

  async assertRecalculateCpiDialogVisible(bodyPattern?: RegExp): Promise<void> {
    await expect(this.recalculateDialog).toBeVisible({ timeout: 30000 });
    if (bodyPattern) {
      await expect(this.recalculateDialog.getByText(bodyPattern).first()).toBeVisible({
        timeout: 15000,
      });
    }
  }

  async chooseNotifyByEmailOnRecalculate(): Promise<void> {
    await this.recalculateDialog.getByRole('button', { name: /Notify By Email/i }).click();
  }

  async chooseIWillWaitOnRecalculate(): Promise<void> {
    await this.recalculateDialog.getByRole('button', { name: /I will wait/i }).click();
  }

  async cancelRecalculateDialog(): Promise<void> {
    await this.recalculateDialog.getByRole('button', { name: /^Cancel$/i }).click();
    await expect(this.recalculateDialog).toBeHidden({ timeout: 15000 });
  }

  async assertRecalculateButtonEnabled(expected: boolean): Promise<void> {
    if (expected) {
      await expect(this.recalculateButton).toBeEnabled({ timeout: 15000 });
    } else {
      await expect(this.recalculateButton).toBeDisabled({ timeout: 15000 });
    }
  }

  async waitForSyncRecalculationComplete(toastPattern: RegExp, timeoutMs = 180000): Promise<void> {
    const progress = this.page.getByText(/Calculating CPI estimate/i).first();
    await expect(progress).toBeVisible({ timeout: 30000 }).catch(() => undefined);
    await this.cpi.waitForToastMatching(toastPattern, timeoutMs);
  }

  async assertNoToastWithin(timeoutMs = 3000): Promise<void> {
    const toast = this.page.locator('.forceToastMessage, .slds-notify--toast').first();
    await expect(toast).toBeHidden({ timeout: timeoutMs }).catch(() => undefined);
  }

  async captureBqmBaseline(): Promise<BqmJobBaseline> {
    return this.cpi.captureLatestBqmJobBaseline();
  }

  async assertNoRecalculationJobStarted(
    sinceOrBaseline: string | BqmJobBaseline,
    pattern: RegExp,
    options?: AssertNoNewBqmJobOptions
  ): Promise<void> {
    await this.cpi.assertNoNewCpiBqmJob(sinceOrBaseline, pattern, options);
  }

  async assertRecalculationJobStarted(
    sinceOrBaseline: string | BqmJobBaseline,
    pattern: RegExp,
    options?: AssertNoNewBqmJobOptions
  ): Promise<void> {
    await this.cpi.assertRequiredBqmJobInLatest(sinceOrBaseline, pattern, options);
  }

  async assertLatestRecalculationJob(sinceIso: string, pattern: RegExp): Promise<void> {
    await this.cpi.assertLatestBqmJobMatches(pattern, sinceIso);
  }

  cpiCalculation(): CpiCalculationPage {
    return this.cpi;
  }

  soqlNowMinusSeconds(seconds: number): string {
    return this.cpi.soqlNowMinusSeconds(seconds);
  }
}
