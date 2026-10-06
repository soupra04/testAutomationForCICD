import { Page, Locator, expect } from "@playwright/test";
import { get } from "http";
import {SalesforceUtils} from "../utils/sfUtils";

//===================================================
// Buttons defaults
//===================================================

export class XRLUtils {
  private sf: SalesforceUtils;
  constructor(private page: Page) {
    this.sf = new SalesforceUtils(page);
  }

  /**
   * Returns a related list locator by its header text.
   * Works for custom related lists with `xrl-extrellist_extrellist`.
   */
  getXRLByName(name: string): Locator {
    return this.page.locator(
      `article[xrl-extrellist_extrellist]:has(lightning-formatted-rich-text span:has-text("${name}"))`
    );
  }

  /**
   * Validates if a related list is visible by name.
   */
  async expectXRLVisible(name: string, timeout = 10000): Promise<void> {
    const relatedList = this.getXRLByName(name);
    await expect(relatedList).toBeVisible({ timeout });
  }

  /**
   * Checks if related list exists in DOM (not necessarily visible).
   */
  async XRLExists(name: string): Promise<boolean> {
    const relatedList = this.getXRLByName(name);
    return (await relatedList.count()) > 0;
  } 

  /**
   * UI renders Created Date From/To as two sections that share data-id="CreatedDate".
   * Excel/automation uses CreatedDatee as an alias for the Created Date To section.
   */
  private getServerCreatedDateSection(dataId: 'CreatedDate' | 'CreatedDatee'): Locator {
    const panel = this.page.getByRole('tabpanel', { name: 'Search Quotes' });
    const label = dataId === 'CreatedDatee' ? 'Created Date To' : 'Created Date From';
    // Both From/To share data-id="CreatedDate"; disambiguate by section label.
    // Inner locators in `has` are resolved relative to each layout item.
    return panel
      .locator('lightning-layout-item')
      .filter({ has: this.page.getByText(label, { exact: true }) })
      .filter({ has: this.page.locator('c-multiselect[data-id="CreatedDate"]') })
      .first();
  }

  private getServerCreatedDateFilter(dataId: 'CreatedDate' | 'CreatedDatee'): Locator {
    return this.getServerCreatedDateSection(dataId).locator('c-multiselect[data-id="CreatedDate"]').first();
  }

  /**
   * Removes the Server Side Filters that were selected from dropdown.
   */
  async clickCrossOnServerFilter(dataId: any, tab?: string){
    const originalDataId = dataId;

    if(['CreatedById','CreatedDate','CreatedDatee'].includes(dataId) && !tab){
      dataId = dataId;
    }
    else if(['OwnerId'].includes(dataId) && tab === 'searchQuoteItems'){
      dataId = `${process.env.SF_ORG_PREFIX}__CustomerBoM__r.${dataId}`;
    }
    else if(!['Part_Number','Description','Item_Type'].includes(dataId) && tab === 'searchQuoteItems'){
      dataId = `${process.env.SF_ORG_PREFIX}__CustomerBoM__r.${process.env.SF_ORG_PREFIX}__${dataId}__c`;
    }
    else{
      dataId = `${process.env.SF_ORG_PREFIX}__${dataId}__c`;
    }

    const locator =
      originalDataId === 'CreatedDatee' && !tab
        ? this.getServerCreatedDateSection('CreatedDatee').locator('button[title="Clear"]')
        : originalDataId === 'CreatedDate' && !tab
          ? this.getServerCreatedDateSection('CreatedDate').locator('button[title="Clear"]')
          : this.page.locator(`c-multiselect[data-id="${dataId}"] button[title="Clear"]`);
    if(await locator.count()>0){
        await locator.click();
        if (!['CreatedDate', 'CreatedDatee'].includes(originalDataId)) {
          await this.page.locator('div[title="Add remaining filters."]').click();
        }
    }
    else{return 0;}
  }

  // ===================================================
  // Server Filters (Visible without clicking "+" icon)
  // ===================================================


  getFilter(dataId: string): Locator {
    return this.page.locator(`[data-id="${dataId}"]`);
  }

  /**
   * Select a filter operator (optional)
   * Example: ==, !=, <, >, contains
   */
  async selectOperator(dataId: string, operator?: string) {
    if (!operator) return; // skip if operator is not provided

    const filter = this.getFilter(dataId);

    // Locate the operator button inside <c-filter-options>
    const operatorButton = filter.locator("c-filter-options button");

    await operatorButton.click();

    // Select operator from dropdown list
    await this.page.locator(`.slds-dropdown a:has-text("${operator}")`).click();
  }

