import { Locator, Page, errors, expect } from "@playwright/test";
import { TestContext } from '../utils/testContext';
import dotenv from "dotenv";
dotenv.config();
import { SalesforceUtils } from "../utils/sfUtils";
import { TestingUtils } from "../utils/testingUtils";
import { XRLUtils } from "../utils/xrlUtils";
import { AdvanceUi } from "../utils/advUi";
import * as XLSX from "xlsx";
import { count, error, log, table, time } from "console";
import { QUOTE_TEST_DATA, BOMs_TO_COPY, XRL_OFFSET } from "../assets/test_data_constants";
import { getExcelData } from "../utils/excelReader";
import { TIMEOUT } from "dns";
import { globalVars } from "../libs/lib";
import {
    selectAllButtonLocator,
    deleteButtonLocator,
    goToEditQuoteGridChevronName,
    goToCopyBoMItems,
    goToSelectBomsChevronName,
    untieButtonLocator,
} from "../pages/editQuoteGridPage";
import { QuotePage, quoteHeaderPricingFields } from "../pages/quotePage";
import { BomService } from "./bom-service";
import { Connection } from "jsforce";
import { getEnv, hydrateSfVarsIntoProcessEnv } from "../utils/envConfig";

hydrateSfVarsIntoProcessEnv();
const SF_INSTANCE_URL = process.env.SF_INSTANCE_URL;

export class QuoteService {
    private page: Page;
    private quote: SalesforceUtils;
    private test: TestingUtils;
    private advui: AdvanceUi;
    private xrl: XRLUtils;
    /** Namespace prefix; defaults to SF_ORG_PREFIX (optional override for rare cases). */
    private orgPrefix: string;

    constructor(page: Page, opts?: { orgPrefix?: string }) {
        this.page = page;
        this.orgPrefix = (opts?.orgPrefix ?? getEnv("SF_ORG_PREFIX") ?? "").trim();
        this.quote = new SalesforceUtils(page);
        this.test = new TestingUtils(page);
        this.advui = new AdvanceUi(page);
        this.xrl = new XRLUtils(page);
    }

    async openSupplierGrid(quoteId: any) {
        // Open the Supplier Grid
        // const quoteId = await this.findTestQuote();
        if (quoteId) {
            await this.page.goto(`${SF_INSTANCE_URL}/lightning/r/${this.orgPrefix}__CustomerBoM__c/${quoteId}/view`);
            await this.page.waitForTimeout(6000); // Wait for the page to load completely
            await this.page.getByRole('button', { name: 'Show more actions' }).click();
            // await this.page.locator('button', { has: this.page.locator('span', { hasText: 'Show more actions' }) }).click();
            await this.page.getByRole('menuitem', { name: 'Supplier Assignment' }).click();
            await this.page.waitForTimeout(9000); // Wait for the Supplier Grid to load                 
        } else {
            console.error("No test quote found.");
        }
    }

    private isSelectableManufacturerOption(title: string, currentValue: string): boolean {
        const normalized = title.trim();
        if (!normalized || normalized === currentValue.trim()) return false;
        if (/^--\s*none\s*--$/i.test(normalized)) return false;
        if (/^--\s*select\s*--$/i.test(normalized)) return false;
        return true;
    }

    /** Persist pending edits on the Supplier Assignment XRL grid. */
    async saveSupplierAssignmentGrid(): Promise<void> {
        await this.page.locator('c-data-table').first().waitFor({ state: 'visible', timeout: 30000 });
        // Do not press Escape here — it closes the Supplier Assignment view and removes the save toolbar.
        await this.page.keyboard.press('Tab').catch(() => undefined);
        await this.page.waitForTimeout(500);

        const saveButtons = this.page.locator(`lightning-button-icon[data-id=':save']`);
        const count = await saveButtons.count();
        if (count > 0) {
            const target = saveButtons.nth(count - 1);
            await target.scrollIntoViewIfNeeded();
            await target.click();
        } else {
            console.log('[Supplier Grid] Save icon not found; falling back to Control+S');
            await this.page.keyboard.press('Control+S');
        }
        await this.page.waitForLoadState('domcontentloaded');
    }

    /** Read Manufacturer cell text on Supplier Assignment grid (1-based item number). */
    async getManufacturerCellValue(itemNo: number): Promise<string> {
        const row = itemNo - 1;
        const manufacturerCell = this.page
            .locator(
                `td[data-colname="${this.orgPrefix}__Manufacturer__c"][role="gridcell"][data-rowind="${row}"]`
            )
            .first();
        return ((await manufacturerCell.textContent()) ?? '').trim();
    }

    /**
     * Open Manufacturer lookup on one row, log the current cell value, and pick a different
     * dropdown option (uses searchHint to filter options when provided, e.g. "Cisco").
     */
    async changeManufacturerToDifferentOption(
        itemNo: number,
        searchHint?: string
    ): Promise<{ current: string; selected: string }> {
        const row = itemNo - 1;
        const manufacturerCell = this.page
            .locator(
                `td[data-colname="${this.orgPrefix}__Manufacturer__c"][role="gridcell"][data-rowind="${row}"]`
            )
            .first();
        const currentValue = ((await manufacturerCell.textContent()) ?? '').trim();
        console.log(`[Supplier Grid] Current Manufacturer cell value: "${currentValue}"`);

        await manufacturerCell.dblclick({ position: { x: XRL_OFFSET, y: XRL_OFFSET } });
        await manufacturerCell.click();

        const inputLocator = this.page.locator(
            `c-multiselect[data-id="${this.orgPrefix}__Manufacturer__c"] input[class="slds-input"][part="input"][type="text"]`
        );
        const options = this.page.locator('span.slds-truncate.liitem');
        const hintsToTry = [
            (searchHint ?? '').trim(),
            currentValue.split(/\s+/)[0] ?? '',
            '',
        ].filter((hint, index, all) => all.indexOf(hint) === index);

        let selected = '';
        for (const hint of hintsToTry) {
            if (hint) {
                await inputLocator.fill(hint);
            } else {
                await inputLocator.clear();
                await inputLocator.click();
            }

            await options.first().waitFor({ state: 'visible', timeout: 10000 });

            const optionCount = await options.count();
            for (let i = 0; i < optionCount; i++) {
                const option = options.nth(i);
                const title =
                    ((await option.getAttribute('title')) ?? (await option.textContent()) ?? '').trim();
                if (!this.isSelectableManufacturerOption(title, currentValue)) continue;

                selected = title;
                console.log(
                    `[Supplier Grid] Picking alternate Manufacturer from dropdown: "${selected}" (hint="${hint || 'all'}")`
                );
                await option.click();
                break;
            }
            if (selected) break;
        }

        if (!selected) {
            throw new Error(
                `No alternate manufacturer found in dropdown (current="${currentValue}", hints=${hintsToTry.join('|')})`
            );
        }

        await this.page.getByRole('dialog').nth(0).press('Enter').catch(() => undefined);
        await this.page.waitForTimeout(500);
        await expect(manufacturerCell).toContainText(selected, { timeout: 10000 });
        return { current: currentValue, selected };
    }

    async changeManufacturer(input: any, manufacturer: any, itemNo: any, selectBox?: any) {
        // Change the Manufacturer for the first item in the Supplier Grid
        const row = (input[0] === 'all') ? 0 : itemNo - 1; // adjusting for zero-based index      
        const manufacturerCell = this.page.locator(`td[data-colname="${this.orgPrefix}__Manufacturer__c"][role="gridcell"][data-rowind="${row}"]`).first();
        // await manufacturerCell.click();

        const manufacturerValue = (await manufacturerCell.textContent());
        if (manufacturerValue === manufacturer && typeof input === 'string' && input === 'one') {
            console.log(`Manufacturer is already set to ${manufacturer}`);
            return; // Legacy string input only — ['one'] always re-selects to allow grid save/trigger
        }

        else if (manufacturerValue != '' || manufacturerValue == '') {
            // Manufacturer cell is blank, proceed with the next lines
            await manufacturerCell.dblclick({ position: { x: XRL_OFFSET, y: XRL_OFFSET } });
            if (input[0] !== "all" && input.length === 1 && selectBox === undefined) {
                // if we want to change the manufacturer for one item
                await manufacturerCell.click();
                const inputLocator = this.page.locator(`c-multiselect[data-id="${this.orgPrefix}__Manufacturer__c"] input[class="slds-input"][part="input"][type="text"]`);
                // await inputLocator.click();
                await inputLocator.fill(manufacturer);
                // Wait for Manufacturer option (isVisible() alone can skip before dropdown renders)
                const manufOption = this.page.locator(`span[class="slds-truncate liitem"][title = "${manufacturer}"]`);
                try {
                    await manufOption.waitFor({ state: 'visible', timeout: 10000 });
                    console.log(`${manufacturer} is visible in the dropdown`);
                    await manufOption.click();
                } catch {
                    throw new Error(`Manufacturer "${manufacturer}" is not visible in the dropdown`);
                }
                await this.page.getByRole('dialog').nth(0).press('Enter');
            }
            else if (input[0] !== "all" && input.length > 1 && selectBox === undefined) {
                // if we want to change the manufacturer for many item
                await this.clickPopupInputAndSelectManufacturer(manufacturer);
                await this.page.getByRole('dialog').nth(0).press('Enter');
                // const saveButton = this.page.getByRole('button', { name: 'Save' });
                // await saveButton.click();
                await this.page.getByRole('button', { name: 'Apply' }).click();
                await this.page.waitForTimeout(5000); // Wait for the save operation to complete  
            }
            else if (input[0] === "all" || selectBox !== undefined) {
                // if we want to change the manufacturer for all items
                await this.clickPopupInputAndSelectManufacturer(manufacturer);
                // await page.getByRole('button', { name: 'Clear' }).click();
                // await page.getByRole('option').getByText('Cisco Systems').click();
                await this.page.waitForTimeout(6000);
                await this.page.getByRole('button', { name: 'Apply' }).click();
                await this.page.waitForTimeout(5000); // Wait for the save operation to complete
            }
            else {
                throw new Error('Invalid input value for manufacturer selection');
            }
        }

    }

    async changeSupplier(input: any, supplier: any, itemNo: any, selectBox?: any) {
        // Change the Supplier for the first item in the Supplier Grid
        const index = (input[0] === 'all') ? 0 : itemNo - 1; // adjusting for zero-based index                
        const supplierCell = this.page.locator(`td[data-colname="${this.orgPrefix}__Supplier__c"][role="gridcell"][data-rowind="${index}"]`).first();
        // await supplierCell.click();

        const supplierValue = (await supplierCell.textContent());
        if (supplierValue === supplier && input[0] == "one") {
            console.log(`Supplier is already set to ${supplier}`);
            return; // Exit if the supplier is already set to the desired value
        }

        else if (supplierValue != '' || supplierValue == '') {
            // Supplier cell is blank, proceed with the next lines
            await supplierCell.first().dblclick({ position: { x: XRL_OFFSET, y: XRL_OFFSET } });
            if (input[0] !== "all" && input.length === 1 && selectBox === undefined) {
                // if we want to change the supplier for one item
                await supplierCell.click();
                const inputLocator = this.page.locator(`c-multiselect[data-id="${this.orgPrefix}__Supplier__c"] input[class="slds-input"][part="input"][type="text"]`);
                // await inputLocator.click();
                await inputLocator.fill(supplier);
                // Wait for Supplier option (isVisible() alone can skip before dropdown renders)
                const suppOption = this.page.locator(`span[class="slds-truncate liitem"][title = "${supplier}"]`);
                try {
                    await suppOption.waitFor({ state: 'visible', timeout: 10000 });
                    console.log(`${supplier} is visible in the dropdown`);
                    await suppOption.click();
                } catch {
                    throw new Error(`Supplier "${supplier}" is not visible in the dropdown`);
                }
                await this.page.getByRole('dialog').nth(0).press('Enter');
            }
            else if (input[0] !== "all" && input.length > 1 && selectBox === undefined) {
                // if we want to change the supplier for one item
                await this.clickPopupInputAndSelectSupplier(supplier);
                await this.page.getByRole('dialog').nth(0).press('Enter');
                // const saveButton = this.page.getByRole('button', { name: 'Save' });
                // await saveButton.click();
                await this.page.getByRole('button', { name: 'Apply' }).click();
                await this.page.waitForTimeout(5000); // Wait for the save operation to complete  
            }
            else if (input[0] === "all" || selectBox !== undefined) {
                // if we want to change the supplier for all items
                await this.clickPopupInputAndSelectSupplier(supplier);
                // await page.getByRole('button', { name: 'Clear' }).click();
                // await page.getByRole('option').getByText('Cisco Systems').click();
                await this.page.waitForTimeout(6000);
                await this.page.getByRole('button', { name: 'Apply' }).click();
                await this.page.waitForTimeout(5000); // Wait for the save operation to complete
            }
            else {
                throw new Error('Invalid input value for supplier selection');
            }
        }

    }

    async resetSuppNdManuToNone(loadAllItms?: any, selItms?: any){
        // resets the changed suppliers on quote items to None 

        if(loadAllItms !== 'yes'){
            // If loadAllItms was yes means items were already loaded
            // hence clicking load all items if loadAllItems is not selected
            await this.page.locator(`c-action[data-id="showAllItems"]`).click(); 
            await this.page.waitForLoadState('domcontentloaded');
            await this.xrl.updateNoOfItemsPerPage('200');   // Changing the item count on Page to 200
        } 
        if((selItms!== 'all') || (selItms === 'all' && loadAllItms !== 'yes')){
            // if all items were changed the select all button was already clicked 
            // hence clicking if only few items were changed/ if all items were not loaded
            await this.selectAllItemsonSupplierGrid();
        }
        // ================== { Change Supplier } ==================
        const supplierCell = this.page.locator(`td[data-colname="${this.orgPrefix}__Supplier__c"][role="gridcell"][data-rowind="0"]`).first();
        await supplierCell.first().dblclick({ position: { x: XRL_OFFSET, y: XRL_OFFSET } });
        await this.clickPopupInputAndSelectManufacturer('--None--');
        await this.page.getByRole('button', { name: 'Apply' }).click();
        // ================== { Change Manufacturer } ==================
        const manufacturerCell = this.page.locator(`td[data-colname="${this.orgPrefix}__Manufacturer__c"][role="gridcell"][data-rowind="0"]`).first();
        await manufacturerCell.dblclick({ position: { x: XRL_OFFSET, y: XRL_OFFSET } });
        await this.clickPopupInputAndSelectManufacturer('--None--');
        await this.page.getByRole('button', { name: 'Apply' }).click();

        await this.xrl.clickIconOnXRLGrid(":save");          
        await this.page.waitForLoadState('domcontentloaded'); // Wait for changes to apply
        const message = await this.quote.getUpperToastMessage();    // Gets the message from notification
        await expect(message).toBe("Success");
    }

    async verifyAccAssignedOnMinors(quoteId: any, accountType: string, account: any) {
        // Checks if Minor contains the account assigned
        const minors = await this.loadMinorItemsCount(quoteId);
        const incorrectMinors: number[] = [];
        for (let i = 0; i < minors; i++) {
            const locatorCell = this.page.locator(`td[data-colname="${this.orgPrefix}__${accountType}__c"][role="gridcell"][data-rowind="${i}"]`).first();
            const textValue = (await locatorCell.textContent());
            if (textValue === account) {
                console.log(`Minor Item has value ${textValue}`);
            }
            else {
                // load the i counter value and show error at last
                incorrectMinors.push(i + 1); // adding 1 to match row number on UI
            }
        }
        if (incorrectMinors.length > 0) {
            throw new Error(`The following Minor Items do not have the correct ${accountType} assigned: Rows ${incorrectMinors.join(", ")}`);
        }
    }

    async loadMinorItemsCount(quoteId: any) {
        // Return total minors from GSB
        const sfConn = new Connection({ instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID });
        const query = `SELECT Count(Id) FROM ${this.orgPrefix}__Cust_BoM_Item__c WHERE ${this.orgPrefix}__CustomerBoM__r.Id = '${quoteId}' and ${this.orgPrefix}__Group_Sort_Box__c = 'GSB-00000'`;
        console.log(query);
        const result = await sfConn.query(query);
        const count = result.records[0].expr0;
        return count;

    }

    async selFirstBoxOnSupplierGrid() {
        // Selects first Box on Supplier Grid
        const frstBoxloc = this.page.locator('tr[class="groupRow"] input[class="custom-checkbox"]').first();
        await frstBoxloc.click();
    }

    async selectAllItemsonSupplierGrid() {
        // Select all items on the Supplier Grid
        const click = await this.page.locator('input[type="checkbox"][name="selectAll"]').isChecked();
        if(click === false){
            await this.page.locator('lightning-input[class="checkAll custom-checkbox slds-form-element"]').click(); // Select the select all button
        }
        else{
            await this.page.locator('lightning-input[class="checkAll custom-checkbox slds-form-element"]').dblclick(); // Select the select all button
        }
    }

    async clickPopupInputAndSelectManufacturer(manufacturer: any) {
        // Click on the input field in the popup and fill it with user given "manufacturer" after searching     

        const inputLocator = this.page.locator(`div[class="slds-popover extRelListSearch"] input[class="slds-input"]`);
        await inputLocator.click();
        await inputLocator.fill(manufacturer);

        // Check if Manufacturer is present or not in the dropdown                    
        if (await this.page.locator(`span[class="slds-truncate liitem"][title = "${manufacturer}"]`).isVisible()) {
            console.log(`${manufacturer} is visible in the dropdown`);
            await this.page.locator(`span[class="slds-truncate liitem"][title = "${manufacturer}"]`).click();
        }
        else {
            throw new Error("Manufacturer is not visible in the dropdown");
        }
    }

    async clickPopupInputAndSelectSupplier(supplier: any) {
        // Click on the input field in the popup and fill it with user given "supplier" after searching     

        const inputLocator = this.page.locator(`div[class="slds-popover extRelListSearch"] input[class="slds-input"]`);
        await inputLocator.click();
        await inputLocator.fill(supplier);

        // Check if Supplier is present or not in the dropdown                    
        if (await this.page.locator(`span[class="slds-truncate liitem"][title = "${supplier}"]`).isVisible()) {
            console.log(`${supplier} is visible in the dropdown`);
            await this.page.locator(`span[class="slds-truncate liitem"][title = "${supplier}"]`).click();
        }
        else {
            throw new Error("Supplier is not visible in the dropdown");
        }
    }

