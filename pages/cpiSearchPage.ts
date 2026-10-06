import { expect, Locator, Page } from '@playwright/test';
import { getCpiSearchTabUrl } from '../utils/cpiOrg';
import { normalizeCpiEffectiveDate } from '../utils/excelTestDataParsers';
import { SalesforceUtils } from '../utils/sfUtils';
import { log } from 'console';

const COLUMN_ALIASES: Record<string, string> = {
  SKU: 'SKU (PART NUMBER)',
  'Applicable Rebate %': 'PARTNER REBATE %',
  Portfolio: 'PORTFOLIO',
  'CPI Period': 'CPI PERIOD',
  'Geographic Location': 'GEOGRAPHY',
  Geography: 'GEOGRAPHY',
  GSP: 'GSP',
  'Service Tiers': 'SERVICE TIER',
};

export type CpiSearchPopup = {
  title: string;
  message: string;
  /** success | error | info | other */
  type: string;
};

/** Snapshot of Search Results used to detect when the grid refreshes after Search. */
type CpiResultsFingerprint = {
  empty: boolean;
  rowCount: number;
  firstCell: string;
  /** First N rows × cells — catches CPI Period / column changes when SKU+count stay the same. */
  contentKey: string;
};

export class CpiSearchPage {
  private sf: SalesforceUtils;
  /** Popup captured during the latest Search click (toast disappears quickly). */
  private lastSearchPopup: CpiSearchPopup | null = null;

  readonly skuInput: Locator;
  readonly effectiveDateInput: Locator;
  readonly searchButton: Locator;
  readonly resultsGrid: Locator;
  readonly emptyState: Locator;
  readonly minLengthValidation: Locator;

  constructor(private page: Page) {
    this.sf = new SalesforceUtils(page);
    this.skuInput = page.getByRole('textbox', { name: 'Cisco SKU' });
    this.effectiveDateInput = page.getByRole('textbox', { name: 'Effective Date' });
    this.searchButton = page.getByRole('main').getByRole('button', { name: 'Search', exact: true });
    this.resultsGrid = page.getByRole('grid').first();
    this.emptyState = page.getByText('Record(s) Not Found');
    // Live UI: div.slds-form-element__help under Cisco SKU
    // "Enter at least 3 characters or leave empty to search all SKUs."
    this.minLengthValidation = page
      .locator('.slds-form-element__help[data-help-message], .slds-form-element__help')
      .filter({ hasText: /at least 3 characters/i });
  }

  private resolveColumnName(columnName: string): string {
    return COLUMN_ALIASES[columnName] ?? columnName;
  }

  async gotoCpiSearchTab(): Promise<void> {
    // Session comes from playwright storageState (SF_SESSION_ID via globalSetup).
    await this.page.goto(getCpiSearchTabUrl());
    await this.waitForPageReady();
  }

  async openAndVerifyCpiSearchPage(): Promise<void> {
    await this.gotoCpiSearchTab();
    await this.assertQueryAreaVisible();
    await this.assertResultsTableEmpty();
  }

  async search(options: {
    sku?: string;
    operator?: string;
    portfolio?: string;
    geography?: string;
    limit?: string;
    effectiveDate?: string;
  }): Promise<void> {
    if (options.operator) {
      await this.selectOperator(options.operator);
      console.log(`Selected operator '${options.operator}'`);
    }
    if (options.portfolio) {
      await this.selectPortfolio(options.portfolio);
      console.log(`Selected portfolio '${options.portfolio}'`);
    }
    if (options.geography) {
      await this.selectGeography(options.geography);
      console.log(`Selected geography '${options.geography}'`);
    }
    if (options.limit) {
      await this.selectResultLimit(options.limit);
      console.log(`Selected limit '${options.limit}'`);
    }
    if (options.effectiveDate) {
      await this.setEffectiveDate(options.effectiveDate);
      console.log(`Selected effective date '${options.effectiveDate}'`);
    }
    if (options.sku !== undefined) {
      if (options.sku === '') {
        await this.clearSku();
        console.log(`Cleared SKU`);
      } else {
        await this.enterSku(options.sku);
      }
    }

    await this.clickSearch();
    console.log('Clicked Search');
  }