    async selectDropdownOption(dropdownLocator: string, optionText: string) {
    // Open dropdown
    const dropdownTrigger = this.page.locator(dropdownLocator);
    await dropdownTrigger.click();

    // Wait for listbox to appear
    const listbox = this.page.locator('div[role="listbox"]');
    await expect(listbox).toBeVisible({ timeout: 10000 });

    // Match the listbox option exactly (avoid substring matches like "All" → "Allied Technologies")
    const option = listbox.getByRole('option', { name: optionText, exact: true });

    // Ensure it’s visible
    await expect(option).toBeVisible({ timeout: 10000 });

    // Click it
    await option.click();

    console.log(`✅ Selected option: ${optionText}`);
  }


  /**
   * Insert or select a value in the filter input
   * Works for multiselect, text, and date fields
   */
  async setValue(dataId: string, value: string) {
    const filter = this.getFilter(dataId);

    const tagName = await filter.evaluate(el => el.tagName.toLowerCase());
    console.log(`🔎 Filter tag: ${tagName}`);

    // Case 1: Multi-select
    if (tagName === "c-multiselect") {
      const input = filter.locator('input[type="text"]');
      await input.click();
      await input.fill(value);

      const listbox = this.page.locator('div[role="listbox"]');
      await listbox.waitFor({ state: "visible", timeout: 20000 });

      const option = listbox.locator(".slds-truncate", { hasText: value }).first(); // if same names present select first option
      await option.waitFor({ state: "visible", timeout: 20000 });
      await option.click();

      console.log(`✅ Selected from multiselect: ${value}`);
      return;
    }

    // Case 2: Lightning combobox
    if (tagName === "lightning-base-combobox") {
      const input = filter.locator("input");
      await input.click();
      await input.fill(value);

      const listbox = this.page.locator('div[role="listbox"]');
      await listbox.waitFor({ state: "visible", timeout: 10000 });

      const option = listbox.locator(".slds-truncate", { hasText: value });
      await option.waitFor({ state: "visible", timeout: 10000 });
      await option.click();

      console.log(`✅ Selected from dropdown: ${value}`);
      return;
    }

    // Case 3: Plain input
    if (await filter.locator("input").count()) {
      const input = filter.locator("input");
      await input.fill(value);
      console.log(`✅ Filled plain input: ${value}`);
      return;
    }

    throw new Error(`❌ No valid input found for filter with data-id=${dataId}`);
  }

  /**
   * Convenience: optionally select operator and set value
   */
  async applyFilter(dataId: string, value: string, operator?: string, tab?: string, dropdwnNo?: any) {
    //---------dataId selection Logic---------------
    if(['CreatedById','CreatedDate','CreatedDatee'].includes(dataId) && !tab){
      dataId = dataId;
    }
    else if(['Name','OwnerId'].includes(dataId) && tab === 'searchQuoteItems'){
      dataId = `${process.env.SF_ORG_PREFIX}__CustomerBoM__r.${dataId}`
    }
    else if(!['Part_Number','Description', 'Item_Type'].includes(dataId) && tab === 'searchQuoteItems'){
      dataId = `${process.env.SF_ORG_PREFIX}__CustomerBoM__r.${process.env.SF_ORG_PREFIX}__${dataId}__c`
    }
    else{
      dataId = `${process.env.SF_ORG_PREFIX}__${dataId}__c`;
    }
    //---------Operator selection Logic---------------
    if(!tab){ // if tab is search Quote Items skip this logic
      await this. selectOperator(dataId, operator);
    }
    else{
      await this.slctOpertrInSrchItms(dropdwnNo, operator);
    }
    //---------value selection Logic---------------
    if(['CreatedDate','CreatedDatee'].includes(dataId)){
      await this.pickDate(dataId, value);
    }
    else{
      await this.setValue(dataId, value);
    }
    
  }