    async fetchDefaultItmsCountOnSuppGrid(quoteId: any) {
        // Gives the items count using query 
        const query = `SELECT count(Id) FROM ${this.orgPrefix}__Cust_BoM_Item__c where ${this.orgPrefix}__CustomerBoM__r.Id = '${quoteId}' and (${this.orgPrefix}__Line_Type__c = 'MAJOR' or  ${this.orgPrefix}__Item_Type__c = 'SERVICE')`;
        const sfConn = new Connection({ instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID });
        const result = await sfConn.query(query);
        return result;
    }

    async fetchTotItmsCount(quoteId: any) {
        // Gives total number of items in a specific using sf query
        const query = `SELECT count(Id) FROM ${this.orgPrefix}__Cust_BoM_Item__c where ${this.orgPrefix}__CustomerBoM__r.Id = '${quoteId}'`;
        const sfConn = new Connection({ instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID });
        const result = await sfConn.query(query);
        return result;
    }

    async createNewQuote() {
        // Creates a new quote from Opportunity Page
        await this.page.getByRole('button', { name: 'Follow' }).waitFor();
        console.log(`Follow button is visible`);
        await this.quote.clickRecordPageButton('Create New Quote');
        console.log(`Create New Quote button is clicked`);
        await this.page.locator('xpath=(//lightning-formatted-text[starts-with(normalize-space(.), "QT-")])[1]')
            .waitFor({ state: 'visible', timeout: 90000 });
        console.log(`New Quote page is opened`);

    }

    async createnewVersion2() {
        // Creates a new version of the quote
        await this.page.getByRole('button', { name: 'Export Quote' }).waitFor();
        console.log(`Export Quote button is visible`);
        await this.quote.clickRecordPageButton('Create New Version');
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(5000);
        console.log(`Create New Version button is clicked`);
        const verioname = this.page.locator('xpath=(//lightning-formatted-text[starts-with(normalize-space(.), "QT-")])[1]')
        await verioname.waitFor({ state: 'visible', timeout: 90000 });
        console.log(`Quote Version is visible`);
        return verioname.textContent();
    }

    async createnewVersion(): Promise<{ quoteNumber: string; quoteId: string }> {
        await this.waitForQuoteDetailsPageReady();
        const originalQuoteId = await this.parseQuoteIdFromUrl();
        console.log(`Export Quote button is visible`);
        await this.quote.clickRecordPageButton('Create New Version');
        await this.page.waitForLoadState('domcontentloaded');
        console.log(`create new version button is clicked`);
        const newQuoteId = await this.waitForQuoteIdChange(originalQuoteId);
        await this.getQuotePage().getQuoteHeading().waitFor({ state: 'visible', timeout: 90000 });
        const quoteNumber = await this.getQuoteNumberFromHeading();
        console.log(`New Quote is visible: ${quoteNumber} (${newQuoteId})`);
        return { quoteNumber, quoteId: newQuoteId };
    }

    async createNewQuote2() {
        // Creates a new quote from Opportunity Page (legacy implementation)
        await this.page.getByRole('button', { name: 'Follow' }).waitFor(); // waits till the follow button is visible on opportunity
        console.log(`Follow button is visible`);
        // If the create New Button is visible on the page then click it else go to dropdown to select button
        if (await this.page.getByRole('button', { name: 'Create New Quote' }).isVisible()) {
            console.log(`Create New Quote button is visible and clicked`);
            await this.quote.getItemByRoleandClick('button', 'Create New Quote');
        }
        else {
            await this.quote.getItemByRoleandClick('button', 'Show more actions');
            await this.quote.getItemByRoleandClick('menuitem', 'Create New Quote');
        }
    }


    async findQuoteId() {
        // Find the Quote ID from the BoM page URL
        await this.page.locator('div[class="record-layout-container"]').waitFor({ state: 'visible', timeout: 90000 });
        const QuoteIdText = this.page.url().split(`/${this.orgPrefix}__CustomerBoM__c/`)[1]?.split('/')[0];

        if (QuoteIdText == '') {
            throw new Error("Quote ID not found on the page");
        }
        console.log('Fetched Quote id:', QuoteIdText.trim());
        return QuoteIdText.trim();
    }

    async visitTestQuoteAndOpenEQG() {
        const quoteId = await this.findTestQuote();
        if (quoteId) {
            await this.page.goto(`${process.env.SF_INSTANCE_URL}/lightning/r/${this.orgPrefix}__CustomerBoM__c/${quoteId}/view`);
            await this.page.waitForTimeout(6000); // Wait for the page to load completely
            await this.page.locator('button', { has: this.page.locator('span', { hasText: 'Show more actions' }) }).click();
            await this.page.getByRole('menuitem', { name: 'Edit Quote' }).click();
        } else {
            console.error("No test quote found.");
        }
    }

    async findTestQuote() {
        //Finds latest quote created for the test account amd BoM = "67021223-4740650579" that is in Test Account
        const sfConn = new Connection({ instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID });
        const query = `SELECT Id FROM ${this.orgPrefix}__CustomerBoM__c WHERE ${this.orgPrefix}__Account__r.Name LIKE 'Test Account%' and ${this.orgPrefix}__Quote_BoMs_Numbers__c LIKE '%67021223-4740650579%' ORDER BY CreatedDate DESC LIMIT 1`;
        const result = await sfConn.query(query);
        const record = result.records[0] as { Id: string }; // Return only the Id of the first record
        return record.Id;
    }

    async waitForMasterItemsGridPage() {
        // Waits for the Master Item Page to load completely
        await this.page.waitForTimeout(5000); // Initial wait for the page to load
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        try {
            await frame.locator('span[class="ui-jqgrid-title"]').filter({ hasText: 'Master Items' }).waitFor({ state: 'visible', timeout: 60000 });
        } catch (error) {
            console.error("Error waiting for Master Items grid:", error);
        }
    }

    async waitForMasterItemGridDataLoad() {
        //--------  Logic to wait till the grid loads after search
        const iframe = await this.page.locator('iframe[name^="vfFrameId_"]').contentFrame();
        const mimGridTable = iframe.locator('#gbox_mimGrid .ui-jqgrid-bdiv table tbody tr:not(.jqgfirstrow)');
        await mimGridTable.first().waitFor({
            state: 'visible',
            timeout: 500000
        });
    }