  async waitForPageReady(): Promise<void> {
    await this.sf.waitForLightningLoad();
    await expect(this.page.getByRole('heading', { name: 'Cisco Partners Incentive Search' })).toBeVisible({ timeout: 60000 });
    await expect(this.skuInput).toBeVisible({ timeout: 60000 });
    await expect(this.searchButton).toBeVisible({ timeout: 60000 });
    console.log('CPI Search Page ready');
  }

  async assertQueryAreaVisible(): Promise<void> {
    await expect(this.skuInput).toBeVisible();
    await expect(this.page.getByRole('combobox', { name: 'SKU Operator' })).toBeVisible();
    await expect(this.page.getByRole('combobox', { name: 'Cisco Portfolio' })).toBeVisible();
    await expect(this.page.getByRole('combobox', { name: 'Geography (Services only)' })).toBeVisible();
    await expect(this.page.getByRole('combobox', { name: 'Limit' })).toBeVisible();
    await expect(this.effectiveDateInput).toBeVisible();
    console.log('Query area visible');
  }

  async assertResultsTableEmpty(): Promise<void> {
    await expect(this.emptyState).toBeVisible();
  }

  async assertColumnHeadersVisible(headers: string[]): Promise<void> {
    for (const header of headers) {
      const headerLocator = this.resultsGrid
        .getByRole('columnheader', { name: header })
        .or(this.resultsGrid.getByRole('button', { name: header, exact: true }));
      await expect(headerLocator.first()).toBeVisible({ timeout: 15000 });
    }
    console.log('Column headers visible');
  }

  async enterSku(value: string): Promise<void> {
    await this.skuInput.click();
    await this.skuInput.fill(value);
    console.log(`Entered SKU '${value}'`);
  }

  async clearSku(): Promise<void> {
    await this.skuInput.click();
    await this.skuInput.fill('');
  }

  async getEffectiveDate(): Promise<string> {
    return (await this.effectiveDateInput.inputValue()).trim();
  }

  /**
   * Sets Effective Date using the CPI UI format (e.g. "Jul 14, 2026").
   * Accepts Excel-style values like "14-Jul-26" and normalizes them first.
   */
  async setEffectiveDate(date: string): Promise<void> {
    const formatted = normalizeCpiEffectiveDate(date);
    await this.effectiveDateInput.click();
    await this.effectiveDateInput.fill(formatted);
    await this.effectiveDateInput.press('Tab');
    await expect(this.effectiveDateInput).toHaveValue(formatted, { timeout: 10000 });
  }

  async selectOperator(value: string): Promise<void> {
    await this.sf.selectComboboxOption('SKU Operator', value);
  }

  async selectPortfolio(value: string): Promise<void> {
    const option = value === 'All' ? 'All Portfolios' : value;
    await this.sf.selectComboboxOption('Cisco Portfolio', option);
  }

  async selectGeography(value: string): Promise<void> {
    await this.sf.selectComboboxOption('Geography (Services only)', value);
  }