  /**
   * Excel/Zephyr dates use DD/MM/YYYY; Lightning date inputs expect US MM/DD/YYYY.
   * Examples: 16/12/2025 -> 12/16/2025, 11/1/2025 -> 01/11/2025.
   */
  private toUsDateFormat(dateStr: string): string {
    const match = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return dateStr;

    const n1 = parseInt(match[1], 10);
    const n2 = parseInt(match[2], 10);
    const year = match[3];
    let month: number;
    let day: number;

    if (n1 > 12) {
      day = n1;
      month = n2;
    } else if (n2 > 12) {
      month = n1;
      day = n2;
    } else {
      // Ambiguous values like 11/1/2025 follow DD/MM in Excel test data.
      day = n1;
      month = n2;
    }

    return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
  }

  /** True when Excel/Zephyr value is a literal date (not a preset like "Today"). */
  private isCustomDateValue(value: string): boolean {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return false;

    // Relative presets shown in the date-filter listbox
    if (
      /^(today|yesterday|tomorrow)$/i.test(trimmed) ||
      /^(this|last|next|current)\s+/i.test(trimmed)
    ) {
      return false;
    }

    // Literal dates: 1/1/2026, 2026-01-01, Jan 1, 2026, 1-Jan-26 (+ optional time)
    return (
      /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(trimmed) ||
      /^\d{4}-\d{2}-\d{2}/.test(trimmed) ||
      /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}/.test(trimmed) ||
      /^\d{1,2}-[A-Za-z]{3,9}-\d{2,4}/.test(trimmed)
    );
  }

  /** Normalize Excel date/time strings for remaining-filters datepicker (e.g. "Jan 1, 2026"). */
  private formatFilterDateForPicker(value: string): string {
    const trimmed = String(value ?? '').trim();
    // Drop trailing time: "1/1/2026 0:00" / "2026-03-31 00:00:00"
    const withoutTime = trimmed.replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, '').trim();

    const toUiShort = (parsed: Date): string =>
      parsed.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

    // UI short form already: "Jan 1, 2026"
    const uiMatch = withoutTime.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (uiMatch) {
      const parsed = new Date(`${uiMatch[1]} ${uiMatch[2]}, ${uiMatch[3]}`);
      if (!Number.isNaN(parsed.getTime())) return toUiShort(parsed);
    }

    // Excel day-month-year: "1-Jan-2026"
    const excelMatch = withoutTime.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{2}|\d{4})$/);
    if (excelMatch) {
      const day = excelMatch[1];
      const month = excelMatch[2];
      const year = excelMatch[3].length === 2 ? `20${excelMatch[3]}` : excelMatch[3];
      const parsed = new Date(`${month} ${day}, ${year}`);
      if (!Number.isNaN(parsed.getTime())) return toUiShort(parsed);
    }

    let parsed: Date;
    if (withoutTime.includes('/')) {
      const datePart = withoutTime.split(/\s+/)[0];
      const us = this.toUsDateFormat(datePart);
      const [month, day, year] = us.split('/').map((part) => parseInt(part, 10));
      parsed = new Date(year, month - 1, day);
    } else {
      parsed = new Date(
        withoutTime.includes('T') ? withoutTime : `${withoutTime}T12:00:00`
      );
    }
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Unable to parse filter date: "${value}"`);
    }
    return toUiShort(parsed);
  }

  private async saveCustomDatePicker(filter: Locator, section: Locator): Promise<void> {
    const sectionSave = section.getByRole('button', { name: 'Save', exact: true });
    if (await sectionSave.count()) {
      await sectionSave.click({ force: true });
      return;
    }
    const candidates = [
      filter.locator('button:has-text("Save")'),
      section.locator('button:has-text("Save")'),
    ];
    for (const locator of candidates) {
      if (await locator.count()) {
        await locator.first().click({ force: true });
        return;
      }
    }
    throw new Error('Custom date picker Save button not found');
  }

  /**
   * Picks a date in a server-side date filter (CreatedDate / CreatedDatee).
   * Supports preset options (e.g. "Today") and custom dates via the Custom picker.
   * Pass `root` (e.g. remaining-filters dialog) when the filter is not on the main tabpanel.
   */
  async pickDate(dataId: any, value: any, root?: Locator) {
    let section: Locator;
    let filter: Locator;

    if (dataId === 'CreatedDate' || dataId === 'CreatedDatee') {
      section = this.getServerCreatedDateSection(dataId);
      filter = section.locator('c-multiselect[data-id="CreatedDate"]').first();
    } else if (root) {
      filter = root.locator(`c-multiselect[data-id="${dataId}"]`).first();
      section = filter.locator('xpath=ancestor::lightning-layout-item[1]');
    } else {
      section = this.page
        .locator('[role="tabpanel"]:not([hidden])')
        .locator(`[data-id="${dataId}"]`)
        .first()
        .locator('xpath=ancestor::lightning-layout-item[1]');
      filter = section;
    }

    const input = filter.locator('input').first();
    await input.click();

    const listbox = this.page.locator('div[role="listbox"]');
    await listbox.waitFor({ state: 'visible', timeout: 10000 });

    // Preset option — e.g. "Today", "Last Month"
    if (!this.isCustomDateValue(value)) {
      await listbox.locator('.slds-truncate', { hasText: value }).click();
      return;
    }

    // Custom date — open the date picker, fill, and save
    await listbox.locator('.slds-truncate', { hasText: /^CUSTOM$/i }).click();

    const formatted = this.formatFilterDateForPicker(value);
    console.log(`[pickDate] data-id=${dataId} excel="${value}" picker="${formatted}"`);

    const datePicker = filter.locator('lightning-datepicker input').first();
    await datePicker.waitFor({ state: 'visible', timeout: 10000 });
    await datePicker.click();
    await datePicker.fill(formatted);
    await datePicker.press('Tab');
    await this.saveCustomDatePicker(filter, section);
    await this.page.waitForTimeout(500);
    await this.page.keyboard.press('Escape').catch(() => undefined);
  }

  async slctOpertrInSrchItms(locatorNo: any, operator: any){
    if(!operator){return 0;}
    await this.page.locator("c-filter-options button").nth(locatorNo+3-1).click();
    // Select operator from dropdown list
    await this.page.getByText(operator, { exact: true }).click();
  }

  async showErrors(){
    const messageLoc = await this.page.locator('span[class="toastMessage forceActionsText"][data-aura-class="forceActionsText"]');    
    try {
        await messageLoc.waitFor({ state: 'visible', timeout: 5000 });
      } catch {
        // If it didn’t show within the window, return success code
        return 0;
      }

    if(await messageLoc.count()>0){
      const message = await this.sf.getToastMessage();
      throw new Error(message);
    }
    
  }

// ====================================================
//  Actions (Except defaults like 9dots and configure)
// ====================================================

  async clickXRLButtons(dataId: string) {
    const XRLButton = this.page.locator(`lightning-button[data-id='${dataId}'] button`);
    // There might be case when 2 locators have same locator as same page can have 2 Tabs
    // Wait until at least one matching element becomes visible
    // await XRLButton.waitFor({ state: 'visible', timeout: 10000 });
    const count = await XRLButton.count(); 
    if (count === 0) {
        throw new Error(`Button not found for data-id="${dataId}"`);
      }  
    // Logic to click the last matching locator if n matches  
    const lastIndex = count - 1;
    const target = XRLButton.nth(lastIndex);
    await target.scrollIntoViewIfNeeded();
    await target.click();
  }

  async clickIconOnXRLGrid(dataId: string){
    const XRLButton = this.page.locator(`lightning-button-icon[data-id='${dataId}']`)
    // There might be case when 2 locators have same locator as same page can have 2 Tabs
    // Wait until at least one matching element becomes visible
    // await XRLButton.waitFor({ state: 'visible', timeout: 10000 });
    const count = await XRLButton.count();
    
    if (count === 0) {
        throw new Error(`Button not found for data-id="${dataId}"`);
      }  
    // Logic to click the last matching locator if n matches  
    const lastIndex = count - 1;
    const target = XRLButton.nth(lastIndex);
    await target.scrollIntoViewIfNeeded();
    await target.click();
  }

  async clickYesOnconfirmation(){
    await this.page.getByRole('button', { name: 'Yes' }).click();
  }

  async resetServerFilters() {
    const resetBtn = this.page.getByRole('button', { name: 'Reset Filters' });
    if (await resetBtn.isVisible()) {
      await resetBtn.click();
      await this.page.locator('c-data-table').first().waitFor({ state: 'visible', timeout: 60000 });
    }
  }

  async updateNoOfItemsPerPage(number: any){
    // Logic to set the number of items to show on XRL Table
    await this.page.locator(`button[aria-haspopup="listbox"][role="combobox"]`).first().waitFor({ state: 'visible', timeout: 20000 });
    await this.page.locator(`button[aria-haspopup="listbox"][role="combobox"]`).first().click();
    // await this.page.locator(`button[aria-haspopup="listbox"][role="combobox"]`).click();
    await this.page.getByText(`${number}`).last().click();
  }

// ====================================================
// Data Table Utilities
// ====================================================

  async getXRLTable(dataInd:string) {
    const table = this.page.locator(`c-data-table[data-ind='${dataInd}']`);
    await expect(table).toBeVisible({ timeout: 1000000 });
    return table;
  }

  async getTablePagination(PageDataId: String) {
    const pageOptions = await this.page.locator(`lightning-button-icon[data-id='${PageDataId}']`);
    return pageOptions;
  }

  gridStatusBar(): Locator {
    return this.page
      .locator('c-data-table div[xrl-datatable_datatable][class="slds-grid slds-m-around_xx-small"]')
      .first();
  }

  async getGridStatusText(): Promise<string> {
    const statusLocator = this.gridStatusBar();
    await statusLocator.waitFor({ state: 'visible', timeout: 120000 });
    return ((await statusLocator.innerText()) || '').replace(/\s+/g, ' ').trim();
  }

  /** Parse "Loaded N out of M items" from the XRL grid status bar. */
  parseLoadedItemsStatus(text: string): { loaded: number; total: number } | null {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const match = normalized.match(/Loaded\s+(\d+)\s+out\s+of\s+(\d+)\s+items/i);
    if (!match) return null;
    return {
      loaded: parseInt(match[1], 10),
      total: parseInt(match[2], 10),
    };
  }

  /**
   * Wait until Load All finishes — status shows "Loaded N out of N items" with N > 0.
   * Load All is async; the grid may briefly show "Loaded 0 out of M items" first.
   */
  async waitForLoadAllComplete(timeoutMs = 180000): Promise<{ loaded: number; total: number; text: string }> {
    const statusLocator = this.gridStatusBar();
    await statusLocator.waitFor({ state: 'visible', timeout: 120000 });

    let summary: { loaded: number; total: number; text: string } | null = null;
    await expect
      .poll(
        async () => {
          const text = await this.getGridStatusText();
          const counts = this.parseLoadedItemsStatus(text);
          if (counts && counts.loaded > 0 && counts.loaded === counts.total) {
            summary = { ...counts, text };
            return true;
          }
          return false;
        },
        {
          timeout: timeoutMs,
          message: 'Waiting for Load All to complete (Loaded N out of N items)',
        }
      )
      .toBe(true);

    console.log(`Load All complete: ${summary!.text}`);
    return summary!;
  }

  async getCurrentGridPageNumber(): Promise<number> {
    const spinbutton = this.gridStatusBar().getByRole('spinbutton');
    await expect(spinbutton).toBeVisible({ timeout: 30000 });
    return parseInt((await spinbutton.inputValue()) || '0', 10);
  }

  /** Search Quotes grid uses status-bar icon buttons; index 2 is Next Page (MCP-verified). */
  async clickGridNextPage(): Promise<void> {
    const statusBar = this.gridStatusBar();
    await expect(statusBar).toBeVisible({ timeout: 30000 });
    const pageBefore = await this.getCurrentGridPageNumber();
    const nextButton = statusBar.locator('button').nth(2);
    await expect(nextButton).toBeVisible({ timeout: 30000 });
    await expect(nextButton).toBeEnabled({ timeout: 30000 });
    await nextButton.click();
    await expect
      .poll(async () => this.getCurrentGridPageNumber(), {
        timeout: 30000,
        message: `Grid page should advance from ${pageBefore}`,
      })
      .toBe(pageBefore + 1);
    console.log(`Grid page advanced to ${pageBefore + 1}`);
  }

  async getTotalRecords(filterType: any){
    const text = await this.getGridStatusText();
    await expect(text).toMatch(/Loaded \d+ out of|Showing \d+ filtered items|out of \d+ items/i);
    let records = 0;
    if (filterType === "server") {
      // Server filters: compare against the total matching set ("out of N items") after loadAll.
      records = parseInt(text.match(/out of (\d+) items/)?.[1] ?? "0", 10);
    } else if (filterType === "client") {
      // Legacy: "Showing 34 filtered items"; current UI: "Loaded 34 out of 74 items"
      records = parseInt(
        text.match(/Showing (\d+) filtered items/)?.[1]
          ?? text.match(/Loaded (\d+) out of/)?.[1]
          ?? "0",
        10
      );
    }
    console.log(`Number of records loaded on XRL Grid is: ${records} (${filterType})`);
    return records;
  }

  async clickOnSaveBtnOnServerFltr(){
    await this.page.locator('button:has-text("Save")').click();
  }

  async clickOnSaveBtnOnClientFltr(){
    await this.page.getByRole('button', { name: 'Save Filter' }).click();
  }

  async clickTablePagination(PageDataId: String) {
    if (PageDataId === 'nextPage') {
      await this.clickGridNextPage();
      return;
    }
    const button = await this.getTablePagination(PageDataId);
    await button.click();
    console.log(`Clicked on pagination button with data-id: ${PageDataId}`);
  }

  async inputTablePagination(PageDataId: String, pageNumber: number) {
    const input = await this.getTablePagination(PageDataId);
    await input.fill(pageNumber.toString());
    await input.press('Enter');
    console.log(`Navigated to page number: ${pageNumber}`);
  }


// Get column index by header text
  async getColumnIndex(columnName: string): Promise<number> {
    const headers = this.page.locator('table thead tr th');
    const count = await headers.count();

    for (let i = 0; i < count; i++) {
      const text = await headers.nth(i).getAttribute("aria-label");
      console.log(`Header ${i}: ${text}`);
      if ((text ?? '').trim() === columnName) {
        return i;
      }
    }
    throw new Error(`Column "${columnName}" not found`);
  }

  // Get cell value by row number and column name
  async getCellValue(rowIndex: number, columnName: string): Promise<string> {
    const colIndex = await this.getColumnIndex(columnName);
    const cell = this.page.locator('table tbody tr').nth(rowIndex).locator('td').nth(colIndex);
    return cell.innerText();
  }

  // Get all cell values in a column (one value per tbody row, at the resolved column index).
  async getAllCellValues(columnName: string): Promise<string[]> {
    const colIndex = await this.getColumnIndex(columnName);
    const rows = this.page.locator('table tbody tr');
    const count = await rows.count();
    const values: string[] = [];
    for (let i = 0; i < count; i++) {
      values.push((await rows.nth(i).locator('td').nth(colIndex).innerText()).trim());
    }
    return values;
  }

  // Filter table by column value
  async clickOnClientFilter(dataId: string){
    if(dataId === "Name"|| dataId === "CreatedDate"){
      dataId = dataId;
    }
    else{
      dataId = `${process.env.SF_ORG_PREFIX}__${dataId}__c`;
    }
    const filter = await this.page.locator(`lightning-icon[xrl-datatable_datatable][data-id=${dataId}][title="Column Filters"]`);
    await filter.waitFor({state:"visible"});
    await filter.click();
  } 
  
  // Click on the dropdown button for operation selection
  async clickOperationDropdwn(){
    const dropdown = await this.page.locator(`lightning-combobox[data-id="filterOperation"]`);
    await dropdown.waitFor({state:"visible"});
    await dropdown.click();
  }

  // Input the string to filter the Table
  async inputFilterStr(input: string){
    if (!input){return 0;}
    const inputLoc = await this.page.locator(`lightning-input[data-id="filterStr"] input`);
    await inputLoc.waitFor({state:"visible"});
    await inputLoc.click();
    await inputLoc.fill(input);
  }

  // Input the dropdown to filter the Table
  async slctClientFltrInptDropdwn(value: string){
    await this.page.locator('input[class="slds-input"][type="text"][placeholder="Select option"]').last().click();
    await this.page.getByText(value,{exact:true}).nth(0).click();
    // await this.page.locator(`li[class="slds-listbox__item"][role="presentation"][data-value="${value}"]`).click();
  }

  // Input the dropdown to filter the Table based on client filter "Range"
  async inputRange(value: string, clientFilter: string){
    
    let format: 'date' | 'number' | undefined;
    
    // If "Date" key is present on the clientFilter field name, format will be date    
    if (clientFilter?.toLowerCase().includes('date')) {
        format = 'date';
      }

    
    // If date format then select the date locators and put values to respective locators
    if(format === 'date'){ 
      // If input range contains dates   
      const re = /From\s*\[\s*(\d{1,2}\/\d{1,2}\/\d{4})(?:\s*,\s*([0-2]?\d:[0-5]\d\s*[ap]m))?\s*\]\s*To\s*\[\s*(\d{1,2}\/\d{1,2}\/\d{4})(?:\s*,\s*([0-2]?\d:[0-5]\d\s*[ap]m))?\s*\]/i;
      const m = value.match(re);
      if (!m) {
        throw new Error('String does not match expected From/To format.');
      }

      const [, value1, value2Raw, value3, value4Raw] = m;
      const fromDate = this.toUsDateFormat(value1);
      const toDate = this.toUsDateFormat(value3);

      const firstDatePicker = await this.page.locator('lightning-datepicker input').first();
      await firstDatePicker.waitFor({ state: 'visible', timeout: 10000 });
      const secondDatePicker = await this.page.locator('lightning-datepicker input').last();
      await secondDatePicker.waitFor({ state: 'visible', timeout: 10000 });
      const firstTimeloc = await this.page.locator('lightning-timepicker[class="slds-form-element"]').first();
      const secondTimeloc = await this.page.locator('lightning-timepicker[class="slds-form-element"]').last();
      
      await firstDatePicker.click();
      await firstDatePicker.fill(fromDate);
      if (value2Raw) {
        await firstTimeloc.click();
        await firstTimeloc.press('Control+A');
        await firstTimeloc.press('Delete');
        await firstTimeloc.type(value2Raw);
      }

      await secondDatePicker.click();
      await secondDatePicker.fill(toDate);
      if (value4Raw) {
        await secondTimeloc.click();
        await secondTimeloc.press('Control+A');
        await secondTimeloc.press('Delete');
        await secondTimeloc.type(value4Raw);
      }
    }else{      
      // If the input range contains numbers
      const numMatch = value.match(/From\s*\[\s*([+-]?\d+(?:\.\d+)?)\s*\]\s*To\s*\[\s*([+-]?\d+(?:\.\d+)?)\s*\]/i);
      if (!numMatch) {
        throw new Error('String does not match expected From/To numeric format.');
      }
      const [, n1, n2] = numMatch;

      // Type conversion
      const value1 = String(n1);
      const value2 = String(n2);

      const firstloc  = this.page.locator('lightning-input[data-id="filterStr"] input');
      const secondloc = this.page.locator('lightning-input[data-id="filterStrTo"] input');

      // First value
      await firstloc.click();
      await firstloc.type(value1);

      // Second value
      await secondloc.click();
      await secondloc.type(value2);

    }    
  }

  async applyColumnFilterOnXRLTable(columnFilter: string, filterOperation: string, filtrStr: string){
    // Generic method to add column filters on XRL Table
    if(columnFilter === ''){return 0;}    // If no column filter skip the method
    await this.clickOnClientFilter(columnFilter);            
    await this.clickOperationDropdwn();
    await this.page.getByText(filterOperation,{exact:true}).nth(0).click();        // Select filter operation
    if (['Status', 'Quote_Category', 'Item_Type']. includes(columnFilter)){
            await this.slctClientFltrInptDropdwn(filtrStr);
        }
        else if (columnFilter === 'Range'){
            await this.inputRange(filtrStr, columnFilter);
        }
        else{
            await this.inputFilterStr(filtrStr);
        }            
    await this.clickOnSaveBtnOnClientFltr();
  }

  // Used in Supplier Assignent Grid
  async clickCheckbox(boxNumber: any){
        // Clicks the checkbox that is given by the user
        const serialNo = boxNumber-1; // as the numbering starts from 0
        const checkbox = await this.page.locator('tr[xrl-datatable_datatable][style="undefined"] input[class="custom-checkbox"]');
        // Check if the checkbox exists, if exists click it
        try{               
            await checkbox.nth(serialNo).waitFor({ state: 'visible', timeout: 10000 });
            await checkbox.nth(serialNo).click();
        } catch (error) {
            console.error(`Checkbox ${boxNumber} not found:`, error);
            return;             
        }           
    }

    async clkCheckboxFrmList(rowsToSelect: any){
        // Clicks on the list of checkboxes given by the user
        // rowNumber: [1,2,3]
        if (rowsToSelect.length === 0) {return 0;}
        // await this.page.waitForTimeout(6000);
        const rowNumber = JSON.parse(rowsToSelect);
        for (let i = 0; i < rowNumber.length; i++) {
            // select the row by rowNumber[i]
            console.log(`Trying to Click checkbox: ${rowNumber[i]}`);
            // await this.page.waitForTimeout(3000);
            let currRow = rowNumber[i];
            await this.clickCheckbox(currRow);
        }     
    }
}