    async updtFltrByOnMstrItmGrd(filterField: any, filterBy: any, tableName: any) {
        // Updates Filter By on Master Item Grid for Search Criteria

        const num = tableName === "Search Criteria" ? 0 : 1; // unchanged
        console.log(
            "obatianed number from the UI to identify the table",
            num,
            "and table name is",
            tableName
        );

        console.log("filterBy BEFORE sanitize:", filterBy);
        filterBy = filterBy?.replace(/^['"]|['"]$/g, ''); // unchanged
        console.log("filterBy AFTER sanitize:", filterBy);

        if (!filterBy) {
            // unchanged: skip if no filter value
            return;
        }

        try {
            const frame = await this.quote.frameInEQG(); // unchanged

            // ✅ NEW CODE (SAFE – HANDLES count = 1 or 2)
            // =====================================================
            const operationBtnLocator = frame.locator(
                `a[title="Click to select search operation."][colname="${this.orgPrefix}__${filterField}"]`
            );

            const matchingCount = await operationBtnLocator.count();
            console.log("Matching elements count:", matchingCount);

            let operationBtn;

            if (matchingCount === 1) {
                // Only one operator exists (e.g. Unit_List_Price__c)
                operationBtn = operationBtnLocator.first();
            } else {
                // Both operators exist → keep existing ternary behavior
                operationBtn = operationBtnLocator.nth(num);
            }

            // =====================================================
            // DEBUG (UNCHANGED)
            // =====================================================
            const opertBtnText = await operationBtn.allTextContents();
            console.log(opertBtnText);

            await operationBtn.click();
            console.log("Operator button is clicked");

            // =====================================================
            // ✅ NEW CODE (SAFE + DEBUG)
            // =====================================================
            const allMenuItems = await frame
                .locator('li.ui-menu-item a.g-menu-item')
                .allTextContents();

            console.log("Available operator menu items:", allMenuItems);

            const operatorMenuItem = frame
                .locator('li.ui-menu-item a.g-menu-item')
                .filter({ hasText: filterBy })
                .first();

            const selectedMenuText = await operatorMenuItem.textContent();
            console.log("Operator menu item selected:", selectedMenuText);

            await operatorMenuItem.click();
            console.log("Operator menu item clicked");


        } catch (err) {
            console.warn('Could not update the filter By:', err);
        }
    }

    async extractEQGTableData(){
        // Extracting all the Data rows from the edit quote Grid Page
        const frame = await this.quote.frameInEQG();
        const table = await frame.locator('div[class="ui-jqgrid-view"][role="grid"][id="gview_qtGrid"]');       // Table locator
        await table.waitFor({state: "visible", timeout: 9000});                                                 // Waiting till Table is visible
        const row = frame.locator('tbody tr[role="row"]:not(.jqgfirstrow)');                                    // All rows including all (Group Headers + Box Headers + Items)
        const allItmsData = [];
        for(let i = 0; i < await row.count(); i++){
            allItmsData.push(await row.nth(i).textContent());
        }
        return allItmsData;
    }

    async verifyGroupingIsIntact(prev: any, all: any) {
        // Checks if the EQG table is intact before and after copy
        // Checking the index from which the Matching element starts 
        const trimmedData = [];
        let ind = 0;
        for (let i = 0; i <= all.length; i++) {        
            if (all[i] === prev[0]) {
                // getting the index after the prev data is matched with new data
                ind = i; 
                break;                    

            }
        }
        for (let index = ind; index< (ind + prev.length); index ++){
            trimmedData.push(all[index]);
        }
        expect(trimmedData).toStrictEqual(prev);
    }

    async verifyItemAddedOnCorrectPosition(partNumber: any, itmPosition: any) {
        // Verifies if item is added to box after drag and drop, itmPosition can be = 'first' or 0/1/2..
        let itemPartNo: string| null = null; 
        const index = (itmPosition === 'first') ? 0 : itmPosition;                  // if "first" is mentioned on itmPosition then index will be 0                                
        itemPartNo = await this.advui.getValueByRowAndFieldInEQG('item', index, 'Part_Number');        
        const actual = itemPartNo?.trim() ?? '';
        expect(actual).toContain(partNumber);
        console.log('Item was added successfully on Correct position after set grouping'); // logs only on success
    }

    async verifyBoxAddedOnCorrectPosition(boxName: any, boxPosition: any){
        // Verifies if Box is added to the correct position, boxPosition can be = 'first' or 0/1/2..
        const frame = await this.quote.frameInEQG();
        let boxPartNo : string| null = null; 
        const index = (boxPosition === 'first') ? 0 : boxPosition;      // if "first" is mentioned on boxPosition then index will be 0
        boxPartNo = await this.advui.getValueByRowAndFieldInEQG('box', index, 'Part_Number');        
        const actual = boxPartNo?.trim() ?? '';
        expect(actual).toContain(boxName);
        console.log('Box was added successfully on Correct position after set grouping'); // logs only on success
    }

    async verifyBoxAddedToCorrectGroup(groupName: any, boxPartNo: any){
        // Checks that the box is added under the expected Group
        /* ---- Logic: This method will check go through all the EQG Data Rows to find the Box by partNumber that was placed inside the Group 
        then get the index of the box, then it will check the row above box to check if the Group is our desired Group ---- */
        const index = await this.returnIndexOfElement('box', boxPartNo);       // getting index of the Box
        const groupPartNo = await this.advui.getValueByRowAndFieldInEQG('group', (index-1), 'Part_Number');
        console.log(`Our Group Data at index: ${index-1} is ${groupPartNo}`);
        expect(groupPartNo).toContain(groupName);
    }

    async returnIndexOfElement(type: any, partNumber: any){
        // returns the index of Group/Box/Quote Item by matching the partNumber on Edit Quote Grid
        const frame = await this.quote.frameInEQG();
        const rows = frame.locator('tbody tr[role="row"]:not(.jqgfirstrow)');                                   // All rows including all (Group Headers + Box Headers + Items)
        let elmIndex = -1;
        let index;
        for(index = 0; index < await rows.count(); index++){
            const partNoOnRow = await this.advui.getValueByRowAndFieldInEQG(type, index, 'Part_Number');          // Extracting the Row Data            
            if(partNoOnRow?.includes(partNumber)){
                elmIndex = index;
                console.log(`Our expected element was found at row index: ${index}`);
                break;      // if boxPartNo matches with data row partNumber then index of the desired Box found
            }
        }
        return elmIndex;
    }

    async returnItemsUnderBox(boxIndex: any){
        // checks that Group/ Box contains correct value after Item or Box added 
        const frame = await this.quote.frameInEQG();
        const row = frame.locator('tbody tr[role="row"]:not(.jqgfirstrow)');                                   // All rows including all (Group Headers + Box Headers + Items)
        const allItmsData = [];
        for(let i = (boxIndex+1); i < await row.count(); i++){
            // if Qty value is empty break the loop, meaning next Box or group found, so stop
            const rawqty = await row.locator(` td[aria-describedby="qtGrid_${this.orgPrefix}__Quantity__c"]`).nth(i).textContent() || '';
            const qty = rawqty.replace(/\u00A0/g, '').trim();
            if (qty === ''){
                break;      
            }
            else{
                // Extract all items under a box
                const totListPrice = parseFloat(await row.locator(` td[aria-describedby="qtGrid_${this.orgPrefix}__Total_List_Price__c"] span`).nth(i).getAttribute('data-src') || '0');
                const varTotCost = parseFloat(await row.locator(` td[aria-describedby="qtGrid_${this.orgPrefix}__VAR_Total_Cost__c"] span`).nth(i).getAttribute('data-src') || '0');
                const varTotProfit = parseFloat(await row.locator(` td[aria-describedby="qtGrid_${this.orgPrefix}__VAR_Total_Profit__c"] span`).nth(i).getAttribute('data-src') || '0');
                const custExtPrice = parseFloat(await row.locator(` td[aria-describedby="qtGrid_${this.orgPrefix}__Cust_Extended_Price__c"] span`).nth(i).getAttribute('data-src') || '0');
                
                allItmsData.push({
                    "Total Extended List Price": Math.round(totListPrice * 100) / 100,
                    "VAR Total Cost": Math.round(varTotCost * 100) / 100,
                    "VAR Total Profit": Math.round(varTotProfit * 100) / 100,
                    "Customer Extended Price": Math.round(custExtPrice * 100) / 100
                });
            }
        }
        return allItmsData;
    }

    async checkBoxTotalIsCorrect(boxName: any){
        // Checks that the Pricing on Box is sum of all the items under it, input is Box Name
        const index = await this.returnIndexOfElement('box', boxName);
        const allItmsData = await this.returnItemsUnderBox(index);
        const boxData = await this.advui.loadElementHeaderDataFromEQG(index);

        let totals = {
            "Total Extended List Price": 0,
            "VAR Total Cost": 0,
            "VAR Total Profit": 0,
            "Customer Extended Price": 0
        };

        // looping through each item and adding the numbers
        for (let item of allItmsData) {
            totals["Total Extended List Price"] += item["Total Extended List Price"];
            totals["VAR Total Cost"] += item["VAR Total Cost"];
            totals["VAR Total Profit"] += item["VAR Total Profit"];
            totals["Customer Extended Price"] += item["Customer Extended Price"];
        }
        expect(totals).toStrictEqual(boxData);
    }

    async checkGrpTotalIsCorrect(grpName: any){
        /* Checks that the Pricing on Group is sum of all the boxes under it, input is Group Name
        Logic: If Group is selected, the Boxes under it are auto selected
        We are checking the boxes that are checked and extracting those data and adding them and, 
        then matching with the selected Group Header Data */
        const grpIndex = await this.returnIndexOfElement('group', grpName);                               // index of Group
        const grpData = await this.advui.loadElementHeaderDataFromEQG(grpIndex);
        const frame = await this.quote.frameInEQG();
        const row = frame.locator('tbody tr[role="row"]:not(.jqgfirstrow)');                               // All rows including all (Group Headers + Box Headers + Items)
        await row.locator(' input[class="groupCheckbox"]').nth(grpIndex).click();                     // Select the group checkbox
        const allBoxData = [];
        for(let index = (grpIndex+1); index < await row.count(); index++){
            // if not checked then it is not part of group
            const checked = await row.locator(' input[class="groupCheckbox"]').nth(index).isChecked();
            if (checked === false){
                break;      
            }
            else{
                // Extract all boxes under a group
                const boxData = await this.advui.loadBoxHeaderDataFromEQG(index);                   // Loads the Box data of the row by boxIndex            
                allBoxData.push(boxData);
            }
        }
        await row.locator(' input[class="groupCheckbox"]').nth(grpIndex).click();                   // deselecting the Group so that the Edit Quote Summary shows whole Data

        let boxTotals = {
            "Total Extended List Price": 0,
            "VAR Total Cost": 0,
            "VAR Total Profit": 0,
            "Customer Extended Price": 0
        };

        // looping through each item and adding the numbers from all Boxes
        for (let item of allBoxData) {
            boxTotals["Total Extended List Price"] += item["Total Extended List Price"];
            boxTotals["VAR Total Cost"] += item["VAR Total Cost"];
            boxTotals["VAR Total Profit"] += item["VAR Total Profit"];
            boxTotals["Customer Extended Price"] += item["Customer Extended Price"];
        }
        expect(boxTotals).toStrictEqual(grpData);
    }

    async getTotalBoxCount() {
        // Returns the total Number of Boxes present in the EQG
        const frame = await this.quote.frameInEQG();
        const boxQtyInput = frame.locator('tr[class="ui-widget-content jqgroup ui-row-ltr qtGridghead_2"]');
        return await boxQtyInput.count();
    }

    async getAllBoxData() {
        // Returns all box data from the Edit Quote Grid
        const boxData = [];
        const frame = await this.quote.frameInEQG();
        const boxRows = await this.getTotalBoxCount();
        for (let i = 0; i < boxRows; i++) {
            const totListPrice = parseFloat(await frame.locator(`tr[class="ui-widget-content jqgroup ui-row-ltr qtGridghead_2"] td[aria-describedby="qtGrid_${this.orgPrefix}__Total_List_Price__c"] span`).nth(i).getAttribute('data-src') || '0');
            const varTotCost = parseFloat(await frame.locator(`tr[class="ui-widget-content jqgroup ui-row-ltr qtGridghead_2"] td[aria-describedby="qtGrid_${this.orgPrefix}__VAR_Total_Cost__c"] span`).nth(i).getAttribute('data-src') || '0');
            const varTotProfit = parseFloat(await frame.locator(`tr[class="ui-widget-content jqgroup ui-row-ltr qtGridghead_2"] td[aria-describedby="qtGrid_${this.orgPrefix}__VAR_Total_Profit__c"] span`).nth(i).getAttribute('data-src') || '0');
            const custExtPrice = parseFloat(await frame.locator(`tr[class="ui-widget-content jqgroup ui-row-ltr qtGridghead_2"] td[aria-describedby="qtGrid_${this.orgPrefix}__Cust_Extended_Price__c"] span`).nth(i).getAttribute('data-src') || '0');
            const partNo = await frame.locator('tr[class="ui-widget-content jqgroup ui-row-ltr qtGridghead_2"] span[class="groupText"] b').nth(i).textContent();

            boxData.push({
                "Total Extended List Price": Math.round(totListPrice * 100) / 100,
                "VAR Total Cost": Math.round(varTotCost * 100) / 100,
                "VAR Total Profit": Math.round(varTotProfit * 100) / 100,
                "Customer Extended Price": Math.round(custExtPrice * 100) / 100,
                "PartNumber": partNo?.trim()
            });
        }
        return boxData;
    }

    async verifyCloneBoxesAdded(selectedBoxData: any, cloneCount: any, partNumber: any) {
        // Verifies if correct number of clones are added on the Edit Quote grid

        const allBoxData = await this.getAllBoxData();      // Combined Data of all the boxes in the Grid      
        let matchCount = 0;

        allBoxData.forEach((item, index) => {
            const diffs = [];   // Store mismatch results  

            if (item["PartNumber"] === partNumber) {
                // Check Boxes of Part Numbers which match with the previous selected box before clonning                           
                for (const key in selectedBoxData) {                         //--- Looping through each key in selectedBoxData ---//
                    const expectedValue = selectedBoxData[key];              // Expected
                    const actualValue = item[key as keyof typeof item];      // Actual for this box 
                    //--- Check if values do NOT match ---//
                    if (actualValue !== expectedValue) {
                        diffs.push(key + " expected " + expectedValue + " but found " + actualValue);
                    }
                }
                if (diffs.length === 0) {       // Perfect match
                    matchCount++;
                } else {                        // Show mismatches
                    console.warn("Box " + (index + 1) + " mismatch:\n - " + diffs.join("\n - "));
                }
            }
        });

        const splitCount = await this.returnSplitBoxCountForPartNumber(partNumber);
        expect(matchCount - splitCount).toBe(Number(cloneCount) + 1); // +1 added for Original box
    }

    async returnSplitBoxCountForPartNumber(partNumber: any) {
        // Return the occurence of Split Boxes with same PartNumber we are cloning
        const frame = await this.quote.frameInEQG();
        const items = await frame.locator(':has(> i[title="Split Box - Clone"]) > b', { hasText: partNumber });
        const count = await items.count();
        console.log('Count:', count);
        return count;
    }

    async getAllTierZeroGrpData(grpCount: any) {
        // Returns all group data from Edit Quote Grid that are tier 0
        const grpData = [];
        const frame = await this.quote.frameInEQG();
        for (let i = 0; i < grpCount; i++) {
            const totListPrice = parseFloat(await frame.locator(`tr[id^="qtGridghead_0_"] td[aria-describedby="qtGrid_${this.orgPrefix}__Total_List_Price__c"] span`).nth(i).getAttribute('data-src') || '0');
            const varTotCost = parseFloat(await frame.locator(`tr[id^="qtGridghead_0_"] td[aria-describedby="qtGrid_${this.orgPrefix}__VAR_Total_Cost__c"] span`).nth(i).getAttribute('data-src') || '0');
            const varTotProfit = parseFloat(await frame.locator(`tr[id^="qtGridghead_0_"] td[aria-describedby="qtGrid_${this.orgPrefix}__VAR_Total_Profit__c"] span`).nth(i).getAttribute('data-src') || '0');
            const custExtPrice = parseFloat(await frame.locator(`tr[id^="qtGridghead_0_"] td[aria-describedby="qtGrid_${this.orgPrefix}__Cust_Extended_Price__c"] span`).nth(i).getAttribute('data-src') || '0');
            const grpName = await frame.locator('tr[id^="qtGridghead_0_"] span[class="groupText"] b').nth(i).textContent();

            grpData.push({
                "Total Extended List Price": Math.round(totListPrice * 100) / 100,
                "VAR Total Cost": Math.round(varTotCost * 100) / 100,
                "VAR Total Profit": Math.round(varTotProfit * 100) / 100,
                "Customer Extended Price": Math.round(custExtPrice * 100) / 100,
                "Group Name": grpName?.trim()
            });
        }
        return grpData;
    }

    async returnAllTierZeroGrpCount(){
        // returns total Tier 0 Group count
        const frame = await this.quote.frameInEQG();
        const grpCount = await frame.locator('tr[id^="qtGridghead_0_"]').count();
        return grpCount;
    }

    async returnAllTierOneGrpCount(){
        // returns total Tier 1 Group count
        const frame = await this.quote.frameInEQG();
        const grpCount = await frame.locator('tr[id^="qtGridghead_1_"]').count();
        return grpCount;
    }

    async getAllTierOneGrpData(grpCount: any){
        // Returns all group data from Edit Quote Grid that are tier 1
        const grpData = [];
        const frame = await this.quote.frameInEQG();
        for (let i = 0; i < grpCount; i++) {
            const totListPrice = parseFloat(await frame.locator(`tr[id^="qtGridghead_1_"] td[aria-describedby="qtGrid_${this.orgPrefix}__Total_List_Price__c"] span`).nth(i).getAttribute('data-src') || '0');
            const varTotCost = parseFloat(await frame.locator(`tr[id^="qtGridghead_1_"] td[aria-describedby="qtGrid_${this.orgPrefix}__VAR_Total_Cost__c"] span`).nth(i).getAttribute('data-src') || '0');
            const varTotProfit = parseFloat(await frame.locator(`tr[id^="qtGridghead_1_"] td[aria-describedby="qtGrid_${this.orgPrefix}__VAR_Total_Profit__c"] span`).nth(i).getAttribute('data-src') || '0');
            const custExtPrice = parseFloat(await frame.locator(`tr[id^="qtGridghead_1_"] td[aria-describedby="qtGrid_${this.orgPrefix}__Cust_Extended_Price__c"] span`).nth(i).getAttribute('data-src') || '0');
            const grpName = await frame.locator('tr[id^="qtGridghead_0_"] span[class="groupText"] b').nth(i).textContent();

            grpData.push({
                "Total Extended List Price": Math.round(totListPrice * 100) / 100,
                "VAR Total Cost": Math.round(varTotCost * 100) / 100,
                "VAR Total Profit": Math.round(varTotProfit * 100) / 100,
                "Customer Extended Price": Math.round(custExtPrice * 100) / 100,
                "Group Name": grpName?.trim()
            });
        }
        return grpData;
    }

    async verifyCreatedGroups(grpName: any, cloneCount: any, selectedBoxData: any) {
        // Verifies if groups created are correctly showing right names with pricing
        const allGrpData = await this.getAllTierZeroGrpData(parseInt(cloneCount) + 1);
        let groupCreated = 0;

        allGrpData.forEach((item, index) => {
            const diffs = [];   // Store mismatch results  

            if (item["Group Name"]?.startsWith(`${grpName}-`)) {
                // Check inside Groups with Group name that was added before- for clonning 
                console.log("Group checking for: " + item["Group Name"]);
                groupCreated++;                                         // Got a match hence Increasing the counter                   
                for (const key in allGrpData) {                         //--- Looping through each key in allGrpData ---//
                    const expectedValue = selectedBoxData[key];              // Expected
                    const actualValue = item[key as keyof typeof item];      // Actual for this box 
                    //--- Check if values do NOT match ---//
                    if (actualValue !== expectedValue) {
                        diffs.push(key + " expected " + expectedValue + " but found " + actualValue);
                    }
                }
                if (diffs.length !== 0) {                       // Show mismatches
                    console.warn("Box " + (index + 1) + " mismatch:\n - " + diffs.join("\n - "));
                }
            }
        });
        expect(groupCreated).toBe(Number(cloneCount) + 1);
    }

    async checkClonesAreIntact(partNumber: any, cloneCount: any) {
        // Check that the Clone boxes are attached at the last in Edit Quote Grid               

        const allBoxData = await this.getAllBoxData();
        const total = allBoxData.length;
        const reqPartNos = Number(cloneCount);
        const diffs: string[] = [];
        // ---- Scan from the beginning and stop at the first occurrence of partNumber ----
        let firstIdx = -1;
        for (let i = 0; i < total; i++) {
            if (allBoxData[i]?.PartNumber === partNumber) {
                firstIdx = i;
                break;
            }
        }
        if (firstIdx === -1) {
            // partNumber never appears
            diffs.push(`PartNumber "${partNumber}" was not found in any box.`);
            return { ok: false, diffs };
        }
        // ---- Verify the next required boxes from the first occurrence ----
        for (let j = 1; j <= reqPartNos; j++) {
            const idx = firstIdx + j;
            const item = allBoxData[idx];
            if (item?.PartNumber !== partNumber) {
                diffs.push(`At Box #${idx + 1}: expected "${partNumber}", found "${item?.PartNumber}".`);
                console.warn("Clone run check failed:\n - " + diffs.join("\n - "));
                return { ok: false, diffs };
            }
        }
        // Updating success message
        const fromBox = firstIdx + 1;
        const toBox = firstIdx + reqPartNos;
        console.log(`Success: Found ${reqPartNos} consecutive PartNumbers:"${partNumber}" after Original Box at #${firstIdx}, where Clone Boxes are from Box #${fromBox} to Box #${toBox}`);
        return { ok: true, diffs: [] };
    }

    async verifyEQGSummaryPricingAftrClone(summaryDataBeforeClone: any, summaryDataAftrClone: any, selectedBoxData: any, cloneCount: any) {
        // Verifies if the EQG Summary Pricing is correctly updated after clonning boxes/groups

        const initialSummValue = summaryDataBeforeClone?.[0];
        const boxValue = Array.isArray(selectedBoxData) ? selectedBoxData[0] : selectedBoxData;

        const result: Record<string, string> = {};
        for (const key in initialSummValue) {
            const preValue = parseFloat(initialSummValue[key]);
            const calcValue = parseFloat(boxValue[key] ?? "0") * cloneCount;

            result[key] = (preValue + calcValue).toFixed(2);
        }
        const expctdSummaryValue = [result];
        console.log("After Clone: ", summaryDataAftrClone);
        console.log("Expected Summary: ", expctdSummaryValue);

        const actual = summaryDataAftrClone?.[0] ?? {};
        const expected = expctdSummaryValue[0];
        for (const key of Object.keys(expected)) {
            const exp = parseFloat(expected[key]);
            const act = parseFloat(actual[key] ?? "0");
            expect(Math.abs(act - exp), `${key}: expected ${exp}, got ${act}`).toBeLessThanOrEqual(0.01);
        }
    }

    async validateSortOrder(quoteId: any) {
        // Checking if the Sort Order is correct on the Edit Quote Grid
        const sortOrderData = await this.getSortOrderDataFromQuote(quoteId);
        const records: any[] = Array.isArray(sortOrderData?.records) ? sortOrderData.records : [];

        const orderField = `${this.orgPrefix}__Sort_Order__c`;
        const boxField = `${this.orgPrefix}__Group_Sort_Box__c`;

        // Diving records into two arrays for Sort_Order and Group_Sort_Box 
        const arr1: number[] = records.map(r => Number(r?.[orderField] ?? r?.[`${this.orgPrefix}_Sort_Order__c`] ?? 0));         // array of Sort Orders of all Quote items
        const arr2: string[] = records.map(r => String(r?.[boxField] ?? r?.[`${this.orgPrefix}_Group_Sort_Box__c`] ?? ''));    // array of Group Sort Boxes of all Quote items

        for (let i = 1; i < arr1.length; i++) {
            const diff = arr1[i] - arr1[i - 1];           // Gives difference of the Sort Orders between the first and the next quote item
            const gsb: boolean = arr2[i] == arr2[i - 1];  // Gives the comparison value (in boolean) between the first and the next quote item

            if (!gsb) {
                if (diff == 20) {
                    // console.log("GSB is not same therefore diff is 20");
                } else if (diff == 10) {
                    throw new Error("GSB is changed but diff is 10");
                } else {
                    throw new Error(`Mismatched value for items: ${(i - 1)} and ${i}`);
                }
            } else {
                if (diff != 10) {
                    throw new Error(`GSB is same but diff is not 10, for items: ${(i - 1)} and ${i}`);
                } else {
                    // console.log("GSB is same and diff is 10");
                }
            }
        }
    }

    async getSortOrderDataFromQuote(quoteId: any) {
        // Returns the Group_Sort_Box and Sort_Order values of quoteItems in Quote by its Quote ID
        const sfConn = new Connection({ instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID });
        const query = `SELECT ${this.orgPrefix}__Group_Sort_Box__c, ${this.orgPrefix}__Sort_Order__c from ${this.orgPrefix}__Cust_BoM_Item__c where ${this.orgPrefix}__CustomerBoM__c = '${quoteId}' order by ${this.orgPrefix}__Sort_Order__c `;
        // console.log(query);
        const result = await sfConn.query(query);
        return result;
    }

    async manfLocator() {
        // Locator for selecting Manufacturer depends on Org
        let manufLocator: string;
        if (process.env.SF_INSTANCE_URL === 'https://st1723635638241.my.salesforce.com' || 'https://st1723635638241--pqw3v9.sandbox.lightning.force.com') {
            manufLocator = 'Vendor__c'
        } else {
            manufLocator = 'Manufacturer__c'
        }
        return manufLocator;
    }

    async fltrByColOnMstrItmGrd(filterField: any, filterValue: any, TableName: any) {
        // Filters By Column on Master Item Grid
        const num = TableName === "Search Criteria" ? 0 : 1; // if Table is Search Criteria we will select first locator
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        if (filterValue === null || filterValue === undefined || filterValue === '') {
            // skip if there is no value on filterBy
            return 0;
        }

        if (filterField === "Item_Type_X__c") { // if Item type we will select from dropdown 
            await frame.locator(`.ui-search-input select[role="select"][name="${this.orgPrefix}__${filterField}"]`).nth(num).selectOption(filterValue);
        }
        else if (filterField === "Manufacturer__c") { //gdt

            await frame.locator(`span[role="combobox"][aria-labelledby="select2-gs_${this.orgPrefix}__Manufacturer__c-container"]`).nth(num).click();
            // await frame.locator('input[role="textbox"][type="search"][class="select2-search__field"]').click();
            await frame.locator('input[role="textbox"][type="search"][class="select2-search__field"]').type(filterValue, { delay: 100 });
            await frame.getByRole('treeitem', { name: filterValue }).click();
        }
        else if (filterField === "Vendor__c") {
            const locator = frame.locator(`input[role="textbox"][name="${this.orgPrefix}__Vendor__c"]`).nth(num);
            // await frame.locator('input[role="textbox"][type="search"][class="select2-search__field"]').click();
            // await frame.locator(`input[role="textbox"][name="${this.orgPrefix}__Vendor__c"]`).nth(num).type(filterValue, { delay: 100 });
            await locator.waitFor({
                state: 'visible'
            });
            await locator.click();
            await locator.fill('');
            await locator.type(filterValue, { delay: 100 });
            await expect(locator).toHaveValue(filterValue, { timeout: 5000 });
            await locator.press('Enter');


        }
        else {
            // We will click on column filters and put value to filter on text area
            //  const locator = frame.locator(`.ui-search-input input[name="${this.orgPrefix}__${filterField}"][role="textbox"]`).nth(num);
            // await locator.click();
            // await locator.type(filterValue, { delay: 100 });

            // We will click on column filters and put value to filter on text area

            const inputLocator = frame.locator(
                `.ui-search-input input[name="${this.orgPrefix}__${filterField}"][role="textbox"]`
            );

            const inputCount = await inputLocator.count();
            console.log("Filter input count:", inputCount);

            let locator;

            if (inputCount === 1) {
                // Only one input exists (e.g. numeric fields like Unit_List_Price__c)
                locator = inputLocator.first();
            } else {
                // Both Search Criteria & Master Items exist → preserve old behavior
                locator = inputLocator.nth(num);
            }

            //  Ensure input is ready
            await locator.waitFor({ state: 'visible' });
            await locator.click();

            //  Clear any previous value (important in EQG)
            await locator.fill('');

            // Type slowly to avoid debounce issues
            await locator.type(filterValue, { delay: 100 });

            //  Wait until DOM actually contains the value
            await expect(locator).toHaveValue(filterValue, { timeout: 5000 });

            await locator.press('Enter');

        }
    }

    async clckSrchBtnOnMastrItmGrid() {
        // Clicks on the search button on Search Criteria Table of Master Item Grid
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const srchbtn = frame.locator('button[id = "search"][title="Search"]');
        await srchbtn.waitFor({
            state: 'visible'
        });
        await expect(srchbtn).toBeEnabled();
        await srchbtn.click();
    }

    async chckRecordCount(matches: any) {
        // Gives the total Master Items retrieved on UI and checks with the input data "matches"
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await this.page.waitForTimeout(3000);
        await frame.locator('input[role="checkbox"][id="cb_mimGrid"]').check(); // select all button on Master Items table
        try {
            const text = await frame.locator('div[class="advUI-selectedItems"]').textContent();
            const number = text ? parseInt(text.replace(/\D/g, ""), 10) : null;
            await frame.locator('input[role="checkbox"][id="cb_mimGrid"]').uncheck(); // uncheck the select all button

            if (number === matches) {
                console.log("All the records were fetched successfully!");
            }
            else {
                throw new Error(`Incorrect number of Items fetched on UI! Expected: "${matches}" Records on MI Grid: "${number}" `);
            }
        }
        catch (err: any) {
            throw new Error(err);
        }
    }

    async clckOnCopyMstrItmsBtn(itemsToSel: any) {
        // Clicks on the "Copy selected items to quote" button on Master Item Grid
        try {
            const frame = await this.quote.frameInEQG(); // Setting up the iframe
            await frame.getByRole('button', { name: 'Copy selected items to quote' }).click();
            // Wait for notification textand validate message
            await frame.locator('div[class="ui-pnotify-text"]').waitFor({ state: 'visible', timeout: 8000 });
            const successMsg = await frame.locator('div[class="ui-pnotify-text"]').textContent();
            if (successMsg === `${itemsToSel.length} items copied to Quote` || successMsg === `${itemsToSel.length} item copied to Quote`) {
                console.log("Items were copied with success message on UI");
            }
            else { console.log(`A message was captured after copy:${successMsg}`); }
        }
        catch (err: any) { console.log("Error Occured", err); }
    }

    async itmTypeLocator() {
        // Locator for selecting Manufacturer depends on Org
        let itmTypeLocator: string;
        if (process.env.SF_INSTANCE_URL === 'https://st1723635638241.my.salesforce.com') {
            itmTypeLocator = 'Item_Type__c'
        } else {
            itmTypeLocator = 'Item_Type_X__c'
        }
        return itmTypeLocator;
    }

    async fetchSelectedMasterItemData(rowsSelected: any) {
        // Gets the row data of the selected Master Items from Master Item Tab
        const selMastrData = [];
        const rowNumber = JSON.parse(rowsSelected);
        const itmTypeLocator = await this.itmTypeLocator();
        for (let i = 0; i < rowNumber.length; i++) {

            const frame = await this.quote.frameInEQG();
            const prtNo = await frame.locator(`td[role = "gridcell"][aria-describedby="mimGrid_${this.orgPrefix}__Part_Number__c"]`).nth(rowNumber[i] - 1).textContent();
            // const itmType = await frame.locator(`td[role = "gridcell"][aria-describedby="mimGrid_${this.orgPrefix}__${itmTypeLocator}"]`).nth(rowNumber[i]-1).textContent();
            const qty = await frame.locator(`td[role = "gridcell"][aria-describedby="mimGrid_${this.orgPrefix}__Default_Quantity__c"]`).nth(rowNumber[i] - 1).textContent();
            const unitLP = await frame.locator(`td[role = "gridcell"][aria-describedby="mimGrid_${this.orgPrefix}__Unit_List_Price__c"]`).nth(rowNumber[i] - 1).textContent();
            // const totVarCost = await frame.locator(`td[role = "gridcell"][aria-describedby="mimGrid_${this.orgPrefix}__VAR_Cost__c"]`).nth(rowNumber[i]-1).textContent();

            const Data = {
                "Part Number": prtNo,
                //  "Item Type": itmType,
                "Unit List Price": unitLP,
                "Quantity": qty,
                //  "VAR Total Cost": totVarCost
            };
            selMastrData.push(Data);
        }
        return selMastrData;
    }

    async vldateMstrItmsOnEQG(mastrItmData: any[], qtItmData: any[]) {
        // Validates the copied Master items on the Edit Quote Grid
        return mastrItmData.every(mastrItm => qtItmData.some(eqgItem => JSON.stringify(qtItmData) === JSON.stringify(mastrItm)));
    }

    async validateAndReportMismatches(mastrItmData: any[], qtItmData: any[], keyField: string): Promise<{ isValid: boolean; htmlReport: string }> {
        // Checks if the mastrItmData (List of copied Master Items from Master Item Grid) is present on qtItmData (List of all EQG Data row values) on Edit Quote Grid
        // returns flag isValid and Mismatch HTML table
        let isValid = true;

        let table = `<h4 style="margin:0;padding:0;font-weight:bold;">Copied Values Table</h4>`;
        table += `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;margin-top:4px;">`;
        table += `<thead><tr>
            <th style="color:#003366;">${keyField}</th>
            <th style="color:#003366;">Field</th>
            <th style="color:#003366;">Value on Master Item Grid</th>
            <th style="color:#003366;">Value on EQG</th>
            <th style="color:#003366;">Mismatch</th>
        </tr></thead>`;

        for (const mastrItm of mastrItmData) {
            const keyValue = mastrItm[keyField];
            const match = qtItmData.find(eqgItem => eqgItem[keyField] === keyValue);
            table += `<tr><td colspan="5" style="background:#f0f0f0;font-weight:bold;">${keyValue}</td></tr>`;

            if (!match) {
                isValid = false;
                table += `<tr>
                <td style="color:red;">${keyValue}</td>
                <td colspan="3" style="color:red;">Missing in qtItmData</td>
                <td><span style="color:red;">Yes</span></td>
            </tr></tbody>`;
                continue;
            }

            for (const field of Object.keys(mastrItm)) {
                if (field === keyField) continue;

                const expected = mastrItm[field];
                const actual = match[field];
                let isMismatch: boolean;
                if (field === 'Unit List Price') {
                    const normExpected = await this.advui.cleanPricingData(expected);
                    const normActual = await this.advui.cleanPricingData(actual);
                    const numExpected = normExpected == null ? 0 : parseFloat(normExpected);
                    const numActual = normActual == null ? 0 : parseFloat(normActual);
                    isMismatch = isNaN(numExpected) || isNaN(numActual)
                        ? normExpected !== normActual
                        : numExpected !== numActual;
                } else {
                    isMismatch = expected !== actual;
                }

                if (isMismatch) isValid = false;

                table += `<tr>
                <td></td>
                <td>${field}</td>
                <td style="color:${isMismatch ? 'red' : 'green'};">${expected}</td>
                <td style="color:${isMismatch ? 'red' : 'green'};">${actual}</td>
                <td><span style="color:${isMismatch ? 'red' : 'green'};">${isMismatch ? 'Yes' : 'No'}</span></td>
            </tr>`;
            }
            table += `</tbody>`;
        }

        table += `</table>`;
        table = table.replace(/\n/g, '').replace(/\s{2,}/g, ' ').trim();
        return { isValid, htmlReport: table.trim() };
    }

    async gotoQuoteById(quoteId: string) {
        // SF_INSTANCE_URL already includes https://; quote test data uses record Id (same as goToRecord)
        await this.goToRecord(quoteId);
    }

    async readBOMIdsFromExcel() {
        // Logic to read BOM Ids from an Excel file
        const workbook = XLSX.readFile(BOMs_TO_COPY);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, raw: true });
        const dataRows = rows.slice(1);
        return dataRows;
    }