  /** Visible Geography combobox option labels (excludes blank entries). */
  async getGeographyOptions(): Promise<string[]> {
    const combobox = this.page.getByRole('combobox', { name: 'Geography (Services only)' });
    await combobox.click();
    const listbox = this.page.getByRole('listbox', { name: 'Geography (Services only)' });
    await expect(listbox).toBeVisible({ timeout: 10000 });
    const options = listbox.getByRole('option');
    const count = await options.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = ((await options.nth(i).innerText()) || '').replace(/\s+/g, ' ').trim();
      if (text) labels.push(text);
    }
    await this.page.keyboard.press('Escape');
    await expect(listbox).toBeHidden({ timeout: 5000 }).catch(() => undefined);
    return labels;
  }

  async selectResultLimit(value: string): Promise<void> {
    await this.sf.selectComboboxOption('Limit', value);
  }

  async clickSearch(): Promise<void> {
    // Live UI: toast/grid often take ~15s+; prior rows stay visible until refresh.
    const before = await this.getResultsFingerprint();
    this.lastSearchPopup = null;
    const popupPromise = this.waitForSearchPopup(45000);
    await this.searchButton.click();
    this.lastSearchPopup = await popupPromise;
    await this.page.getByRole('grid').first().waitFor({ state: 'visible', timeout: 60000 });
    await this.waitForSearchResultsReady(before, 90000);
  }

  private isNoResultsPopup(popup: CpiSearchPopup | null): boolean {
    if (!popup) return false;
    return (
      /No Results/i.test(popup.title) ||
      /No eligible offers match your search criteria/i.test(popup.message)
    );
  }

  private isSuccessResultsPopup(popup: CpiSearchPopup | null): boolean {
    if (!popup) return false;
    return (
      popup.type === 'success' ||
      /Showing only the top/i.test(popup.message) ||
      /Results limited/i.test(popup.message)
    );
  }

  private async getResultsFingerprint(): Promise<CpiResultsFingerprint> {
    if (await this.emptyState.isVisible().catch(() => false)) {
      return { empty: true, rowCount: 0, firstCell: '', contentKey: '' };
    }
    const dataRows = this.resultsGrid.getByRole('row').filter({
      has: this.page.getByRole('gridcell'),
    });
    const rowCount = await dataRows.count();
    const sampleRows = Math.min(rowCount, 5);
    const rowKeys: string[] = [];
    for (let r = 0; r < sampleRows; r++) {
      const cells = dataRows.nth(r).getByRole('gridcell');
      const cellCount = Math.min(await cells.count(), 8);
      const parts: string[] = [];
      for (let c = 0; c < cellCount; c++) {
        parts.push((await cells.nth(c).innerText()).trim());
      }
      rowKeys.push(parts.join('\t'));
    }
    const firstCell = rowKeys[0]?.split('\t')[0] ?? '';
    return { empty: false, rowCount, firstCell, contentKey: rowKeys.join('\n') };
  }

  /**
   * Waits until Search finishes rendering new results.
   * MCP probe (Ends with / 10H): toast ~15s; old grid rows stay until then — must not
   * treat pre-search rows as ready.
   * Re-search with same SKU/limit (e.g. Effective Date only) can keep identical rows;
   * after success toast, accept once the fingerprint stays stable long enough.
   */
  async waitForSearchResultsReady(
    before: CpiResultsFingerprint,
    timeoutMs = 90000
  ): Promise<void> {
    // ~8 × 2s polls after toast ≈ 15s+ of unchanged grid ⇒ treat as identical result set
    const identicalSettlePasses = 8;
    let identicalStablePasses = 0;

    await expect(async () => {
      if (this.isNoResultsPopup(this.lastSearchPopup)) {
        const emptyVisible = await this.emptyState.isVisible().catch(() => false);
        expect(emptyVisible, 'No Results search should show empty state').toBe(true);
        return;
      }

      const after = await this.getResultsFingerprint();

      if (after.empty) {
        if (this.isNoResultsPopup(this.lastSearchPopup)) return;
        // Toast can vanish: only settle empty without toast when prior search had rows
        // (do not accept empty on first search — results/toast may still be in flight).
        if (!before.empty) {
          identicalStablePasses += 1;
          if (identicalStablePasses >= identicalSettlePasses) {
            return;
          }
        }
        throw new Error('Still showing empty / waiting for result rows after Search');
      }

      expect(after.rowCount, 'Search should render result rows').toBeGreaterThan(0);
      expect(after.firstCell.length, 'First result cell should be populated').toBeGreaterThan(0);

      const gridChanged =
        before.empty ||
        after.firstCell !== before.firstCell ||
        after.rowCount !== before.rowCount ||
        after.contentKey !== before.contentKey;

      if (gridChanged) {
        identicalStablePasses = 0;
        return;
      }

      if (!this.isSuccessResultsPopup(this.lastSearchPopup)) {
        throw new Error(
          `Grid still shows pre-search data (first cell '${before.firstCell}', rows ${before.rowCount})`
        );
      }

      // Success toast + unchanged fingerprint: either still stale, or identical re-query.
      identicalStablePasses += 1;
      if (identicalStablePasses < identicalSettlePasses) {
        throw new Error(
          `Toast received but grid not refreshed yet (still '${before.firstCell}')`
        );
      }
    }).toPass({ timeout: timeoutMs, intervals: [500, 1000, 2000] });
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

  private async readVisibleToasts(
    toasts: Locator = this.page.locator(
      '.forceToastMessage.slds-notify--toast, .slds-notify--toast.forceToastMessage'
    )
  ): Promise<CpiSearchPopup[]> {
    const count = await toasts.count();
    const parsed: CpiSearchPopup[] = [];
    for (let i = 0; i < count; i++) {
      const toast = toasts.nth(i);
      if (!(await toast.isVisible().catch(() => false))) continue;
      let title = this.sanitizeToastText(
        (await toast.locator('.toastTitle').first().textContent().catch(() => '')) || ''
      );
      let message = this.sanitizeToastText(
        (await toast.locator('.toastMessage').first().textContent().catch(() => '')) || ''
      );
      if (!title && !message) {
        const raw = this.sanitizeToastText((await toast.innerText().catch(() => '')) || '');
        // e.g. "No Results No eligible offers match your search criteria."
        const noResults = raw.match(/No Results\s*(.*)/i);
        if (noResults) {
          title = 'No Results';
          message = (noResults[1] || '').trim();
        } else {
          message = raw;
        }
      }
      const className = (await toast.getAttribute('class')) || '';
      let type = 'other';
      if (/slds-theme--success|theme--success/i.test(className)) type = 'success';
      else if (/slds-theme--error|theme--error/i.test(className)) type = 'error';
      else if (/slds-theme--warning|theme--warning/i.test(className)) type = 'warning';
      else if (/slds-theme--info|theme--info/i.test(className)) type = 'info';
      parsed.push({ title, message, type });
    }
    return parsed;
  }

  /**
   * Waits for Lightning toast(s) after Search.
   * Captures immediately (toasts disappear quickly), then briefly rechecks for a
   * second toast. Prefers Success "Showing only the top…" when present; otherwise
   * No Results / first toast.
   */
  async waitForSearchPopup(timeoutMs = 45000): Promise<CpiSearchPopup | null> {
    const toasts = this.page.locator(
      '.forceToastMessage.slds-notify--toast, .slds-notify--toast.forceToastMessage'
    );
    try {
      await toasts.first().waitFor({ state: 'visible', timeout: timeoutMs });
      // Read immediately — No Results toast can vanish within ~1s
      const immediate = await this.readVisibleToasts(toasts);
      await this.page.waitForTimeout(500);
      const later = await this.readVisibleToasts(toasts);
      const merged = [...later, ...immediate];
      return (
        merged.find((p) => /Showing only the top/i.test(p.message)) ??
        merged.find(
          (p) =>
            /No Results/i.test(p.title) ||
            /No eligible offers match your search criteria/i.test(p.message)
        ) ??
        immediate[0] ??
        later[0] ??
        null
      );
    } catch {
      return null;
    }
  }

  getLastSearchPopup(): CpiSearchPopup | null {
    return this.lastSearchPopup;
  }

  /** Log Success / No Results / error toast captured during Search click. */
  logSearchPopup(testKey: string): CpiSearchPopup | null {
    const popup = this.getLastSearchPopup();
    if (popup) {
      console.log(`[${testKey}] Search popup [${popup.type}]: ${popup.title} — ${popup.message}`);
    } else {
      console.log(`[${testKey}] Search popup message: (none displayed)`);
    }
    return popup;
  }
  /**
 * Log CPI Search grid data to the console (debug / inspection).
 * Uses friendly column names from COLUMN_ALIASES (e.g. 'SKU', 'Applicable Rebate %').
 */
async logGridData(
  testKey: string,
  columns: string[] = [
    'SKU',
    'Applicable Rebate %',
    'Portfolio',
    'Geographic Location',
    'CPI Period',
  ],
  maxRows?: number
): Promise<void> {
  const rowCount = await this.getResultRowCount();
  const rowsToLog = maxRows ? Math.min(rowCount, maxRows) : rowCount;

  console.log(`[${testKey}] Grid rows: ${rowCount}${maxRows ? ` (logging first ${rowsToLog})` : ''}`);

  if (rowCount === 0) {
    console.log(`[${testKey}] Grid is empty`);
    return;
  }

  for (let i = 0; i < rowsToLog; i++) {
    const row: Record<string, string> = {};
    for (const column of columns) {
      row[column] = await this.getCellValue(i, column);
    }
    console.log(`[${testKey}] Row ${i + 1}:`, row);
  }
}

  /**
   * Post-Search pattern:
   * 1) log popup from Search click
   * 2) read SKU column from grid
   * 3) if empty, log "No item exists"
   * 4) expect at least one result row
   */
  async assertSearchReturnedSkuRows(
    testKey: string,
    contextLabel?: string
  ): Promise<string[]> {
    const popup = this.logSearchPopup(testKey);
    const skuValues = await this.getColumnValues('SKU');
    if (skuValues.length === 0) {
      console.log(
        `[${testKey}] No item exists${contextLabel ? ` for ${contextLabel}` : ''}`
      );
      if (popup) {
        console.log(
          `[${testKey}] No-item popup was [${popup.type}]: ${popup.title} — ${popup.message}`
        );
      }
    }
    expect(skuValues.length, 'Search should return at least one result row').toBeGreaterThan(0);
    return skuValues;
  }

  private async getGridColumnIndex(columnName: string): Promise<number> {
    const resolved = this.resolveColumnName(columnName);
    const headers = this.resultsGrid.getByRole('columnheader');
    const count = await headers.count();
    for (let i = 0; i < count; i++) {
      const text = (await headers.nth(i).innerText()).trim();
      if (text === resolved || text.includes(resolved)) {
        return i;
      }
    }
    throw new Error(`Column "${columnName}" not found in CPI Search grid`);
  }

  async getResultRowCount(): Promise<number> {
    if (await this.emptyState.isVisible().catch(() => false)) {
      return 0;
    }
    const dataRows = this.resultsGrid.getByRole('row').filter({
      has: this.page.getByRole('gridcell'),
    });
    return dataRows.count();
  }

  async getColumnValues(columnName: string): Promise<string[]> {
    if (await this.emptyState.isVisible().catch(() => false)) {
      return [];
    }
    const colIndex = await this.getGridColumnIndex(columnName);
    const dataRows = this.resultsGrid.getByRole('row').filter({
      has: this.page.getByRole('gridcell'),
    });
    const count = await dataRows.count();
    const values: string[] = [];
    for (let i = 0; i < count; i++) {
      values.push(
        (await dataRows.nth(i).getByRole('gridcell').nth(colIndex).innerText()).trim()
      );
    }
    return values;
  }

  async getCellValue(rowIndex: number, columnName: string): Promise<string> {
    const colIndex = await this.getGridColumnIndex(columnName);
    const dataRows = this.resultsGrid.getByRole('row').filter({
      has: this.page.getByRole('gridcell'),
    });
    return (await dataRows.nth(rowIndex).getByRole('gridcell').nth(colIndex).innerText()).trim();
  }

  async assertSkuInResults(sku: string): Promise<void> {
    const values = await this.getColumnValues('SKU');
    expect(values).toContain(sku);
  }

  async assertSkuNotInResults(sku: string): Promise<void> {
    const values = await this.getColumnValues('SKU');
    expect(values).not.toContain(sku);
  }

  async clickColumnHeader(columnName: string): Promise<void> {
    const resolved = this.resolveColumnName(columnName);
    await this.resultsGrid.getByRole('button', { name: resolved, exact: true }).click();
    // Datatable re-sort + re-render can take >1s on large result sets
    await this.page.waitForTimeout(2000);
  }

  private async getColumnHeader(columnName: string): Promise<Locator> {
    const colIndex = await this.getGridColumnIndex(columnName);
    return this.resultsGrid.getByRole('columnheader').nth(colIndex);
  }

  /**
   * XRL datatable sort state from header icons (aria-sort stays "none").
   * Cycle: none → arrowup (asc) → arrowdown (desc) → none.
   */
  async getColumnSortDirection(columnName: string): Promise<'asc' | 'desc' | 'none'> {
    const header = await this.getColumnHeader(columnName);
    const icons = header.locator('lightning-icon');
    const count = await icons.count();
    for (let i = 0; i < count; i++) {
      const name = (await icons.nth(i).getAttribute('icon-name')) || '';
      if (name === 'utility:arrowup') return 'asc';
      if (name === 'utility:arrowdown') return 'desc';
    }
    return 'none';
  }

  async assertColumnSortDirection(
    columnName: string,
    expected: 'asc' | 'desc' | 'none'
  ): Promise<void> {
    const actual = await this.getColumnSortDirection(columnName);
    expect(actual, `${columnName} sort direction`).toBe(expected);
  }

  /** Parse PARTNER REBATE % cell text (e.g. "12.00%") to numbers for sort checks. */
  private parseRebatePercents(values: string[]): number[] {
    return values
      .map((v) => parseFloat(v.replace(/[^0-9.-]/g, '')))
      .filter((n) => !Number.isNaN(n));
  }

  /** Default CPI results: PARTNER REBATE % highest → lowest (numeric). */
  async assertDefaultSortByRebateDesc(): Promise<void> {
    const numeric = this.parseRebatePercents(
      await this.getColumnValues('Applicable Rebate %')
    );
    for (let i = 1; i < numeric.length; i++) {
      expect(numeric[i - 1]).toBeGreaterThanOrEqual(numeric[i]);
    }
  }

  /** After toggling PARTNER REBATE % sort: lowest → highest (numeric). */
  async assertSortByRebateAsc(): Promise<void> {
    const numeric = this.parseRebatePercents(
      await this.getColumnValues('Applicable Rebate %')
    );
    for (let i = 1; i < numeric.length; i++) {
      expect(numeric[i - 1]).toBeLessThanOrEqual(numeric[i]);
    }
  }

  /**
   * XRL/Lightning datatable uses ASCII code-point order (not localeCompare).
   * localeCompare mis-orders SKUs that contain +, =, etc.
   */
  private compareAscii(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  async assertSortAscending(columnName: string): Promise<void> {
    const values = await this.getColumnValues(columnName);
    const expected = [...values].sort((a, b) => this.compareAscii(a, b));
    expect(values).toEqual(expected);
  }

  async assertSortDescending(columnName: string): Promise<void> {
    const values = await this.getColumnValues(columnName);
    const expected = [...values].sort((a, b) => this.compareAscii(b, a));
    expect(values).toEqual(expected);
  }

  async assertEmptyStateVisible(): Promise<void> {
    await expect(this.emptyState).toBeVisible({ timeout: 30000 });
  }

  async assertMinLengthValidationVisible(): Promise<void> {
    await expect(this.minLengthValidation).toBeVisible({ timeout: 10000 });
    console.log('Min length validation visible');
  }

  /**
   * Reads the Cisco SKU field inline error (shown when input is 1–2 characters).
   * Live text: "Enter at least 3 characters or leave empty to search all SKUs."
   */
  async getMinLengthValidationMessage(): Promise<string> {
    await expect(this.minLengthValidation).toBeVisible({ timeout: 10000 });
    const raw = ((await this.minLengthValidation.innerText()) || '').replace(/\s+/g, ' ').trim();
    // Assistive label "Cisco SKU" is nested inside the help div — strip it from the message
    return raw.replace(/^Cisco SKU\s*/i, '').trim();
  }

  /**
   * Returns the toast body from the latest Search (captured in clickSearch).
   * Falls back to a short wait if nothing was stored yet.
   */
  async getToastMessage(): Promise<string> {
    if (this.lastSearchPopup?.message) {
      return this.lastSearchPopup.message;
    }
    const popup = await this.waitForSearchPopup(3000);
    this.lastSearchPopup = popup;
    return popup?.message ?? '';
  }

  /**
   * Asserts Success trim toast for the selected Limit, e.g.
   * "Showing only the top 100 matches out of 32000" or
   * "Showing only the top 1000 matches out of …".
   */
  async assertTrimToast(limit: number | string): Promise<void> {
    const toast = await this.getToastMessage();
    const pattern = new RegExp(`Showing only the top\\s+${limit}\\s+matches`, 'i');
    console.log(`[trim toast] actual: ${toast || '(none displayed)'}`);
    console.log(`[trim toast] expected partial: Showing only the top ${limit} matches`);
    expect(toast, `Success toast should include limit ${limit}`).toMatch(pattern);
  }

  async assertSkuInputValue(expected: string): Promise<void> {
    await expect(this.skuInput).toHaveValue(expected);
  }

  /** Click Search without waiting for toast (used for inline field validation). */
  async clickSearchButtonOnly(): Promise<void> {
    await this.searchButton.click();
    console.log('Clicked Search without waiting for toast');
  }

  async assertEffectiveDateVisible(): Promise<void> {
    await expect(this.effectiveDateInput).toBeVisible();
  }

  async assertLimitSelected(limit: string): Promise<void> {
    await expect(this.page.getByRole('combobox', { name: 'Limit' })).toContainText(limit);
  }

  async assertAllSkuValuesEqual(expected: string, skuValues?: string[]): Promise<void> {
    const values = skuValues ?? (await this.getColumnValues('SKU'));
    for (let row = 0; row < values.length; row++) {
      expect(
        values[row],
        `Row ${row + 1} SKU (PART NUMBER) cell must be '${expected}', got '${values[row]}'`
      ).toBe(expected);
      console.log(`Row ${row + 1} SKU (PART NUMBER) cell is '${values[row]}', expected '${expected}'`);
    }
  }

  async assertAllSkuValuesContain(substring: string, skuValues?: string[]): Promise<void> {
    const values = skuValues ?? (await this.getColumnValues('SKU'));
    for (let row = 0; row < values.length; row++) {
      expect(
        values[row],
        `Row ${row + 1} SKU (PART NUMBER) must contain '${substring}', got '${values[row]}'`
      ).toContain(substring);
      console.log(`Row ${row + 1} SKU (PART NUMBER) cell contains '${values[row]}', expected '${substring}'`);
    }
  }

  async assertAllSkuValuesStartWith(
    prefix: string,
    testKey?: string,
    skuValues?: string[]
  ): Promise<void> {
    const values = skuValues ?? (await this.getColumnValues('SKU'));
    if (testKey) {
      console.log(`[${testKey}] SKUs starting with '${prefix}' (${values.length} row(s)):`);
    }
    for (let row = 0; row < values.length; row++) {
      if (testKey) console.log(`[${testKey}] Row ${row + 1}: ${values[row]}`);
      expect(
        values[row].startsWith(prefix),
        `Row ${row + 1} SKU (PART NUMBER) must start with '${prefix}', got '${values[row]}'`
      ).toBe(true);
    }
  }

  async assertAllSkuValuesEndWith(
    suffix: string,
    testKey?: string,
    skuValues?: string[]
  ): Promise<void> {
    const values = skuValues ?? (await this.getColumnValues('SKU'));
    if (testKey) {
      console.log(`[${testKey}] SKUs ending with '${suffix}' (${values.length} row(s)):`);
    }
    for (let row = 0; row < values.length; row++) {
      if (testKey) console.log(`[${testKey}] Row ${row + 1}: ${values[row]}`);
      expect(
        values[row].endsWith(suffix),
        `Row ${row + 1} SKU (PART NUMBER) must end with '${suffix}', got '${values[row]}'`
      ).toBe(true);
    }
  }

  async assertAllColumnValuesEqual(columnName: string, expected: string): Promise<void> {
    const values = await this.getColumnValues(columnName);
    for (let row = 0; row < values.length; row++) {
      expect(
        values[row],
        `Row ${row + 1} ${columnName} must be '${expected}', got '${values[row]}'`
      ).toBe(expected);
    }
  }

  async assertGeographyValuesMatch(geography: string): Promise<void> {
    const geoValues = await this.getColumnValues('Geographic Location');
    const nonBlankGeo = geoValues.filter((g) => g.trim() !== '');
    for (let row = 0; row < nonBlankGeo.length; row++) {
      expect(
        nonBlankGeo[row],
        `Row GEOGRAPHY '${nonBlankGeo[row]}' should match '${geography}'`
      ).toMatch(new RegExp(`${geography}|US`, 'i'));
    }
  }

  async assertRowCountAtMost(limit: number | string): Promise<void> {
    const skuValues = await this.getColumnValues('SKU');
    expect(skuValues.length).toBeLessThanOrEqual(Number(limit));
    console.log(`Row count at most ${limit} is ${skuValues.length}`);
  }

  async assertNoMatchToast(testKey?: string): Promise<void> {
    const popup = this.getLastSearchPopup();
    const toastTitle = popup?.title ?? '(none)';
    const toastMessage = popup?.message ?? '(none displayed)';
    if (testKey) {
      console.log(`[${testKey}] toast title: ${toastTitle}`);
      console.log(`[${testKey}] toast message: ${toastMessage}`);
      console.log(
        `[${testKey}] expected: No Results / No eligible offers match your search criteria.`
      );
    }
    expect(toastMessage).toMatch(/No eligible offers match your search criteria\.?/i);
  }

  async assertServiceSkuDetailColumnsPopulated(): Promise<void> {
    const geo = await this.getCellValue(0, 'Geographic Location');
    const gsp = await this.getCellValue(0, 'GSP');
    const tiers = await this.getCellValue(0, 'Service Tiers');
    expect(geo.trim()).not.toBe('');
    expect(gsp.trim()).not.toBe('');
    expect(tiers.trim()).not.toBe('');
  }

  async assertNonServiceSkuDetailColumnsBlank(): Promise<void> {
    const geo = await this.getCellValue(0, 'Geographic Location');
    const gsp = await this.getCellValue(0, 'GSP');
    const tiers = await this.getCellValue(0, 'Service Tiers');
    expect(geo.trim()).toBe('');
    expect(gsp.trim()).toBe('');
    expect(tiers.trim()).toBe('');
  }

  async assertGridReadOnly(): Promise<void> {
    const editableInputs = this.resultsGrid.locator('input, textarea');
    await expect(editableInputs).toHaveCount(0);
  }

  async assertAccessDenied(): Promise<void> {
    await expect(this.page.getByText(/Access Denied/i)).toBeVisible({ timeout: 30000 });
  }

  async assertGwErrorState(): Promise<void> {
    const friendlyError = this.page.getByText(/error|unavailable|try again|retry/i);
    await expect(friendlyError.first()).toBeVisible({ timeout: 30000 });
    await expect(this.emptyState).not.toBeVisible();
  }
}