    async selectGivenRows(rowsToEdit: any) {
        // selects rows when given an array of row numbers 
        // rowNumber: [1,2,3]
        if (rowsToEdit.length === 0) { return 0; }
        const frame = this.page.locator('iframe[name^="vfFrameId_"]').contentFrame();
        const rowNumber = JSON.parse(rowsToEdit);
        for (let i = 0; i < rowNumber.length; i++) {
            // select the row by rowNumber[i]
            console.log(rowNumber[i]);
            await this.page.waitForTimeout(3000);
            try {
                const Row = await frame.locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])').nth(rowNumber[i]);
                await Row.locator('input[type="checkbox"]').first().waitFor({ state: 'visible', timeout: 8000 });
                const checkbox = Row.locator('input[type="checkbox"]').first();
                if (await Row.count() > 0) {
                    await checkbox.click();
                    console.log(`Clicked checkbox for Row Number: ${rowNumber[i]}`);
                } else {
                    throw new Error(` Row not found `);
                }
            } catch (err: any) {
                console.error(`Failed to select row: ${err.message}`);
                throw new Error(`Row could not be selected within the timeout.`);
            }
        }
    }

    async getExcelValueForBulk(sheetPath: any, sheetName: any, rowsToEdit: any, currentRowNumber: any){
        // returns calculated data from Bulk edit Excel data 
        const excel = getExcelData(sheetPath, sheetName);
        const rowNumberArray: number[] = JSON.parse(rowsToEdit); // e.g., [1, 3, 5]
        const dataRows = rowNumberArray.length;
        const preciseData = [];
        const roundData = [];

        // helper to format and round numbers
        const formatNumber = (val: any, roundTo: any) => {
            const num = parseFloat(val);
            return isNaN(num) ? "0.00" : num.toFixed(roundTo); // rounds to how many digits is given as input 
        };

        // Iterate over the Excel Rows after data is rounded to 2 Decimal places
        for (let i = currentRowNumber; i < (currentRowNumber + dataRows); i++) {
            let rowNumber = i;
            const comparisonData = {
                List_Price__c: formatNumber(excel.getCell(rowNumber, "List_Price__c"), 2),
                Quantity__c: formatNumber(excel.getCell(rowNumber, "Quantity__c"), 2),
                Total_List_Price__c: formatNumber(excel.getCell(rowNumber, "Total_List_Price__c"), 2),
                VAR_Discount_Pct__c: formatNumber(excel.getCell(rowNumber, "VAR_Discount_Pct__c"), 2),
                VAR_Unit_Cost__c: formatNumber(excel.getCell(rowNumber, "VAR_Unit_Cost__c"), 2),
                VAR_Total_Cost__c: formatNumber(excel.getCell(rowNumber, "VAR_Total_Cost__c"), 2),
                VAR_Margin_Pct__c: formatNumber(excel.getCell(rowNumber, "VAR_Margin_Pct__c"), 2),
                VAR_Markup_Pct__c: formatNumber(excel.getCell(rowNumber, "VAR_Markup_Pct__c"), 2),
                VAR_Margin__c: formatNumber(excel.getCell(rowNumber, "VAR_Margin__c"), 2),
                VAR_Total_Profit__c: formatNumber(excel.getCell(rowNumber, "VAR_Total_Profit__c"), 2),
                Cust_Discount_Pct__c: formatNumber(excel.getCell(rowNumber, "Cust_Discount_Pct__c"), 2),
                Cust_Unit_Price__c: formatNumber(excel.getCell(rowNumber, "Cust_Unit_Price__c"), 2),
                Cust_Extended_Price__c: formatNumber(excel.getCell(rowNumber, "Cust_Extended_Price__c"), 2),
            };
            roundData.push(comparisonData);
        }

        // Iterate over the Excel Rows and data is rounded to 2 Decimal places 
        for (let i = currentRowNumber; i < (currentRowNumber + dataRows); i++) {
            let rowNumber = i;
            const comparisonData = {
                List_Price__c: formatNumber(excel.getCell(rowNumber, "List_Price__c"), 7),
                Quantity__c: formatNumber(excel.getCell(rowNumber, "Quantity__c"), 7),
                Total_List_Price__c: formatNumber(excel.getCell(rowNumber, "Total_List_Price__c"), 7),
                VAR_Discount_Pct__c: formatNumber(excel.getCell(rowNumber, "VAR_Discount_Pct__c"), 7),
                VAR_Unit_Cost__c: formatNumber(excel.getCell(rowNumber, "VAR_Unit_Cost__c"), 7),
                VAR_Total_Cost__c: formatNumber(excel.getCell(rowNumber, "VAR_Total_Cost__c"), 7),
                VAR_Margin_Pct__c: formatNumber(excel.getCell(rowNumber, "VAR_Margin_Pct__c"), 7),
                VAR_Markup_Pct__c: formatNumber(excel.getCell(rowNumber, "VAR_Markup_Pct__c"), 7),
                VAR_Margin__c: formatNumber(excel.getCell(rowNumber, "VAR_Margin__c"), 7),
                VAR_Total_Profit__c: formatNumber(excel.getCell(rowNumber, "VAR_Total_Profit__c"), 7),
                Cust_Discount_Pct__c: formatNumber(excel.getCell(rowNumber, "Cust_Discount_Pct__c"), 7),
                Cust_Unit_Price__c: formatNumber(excel.getCell(rowNumber, "Cust_Unit_Price__c"), 7),
                Cust_Extended_Price__c: formatNumber(excel.getCell(rowNumber, "Cust_Extended_Price__c"), 7),
            };
            preciseData.push(comparisonData);
        }

        return {precise: preciseData, rounded: roundData};
    }

    async getDataFromGrid(rowsToEdit: any, SheetName: any) {

        const advui = new AdvanceUi(this.page);
        await this.page.waitForTimeout(5000); // Wait for the values to be set from calculation Engine
        // Only the fields that are present on the excel will be used to extract the values from the Edit Quote Grid
        const workbook = XLSX.readFile(QUOTE_TEST_DATA);
        const fieldKeys = this.getRequiredFieldsFromExcelData(SheetName, workbook);
        const rowNumberArray: number[] = JSON.parse(rowsToEdit);
        const eqgDBList: { [key: string]: string | undefined }[] = [];

        for (let i = 0; i < rowNumberArray.length; i++) {
            const rowToEdit = await advui.findTheRow(rowNumberArray[i]);
            // Extract the values from the Edited Row of Edit Quote Grid
            const eqgData: { [key: string]: string | undefined } = {};
            for (const key of await fieldKeys) {
                const cell = await rowToEdit.locator(`td[aria-describedby="qtGrid_${this.orgPrefix}__${key}"]`).first();
                let value = (await cell.textContent())?.trim();
                if (value) {
                    value = String(value).replace(/[$€£,]/g, '');
                    // If value is an whole number, add ".00"
                    if (!isNaN(Number(value)) && value !== '' && !value.includes('.')) {
                        value = `${value}.00`;
                    }
                }
                eqgData[key] = value;
            }
            eqgDBList.push(eqgData);
        }
        console.log(eqgDBList);
        return eqgDBList;
    }

    async selectBomAndCopyOnly(bomSrc: any, bomToCopy: any){
        // Selects BoM Items for Copy from the Quote page based on the BOM Ids from Excel file
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const BomRowsInGrid = frame.locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])');
        const quickAddToQuote = frame.locator('button[id="btnquickAddToQuote"]');
        await quickAddToQuote.waitFor({state: "attached"});
        let errors: string[] = [];
        // --(1)-- Select the BOM Source
        if (bomSrc !== undefined && bomToCopy !== undefined) {
            await frame.locator('span[class="select2-selection__arrow"][role="presentation"]').click();
            await frame.getByRole('treeitem', { name: new RegExp('^' + bomSrc) }).click();
            await this.page.waitForTimeout(3000); // Wait for the page to load completely
        }
        // --(2)-- Select the BOM 
        const bomLocator = BomRowsInGrid.filter({ has: frame.locator('td[role="gridcell"][aria-describedby="BomSelectorGrid_Name"] a'), hasText: bomToCopy });
        await bomLocator.locator('input[type="checkbox"]').click();
    }

    async selectBoMIdsFromExcel(no_of_BoMs: any | null) {
        // Selects BoM Items for Copy from the Quote page based on the BOM Ids from Excel file
        // no_of_BoMs = "all" reads all Boms, no_of_BoMs = 2 reads first two bom only... 
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const targetRows = await this.readBOMIdsFromExcel();
        const rows = frame.locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])');

        // Pick BOM Source and BOM Number from the targetRows
        const BoMNumbers: any[] = [];
        const BoMSources: string[] = [];
        for (const item of targetRows) {
            BoMSources.push(item[0]);
            BoMNumbers.push(item[1]);
        }
        // Waiting for the page to load completely
        await this.page.waitForTimeout(5000);
        // await frame.locator('tr[role="row"][class="ui-jqgrid-labels"]').waitFor({ state: 'visible' }); // commented as it was failing when browser was disabled
        let errors: string[] = [];

        // If no_of_BoMs is null or undefined or empty, set it to the length of targetRows
        if (no_of_BoMs === null || no_of_BoMs === "" || no_of_BoMs === undefined || no_of_BoMs === "all") {
            no_of_BoMs = targetRows.length;
        }

        for (let i = 0; i < no_of_BoMs; i++) {

            // --(1)-- Select the BOM Source
            if (BoMSources[i] !== undefined) {
                await frame.locator('span[class="select2-selection__arrow"][role="presentation"]').click();
                await frame.getByRole('treeitem', { name: new RegExp('^' + BoMSources[i]) }).click();
                await this.page.waitForTimeout(3000); // Wait for the page to load completely
            }
            const row = rows.filter({
                has: frame.locator('td[role="gridcell"][aria-describedby="BomSelectorGrid_Name"] a'),
                hasText: BoMNumbers[i]
            });
            if (await row.count() > 0) {
                await row.locator('input[type="checkbox"]').click();
                console.log(`Clicked checkbox for BoM Number: ${BoMNumbers[i]}`);
            } else {
                errors.push(` BoM Number: ${BoMNumbers[i]} was not found, under BoM Source: ${BoMSources[0]} `); // ${BoMSources[0]} as bom source is present on the first row
                continue;
            }
        }
        if (errors.length === no_of_BoMs) {
            TestContext.skipAfterEach = true;
            throw new Error(` Some BoM Numbers were not found.</h3> ${errors.join('')}`);
        }
        return errors;
    }

    async selectMultipleBomsOnSelectorPage(bomSource: any, bomNames: string[]): Promise<void> {
        const frame = await this.quote.frameInEQG();
        const bomRowsInGrid = frame.locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])');

        if (bomSource !== undefined) {
            await frame.locator('span[class="select2-selection__arrow"][role="presentation"]').click();
            await frame.getByRole('treeitem', { name: new RegExp('^' + bomSource) }).click();
            await this.page.waitForTimeout(3000);
        }

        for (const bomToCopy of bomNames) {
            const bomToCopyStr = String(bomToCopy);
            const bomLocator = bomRowsInGrid.filter({
                has: frame.locator('td[role="gridcell"][aria-describedby="BomSelectorGrid_Name"] a'),
                hasText: bomToCopyStr,
            });

            const startTime = Date.now();
            while (Date.now() - startTime < 20000) {
                if ((await bomLocator.count()) > 0) {
                    break;
                }
                await this.page.waitForTimeout(1000);
            }

            if ((await bomLocator.count()) === 0) {
                throw new Error(`BoM Number: ${bomToCopyStr} was not found under BoM Source: ${bomSource}`);
            }

            const isChecked = await bomLocator.locator('input[type="checkbox"]').isChecked();
            if (!isChecked) {
                await bomLocator.locator('input[type="checkbox"]').click();
                console.log(`Clicked checkbox for BoM Number: ${bomToCopyStr}`);
            } else {
                console.log(`BoM Number: ${bomToCopyStr} is already selected`);
            }
        }
    }

    async selectBomAndCopy(bomSource: any, bomToCopy: any): Promise<boolean> {

        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const BomRowsInGrid = frame.locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])');

        let errors: string[] = [];
        // --(1)-- Select the BOM Source
        if (bomSource !== undefined && bomToCopy !== undefined) {
            await frame.locator('span[class="select2-selection__arrow"][role="presentation"]').click();
            await frame.getByRole('treeitem', { name: new RegExp('^' + bomSource) }).click();
            await this.page.waitForTimeout(3000); // Wait for the page to load completely
        }
        // --(2)-- Select the BOM 
        const bomLocator = BomRowsInGrid.filter({ has: frame.locator('td[role="gridcell"][aria-describedby="BomSelectorGrid_Name"] a'), hasText: bomToCopy });

        const startTime = Date.now();
        let countbomlocator = 0;

        while (Date.now() - startTime < 20000) {
            countbomlocator = await bomLocator.count();
            // As soon as BOM row appears, exit loop
            if (countbomlocator > 0) {
                break;
            }
            // Pause between polls to avoid busy looping and CPU overuse
            await this.page.waitForTimeout(1000);

        }
        // Safe to check now because we confirmed BOM row exists
        const isChecked = await bomLocator.locator('input[type="checkbox"]').isChecked();
        console.log("the count of the bom locator is" + countbomlocator);
        console.log("the box is already checked or not" + "== " + " " + isChecked);

        //Handle selection or cleanup ---

        if (isChecked == false) {
            await bomLocator.locator('input[type="checkbox"]').click();
            console.log(`Clicked checkbox for BoM Number: ${bomToCopy}`);
            return true;
        } else {
            //errors.push(`<h3> BoM Number: ${bomToCopy} was not found, under BoM Source: ${bomSource} </h3>`);
            console.log("we are getting error to select the bom because bom is already select in this page" + ` BoM Number: ${bomToCopy} was not found, under BoM Source: ${bomSource} `);
            await this.advui.gotoChevron(goToCopyBoMItems);
            await this.advui.clickOnButton(selectAllButtonLocator);
            await this.advui.clickOnButton(deleteButtonLocator);
            await this.advui.clickYesOnconfirmationPopUp();
            await this.advui.clickOnButton(deleteButtonLocator);
            await this.advui.clickOnCopyBoMItemsButton();
            return false;


        }

    }

    async checkBoMSourceAndSwitchIfNeeded(bomSource: any) {
        // Logic to check and switch BOM Source if needed for data deletion
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        if (!bomSource.startsWith("Opportunity BoMs")) {
            await frame.locator('span[class="select2-selection__arrow"][role="presentation"]').click();
            await frame.getByRole('treeitem', { name: new RegExp('^' + bomSource) }).click();
            await this.page.waitForTimeout(3000); // Wait for the page to load completely
        }
        else return 0;
    }

    async goToSelectBoMsPage() {
        // Navigate to the BOM selection page        
        await this.page.waitForTimeout(3000); // Wait for the page to load completely
        await this.quote.getItemByRoleandClick('button', 'Show more actions');
        await this.quote.clickOnQuoteButton('Copy BoMs to Quote');
        console.log(`Copy BoMs to Quote button is clicked`);
        await this.page.locator('iframe[name^="vfFrameId_"]').waitFor({ state: 'visible' });
        console.log(`Select BoMs page is opened`);
        if (await this.page.locator('iframe[name^="vfFrameId_"]').count() === 0) {
            throw new Error(`<h4> No BOM found for BOM selection. </h4>`);
        }
    }

    async selectFirstNBomsForCopy(no_of_BoMs: any) {
        // Selects the first n number of BoM Items for Copy from the Select BoMs page

        const errors: string[] = [];
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        // Logic to select single or multiple boms
        const checkboxes = frame.locator('[id="BomSelectorGrid"] [role="row"] [type="checkbox"]');

        for (let i = 0; i < no_of_BoMs; i++) {
            try {
                await checkboxes.nth(i).click();
            } catch (error) {
                errors.push(` Error selecting BOM checkbox: ${error}`);
                continue;
            }
        }
        return errors;
    }

    async selctAllBtnOnShipTo() {
        // Selects the select all checkbox in Ship To Assignement Grid
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator('input[role="checkbox"][id="cb_grid"]').click();
    }

    async fetchSelRcdsOnShipTo() {
        // Gives the total records selected on shipTo assignment Grid
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        // const rawTxt =  await frame.locator('div[class="advUI-selectedItems"]').textContent();
        const rawTxt = await frame.locator('button[id="btnSave"] b[style="color:red"]').textContent();
        // Extract the number using regex
        const match = rawTxt?.match(/\b\d+\b/);
        return match ? parseInt(match[0], 10) : 0; // if no match returns 0, if 09 returns 9
    }

    async waitForShipToTitle() {
        //TODO expect to have 'ShipTo Assignment for Quote Items' as Grid header
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const title = frame.locator('span.ui-jqgrid-title').filter({ hasText: 'ShipTo Assignment for Quote Items' });
        await title.waitFor({ state: 'visible', timeout: 20000 });
    }

    async updtShipToAcc(AccntName: any) {
        // Selects the Account name
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator(`span[class="select2-selection select2-selection--single"][role="combobox"][aria-haspopup="true"][aria-expanded="false"][aria-labelledby="select2-${this.orgPrefix}__Account_Site__c-container"]`).click();
        await frame.locator('li[class="select2-results__option"][role="treeitem"][aria-selected="false"]').filter({ hasText: `${AccntName}` }).click();
    }

    async updtShipToAccInLine(AccntName: any) {
        // Selects the Account name in line edit mode
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator(`span[class="select2-selection__rendered"][id$="_${this.orgPrefix}__Account_Site__c-container"]`).nth(1).click(); // We will be clicking second locator that matched, as the first locator that matched was the Assigned ShipTo filter
        await frame.locator('li[class^="select2-results__option"][role="treeitem"]').filter({ hasText: `${AccntName}` }).click();
        await this.page.keyboard.press('Enter');
    }

    async clkUpdtBtnOnShipTo() {
        // Clicks update button on Assigning Bulk Ship To POPUP
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator('a[id="sData"]').click();
    }

    async validateShipToGridAfterSave(rowsToSelect: any, siteAdd: any, siteCity: any, siteCountry: any) {
        // Validate the ShipTo Grid after saving

        const siteAddListUI = await this.fetchValuesfrmShipToGrid("Account_Site_Street__c");
        const siteCityListUI = await this.fetchValuesfrmShipToGrid("Account_Site_City__c");
        const siteCountryListUI = await this.fetchValuesfrmShipToGrid("Account_Site_Country__c");
        if (rowsToSelect === '["all"]') {
            // if we are sending all rows to select it generates a list of all rows present in the UI
            rowsToSelect = Array.from({ length: siteAddListUI.length }, (_, i) => i + 1);     // updated Rows to select with index starting with 1 when using all method
        } else rowsToSelect = JSON.parse(rowsToSelect);

        for (let i = 0; i < rowsToSelect.length; i++) {
            // Iterate through the rows that were changed

            const idx = (rowsToSelect[i] - 1);        // The rows that were changed on test case are 1 based index, so converting to 0 based index for array access
            const addr = siteAddListUI[idx];        // Fetching the Site Address values from UI based on the changed rows
            const city = siteCityListUI[idx];       // Fetching the Site City values from UI based on the changed rows
            const country = siteCountryListUI[idx]; // Fetching the Site Country values from UI based on the changed rows

            if ((addr === siteAdd) && (city === siteCity) && (country === siteCountry)) {
                console.log(`Row ${idx + 1} validated successfully: "${addr}, ${city}, ${country}"`);
            } else {
                throw new Error(`Mismatch at row ${idx + 1}: expected "${siteAdd}, ${siteCity}, ${siteCountry}", found "${addr}, ${city}, ${country}"`);
            }
        }
    }

    async clkOnSaveRecrds() {
        // Clicks on save records button on ShipTo Grid
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator('button[id="btnSave"]').click();
    }

    async gotoCopyBomItemsToQuote() {
        const frame = await this.quote.frameInEQG();
        const copyTab = frame.getByRole('link', { name: 'Copy BoM Items' });
        if (!(await copyTab.isVisible().catch(() => false))) {
            await frame
                .getByRole('link', { name: /Select BoMs/i })
                .click({ timeout: 15000 })
                .catch(() => undefined);
            await this.page.waitForTimeout(1000);
        }
        await copyTab.click({ timeout: 60000 });
    }

    async getBoMHeaderPricingFromCopyBoMItemsTab(): Promise<{ extListPrice: number; extNetPrice: number }> {
        // Reads BoM header row totals (Ext List Price, Ext Net Price) from the Copy BoM Items tab grid.
        // Each top-level group row (id starts with "QuoteGridghead_0_") shows one BoM's sum; aggregate all when multiple BoMs are present.
        const frame = await this.quote.frameInEQG();
        const bomHeaderRows = frame.locator('tr[id^="QuoteGridghead_0_"]');
        await bomHeaderRows.first().waitFor({ state: 'visible', timeout: 20000 });
        const parse = (raw: string | null) =>
            parseFloat((raw ?? '0').replace(/[,$\s]/g, '')) || 0;

        let extListPrice = 0;
        let extNetPrice = 0;
        const rowCount = await bomHeaderRows.count();
        for (let i = 0; i < rowCount; i++) {
            const row = bomHeaderRows.nth(i);
            const extListPriceText = await row
                .locator('td[aria-describedby="QuoteGrid_bm_Extended_List_Price"]')
                .textContent();
            const extNetPriceText = await row
                .locator('td[aria-describedby="QuoteGrid_bm_Extended_Net_Price"]')
                .textContent();
            const rowExtListPrice = parse(extListPriceText);
            const rowExtNetPrice = parse(extNetPriceText);
            extListPrice += rowExtListPrice;
            extNetPrice += rowExtNetPrice;
            console.log(`BoM header row ${i + 1}/${rowCount} — Ext List Price: ${rowExtListPrice}, Ext Net Price: ${rowExtNetPrice}`);
        }

        // Round to 2 decimals so JS float sum noise (e.g. 5322480.260000001) matches currency UI values.
        const result = {
            extListPrice: Math.round(extListPrice * 100) / 100,
            extNetPrice: Math.round(extNetPrice * 100) / 100,
        };
        console.log(`BoM header baseline pricing (total across ${rowCount} BoM(s)) — Ext List Price: ${result.extListPrice}, Ext Net Price: ${result.extNetPrice}`);
        return result;
    }

    async goToRecord(Id: string) {
        // method to go to any record page from its record ID 
        if (!Id) { throw new Error(`Cannot Go to the record Id as it is blank`); } // Throws Error if no Id is passed
        await this.page.goto(`${process.env.SF_INSTANCE_URL}/${Id}`);
        await this.page.waitForTimeout(6000); // Wait for the page to load completely
    }

    async goToEditQuoteGrid() {
        await this.page.locator('button', { has: this.page.locator('span', { hasText: 'Show more actions' }) }).click();
        await this.page.getByRole('menuitem', { name: 'Edit Quote' }).click();
    }

    async selectItemsforCopy(no_of_items: any) {
        // Selects BoM items from the first non-linearly (1.. then 3.. then 5.. like this)

        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        // Logic to select single or multiple items
        const checkboxes = await frame.locator('input[name^="jqg_QuoteGrid_"]');
        for (let i = 0; i < no_of_items; i += 2) {
            try {
                await checkboxes.nth(i).click();

            } catch (error) {
                throw new Error(`Error selecting BOM checkbox: ${error}`);
            }
        }
    }

    private copyBoMItemPartColumnIds(): string[] {
        const prefix = this.orgPrefix;
        return [
            `QuoteGrid_${prefix}__Part_Number__c`,
            'QuoteGrid_bm_Part_Number',
            `QuoteGrid_${prefix}__Part_Number`,
        ];
    }

    private copyBoMItemRowLocator(
        frame: Awaited<ReturnType<SalesforceUtils['frameInEQG']>>
    ) {
        return frame.locator('tr.jqgrow, tr[role="row"]');
    }

    private async findCopyBoMItemRow(
        frame: Awaited<ReturnType<SalesforceUtils['frameInEQG']>>,
        lineItemKey: string,
        matchBy: 'part' | 'line' | 'auto' = 'auto'
    ) {
        const prefix = this.orgPrefix;
        const lineCols = [
            `QuoteGrid_bm_Line_Number`,
            `QuoteGrid_${prefix}__Line_Number__c`,
            `QuoteGrid_${prefix}__Sort_Order__c`,
        ];
        const escaped = lineItemKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exact = new RegExp(`^\\s*${escaped}\\s*$`, 'i');
        const rows = this.copyBoMItemRowLocator(frame);

        const tryPart = matchBy === 'part' || matchBy === 'auto';
        const tryLine = matchBy === 'line' || (matchBy === 'auto' && /^\d+$/.test(lineItemKey));

        if (tryPart) {
            for (const partCol of this.copyBoMItemPartColumnIds()) {
                const byPart = rows.filter({
                    has: frame.locator(`td[aria-describedby="${partCol}"]`, { hasText: exact }),
                });
                if ((await byPart.count()) > 0) return byPart.first();
            }
        }
        if (tryLine) {
            for (const lineCol of lineCols) {
                const byLine = rows.filter({
                    has: frame.locator(`td[aria-describedby="${lineCol}"]`, { hasText: exact }),
                });
                if ((await byLine.count()) > 0) return byLine.first();
            }
        }
        const fallback = rows.filter({ hasText: exact }).first();
        return (await fallback.count()) > 0 ? fallback : null;
    }

    private async readPartNumberFromCopyBoMRow(
        row: NonNullable<Awaited<ReturnType<QuoteService['findCopyBoMItemRow']>>>
    ): Promise<string> {
        for (const partCol of this.copyBoMItemPartColumnIds()) {
            const cell = row.locator(`td[aria-describedby="${partCol}"]`);
            if ((await cell.count()) === 0) continue;
            const value = ((await cell.textContent()) ?? '').trim();
            if (value) return value;
        }
        return '';
    }

    /** Expand the next collapsed tree row under a top-level BoM group on Copy BoM Items. */
    private async expandNextCollapsedRowInBomScope(bomScope: string): Promise<boolean> {
        const frame = await this.quote.frameInEQG();
        const expandSelector =
            'td.ui-sgcollapsed span.ui-icon-plus, td.ui-sgcollapsed span.ui-icon-circlesplus, .tree-wrap-ltr .ui-icon-plus';
        const headers = frame.locator('tr[id*="QuoteGridghead_0_"]');
        const headerCount = await headers.count();
        let startIdx = -1;
        for (let i = 0; i < headerCount; i++) {
            const text = (await headers.nth(i).textContent()) ?? '';
            if (text.includes(bomScope)) {
                startIdx = i;
                break;
            }
        }
        if (startIdx < 0) {
            return this.expandBomGroupInCopyBoMItemsTab(bomScope);
        }

        const startHeader = headers.nth(startIdx);
        const endHeader = startIdx + 1 < headerCount ? headers.nth(startIdx + 1) : null;
        const startId = await startHeader.getAttribute('id');
        const endId = endHeader ? await endHeader.getAttribute('id') : null;
        if (!startId) {
            return this.expandBomGroupInCopyBoMItemsTab(bomScope);
        }

        const clicked = await frame.locator('table#QuoteGrid tr, table[id="QuoteGrid"] tr').evaluateAll(
            (rows, { startId, endId, expandSelector }) => {
                let inScope = false;
                for (const row of rows) {
                    if (row.id === startId) {
                        inScope = true;
                        const plus = row.querySelector(expandSelector);
                        if (plus instanceof HTMLElement) {
                            plus.click();
                            return true;
                        }
                        continue;
                    }
                    if (endId && row.id === endId) break;
                    if (!inScope) continue;
                    const plus = row.querySelector(expandSelector);
                    if (plus instanceof HTMLElement) {
                        plus.click();
                        return true;
                    }
                }
                return false;
            },
            { startId, endId, expandSelector }
        );

        return clicked;
    }

    /** Expand nested BoM tree rows until the target line item row is rendered. */
    private async ensureCopyBoMLineItemVisible(
        lineItemKey: string,
        bomScope?: string
    ): Promise<boolean> {
        for (let attempt = 0; attempt < 15; attempt++) {
            const frame = await this.quote.frameInEQG();
            if (await this.findCopyBoMItemRow(frame, lineItemKey)) {
                return true;
            }
            if (!bomScope) break;
            const expanded = await this.expandNextCollapsedRowInBomScope(bomScope);
            if (!expanded) break;
            await this.page.waitForTimeout(350);
        }
        return false;
    }

    /** Row state on Copy BoM Items: disabled checkbox means the item is already on the Quote. */
    private async getCopyBoMItemRowState(
        lineItemKey: string
    ): Promise<{ partNumber: string; alreadyCopied: boolean } | null> {
        const frame = await this.quote.frameInEQG();
        const row = await this.findCopyBoMItemRow(frame, lineItemKey);
        if (!row) {
            return null;
        }
        const checkbox = row.locator('input[type="checkbox"]').first();
        const partNumber =
            (await this.readPartNumberFromCopyBoMRow(row)) || lineItemKey.trim();
        const alreadyCopied = await checkbox.isDisabled();
        console.log(
            `[Copy BoM Items] row "${lineItemKey}" → part="${partNumber}", alreadyCopied=${alreadyCopied}`
        );
        return { partNumber, alreadyCopied };
    }

    /** Delete one Quote Item from the Copy BoM Items tab (already-copied / disabled row). */
    async deleteQuoteItemOnCopyBoMItemsTab(partNumber: string, advui: AdvanceUi): Promise<void> {
        const frame = await this.quote.frameInEQG();
        const row = await this.findCopyBoMItemRow(frame, partNumber, 'part');
        if (!row) {
            throw new Error(`Part Number "${partNumber}" not found on Copy BoM Items for delete`);
        }
        const checkbox = row.locator('input[type="checkbox"]').first();
        await row.scrollIntoViewIfNeeded();
        await checkbox.click({ force: true });
        await advui.clickOnButton(deleteButtonLocator);
        await advui.clickYesOnconfirmationPopUp();
    }

    /** Select a BoM-side row on Copy BoM Items for copy-to-quote. */
    private async selectCopyBoMItemRow(partNumber: string): Promise<void> {
        const frame = await this.quote.frameInEQG();
        const row = await this.findCopyBoMItemRow(frame, partNumber, 'part');
        if (!row) {
            throw new Error(`Part Number "${partNumber}" not found on Copy BoM Items for select`);
        }
        const checkbox = row.locator('input[type="checkbox"]').first();
        await row.scrollIntoViewIfNeeded();
        await checkbox.click({ force: true });
        await expect(checkbox).toBeChecked({ timeout: 10000 });
        console.log(`[Copy BoM Items] selected row Part Number="${partNumber}"`);
    }

    /** Open Copy BoMs wizard from the Quote and ensure the preferred BoM is selected. */
    private async openSelectBoMsWizardForCopy(
        cpiPage?: import('../pages/cpiCalculationPage').CpiCalculationPage,
        quoteName?: string,
        preferredBom?: string
    ): Promise<'selected' | 'already_on_quote' | 'not_found'> {
        const frame = await this.quote.frameInEQG().catch(() => null);
        const wizardOpen =
            frame &&
            (await frame
                .locator('[id="BomSelectorGrid"], button#btncopyBoMToQuote')
                .first()
                .isVisible()
                .catch(() => false));
        if (!wizardOpen) {
            if (!cpiPage || !quoteName) {
                throw new Error('Copy BoMs wizard is not open and quote context was not provided');
            }
            await cpiPage.gotoQuoteByName(quoteName);
            await this.goToSelectBoMsPage();
        }
        await this.waitForSelectBoMsGrid();
        if (!preferredBom) {
            return 'selected';
        }
        return this.ensureBomSelectedOnSelectorPage(preferredBom);
    }

    /** Remove a quote line from EQG when a prior run left it on the Quote (SOQL guard). */
    private async removeQuoteLineItemIfPresent(
        lineItemKey: string,
        cpiPage: import('../pages/cpiCalculationPage').CpiCalculationPage,
        quoteName: string,
        preferredBom: string
    ): Promise<void> {
        if (/^\d+$/.test(lineItemKey.trim())) return;

        await cpiPage.gotoQuoteByName(quoteName);
        const quoteId = await cpiPage.resolveQuoteRecordId(quoteName);
        const partField = `${this.orgPrefix}__Part_Number__c`;
        const escapedPart = lineItemKey.replace(/'/g, "\\'");
        const rows = await cpiPage.querySoql<{ Id: string }>(
            `SELECT Id FROM ${this.orgPrefix}__Cust_BoM_Item__c WHERE ${this.orgPrefix}__CustomerBoM__c = '${quoteId}' AND ${partField} = '${escapedPart}' LIMIT 1`
        );
        if (!rows[0]?.Id) return;

        console.log(
            `[Copy BoM Items] "${lineItemKey}" already on Quote (SOQL) — removing before recopy`
        );
        await cpiPage.deleteQuoteItemByPartNumberViaSoql(quoteName, lineItemKey);
        await this.openSelectBoMsWizardForCopy(cpiPage, quoteName, preferredBom);
    }

    /**
     * Copy a specific BoM line onto the Quote for CPI trigger testing.
     * If the line is already on the Quote (disabled checkbox), delete it first then recopy.
     */
    async copyBoMLineItemForCpiTrigger(
        preferredBom: string,
        lineItemKey: string,
        advui: AdvanceUi,
        opts?: { cpiPage?: import('../pages/cpiCalculationPage').CpiCalculationPage; quoteName?: string }
    ): Promise<{ partNumber: string; count: number; bomUsed: string }> {
        if (opts?.cpiPage && opts?.quoteName) {
            await this.removeQuoteLineItemIfPresent(
                lineItemKey,
                opts.cpiPage,
                opts.quoteName,
                preferredBom
            );
        }

        for (let attempt = 0; attempt < 2; attempt++) {
            const status = await this.openSelectBoMsWizardForCopy(
                opts?.cpiPage,
                opts?.quoteName,
                preferredBom
            );
            if (status === 'not_found') {
                throw new Error(`BoM ${preferredBom} not found on Select BoMs grid`);
            }
            await this.gotoCopyBomItemsToQuote();
            await this.waitForCopyBoMItemsTab();
            await advui.clickOnButton(untieButtonLocator);
            const visible = await this.ensureCopyBoMLineItemVisible(lineItemKey, preferredBom);
            if (!visible) {
                throw new Error(
                    `Line item "${lineItemKey}" not found on Copy BoM Items under BoM ${preferredBom}`
                );
            }

            const rowState = await this.getCopyBoMItemRowState(lineItemKey);
            if (!rowState) {
                throw new Error(
                    `Line item "${lineItemKey}" not found on Copy BoM Items under BoM ${preferredBom}`
                );
            }

            if (rowState.alreadyCopied) {
                console.log(
                    `[Copy BoM Items] "${rowState.partNumber}" already on Quote — deleting before recopy`
                );
                try {
                    await this.deleteQuoteItemOnCopyBoMItemsTab(rowState.partNumber, advui);
                } catch (deleteErr) {
                    if (!opts?.cpiPage || !opts?.quoteName) throw deleteErr;
                    console.warn(
                        `[Copy BoM Items] delete on Copy BoM Items tab failed; falling back to EQG: ${deleteErr}`
                    );
                    await opts.cpiPage.deleteQuoteItemByPartNumberViaSoql(
                        opts.quoteName,
                        rowState.partNumber
                    );
                    await this.openSelectBoMsWizardForCopy(
                        opts.cpiPage,
                        opts.quoteName,
                        preferredBom
                    );
                }
                continue;
            }

            await this.selectCopyBoMItemRow(rowState.partNumber);
            return { partNumber: rowState.partNumber, count: 1, bomUsed: preferredBom };
        }

        throw new Error(
            `Line item "${lineItemKey}" could not be prepared for copy under BoM ${preferredBom}`
        );
    }

    /** Expand one BoM group row on Copy BoM Items (does not expand the full 300+ item grid). */
    private async expandBomGroupInCopyBoMItemsTab(bomScope?: string): Promise<boolean> {
        if (!bomScope) {
            return false;
        }
        const frame = await this.quote.frameInEQG();
        const escaped = bomScope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const header = frame
            .locator('tr[id*="QuoteGridghead"], tr.jqgroup')
            .filter({ hasText: new RegExp(escaped) })
            .first();
        if ((await header.count()) === 0) {
            return false;
        }
        const expandBtn = header.locator(
            'td.ui-sgcollapsed span.ui-icon-plus, td.ui-sgcollapsed span.ui-icon-circlesplus, .tree-wrap-ltr .ui-icon-plus'
        );
        if ((await expandBtn.count()) === 0) {
            return false;
        }
        await expandBtn.first().click();
        return true;
    }

    /** Probe Copy BoM Items grid for the first copyable (not yet on Quote) part number. */
    async findFirstUncopiedPartOnCopyBoMItemsTab(bomNumber?: string): Promise<string | null> {
        const frame = await this.quote.frameInEQG();
        const partCol = `QuoteGrid_${this.orgPrefix}__Part_Number__c`;
        const checkboxes = frame.locator('input[name^="jqg_QuoteGrid_"]');
        const count = await checkboxes.count();

        for (let i = 0; i < count; i++) {
            const checkbox = checkboxes.nth(i);
            if (await checkbox.isDisabled()) continue;
            if (await checkbox.isChecked()) continue;

            const partNumber = await checkbox.evaluate((el, partColAttr) => {
                const row = el.closest('tr');
                return (
                    row?.querySelector(`td[aria-describedby="${partColAttr}"]`)?.textContent ?? ''
                ).trim();
            }, partCol);
            if (!partNumber) continue;

            if (bomNumber) {
                const matchesBom = await checkbox.evaluate((el, bom) => {
                    let cursor: Element | null = el.closest('tr');
                    while (cursor) {
                        cursor = cursor.previousElementSibling;
                        if (!cursor) break;
                        if (
                            cursor.id?.includes('QuoteGridghead') ||
                            cursor.classList.contains('jqgroup')
                        ) {
                            return cursor.textContent?.includes(bom) ?? false;
                        }
                    }
                    return true;
                }, bomNumber);
                if (!matchesBom) continue;
            }

            console.log(`[Copy BoM Items] found uncopied item Part Number="${partNumber}"`);
            return partNumber;
        }

        return null;
    }

    /** Select a copyable row on Copy BoM Items tab by Part Number. */
    async selectUncopiedItemByPartNumberOnCopyBoMItemsTab(
        partNumber: string
    ): Promise<{ partNumber: string; count: number }> {
        const frame = await this.quote.frameInEQG();
        const partCol = `QuoteGrid_${this.orgPrefix}__Part_Number__c`;
        const escaped = partNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const row = frame
            .locator('tr[role="row"]')
            .filter({
                has: frame.locator(`td[aria-describedby="${partCol}"]`, {
                    hasText: new RegExp(`^${escaped}$`),
                }),
            })
            .first();
        const checkbox = row.locator('input[type="checkbox"]').first();
        await checkbox.waitFor({ state: 'attached', timeout: 20000 });
        await checkbox.click({ force: true });
        await expect(checkbox).toBeChecked({ timeout: 5000 });
        console.log(`[Copy BoM Items] selected uncopied item Part Number="${partNumber}"`);
        return { partNumber, count: 1 };
    }

    /**
     * On Copy BoM Items tab (after Untie), select the first item that is not yet on the Quote.
     * Enabled, unchecked row checkboxes are treatable as copyable; disabled rows are already copied.
     */
    async selectFirstUncopiedItemOnCopyBoMItemsTab(
        bomNumber?: string
    ): Promise<{ partNumber: string; count: number }> {
        const partNumber = await this.findFirstUncopiedPartOnCopyBoMItemsTab(bomNumber);
        if (!partNumber) {
            throw new Error(
                `No uncopied item found on Copy BoM Items tab${bomNumber ? ` for BoM ${bomNumber}` : ''}`
            );
        }
        return this.selectUncopiedItemByPartNumberOnCopyBoMItemsTab(partNumber);
    }

    private async waitForSelectBoMsGrid(): Promise<void> {
        const frame = await this.quote.frameInEQG();
        await frame.locator('[id="BomSelectorGrid"]').waitFor({ state: 'visible', timeout: 60000 });
        await frame
            .locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])')
            .first()
            .waitFor({ state: 'visible', timeout: 60000 });
    }

    /** Match BoM Number or BoM Name on Select BoMs (Excel may provide either). */
    private bomSelectorRowLocator(frame: Awaited<ReturnType<SalesforceUtils['frameInEQG']>>, bomIdentifier: string) {
        const escaped = bomIdentifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped);
        return frame
            .locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])')
            .filter({ hasText: pattern });
    }

    private async readBomNumberFromSelectorRow(
        row: ReturnType<QuoteService['bomSelectorRowLocator']>
    ): Promise<string> {
        const numberCell = row.locator('td[role="gridcell"] a').first();
        return ((await numberCell.textContent()) ?? '').trim();
    }

    /**
     * First BoM on Select BoMs grid that can still be added (enabled, unchecked checkbox).
     */
    async findFirstSelectableBomOnSelectorPage(exclude: string[] = []): Promise<string | null> {
        const frame = await this.quote.frameInEQG();
        await this.waitForSelectBoMsGrid();
        const rows = frame.locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])');
        const rowCount = await rows.count();
        for (let i = 0; i < rowCount; i++) {
            const row = rows.nth(i);
            const checkbox = row.locator('input[type="checkbox"]').first();
            if ((await checkbox.count()) === 0) continue;
            if (await checkbox.isDisabled()) continue;
            if (await checkbox.isChecked()) continue;
            const bomNumber = await this.readBomNumberFromSelectorRow(row);
            if (!bomNumber || exclude.includes(bomNumber)) continue;
            return bomNumber;
        }
        return null;
    }

    /**
     * Ensure the BoM row is checked on Select BoMs without toggling off an already-selected BoM.
     */
    async ensureBomSelectedOnSelectorPage(
        bomToCopy: string
    ): Promise<'selected' | 'already_on_quote' | 'not_found'> {
        const frame = await this.quote.frameInEQG();
        await this.waitForSelectBoMsGrid();
        const bomLocator = this.bomSelectorRowLocator(frame, bomToCopy).first();
        if ((await bomLocator.count()) === 0) {
            return 'not_found';
        }
        const checkbox = bomLocator.locator('input[type="checkbox"]').first();
        const isChecked = await checkbox.isChecked();
        const isDisabled = await checkbox.isDisabled();
        if (isChecked) {
            console.log(
                `[Select BoMs] BoM ${bomToCopy} already selected${isDisabled ? ' (on Quote)' : ''}`
            );
            return 'already_on_quote';
        }
        if (isDisabled) {
            throw new Error(`BoM ${bomToCopy} checkbox is disabled and cannot be selected`);
        }
        await checkbox.click();
        console.log(`[Select BoMs] selected BoM ${bomToCopy}`);
        return 'selected';
    }

    private async waitForCopyBoMItemsTab(): Promise<void> {
        const frame = await this.quote.frameInEQG();
        await frame.locator('button#btncopyBoMToQuote').waitFor({ state: 'visible', timeout: 60000 });
        await frame.locator(`button.${untieButtonLocator}`).waitFor({ state: 'visible', timeout: 60000 });
        await frame
            .locator('tr[id^="QuoteGridghead_0_"], table[id="QuoteGrid"]')
            .first()
            .waitFor({ state: 'attached', timeout: 60000 });
    }

    private async resolveUncopiedPartOnCopyBoMItemsTab(
        bomScope?: string
    ): Promise<string | null> {
        if (bomScope) {
            await this.expandBomGroupInCopyBoMItemsTab(bomScope);
        }

        for (let attempt = 0; attempt < 6; attempt++) {
            let partNumber = bomScope
                ? await this.findFirstUncopiedPartOnCopyBoMItemsTab(bomScope)
                : null;
            if (!partNumber) {
                partNumber = await this.findFirstUncopiedPartOnCopyBoMItemsTab(undefined);
            }
            if (partNumber) {
                return partNumber;
            }
            if (bomScope && attempt === 0) {
                await this.expandBomGroupInCopyBoMItemsTab(bomScope);
            }
            await this.page.waitForTimeout(500);
        }

        return null;
    }

    private async pickUncopiedItemOnCopyBoMItemsTab(
        advui: AdvanceUi,
        bomScope?: string
    ): Promise<{ partNumber: string; count: number; bomUsed: string } | null> {
        await this.gotoCopyBomItemsToQuote();
        await this.waitForCopyBoMItemsTab();
        await advui.clickOnButton(untieButtonLocator);
        const frame = await this.quote.frameInEQG();
        await frame
            .locator('input[name^="jqg_QuoteGrid_"]:not(:disabled)')
            .first()
            .waitFor({ state: 'attached', timeout: 30000 })
            .catch(() => undefined);

        const partNumber = await this.resolveUncopiedPartOnCopyBoMItemsTab(bomScope);
        if (!partNumber) {
            console.log(
                `[Copy BoM Items] no uncopied items${bomScope ? ` under BoM ${bomScope}` : ''}`
            );
            return null;
        }
        const selection = await this.selectUncopiedItemByPartNumberOnCopyBoMItemsTab(partNumber);
        return { ...selection, bomUsed: bomScope ?? 'any-selected-bom' };
    }

    /**
     * Copy one uncopied Cisco item onto the Quote.
     * Fallback order: Excel BoM → any uncopied row on grid → next selectable BoM on Select BoMs.
     */
    async copyOneUncopiedBoMItemWithFallback(
        preferredBom: string,
        advui: AdvanceUi,
        options?: { maxBomAttempts?: number }
    ): Promise<{ partNumber: string; count: number; bomUsed: string }> {
        const maxAttempts = options?.maxBomAttempts ?? 4;
        const triedBoms: string[] = [];
        const bomQueue: string[] = [preferredBom];

        await this.waitForSelectBoMsGrid();

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            let bom = bomQueue.shift();
            if (!bom) {
                bom = (await this.findFirstSelectableBomOnSelectorPage(triedBoms)) ?? undefined;
            }
            if (!bom || triedBoms.includes(bom)) {
                continue;
            }
            triedBoms.push(bom);

            const status = await this.ensureBomSelectedOnSelectorPage(bom);
            if (status === 'not_found') {
                console.warn(`[Copy BoM Items] BoM ${bom} not found on Select BoMs grid`);
                const existingSelection = await this.pickUncopiedItemOnCopyBoMItemsTab(advui);
                if (existingSelection) {
                    return existingSelection;
                }
                const alt = await this.findFirstSelectableBomOnSelectorPage(triedBoms);
                if (alt) bomQueue.push(alt);
                continue;
            }

            const picked = await this.pickUncopiedItemOnCopyBoMItemsTab(advui, bom);
            if (picked) {
                return picked;
            }

            console.log(`[Copy BoM Items] BoM ${bom} has no copyable items; trying another BoM`);
            await advui.gotoChevron(goToSelectBomsChevronName);
            await this.waitForSelectBoMsGrid();
            const alt = await this.findFirstSelectableBomOnSelectorPage(triedBoms);
            if (alt) {
                bomQueue.push(alt);
            }
        }

        const lastResort = await this.pickUncopiedItemOnCopyBoMItemsTab(advui);
        if (lastResort) {
            return lastResort;
        }

        throw new Error(
            `No uncopied item found after trying BoM(s): ${triedBoms.join(', ') || preferredBom}`
        );
    }

    async getItemsCountOnSelectBoMsTab() {
        // Get the count of checked items on select BoMs tab

        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const labelLocator = frame.getByText('BoM items selected:', { exact: false });
        const parent = await labelLocator.locator('..'); // Get parent container
        const text = await parent.innerText();
        const checkedItems = text.match(/(\d+)/)?.[0] || '0';
        return checkedItems;
    }

    async getItemsCountOnCopyBoMItemsTab() {
        // Get the count of checked items on copy BOM items tab

        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const labelLocator = frame.getByText('Selected BoM Items:', { exact: false });
        const parent = await labelLocator.locator('..'); // Get parent container
        const text = await parent.innerText();
        const checkedItems = text.match(/(\d+)/)?.[0] || '0';
        return checkedItems;
    }

    async ftchTotItemsOnShipTo(quoteId: any) {
        // Gives the total items information on ShipTo Grid 
        const sfConn = new Connection({ instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID });
        const query1 = `SELECT Id, ${this.orgPrefix}__Part_Number__c FROM ${this.orgPrefix}__Cust_BoM_Item__c WHERE ${this.orgPrefix}__CustomerBoM__c = '${quoteId}' AND (${this.orgPrefix}__Hierarchy_Type__c IN ('Box','Standalone') OR ${this.orgPrefix}__Item_Type__c = 'Service') order by Id`;
        const result = await sfConn.query(query1);
        return result.records.map(record => record[`${this.orgPrefix}__Part_Number__c`] ?? '');

    }

    async fetchValuesfrmShipToGrid(fieldName: any) {
        // Fetches the Field values from ShipTo Assignment Grid for all items
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const fieldCells = await frame.locator(`td[role="gridcell"][aria-describedby="grid_${this.orgPrefix}__${fieldName}"]`);
        await fieldCells.first().waitFor({ state: 'visible', timeout: 10000 });
        const partNos: string[] = [];
        const partNoCount = await fieldCells.count();
        for (let i = 0; i < partNoCount; i++) {
            const partNo: string = (await fieldCells.nth(i).textContent())?.trim() ?? '';
            partNos.push(partNo);
        }
        return partNos;
    }

    async chckNotfictnAndValidateOnShpTo(recordCount: any) {
        // Checks if success message is shown after ShipTo is assigned on Items
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const notifyMsg = frame.locator('div[class="ui-pnotify-text"]');    // capturing notification message   
        await notifyMsg.waitFor({ state: 'visible', timeout: 5000 });       // wait for the notification element to appear and become visible

        // await the textContent and log the actual string
        const text = await notifyMsg.textContent({ timeout: 5000 });
        console.log(text);
        if (recordCount > 1) {
            // If more than one items are having ShipTo assigned, validate the message 
            expect(notifyMsg).toHaveText(`${recordCount} records have been updated`);   // check expected message present or not, Ex: "3 records have been updated"
        }
        else if (recordCount === 1) {
            expect(notifyMsg).toHaveText(`${recordCount} record has been updated`);     // check the expected message in case on 1 item , Ex: "1 record has been updated"
        }

    }

    async checkNotificationAndValidate(operation: string | null, no_of_items: any | null): Promise<string[]> {
        // Validate the copy action based on the operation

        if (operation === "delete") {
            TestContext.skipAfterEach = true;
        }
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const items_count = Number(no_of_items);    // set the type to number
        const errors: string[] = [];

        // Check Pop Up message while copy if any notification is found
        if (await frame.locator("div[class = 'swal2-container swal2-center swal2-backdrop-show']").count() > 0) {
            const popup_notify = await frame.locator("div[style = 'display: block;']").textContent() || '';
            errors.push(` Unexpected error while copying due to: "${popup_notify}"`);
            TestContext.skipAfterEach = true;
            return errors;
        }

        else {
            const notifyLocator = frame.locator("span[data-notify-text]");
            const swalLocator = frame.locator("div[class = 'swal2-container swal2-center swal2-backdrop-show']");
            // Large bulk copies (e.g. 2000+ rows) can take well over 10s before the notification appears
            const notifyTimeout = Math.min(300_000, Math.max(10_000, items_count * 50));
            console.log(`Waiting up to ${notifyTimeout}ms for ${operation} notification (${items_count} item(s))...`);

            const deadline = Date.now() + notifyTimeout;
            while (Date.now() < deadline) {
                if (await swalLocator.count() > 0) {
                    const popup_notify = await frame.locator("div[style = 'display: block;']").textContent() || '';
                    errors.push(` Unexpected error while copying due to: "${popup_notify}"`);
                    TestContext.skipAfterEach = true;
                    return errors;
                }
                if (await notifyLocator.count() > 0) {
                    break;
                }
                await this.page.waitForTimeout(500);
            }

            if (await notifyLocator.count() === 0) {
                throw new Error(
                    `Timed out after ${notifyTimeout}ms waiting for ${operation} notification (${items_count} item(s))`
                );
            }

            const notifyText = await notifyLocator.first().textContent();
            console.log(" Notification on Page:", notifyText)

            // Validating copy success message
            if (operation === "copy" && notifyText?.trim().includes(`${items_count} row(s) saved successfully`)) {
                console.log(" Items were copied successfully");
            } else if (operation === "delete" && (notifyText?.trim().includes(`${items_count} item(s) deleted`) || notifyText?.trim().includes(`${items_count} row(s) saved successfully`))) {
                console.log(" Items were deleted successfully");
            } else {
                errors.push(` Unexpected error on Copy BoM Items Tab when performing ${operation} operation due to: "${notifyText}"`);
                TestContext.skipAfterEach = true;
                return errors;
            }
        }

        return errors;
    }

    async quickAddToQuote() {
        // Quick add to Quote

        const errors: string[] = [];
        const frame = this.page.locator('iframe[name^="vfFrameId_"]').contentFrame();
        await frame.getByRole('button', { name: 'Quick Add to Quote' }).click();
        const notifyLocator = frame.locator("span[data-notify-text]");
        const notifyText = await notifyLocator.first().textContent();
        console.log(" Captured notification:", notifyText);
        if (notifyText?.trim().includes(`row(s) saved successfully`)) {
            console.log("Items can be copied using -Quick Add to Quote-");
        } else {
            errors.push(` Unexpected error while performing "Quick Add To Quote" due to: "${notifyText}"`);
        }
        return errors;
    }

    async checkSuccesiveItemsAfterBulkUpdate(bulkFieldValidationOnItems: any, valueToUpdateWithBulk: any) {
        // Checks and validates the successive items for the changes that were done using Bulk Edit

        const frame = this.page.locator('iframe[name^="vfFrameId_"]').contentFrame();
        const allRows = frame.locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])');
        const allRowsCount = await allRows.count();
        const errorRows: string[] = [];

        for (let i = 0; i < allRowsCount; i++) {
            // iterates through all the rows in the grid 
            const row = allRows.nth(i);
            const isSelected = await row.getAttribute('aria-selected') === 'true';
            // if locator contains an attribute 'aria-selected' (generally present when row is selected in grid)- return true

            if (isSelected) {
                //if attribute 'aria-selected' is present
                const cell = await row.locator(`td[aria-describedby="qtGrid_${this.orgPrefix}__${bulkFieldValidationOnItems}"]`).first();    // cell corresponding to the bulk edited field on the row
                let value = (await cell.textContent())?.trim(); // extracting the value

                if (value) {
                    value = value.replace(/[$€£,]/g, '');
                    if (value !== valueToUpdateWithBulk) {  // if expected value does not match store the rows to generate error
                        console.log(`Mismatch at row index ${i}: expected "${valueToUpdateWithBulk}", got "${value}"`);
                        errorRows.push(`Row ${i}`);
                    }
                } else {
                    console.log(`Empty or null value at row index ${i}`);
                    errorRows.push(`Row ${i}`);
                }
            }
        }
        if (errorRows.length > 0) {
            throw new Error(`Mismatch on: ${errorRows}`);
        }
        else {
            console.log("All items under Box were updated successfully");
        }
    }

    async getValuesFromEQG(Row: any, SheetName: any) {
        // Get the values from the Edit Quote Grid
        await this.page.waitForTimeout(5000); // Wait for the values to be set from calculation Engine

        // Only the fields that are present on the excel will be used to extract the values from the Edit Quote Grid
        const workbook = XLSX.readFile(QUOTE_TEST_DATA);
        const fieldKeys = this.getRequiredFieldsFromExcelData(SheetName, workbook);

        // Extract the values from the Edited Row of Edit Quote Grid
        const eqgData: { [key: string]: string | undefined } = {};
        for (const key of await fieldKeys) {
            const cell = await Row.locator(`td[aria-describedby="${key}"]`).first();
            let value = (await cell.textContent())?.trim();
            if (value) {
                value = String(value).replace(/[$€£,]/g, '');
                // If value is an whole number, add ".00"
                if (!isNaN(Number(value)) && value !== '' && !value.includes('.')) {
                    value = `${value}.00`;
                }
            }
            eqgData[key] = value;
        }

        // Wrap the object in a list
        const eqgDBList = [eqgData];
        console.log(eqgDBList);
        return eqgDBList;
    }

    async getRequiredFieldsFromExcelData(sheetName: any, workbook: XLSX.WorkBook, headerRowIndex: number = 0 // default to first row
    ): Promise<string[]> {

        const worksheet = workbook.Sheets[sheetName];
        const range = XLSX.utils.decode_range(worksheet['!ref'] || '');
        const requiredHeaders: string[] = [];

        let startColIndex = -1;

        // Find the column index where header starts with `qtGrid_${this.orgPrefix}__List_Price__c`
        for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
            const cell = worksheet[cellAddress];
            const rawHeader = cell?.v?.toString() || '';
            const header = rawHeader.replace(/[^\x20-\x7E]/g, '').trim();

            if (header.startsWith(`qtGrid_${this.orgPrefix}__List_Price__c`) || header.startsWith('List_Price__c')) {
                startColIndex = col;
                break;
            }
        }

        if (startColIndex === -1) {
            throw new Error("Header starting with 'List_Price__c' not found.");
        }

        // Collect all headers from startColIndex to end
        for (let col = startColIndex; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
            const cell = worksheet[cellAddress];
            const rawHeader = cell?.v?.toString() || '';
            const header = rawHeader.replace(/[^\x20-\x7E]/g, '').trim();

            if (header) {
                requiredHeaders.push(header);
            }
        }
        return requiredHeaders;
    }

    async getDataBaseValuesFromSF(quoteId: any, EQGSheet: any, quoteItemNumber: number) {

        // Get the Quote Item Id 
        const sfConn = new Connection({ instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID });
        const query = `SELECT Id, ${this.orgPrefix}__List_Price__c, ${this.orgPrefix}__Initial_Term__c, ${this.orgPrefix}__Quantity__c, ${this.orgPrefix}__Total_List_Price__c, ${this.orgPrefix}__VAR_Discount_Pct__c, ${this.orgPrefix}__VAR_Unit_Cost__c, ${this.orgPrefix}__VAR_Total_Cost__c, ${this.orgPrefix}__VAR_Margin_Pct__c, ${this.orgPrefix}__VAR_Markup_Pct__c, ${this.orgPrefix}__VAR_Margin__c, ${this.orgPrefix}__VAR_Total_Profit__c, ${this.orgPrefix}__Cust_Discount_Pct__c, ${this.orgPrefix}__Cust_Unit_Price__c, ${this.orgPrefix}__Cust_Extended_Price__c FROM ${this.orgPrefix}__Cust_BoM_Item__c WHERE ${this.orgPrefix}__CustomerBoM__c = '${quoteId}'`;
        const result = await sfConn.query(query);
        const firstRecord = result.records[quoteItemNumber] as Record<string, string>;; // Return only the Id of the first record
        // Only the fields that are present on the excel will be used to extract the values from the DB
        const workbook = XLSX.readFile('assets/Edit_Quote_Data.xlsx');
        const fieldKeys = this.getRequiredFieldsFromExcelData(EQGSheet, workbook);
        // Extract the values from the firstRow of Edit Quote Grid
        const eqgData: { [key: string]: string | undefined } = {};

        // 🔹🔹🔹 ADDITION: store unrounded / 7-decimal values
        const eqgDataPrecise: { [key: string]: string | undefined } = {};

        for (const key of await fieldKeys) {
            const dbKey = key.startsWith("qtGrid_") ? key.replace("qtGrid_", "") : key;

            // 🔹🔹🔹 ADDITION: capture raw DB value BEFORE mutation
            let rawValue = firstRecord[dbKey];
            if (rawValue !== undefined && rawValue !== null) {
                const cleaned = String(rawValue).replace(/[$€£,]/g, '');
                eqgDataPrecise[key] =
                    !isNaN(Number(cleaned)) && cleaned !== ''
                        ? Number(cleaned).toFixed(7)
                        : cleaned;
            } else {
                eqgDataPrecise[key] = '';
            }

            let value = firstRecord[dbKey];
            if (value !== undefined && value !== null) {
                value = String(value).replace(/[$€£,]/g, '');
                // If value is exactly 0 or "0", make it "0.00"
                if (value === '0') {
                    value = '0.00';
                } else if (!isNaN(Number(value)) && value !== '' && !value.includes('.')) {
                    value = `${value}.00`;
                } else if (typeof value === 'string' && value.includes('.') && !isNaN(Number(value))) {
                    value = Number(value).toFixed(2);
                }
            }
            else { value = ''; }
            eqgData[key] = value;
        }

        // Wrap the object in a list
        const eqgDataList = [eqgData];
        // 🔹🔹🔹 ADDITION
        const eqgDataPreciseList = [eqgDataPrecise];
        console.log('Rounded (2dp):', eqgDataList);
        console.log('Precise (7dp):', eqgDataPreciseList);

        return {
            rounded: eqgDataList,
            precise: eqgDataPreciseList
        };

    }

    async getBulkDataBaseValuesFromSF(quoteId: any, bulkEditSheetName: any, rowsToEdit: any, filterField: any, filterBy: any, filterValue: any) {
        // Get the Data for rows for bulk Edit data validation after updating values
        const recordIds = [];
        // if (filterBy === 'begins with') {
        //     filterValue = '${filterValue}%';
        // }

        // switch (filterBy) {
        // case 'begins with':
        //     filterValue = '${filterValue}%';
        //     break;
        // case 'ends with':
        //     filterValue = '${filterValue}%';
        //     break;
        // default:
        //     filterValue = '${filterValue}';
        //     break;
        // }
        rowsToEdit = JSON.parse(rowsToEdit)
        const sfConn = new Connection({ instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID });
        const query = `SELECT Id, ${this.orgPrefix}__List_Price__c, ${this.orgPrefix}__Quantity__c, ${this.orgPrefix}__Total_List_Price__c, ${this.orgPrefix}__VAR_Discount_Pct__c, ${this.orgPrefix}__VAR_Unit_Cost__c, ${this.orgPrefix}__VAR_Total_Cost__c, ${this.orgPrefix}__VAR_Margin_Pct__c, ${this.orgPrefix}__VAR_Markup_Pct__c, ${this.orgPrefix}__VAR_Margin__c, ${this.orgPrefix}__VAR_Total_Profit__c, ${this.orgPrefix}__Cust_Discount_Pct__c, ${this.orgPrefix}__Cust_Unit_Price__c, ${this.orgPrefix}__Cust_Extended_Price__c FROM ${this.orgPrefix}__Cust_BoM_Item__c WHERE ${this.orgPrefix}__CustomerBoM__c = '${quoteId}' and ${this.orgPrefix}__${filterField}  LIKE '${filterValue}%'`;
        console.log(query);
        const result = await sfConn.query(query);
        console.log(result);
        // Get the recordIds of the selected rows
        for (let i = 0; i < rowsToEdit.length; i++) {
            const nthRecords = result.records[rowsToEdit[i]] as Record<string, string>;; // Return only the Id of the nth record
            recordIds.push(nthRecords);
        }
        const SFRoundedData: { [key: string]: string | undefined }[] = [];
        const SFPreciseData: { [key: string]: string | undefined }[] = [];

        // Only the fields that are present on the excel will be used to extract the values from the DB
        const workbook = XLSX.readFile('assets/Edit_Quote_Data.xlsx');
        const fieldKeys = this.getRequiredFieldsFromExcelData(bulkEditSheetName, workbook);

        // Extract the values from the all selected Rows of Edit Quote Grid        
        for (let i = 0; i < rowsToEdit.length; i++) {
            const Record = recordIds[i];
            const SFData: { [key: string]: string | undefined } = {};
            for (const key of await fieldKeys) {
                const sfKey = `${this.orgPrefix}__${key}`;
                let value = Record[sfKey];
                if (value !== undefined && value !== null) {
                    value = String(value).replace(/[$€£,]/g, '');
                    // If value is exactly 0 or "0", make it "0.00"
                    if (value === '0') {
                        value = '0.00';
                    } else if (!isNaN(Number(value)) && value !== '' && !value.includes('.')) {
                        value = `${value}.00`;
                    } else if (typeof value === 'string' && value.includes('.') && !isNaN(Number(value))) {
                        value = Number(value).toFixed(2);   // 2 decimal rounding
                    }
                }
                SFData[key] = value;
            }
            SFRoundedData.push(SFData);
        }

        // Extract the values from the all selected Rows of Edit Quote Grid        
        for (let i = 0; i < rowsToEdit.length; i++) {
            const Record = recordIds[i];
            const SFData: { [key: string]: string | undefined } = {};
            for (const key of await fieldKeys) {
                const sfKey = `${this.orgPrefix}__${key}`;
                let value = Record[sfKey];
                if (value !== undefined && value !== null) {
                    value = String(value).replace(/[$€£,]/g, '');
                    // If value is exactly 0 or "0", make it "0.00"
                    if (value === '0') {
                        value = '0.00';
                    } else if (!isNaN(Number(value)) && value !== '' && !value.includes('.')) {
                        value = `${value}.00`;
                    } else if (typeof value === 'string' && value.includes('.') && !isNaN(Number(value))) {
                        value = Number(value).toFixed(7);       // 7 decimal rounding
                    }
                }
                SFData[key] = value;
            }
            SFPreciseData.push(SFData);
        }

        // Wrap the object in a list        
        console.log(SFRoundedData);
        return { rounded: SFRoundedData, precise: SFPreciseData };
    }

    async validateUIDataBeforeSave(eqgExpectedValues: any, eqgDataList: any) {
        // Validates pricing values before clicking on the save button

        const normalize = (val: any) => Array.isArray(val) ? val[0] : val;
        eqgExpectedValues = normalize(eqgExpectedValues);
        eqgDataList = normalize(eqgDataList);

        if (JSON.stringify(eqgExpectedValues) === JSON.stringify(eqgDataList)) {
            return;
        }
        const htmlErr = await this.compareValues(eqgExpectedValues, eqgDataList, "Expected Data from Excel", "Extracted values from EQG") || "";
        if(htmlErr){
            const errTable = await this.test.parsedHTMLTable(htmlErr);        // removes HTML tags and prints table in text format
            throw new Error(`Test did not pass. Values are not equal. ${errTable}`);
        }        
    }

    async validateBulkUIDataBeforeSave(eqgExpectedValues: any, eqgDataList: any) {
        // Validates pricing values before clicking on the save button
        const normalize = (val: any) => Array.isArray(val) ? val : [val];
        eqgExpectedValues = normalize(eqgExpectedValues);
        eqgDataList = normalize(eqgDataList);

        // Check array length matches first
        if (eqgExpectedValues.length !== eqgDataList.length) {
            throw new Error(`Test failed: Array lengths differ. Expected ${eqgExpectedValues.length}, got ${eqgDataList.length}`);
        }
        const errors: string[] = [];

        // Compare each object in the array
        for (let i = 0; i < eqgExpectedValues.length; i++) {
            const expected = eqgExpectedValues[i];
            const actual = eqgDataList[i];

            if (JSON.stringify(expected) !== JSON.stringify(actual)) {
                // If the values are not equal, find the mismatched keys and throw an error with detailed information
                const htmlErr = await this.compareValues(expected, actual, `Expected Data from Excel -row ${i + 1}`, `Extracted values from EQG -row ${i + 1}`);
                if(htmlErr){
                    const errTable = await this.test.parsedHTMLTable(htmlErr);        // removes HTML tags and prints table in text format
                    errors.push(`Row ${i + 1} mismatch:\n${errTable}`);
                }
            }
        }
        if (error.length > 0) {
            // throw new Error(`Test did not pass. Values are not equal. probably JS ISSUE: ${error}`);
            throw new Error(`Test did not pass, probably JS ISSUE:. Found mismatches in ${error.length} row(s):\n\n${errors.join("")}`);
        }
    }

    async validateDBDataAfterSave(eqgExpectedValues: any, sfDatabaseValues: any) {
        // Validates pricing values after clicking on the save button

        const normalize = (val: any) => Array.isArray(val) ? val[0] : val;
        eqgExpectedValues = normalize(eqgExpectedValues);
        sfDatabaseValues = normalize(sfDatabaseValues);

        if (JSON.stringify(eqgExpectedValues) !== JSON.stringify(sfDatabaseValues)) {
            // If the values are not equal, find the mismatched keys and throw an error with detailed information
            const htmlErr = await this.compareValues(eqgExpectedValues, sfDatabaseValues, "Expected Data from Excel", "Salesforce Data");
            if(htmlErr){
                const errTable = await this.test.parsedHTMLTable(htmlErr);        // removes HTML tags and prints table in text format
                if(errTable){
                throw new Error(`Test did not pass. Values are not equal. probably APEX ISSUE: ${errTable}`);
                }
            } else {console.log("The values are equal:", { eqgExpectedValues, sfDatabaseValues });}           
        }
        else {
            console.log("The values are equal:", { eqgExpectedValues, sfDatabaseValues });
        }
    }

    async validateBulkDBDataAfterSave(eqgExpectedValues: any, sfDatabaseValues: any) {
        // Validates pricing values after clicking on the save button

        const normalize = (val: any) => Array.isArray(val) ? val : [val];
        eqgExpectedValues = normalize(eqgExpectedValues);
        sfDatabaseValues = normalize(sfDatabaseValues);

        // Check array length matches first
        if (eqgExpectedValues.length !== sfDatabaseValues.length) {
            throw new Error(`Test failed: Array lengths differ. Expected ${eqgExpectedValues.length}, got ${sfDatabaseValues.length}`);
        }
        const errors: string[] = [];

        // Compare each object in the array
        for (let i = 0; i < eqgExpectedValues.length; i++) {
            const expected = eqgExpectedValues[i];
            const actual = sfDatabaseValues[i];

            if (JSON.stringify(expected) !== JSON.stringify(actual)) {
                // If the values are not equal, find the mismatched keys and throw an error with detailed information
                const htmlErr = await this.compareValues(expected, actual, `Expected Data from Excel -row ${i + 1}`, `Extracted values from SF database -row ${i + 1}`);
                if(htmlErr){
                    const errTable = await this.test.parsedHTMLTable(htmlErr);        // removes HTML tags and prints table in text format
                    errors.push(`Row ${i + 1} mismatch:\n${errTable}`);
                }                
            }
        }
        if (errors.length > 0) {
            // throw new Error(`Test did not pass. Values are not equal. probably JS ISSUE: ${error}`);
            throw new Error(`Test did not pass, probably Apex ISSUE:. Found mismatches in ${error.length} row(s):\n\n${errors.join("")}`);
        }
    }


    async compareAllValues(eqgExpectedValues: any, eqgDataList: any, sfDatabaseValues: any, Saving: boolean | null | '' | undefined) {
        // Compare the values from the Edit Quote Grid, expected values from Excel, and Salesforce Database values

        const normalize = (val: any) => Array.isArray(val) ? val[0] : val;
        eqgExpectedValues = normalize(eqgExpectedValues);
        sfDatabaseValues = normalize(sfDatabaseValues);
        eqgDataList = normalize(eqgDataList);

        if (JSON.stringify(eqgExpectedValues) === JSON.stringify(sfDatabaseValues)) {
            console.log("The values are equal:", { eqgExpectedValues, sfDatabaseValues });
        }


        else if (JSON.stringify(eqgExpectedValues) !== JSON.stringify(sfDatabaseValues) && Saving === true) {
            // If the values are not equal, find the mismatched keys and throw an error with detailed information
            const mismatched = await this.findMismatchedKeys(sfDatabaseValues, eqgExpectedValues);
            const htmlErr = await this.compareValues(eqgExpectedValues, sfDatabaseValues, "Expected Data from Excel", "Salesforce Data");
            if(htmlErr){
                const errTable = await this.test.parsedHTMLTable(htmlErr);        // removes HTML tags and prints table in text format
                throw new Error(`Test did not pass. Values are not equal. probably APEX ISSUE: ${errTable}`);
            }  
        }

        else if (JSON.stringify(eqgExpectedValues) !== JSON.stringify(eqgDataList) && Saving === false) {
            // If the values are not equal, find the mismatched keys and throw an error with detailed information
            const mismatched = await this.findMismatchedKeys(eqgDataList, eqgExpectedValues);
            const htmlErr = await this.compareValues(eqgExpectedValues, eqgDataList, "Expected Data from Excel", "Extracted values from EQG");
            if(htmlErr){
                const errTable = await this.test.parsedHTMLTable(htmlErr);        // removes HTML tags and prints table in text format
                throw new Error(`Test did not pass. Values are not equal. probably JS ISSUE: ${errTable}`);
            }            
        }
    }

    async getActualDataFromExcel(sheetName: any, targetRowIndex: number): Promise<{
        rounded: { [key: string]: string };
        precise: { [key: string]: string };
    }> {
        const workbook = XLSX.readFile('assets/Edit_Quote_Data.xlsx');
        const worksheet = workbook.Sheets[sheetName];

        const range = XLSX.utils.decode_range(worksheet['!ref'] || '');
        const headers: string[] = [];

        let startColIndex = -1;

        // Extract headers and find starting column
        for (let col = range.s.c; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
            const cell = worksheet[cellAddress];
            const header = cell?.v?.toString().trim() || '';
            headers.push(header);

            if (header === `qtGrid_${this.orgPrefix}__List_Price__c`) {
                startColIndex = col;
            }
        }

        if (startColIndex === -1) {
            throw new Error(`Header qtGrid_${this.orgPrefix}__List_Price__c not found.`);
        }

        // Extract key-value pair for the specified row
        const rowMap: { [key: string]: string } = {};
        // 🔹🔹🔹 ADDITION: precise data (7dp)
        const rowMapPrecise: { [key: string]: string } = {};
        const excelRowIndex = range.s.r + targetRowIndex; // Adjust for header row

        for (let col = startColIndex; col <= range.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: excelRowIndex, c: col });
            const cell = worksheet[cellAddress];
            // 🔹🔹🔹 ADDITION: capture raw value BEFORE existing logic
            const rawValue = cell?.v?.toString().trim() || '';
            const cleanedRaw = rawValue.replace(/[$€£,]/g, '');

            if (cleanedRaw && !isNaN(Number(cleanedRaw))) {
                rowMapPrecise[headers[col]] = Number(cleanedRaw).toFixed(7);
            } else {
                rowMapPrecise[headers[col]] = cleanedRaw;
            }
            // 🔹🔹🔹 END ADDITION

            // -------- EXISTING WORKING LOGIC (UNCHANGED) --------
            let value = rawValue;

            // Clean currency formatting
            value = value.replace(/[$€£,]/g, '');

            // Normalize numeric values
            if (value && !isNaN(Number(value))) {
                value = Number(value).toFixed(2);
            }
            rowMap[headers[col]] = value;
        }
        // 🔹🔹🔹 ADDITION: return both (rowMap unchanged)
        return {
            rounded: rowMap,
            precise: rowMapPrecise
        };
    }

    async compareValues(excelData: any, sfData: any, Key1: string, Key2: string) {
        // Compare the values from the Edit Quote Grid and the actual data from Excel for BOM Imports

        const excelData1 = await this.jsonRounding(excelData);
        const sfData1 = await this.jsonRounding(sfData);
        if (JSON.stringify(excelData1) !== JSON.stringify(sfData1)) {
            console.log("The values are not equal!");         
            // If the values are not equal, throw an error with detailed information
            const mismatched = await this.findMismatchedKeys(sfData, excelData);
            const errorMsg =
                `Test did not pass. Values are not equal.` +
                `${await this.printCombinedComparisonTable(excelData, sfData, Key1, Key2)}`;

            return errorMsg;
        }
        else{
            console.log("The values are equal!");
        }
    }

    async printCombinedComparisonTable(excelData: any, sfData: any, Key1: string, Key2: string) {
        const keys = new Set([...Object.keys(excelData), ...Object.keys(sfData)]);
        let table = `<h4>Comparison Table</h4><table border="1" cellpadding="4" cellspacing="0">`;
        table += `<tr><th style="color:#003366;">Key</th><th style="color:#003366;">${Key1}</th><th style="color:#003366;">${Key2}</th></tr>`;

        for (const key of keys) {
            const formattedKey = await this.formatFieldName(key);
            const excelValue = excelData[key];
            const sfValue = sfData[key];

            const isMismatch = excelValue !== sfValue;

            const keyDisplay = isMismatch ? `<span style="color:red;">${formattedKey}</span>` : `<span style="color:green;">${formattedKey}</span>`;
            const excelDisplayValue = isMismatch ? `<span style="color:red;">${excelValue}</span>` : `<span style="color:green;">${excelValue}</span>`;
            const sfValueDisplay = isMismatch ? `<span style="color:red;">${sfValue}</span>` : `<span style="color:green;">${sfValue}</span>`;
            // const mismatchText = isMismatch ? `<span style="color:red;">Yes</span>` : `<span style="color:green;">No</span>`;
            if (isMismatch === true){
                table += `<tr><td>${keyDisplay}</td><td>${excelDisplayValue}</td><td>${sfValueDisplay}</td></tr>`;
            }            
        }
        table += `</table>`;
        return table;
    }

    async doRounding(value: any, places: number) {
        //rounds the value to the specified number of decimal places
        const num = typeof value === 'string' ? Number(value) : value;

        if (typeof num === 'number' && !isNaN(num)) {
            const factor = Math.pow(10, places);
            return Math.round(num * factor) / factor;
        }
        return value; // return non-numeric values as-is
    }

    async jsonRounding(jsonData: any, places: number = 2) {
        // Rounds all numeric values in the JSON object to two decimal places

        const roundedData: Record<string, any> = {};
        for (const key in jsonData) {
            const value = jsonData[key];
            roundedData[key] = await this.doRounding(value, places);
        }

        return roundedData;
    }

    async findMismatchedKeys(sfData: any, excelData: any) {
        // Compare the values and find mismatched keys
        if (typeof sfData === 'string') sfData = JSON.parse(sfData);
        if (typeof excelData === 'string') excelData = JSON.parse(excelData);

        // Use first element if input is an array
        if (Array.isArray(sfData)) sfData = sfData[0] || {};
        if (Array.isArray(excelData)) excelData = excelData[0] || {};

        const mismatched: Record<string, unknown> = {};

        for (const key in sfData) {
            if (sfData[key] !== excelData[key]) {
                // mismatched object stoores the incorrect sf values
                mismatched[key] = sfData[key];
            }
        }
        return mismatched;
    }

    async printErrorInTableFormat(data: any, title: string) {
        // Print the data in a table format

        const obj = Array.isArray(data) ? data[0] : data;

        // If object is invalid or empty
        if (!obj || typeof obj !== 'object') {
            return `<p><h4>${title}</h4></p><p>No data available</p>`;
        }

        // Table in HTML format
        let tableOutput = `<p><h4>${title}</h4></p><table border="1" cellpadding="4" cellspacing="0">`;
        tableOutput += `<tr><th>Key</th><th>Value</th></tr>`;

        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const value = String(obj[key]);
                const formattedKey = await this.formatFieldName(key);
                tableOutput += `<tr><td>${formattedKey}</td><td>${value}</td></tr>`;
            }
        }

        tableOutput += `</table>`;
        return tableOutput;
    }
    async formatFieldName(fieldName: string) {
        // Format the field name to be more readable    
        return fieldName
            .replace(/_/g, ' ') // Replace underscores with spaces
            .replace(/qtGrid /g, '') // Remove "qtGrid" prefix
            .replace(/StrataVAR /g, '') // Remove "StrataVAR" prefix
            .replace(/ c/g, '') // Remove C
            .replace(/\b(\w)/g, (match) => match.toUpperCase()); // Capitalize the first letter of each word
    }

    private getQuotePage(): QuotePage {
        return new QuotePage(this.page);
    }

    async parseQuoteIdFromUrl(): Promise<string> {
        const url = this.page.url();
        const prefix = this.orgPrefix;
        const longFormId = prefix
            ? url.split(`/${prefix}__CustomerBoM__c/`)[1]?.split('/')[0]
            : undefined;
        if (longFormId) {
            return longFormId.trim();
        }
        // Fallback when SF_ORG_PREFIX was missing at module load / CI SF_VARS-only setup
        const customerBomMatch = url.match(/\/(?:[A-Za-z0-9_]+__)?CustomerBoM__c\/([a-zA-Z0-9]{15,18})(?:\/|$)/);
        if (customerBomMatch?.[1]) {
            return customerBomMatch[1].trim();
        }
        const shortFormMatch = url.match(/\/lightning\/r\/([a-zA-Z0-9]{15,18})\/view/);
        if (shortFormMatch?.[1]) {
            return shortFormMatch[1].trim();
        }
        throw new Error(
            `Quote ID not found on the page URL. SF_ORG_PREFIX=${prefix ?? "<unset>"}. URL=${url}`
        );
    }

    async waitForQuoteIdChange(previousQuoteId: string, timeoutMs = 90000): Promise<string> {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            try {
                const currentQuoteId = await this.parseQuoteIdFromUrl();
                if (currentQuoteId && currentQuoteId !== previousQuoteId) {
                    return currentQuoteId;
                }
            } catch {
                // URL may not contain a quote id immediately after Save As New Quote.
            }
            await this.page.waitForTimeout(1000);
        }

        throw new Error(
            `Quote page did not navigate to a new quote within ${timeoutMs}ms. Previous quote ID: ${previousQuoteId}`
        );
    }

    async waitForQuoteDetailsPageReady(): Promise<void> {
        await this.getQuotePage().waitForQuoteDetailsPage();
    }

    async getQuoteNumberFromHeading(): Promise<string> {
        return this.getQuotePage().getQuoteNumberFromHeading();
    }
    async getQuoteVersionFromHeader(): Promise<string | null> {
        await this.waitForQuoteDetailsPageReady();
        return this.getQuotePage().getQuoteVersionValue();
    }


    async getQuoteHeaderPricingFromUI(): Promise<Record<string, string>> {
        const quotePage = this.getQuotePage();
        const pricing: Record<string, string> = {};
        for (const field of quoteHeaderPricingFields) {
            const value = await quotePage.getPricingFieldValue(field);
            if (value) {
                pricing[field] = value;
            }
        }
        return pricing;
    }

    async saveAsNewQuote(): Promise<{ quoteNumber: string; quoteId: string }> {
        await this.waitForQuoteDetailsPageReady();
        const originalQuoteId = await this.parseQuoteIdFromUrl();
        console.log(`Export Quote button is visible`);
        await this.quote.clickRecordPageButton('Save As New Quote');
        await this.page.waitForLoadState('domcontentloaded');
        console.log(`Save As New Quote button is clicked`);
        const newQuoteId = await this.waitForQuoteIdChange(originalQuoteId);
        await this.getQuotePage().getQuoteHeading().waitFor({ state: 'visible', timeout: 90000 });
        const quoteNumber = await this.getQuoteNumberFromHeading();
        console.log(`New Quote is visible: ${quoteNumber} (${newQuoteId})`);
        return { quoteNumber, quoteId: newQuoteId };
    }

    async verifyQuoteHeaderPricingMatches(
        originalQuoteId: string,
        newQuoteId: string,
        quoteType = 'Deal'
    ): Promise<void> {
        const bomService = new BomService(this.page);
    
        const originalPricing = await bomService.getPricesFromSfForQuote(originalQuoteId, quoteType);
        const newPricing = await bomService.getPricesFromSfForQuote(newQuoteId, quoteType);
    
        console.log("========== Original Quote Pricing ==========");
        console.log(JSON.stringify(originalPricing, null, 2));
    
        console.log("========== New Quote Pricing ==========");
        console.log(JSON.stringify(newPricing, null, 2));
    
        const errorMsg = await this.compareValues(
            originalPricing,
            newPricing,
            'Original Quote Pricing',
            'New Quote Pricing'
        );
    
        if (errorMsg) {
            console.log("Comparison Failed:");
            console.log(errorMsg);
            throw new Error(errorMsg);
        }
    
        console.log("Pricing comparison passed.");
    }


}
function locator(arg0: string) {
    throw new Error("Function not implemented.");
}


