import { Page, expect } from "@playwright/test";
import { SalesforceUtils } from "../utils/sfUtils";
import { goToSelectBomsChevronName, goToCopyBoMItems, goToQuoteChevronName } from "../pages/editQuoteGridPage"
import { QuotePage, eqgQuoteHeaderPricingFields } from "../pages/quotePage";
import { XRL_OFFSET } from "../assets/test_data_constants";
import { QuoteService } from "../services/quote-service";
import escapeRegExp from 'lodash/escapeRegExp';
const orgPrefix = process.env.SF_ORG_PREFIX;

export class AdvanceUi {
    private page: Page;
    private quote: SalesforceUtils;

    constructor(page: Page) {
        this.page = page;
        this.quote = new SalesforceUtils(page);
    }

    async clickCopySelectedBoMItemsToButton() {
        // Clicks the "Copy Selected BoM Items to" button
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.getByRole('button', { name: 'Copy Selected BoM Items to' }).click();
    }

    async clickOnBoxBySortvalue(boxSortValue: any) {
        // Selects the Box identified by its Name
        if (boxSortValue === "" || boxSortValue === undefined) { return 0; }    // If boxSortValue is empty or undefined exit the method
        const frame = await this.quote.frameInEQG();
        try {
            await frame.locator(`tr.ui-widget-content.jqgroup.ui-row-ltr.qtGridghead_2 span.group-span input[data-value=${boxSortValue}]`).click();
        } catch (err: any) {
            console.error(`Failed to select box with sort value ${boxSortValue}: ${err.message}`);
            throw new Error(`Box with sort value ${boxSortValue} could not be selected within the timeout.`);
        }
    }
    async selectAllRows() {
        // Selects all the rows on Copy BoM Items Tab / Edit Quote Grid
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        if (await frame.locator('i[title="Select All"][class*="minus"]').count() === 0) {
            await frame.locator('i[title="Select All"][class*="check-square"]').waitFor({ state: 'visible', timeout: 10000 });
            await frame.locator('i[title="Select All"][class*="check-square"]').click();
        }
        else {
            console.log(" All rows are already selected ");
            return 0;
        }
    }

    async cleanPricingData(data: any){        
        // Logic to extract the primary numeric amount from a string that might include:
        // Example: On summary of EQG we see Customer Discount:-$524,487.86 (-10.16%)    
        // Input: -$524,487.86 (-10.16%) ->  Output: -524487.86
        if (data == null || data === '') return null;
        data = String(data).replace(/\([^)]*%\)/g, '');                                         // remove things like "(38.38%)"
        data = data.replace(/\u2212/g, '-');                                            // normalize unicode minus to normal minus
        const match = data.match(/-?\$?\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/);  // extract the money number (-$1,234.56 or $1,234.56 or Indian format 57,41,539.38
        if (!match) return null;       
        let value = match[0].replace(/[$,]/g, '');  // remove $ and commas
        return value;
    }

    async getPricingFromEQGSummary(){
        // Returns the pricing values from summary section of Edit Quote Grid
        const summaryData = [];
        const frame = await this.quote.frameInEQG();
        const totalListPrice = await frame.locator('div[id="itemtotalListPrice"] span').textContent();
        const custTotPrice = await frame.locator('div[id="itemtotalCustPrice"] span').textContent();
        // const custDiscnt = await frame.locator('div[id="itemcustAvgDsc"] span').textContent();
        const varTotCost = await frame.locator('div[id="itemtotalVarCost"] span').textContent();
        const varTotProfit = await frame.locator('div[id="itemtotalVarProfit"] span').textContent();
        // const varDiscnt = await frame.locator('div[id="itemvarAvgDsc"] span').textContent();
        
        //-------- "Customer Discount" and "VAR Discount" commented as they are not required now 
        summaryData.push( {
                "Total Extended List Price": await this.cleanPricingData(totalListPrice),
                "VAR Total Cost": await this.cleanPricingData(varTotCost),
                "VAR Total Profit": await this.cleanPricingData(varTotProfit),
                "Customer Extended Price": await this.cleanPricingData(custTotPrice),
                // "Customer Discount": await this.cleanPricingData(custDiscnt),              
                // "VAR Discount": await this.cleanPricingData(varDiscnt)
            });

        return summaryData;
    }
    async getPricingFromQuoteHeader() {
        // Returns pricing values from Quote Details > Financials (not EQG summary)
        const quotePage = new QuotePage(this.page);
        await quotePage.getQuoteHeading().waitFor({ state: "visible", timeout: 90000 });
        await quotePage.openDetailsFinancialsSection();

        const quoteHeaderData: Record<string, string | null> = {};
        for (const field of eqgQuoteHeaderPricingFields) {
            const rawValue = await quotePage.getEqgHeaderPricingFieldValue(field);
            quoteHeaderData[field] = rawValue ? await this.cleanPricingData(rawValue) : null;
        }
        return [quoteHeaderData];
    }


    async countAllItemsInGrid() {
        // counts all the selected items on Grid
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const text = await frame.locator('div[id="itembomSelNumSelRows"]').textContent();
        const numbers = text?.match(/\d+/g)?.map(Number) ?? [];
        return numbers;
    }

    /** Known Salesforce/Lightning noise — not useful for test failure diagnosis. */
    private static readonly IGNORED_BROWSER_LOG_PATTERNS: RegExp[] = [
        /Failed to create durable storage for cache inclusion policy/,
        /ComponentProfiler:/,
        /Unsupported WebVital metrics/,
        /empApi setting initialized/,
        /forceChatter:fileIcon.*deprecated/,
        /\[vf3pc\]/,
        /iframePathName|referrerHostname|iframeHostname|referrerRootDomain|iframeRootDomain/,
        /\[LEXI:navigator:communication\]/,
        /In-App Guidance is disabled/,
        /InstrumentationResult|O11yInstrumentationResult|\bO11Y\b/,
        /lightning-spinner.*alternativeText/,
    ];

    private shouldIgnoreBrowserLog(text: string): boolean {
        return AdvanceUi.IGNORED_BROWSER_LOG_PATTERNS.some((pattern) => pattern.test(text));
    }

    /** Captures browser errors/warnings for Playwright report attachments on failure. */
    getbrowserlogs(): string[] {
        const browserLogs: string[] = [];
        const pushIfRelevant = (line: string) => {
            if (!this.shouldIgnoreBrowserLog(line)) {
                browserLogs.push(line);
            }
        };

        this.page.on("pageerror", (error) => {
            pushIfRelevant(`[pageerror] ${error.message}`);
        });
        this.page.on("console", (msg) => {
            const type = msg.type();
            if (type !== "error" && type !== "warning") {
                return;
            }
            pushIfRelevant(`[${type}] ${msg.text()}`);
        });
        return browserLogs;
    }

    async getRowValuesFromEQG(allRows: any) {
        // Gets all the row data from EQG
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const eqgList = [];

        for (let i = 0; i < allRows; i++) {
            const row = frame.locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])').nth(i);
            const prtNo = await row.locator(`td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__Part_Number__c"]`).textContent();
            const itmType = await row.locator(`td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__Item_Type__c"]`).textContent();
            const qty = await row.locator(`td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__Quantity__c"]`).textContent();
            const unitLP = await row.locator(`td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__List_Price__c"]`).textContent();
            const totVarCost = await row.locator(`td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__VAR_Total_Cost__c"]`).textContent();

            const Data = {
                "Part Number": prtNo,
                "Item Type": itmType,
                "Unit List Price": unitLP,
                "Quantity": qty,
                "VAR Total Cost": totVarCost
            };
            eqgList.push(Data);
        }
        return eqgList;
    }

    async getValueByRowAndFieldInEQG(type: any, rowNumber: any, field: any){
        /* Can get the Cell value (under a particular column field) of any Group or Box or quote Item row
        Input is rowNumber and field; 
        rowNumber to understand the data we want to extract of the row, field to understand the Column field */   
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const row = frame.locator('tbody tr[role="row"]:not(.jqgfirstrow)');
        let value;
        if ((type === 'box' || type === 'group') && (field === 'Part_Number')){     // As Group and boxes does not have Part Number field 
            value = await row.locator(' .groupText').nth(rowNumber).textContent();
        }
        else {
            value = await row.locator(`td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__${field}__c"]`).nth(rowNumber).textContent();
        }        
        return value;
    }

    async clickOnButton(button: string) {
        // clicks on the desired button on Copy BoM items Tab and returns operation performed
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator(`button[class=${button}]`).waitFor({ state: 'visible', timeout: 20000 });
        await frame.locator(`button[class=${button}]`).click();

        // await frame.locator('button[class="btnselAllRows"]').click();        // Click the select all button
        // await frame.locator('button[class="btndelQuoteItems"]').click();     // Click on delete Quote items
        // await frame.locator('button[class="btnuntieBoxes"]').click();        // Click on Untie Boxes  
    }

    async clickOnCopyBoMItemsButton(){
        // Clicks on the button Copy Selected BoM Items to Quote
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator(`button[id="btncopyBoMToQuote"]`).waitFor({ state: 'visible', timeout: 20000 });
        await frame.locator(`button[id="btncopyBoMToQuote"]`).click();
    }

    async clickOnCheckboxByBoMId(bom: any){
        // Clicks on the checkbox with BoM Name in Copy BoM Items Chevron
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator(`input[data-value="${bom}"][type="checkbox"]`).waitFor({ state: 'visible', timeout: 20000 });
        await frame.locator(`input[data-value="${bom}"][type="checkbox"]`).click();
    }

    async clickNthCheckbox(boxNumber: any) {
        // Clicks the checkbox that is given by the user
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const checkbox = await frame.locator('input[role="checkbox"]');
        const checkboxCount = await frame
            .locator('input[role="checkbox"]')
            .count();

        console.log(`Actual checkboxes in UI: ${checkboxCount}`);
        // Check if the checkbox exists, if exists click it
        try {
            await checkbox.nth(boxNumber).waitFor({ state: 'visible', timeout: 10000 });
            await checkbox.nth(boxNumber).click({ modifiers: ['Control'] });   // Ctrl+Click   
        } catch (error) {
            console.error(`Checkbox ${boxNumber} not found:`, error);
            return;
        }
    }

    async clkOnCheckboxFrmList(rowsToSelect: any) {
        // Clicks on the list of checkboxes given by the user
        // rowNumber: [1,2,3] indexing starting with 1
        const rowNumber: number[] = JSON.parse(rowsToSelect);
        if (rowNumber.length === 0) {
            console.log("no datas are filtered out");
            return 0;
        } else {
            console.log("the number of checkboxes are going to be clicked" + " = " + " " + rowNumber.length)
        }
        // await this.page.waitForTimeout(6000);

        for (let i = 0; i < rowNumber.length; i++) {
            // select the row by rowNumber[i]
            ;
            // await this.page.waitForTimeout(3000);
            let currRow: number = rowNumber[i];
            console.log(
                `Trying to click checkbox (input index=${rowNumber[i]}, playwright index=${currRow})`
            );
            await this.clickNthCheckbox(currRow);
        }
    }

    async selectBox(boxSortValue: any){
        // Selects a Box based on the box number given by user
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const boxCheckbox = frame.locator(`input[data-index="${orgPrefix}__Group_Sort_Box__c"][data-value="${boxSortValue}"][type="checkbox"]`);
        if(await boxCheckbox.count()>0){await boxCheckbox.click();}
        else {throw new Error(`Box with sort order ${boxSortValue} not found on Grid`);}
    }


    async clkOnBackBtnInShipTo() {
        // Clicks on the back button in ShipTo Assignment Grid
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator(`button[id="btnBack"][type="button"]`).waitFor({ state: 'visible', timeout: 10000 });
        await frame.locator(`button[id="btnBack"][type="button"]`).click();
    }

    async clickYesOnconfirmationPopUp() {
        // This will select Yes button for any confirmation popup
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        if (await frame.getByRole('button', { name: 'Yes' }).count() > 0) {
            await frame.getByRole('button', { name: 'Yes' }).click();
        }
        const notifyLocator = frame.locator("span[data-notify-text]");
        // Wait for the notification element to be attached
        await notifyLocator.first().waitFor({ state: "attached", timeout: 10000 });
        const notifyText = await notifyLocator.first().textContent();
        console.log(" Notification on Page:", notifyText)
        if (notifyText?.trim().includes(`item(s) deleted`) || notifyText?.trim().includes(`row(s) saved successfully`)) {
            console.log(" Items were deleted successfully");
        } else {
            throw new Error(` Unexpected error on Copy BoM Items Tab when performing delete operation due to: "${notifyText}"`);
        }
    }

    async clckOnUnlockBoxes(){
        // Click on Unlock checkboxes in Set Grouping Page
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.getByRole('checkbox', { name: 'Unlock Boxes' }).check();
    }

    async clckOnCreateBoxBtn(boxName: any){
        // Creates a New Box by clicking on the "Create Box" button on set grouping; Box Name is given as Input
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator('button[id="groupingCreateBoxBtn"]').click();
        if (boxName !== ''){    // If boxName not empty on Excel sheet then enter box name
            await frame.locator('.jstree-rename-input').fill(boxName);
        }        
        await frame.locator('.jstree-rename-input').press('Enter');
    }

    async clckOnCreateGroupBtn(groupName?: any){
        // Clicks on the Create Group button on set grouping
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator('button[id="groupingCreateBtn"]').click();
        if (groupName){    // If groupName not empty on Excel sheet then enter group name
            await frame.locator('.jstree-rename-input').fill(groupName);
            await frame.locator('.jstree-rename-input').press('Enter');
        } 
        else {
            await frame.locator('.jstree-rename-input').press('Enter');
        }      
    }

    async clckOnRenameBtnOnSetGrpng(){
        // Clicks on the Rename button on Set Grouping
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator('button[onclick="groupingRename()"]').click();
    }

    async clckOnRenameBtnAndRename(renameTxt: any){
        // Clicks on the Rename button on set grouping window
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await this.clckOnRenameBtnOnSetGrpng();
        await frame.locator('.jstree-rename-input').fill(renameTxt);
        await frame.locator('.jstree-rename-input').press('Enter');
    }

    async clckOnDeleteBtnOnSetGrpng(){
        // Clicks on the Rename button on set grouping window
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.locator('button[onclick="groupingDelete()"]').click();
    }

    async expandBoxesInSetGrouping(boxPosition: any){
        // Expand the desired box given by user based on its position
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        if(boxPosition === "first"){                 // Expanding the items under first box
            await frame.locator('i[class="jstree-icon jstree-ocl"]').first().click();
        }             
        else if(boxPosition === "last"){             // Expanding the items under last box
            await frame.locator('i[class="jstree-icon jstree-ocl"]').last().click(); 
        }
        else {
            await frame.locator('i[class="jstree-icon jstree-ocl"]').nth(boxPosition).click();
        }             
    }

    async selectElementInSetGrping(eleName: any){
        // Selects the Box in the set Grouping
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const name = escapeRegExp(eleName);
        await frame.getByRole('link', { name: new RegExp(`${name}$`) }).click();
    }

    async elementRenamed(Name: any){
        // Checks that the Set Grouping Window has a new renamed element with Name that is passed in parameter
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const value = await frame.getByRole('link', { name: `${Name}`, exact: false }).isVisible();
        return value;
    }

    async dragAndDropInsideElement(locatorToDrag: any, targetLocator: any){
        // Logic to add Items or Boxes to Empty Box or Empty Groups respectively
        const box = await targetLocator.boundingBox();
        if (!box) throw new Error('Target not visible/attached');        
        const targetPosition = {            
            x: Math.floor(box.width / 2),
            y: Math.floor(box.height / 2)
        };                                                  // Target position to keep item inside bounding box
        await locatorToDrag.dragTo(targetLocator,{ targetPosition });
    }

    async dragAndDropUnderItem(locatorToDrag: any, targetLocator: any){
        // Drag a specific item Locator under another item locator
        const box = await targetLocator.boundingBox();
        if (!box) throw new Error('Target not visible/attached');
        await locatorToDrag.dragTo(targetLocator,{ targetPosition: { x: Math.round(box.width / 2), y: Math.round(box.height * 0.85) }});
    
    }

    async clickOnSaveInSetGrouping(){
        // Click on the Save button in Set Grouping UI
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.getByRole('button',{name: 'Save'}).click();
    }

    async updateCloneBoxesDetails(cloneCount: any, addClones: any, grpName: any){
        // update the Clone Box details in the Clone Box Popup
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.getByRole('spinbutton', { name: 'Additional Clone Count:' }).click();
        await frame.getByRole('spinbutton', { name: 'Additional Clone Count:' }).fill(cloneCount);      // updating the clone count under Additional Clone Count Input
        await frame.getByRole('spinbutton', { name: 'Additional Clone Count:' }).press('Enter');
        if(addClones.toLowerCase() === 'yes'){
            await frame.getByRole('checkbox', { name: 'Add clone items to new groups' }).check();       // if addClones is yes then we will check the checkbox for Add clone items to new groups
            await frame.getByRole('textbox', { name: 'Prefix of Group Name:' }).click();
            if(grpName && grpName.trim()!==''){                                                         // if Group Name Present it will update the user given value else default value auto selected
                await frame.getByRole('textbox', { name: 'Prefix of Group Name:' }).fill(grpName);      // updating the Group Name under Prefix of Group Name Input
            }
        }        
    }

    async clickOnCloneBtn(){
        // Clicks on the Clone Button on Clone Box popup
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await frame.getByRole('button', { name: 'Clone' }).click();
        const notifyLocator = frame.locator("span[data-notify-text]");
        await this.page.waitForTimeout(3000);   // added delay as other notifications also come
        await notifyLocator.waitFor({ state: "attached", timeout: 10000 });
        const notifyText = await notifyLocator.first().textContent();
        console.log("Notification after clonning boxes:",notifyText);
        expect(notifyText).toContain('row(s) saved successfully');  // Validating notification message after cloning boxes
    }

    async editSelectedRowsUsingBulk(bulkEditfield: string, setBy: string, valueToUpdateWithBulk: string) {
        // Find the Bulk Edit Option button and click it
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        // await frame.locator('.select2-selection--single').click(); // clicking on 'Select a column' dropdown
        await frame.locator('span[class="select2-selection__placeholder"]').filter({ hasText: 'Select a column' }).click();
        await frame.getByRole('treeitem', { name: bulkEditfield }).click();
        await frame.locator('span[class="select2-selection__rendered"][title="Set to X"]').click();
        await frame.getByRole('treeitem', { name: setBy }).click();
        await frame.getByRole('textbox', { name: 'Enter a value' }).click();
        await frame.getByRole('textbox', { name: 'Enter a value' }).fill(valueToUpdateWithBulk);
        await frame.getByRole('textbox', { name: 'Enter a value' }).press('Enter');
        await frame.getByRole('button', { name: 'Update Selected Items' }).click();
    }

    async deleteQuote() {
        // Go to the Quote Header and delete the Quote        
        await this.page.getByRole('button', { name: 'Delete' }).click();
    }

    // async filterCriteria(filterField: string, filterBy: any) {
    //     // Helps to select the search criteria,. like.. begins with, contains, etc.
    //     if (!filterField || !filterBy) { return 0; }   // If any value is empty return 0 and exit ;

    //     filterBy = filterBy.replace(/^['"]|['"]$/g, '');
    //     const frame = await this.quote.frameInEQG(); // Setting up the iframe
    //     // Selecting the Filter criteria
    //     await frame.locator(`.ui-search-oper a[title="Click to select search operation."][colname="${process.env.SF_ORG_PREFIX}__${filterField}"]`).click();
    //     await this.page.waitForTimeout(1000);
    //     if (filterField === "Item_Type__c") { // if Item type we will select from dropdown  
    //         await frame.getByRole('menuitem', { name: filterBy }).waitFor({ state: 'visible', timeout: 2000 });
    //         await this.page.locator('span[title="StrataVAR PqW"]').hover();
    //         await frame.getByRole('menuitem', { name: filterBy }).click();
    //     }
    //     else {
    //         await frame.locator('li.ui-menu-item a.g-menu-item').filter({ hasText: filterBy }).click();
    //     }
    // }

    async filterCriteria(filterField: string, filterBy: any) {
        // Exit early if filter field or operator is missing
        if (!filterField || !filterBy) { return 0; }
    
        // Remove leading/trailing quotes from Excel filter operator value (e.g. "== equal'")
        filterBy = filterBy.replace(/^['"]|['"]$/g, '');
    
        // Get the Edit Quote Grid iframe
        const frame = await this.quote.frameInEQG();
    
        // Open the search-operator menu for the given filter column
        await frame
            .locator(`.ui-search-oper a[title="Click to select search operation."][colname="${process.env.SF_ORG_PREFIX}__${filterField}"]`)
            .click();
    
        // Small wait so the operator menu can render
        await this.page.waitForTimeout(1000);
    
        // Item Type uses a role-based menu item selection
        if (filterField === "Item_Type__c") {
            // Locate the operator menu item (e.g. "== equal")
            const menuItem = frame.getByRole('menuitem', { name: filterBy });
    
            // Wait until the menu item is visible
            await menuItem.waitFor({ state: 'visible', timeout: 5000 });
    
            // Click the menu item (force avoids brittle SF-header hover workaround)
            await menuItem.click({ force: true });
        } else {
            // For other fields, select operator from the classic jqGrid menu list
            await frame.locator('li.ui-menu-item a.g-menu-item').filter({ hasText: filterBy }).click();
        }
    }
    // async filterByColumn(fieldName: string, value: string) {
    //     // Helps to filter the EQG items based on the fieldName 
    //     if (!fieldName || !value) { return 0; }   // If any value is empty return 0 and exit ;
    //     const frame = await this.quote.frameInEQG(); // Setting up the iframe

    //     if (fieldName === "Item_Type__c") { // if Item type we will select from dropdown
    //         await frame.locator(`.ui-search-input select[role="select"][name="${process.env.SF_ORG_PREFIX}__${fieldName}"]`).selectOption(value);
    //     }
    //     else {
    //         // We will click on column filters and put value to filter on text area
    //         const locator = frame.locator(`.ui-search-input input[name="${process.env.SF_ORG_PREFIX}__${fieldName}"][role="textbox"]`);
    //         await locator.click();
    //         await locator.type(value, { delay: 100 });
    //         await this.page.waitForTimeout(2000);           // adding delay to apply the filter after typing and before clicking the checkboxes
    //     }
    // }

    async filterByColumn(fieldName: string, value: string) {
        // Helps to filter the EQG items based on the fieldName 
        if (!fieldName || !value) { return 0; }   // If any value is empty return 0 and exit ;
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
    
        if (fieldName === "Item_Type__c") { // if Item type we will select from dropdown
            await frame.locator(`.ui-search-input select[role="select"][name="${process.env.SF_ORG_PREFIX}__${fieldName}"]`).selectOption(value);
        }
        else {
            const locator = frame.locator(`.ui-search-input input[name="${process.env.SF_ORG_PREFIX}__${fieldName}"][role="textbox"]`);
    
            await locator.waitFor({ state: 'visible', timeout: 20000 });
    
            try {
                await locator.click({ timeout: 5000 });
            } catch {
                console.warn(`filterByColumn: click blocked for ${fieldName}, continuing with type()`);
            }
    
            // Must type — jqGrid filter needs key events; fill() will not apply the filter
            await locator.fill(''); // clear first if needed
            await locator.type(value, { delay: 100 });
    
            // Wait until a Part Number cell matches the filter value (not just "any row")
            const matchedCell = frame.locator(
                `td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__${fieldName}"]`
            ).filter({ hasText: value }).first();
    
            await matchedCell.waitFor({ state: 'visible', timeout: 15000 });
        }
    }
    

    async revertFilterSelection(filterField: any) {
        // Removes the filter if present for any field
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        if (!filterField) { // If filterField is null or undefined we will skip this method
            return;
        }
        else if (filterField === "Item_Type__c") { // if Item type we will select All from dropdown
            await frame.locator(`.ui-search-input select[role="select"][name="${process.env.SF_ORG_PREFIX}__${filterField}"]`).selectOption('All');
        }
        else { // remove the filter
            await frame.locator(`th[role="columnheader"][id="gsh_qtGrid_${process.env.SF_ORG_PREFIX}__${filterField}"] .ui-search-clear a.clearsearchclass`).click();
            await this.page.waitForTimeout(3000);
        }
    }

    async clickSaveButtonIfNeeded(testName: string) {
        // checker if we need to save value or not
        let isSaved: boolean;
        if (testName.includes('NOT SAVING')) {
            // If the test name includes 'NOT SAVING', we don't save the value
            return isSaved = false;
        } else {
            await this.clickSaveButton();
            return isSaved = true;
        }
    }

    async clickSaveButton() {
        // Click on the Save button
        const frameContent = this.page.locator('iframe[name^="vfFrameId_"]').contentFrame();
        await frameContent.locator('button.btnsaveQuoteItems').click();
        await this.page.waitForTimeout(5000); // Wait for the save operation to complete
    }

    async changeCalculationMode(Mode: string) {
        // Click on the "Discount Calculation Mode" button and select the options- CV, VM, MC

        const [customerValue, vendorValue, marginValue] = Mode.replace(/[{}]/g, '').split(',').map(s => s.trim().split(':')[1]);
        const customer = (customerValue === 'V') ? 'VAR' : 'SALESDATA';
        const vendor = (vendorValue === 'M') ? 'SALESDATA' : 'CUST';
        const margin = (marginValue === 'V') ? 'VAR' : 'CUST';

        const frameContent = this.page.locator('iframe[name^="vfFrameId_"]').contentFrame();
        await frameContent.locator('button.btndiscCalcModeBtn').click();
        await frameContent.getByRole('dialog', { name: 'Discount Calculation Mode' }).getByRole('combobox').first().selectOption(customer);
        await frameContent.getByRole('dialog', { name: 'Discount Calculation Mode' }).getByRole('combobox').nth(1).selectOption(vendor);
        await frameContent.getByRole('dialog', { name: 'Discount Calculation Mode' }).getByRole('combobox').nth(2).selectOption(margin);
        await frameContent.getByRole('button', { name: 'Save' }).click();
    }

    async findTheRow(rowNumber: any) {
        // Find the first row in the Edit Quote Grid and double click it 
        try {
            const rowLocator = await this.page.locator('iframe[name^="vfFrameId_"]').contentFrame()
                .locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])')
                .nth(rowNumber);

            await this.page.waitForTimeout(2000);
            // Check if the row exists within a bounded timeout
            await rowLocator.waitFor({ state: 'visible', timeout: 2000 });
            return rowLocator;
        } catch {
            throw new Error(`Row number ${rowNumber} not found in the Edit Quote Grid.`);
        }
    }

    async findTheRowAndDoubleClick(firstRow: any) {
        // Find the first row in the Edit Quote Grid and double click it  
        try {
            await firstRow.dblclick({ timeout: 5000 });
        }
        catch (e) {
            throw new Error("Row is not visible or not enabled for interaction");
        }
        return firstRow;
    }

    async findCell(firstRow: any, field: any) {
        // Find the fields cell 

        const targetCell = firstRow
            .locator(`td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__${field}"]`)
            .first();
        return targetCell;
    }

    async findShipToCellAndDblClk(targetRow: any) {
        // Changes the ShipTo account on the targetCell
        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        await this.page.waitForTimeout(8000);
        const locator = await frame.locator(`td[aria-describedby="grid_${process.env.SF_ORG_PREFIX}__Account_Site__c"]`).nth((targetRow-1)).isVisible();
        if(locator === false){
            return 0;
        } else {
            await frame.locator(`td[aria-describedby="grid_${process.env.SF_ORG_PREFIX}__Account_Site__c"]`).nth((targetRow - 1)).dblclick({ position: { x: XRL_OFFSET, y: XRL_OFFSET } });
        }
    }

    async updtRcrdsPerPage(noOfRecords: any) {
        // Updates the Records per page on the ShipTo Assignment Grid
        const frame = await this.quote.frameInEQG();
        await frame.locator('select[title="Records per Page"]').first().selectOption(`${noOfRecords}`);
    }

    async checkGridIsEditable() {
        // Checks if the Grid is ready to be edited and no background process is running
        await this.page.waitForTimeout(8000);
        // await this.page.locator('iframe[name^="vfFrameId_"]').waitFor({ state: 'visible' });
        const frameContent = this.page.locator('iframe[name^="vfFrameId_"]').contentFrame();
        const occurence = await frameContent
            .getByText('This quote is being updated by background processes. Please refresh this screen and try again after some time.').count();
        console.log('Warning message locator occurrence on Grid Page:', occurence);
        if (occurence > 0) {
            console.log('Update message detected. Refreshing...');
            return true;
        }
        else {
            return false;
        }
    }

    async putValueOnCell(targetCell: any, value: any) {
        // checks if value can be put on cell if editable cell value updated

        const hasSpan = await targetCell.locator('span.editable').count() > 0;
        const hasInput = await targetCell.locator('input.editable').count() > 0;
        if (hasSpan || hasInput) {
            await targetCell.click();
            await targetCell.press('ControlOrMeta+a');
            await targetCell.press('Delete');
            // Find the input inside the cell
            const input = targetCell.locator('input, [contenteditable="true"]').first();
            await input.waitFor({ state: 'visible' });
            await input.fill(value);
            await input.press('Enter');
        } else {
            throw new Error("Field Column is not editable, cell cannot be updated!");
        }
        // Waits for 2 seconds to let the value be set and calc Engine to process
        await this.page.waitForTimeout(2000);
    }

    async refreshGridIfNotEditable(retries: number) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            await this.page.waitForTimeout(1000); // Wait for 1 second before retrying            
            if (await this.checkGridIsEditable() === true) {
                // this.page.reload();
                await this.gotoChevron("Copy BoM Items");
                await this.gotoChevron("Edit");
            } else {
                break; // Exit the loop if the grid is editable
            }
            // If last attempt and still not editable, throw error
            if (attempt === retries && await this.checkGridIsEditable() === true) {
                throw new Error(
                    `Edit Quote Grid is still not editable after ${retries} retries. Background process may still be running.`
                );
            }
        }
    }

    async refreshChevronIfNotEditable(retries: number, chevronName: any) {
        // Refreshes the Grid
        const quote = new QuoteService(this.page);
        for (let attempt = 1; attempt <= retries; attempt++) {
            await this.page.waitForTimeout(1000); // Wait for 1 second before retrying            
            //--- Refresh logic ---//
            if (await this.checkGridIsEditable() === true) {
                await this.gotoChevron(goToQuoteChevronName);   // Go to Quote Header
                await quote.goToSelectBoMsPage();               // Go to Select BoMs Page
                await this.page.waitForTimeout(8000); // Wait for 8 seconds before retrying            
                await this.gotoChevron(chevronName);            // Go to the required chevron again
            } else {
                break; // Exit the loop if the grid is editable
            }
            // If last attempt and still not editable, throw error
            if (attempt === retries && await this.checkGridIsEditable() === true) {
                throw new Error(
                    `Edit Quote Grid is still not editable after ${retries} retries. Background process may still be running.`
                );
            }
        }
    }

    async gotoChevron(locatorName: string) {
        // Navigate to a specific tab in the Quote page

        const frame = await this.quote.frameInEQG(); // Setting up the iframe
        const link = frame.getByRole('link', { name: locatorName });
        try {
            // Optional: wait for the link to be visible and enabled
            await link.waitFor({ state: 'visible', timeout: 50000 });
            await link.click();
            console.log(`Chevron was clicked successfully! ${await link.textContent()}`);
            await this.page.waitForLoadState('domcontentloaded');
            return 1; // success
        } catch (error) {
            console.warn(`Link "${locatorName}" not clickable or locator not present:`, error);
            return 0; // failure
        }

    }

    async goToBoxQtyAndSetValue(boxSortValue: any, boxQty: any) {
        // Go to the Box Qty on the Box where Box Sort = boxSortValue, and update the boxQty 

        const frame = await this.quote.frameInEQG();
        const boxQtyLocator = frame.locator(`input[data-value=${boxSortValue}][class="quoteQty"]`);
        await boxQtyLocator.dblclick();
        await boxQtyLocator.press('ControlOrMeta+a');
        await boxQtyLocator.press('Delete');
        await boxQtyLocator.waitFor({ state: 'visible' });
        await boxQtyLocator.fill(boxQty);
        // await boxQtyLocator.press('Enter');
        // const changedBoxQtyLocator = await frame.locator(`input[data-value="${boxSortValue}"][class="quoteQty"][value="${boxQty}"]`);
        // if (await changedBoxQtyLocator.count()>0){
        //     console.log("Box Qty value was updated");
        // }
        // else {
        //     throw new Error(`Box Qty ${boxQty} could not be updated on Box Sort Value = ${boxSortValue}`);
        // }
    }

    async validateChangedOriginalBoxQtyOnGrid(boxSortValue: any, boxQty: any) {
        // Checks if the Box Qty on the Original Box has been saved successfully

        await this.page.waitForTimeout(9000);
        const frame = await this.quote.frameInEQG();
        const changedBoxQtyLocator = await frame.locator(`input[data-value="${boxSortValue}"][class="quoteQty"][value="${boxQty}"]`);
        if (await changedBoxQtyLocator.count() > 0) {
            console.log("Box Qty value was updated");
        }
        else {
            throw new Error(`Box Qty ${boxQty} could not be updated on Box Sort Value = ${boxSortValue}`);
        }
    }

    async checkIfSplitButtonPresent(boxSortValue: any) {
        // checks if the Split box button is visible when box Qty is greater than 1

        await this.page.waitForTimeout(3000);
        const frame = await this.quote.frameInEQG();
        const splitBoxButtonLocator = await frame.locator(`a[class="boxSplit"][data-value=${boxSortValue}] i[title="Split Box"]`);
        if (await splitBoxButtonLocator.count() > 0) {
            console.log("The Split Icon is available!");
            return true;
        }
        else {
            console.log(" Split Icon is not available! ");
            return false;
        }
    }

    async getBoxQtyValueOfBox(boxSortValue: any) {
        // Gets the Box Quantity of a Box on Grid by its Box Sort Order

        const frame = await this.quote.frameInEQG();
        const boxQtyValue = await frame.locator(`input[data-value=${boxSortValue}][class="quoteQty"]`).getAttribute('value');
        return boxQtyValue;
    }

    async clickOnSplitButton(boxSortValue: any) {
        // Clicks the split box button

        const frame = await this.quote.frameInEQG();
        const splitBoxButtonLocator = await frame.locator(`a[class="boxSplit"][data-value=${boxSortValue}] i[title="Split Box"]`);
        await splitBoxButtonLocator.click()
        const uiWindowLocator = await frame.locator('span[class="ui-dialog-title"]').filter({ hasText: "Split Box" });
        if (await uiWindowLocator.count() > 0) {
            console.log("Split Box window opened successfully");
        }
        else {
            throw new Error('Split Box Window did not open!')
        }
    }

    async clickPlusIcon(boxSortValue: any) {
        // Clicks on the Plus Icon to create new boxes on Split Window

        const frame = await this.quote.frameInEQG();
        const plusLocator = await frame.locator(`div[class="ui-dialog-content ui-widget-content"][data-value="${boxSortValue}"] i[class="fa fa-plus fa-lg"]`)
        await plusLocator.click();
        console.log("Plus icon was clicked successfully!");
    }

    async getOriginalBoxQtyOnUI() {
        // Returns the Box Qty value of Original box when clicking plus icon on Split Window

        const frame = await this.quote.frameInEQG();
        const actualBoxQtyValueOnUI = await frame.locator('input.boxQtyInput.ui-state-disabled').evaluate(el => {
            const style = window.getComputedStyle(el, '::before');
            return style.content;
        });

        return actualBoxQtyValueOnUI;
    }

    async hasDisabledPlusButton() {
        // Checks if plus button is disabled or not on Split Window
        const frame = await this.quote.frameInEQG();
        const actualBoxQtyValueOnUI = await frame.locator('div[class="originalBox splitBox"] button[id="addSplitBox"][class="ui-state-disabled"]');
        if (await actualBoxQtyValueOnUI.count() > 0) {
            return true;
        } else {
            return false;
        }
    }

    async createNewBoxes(noOfBoxesToCreate: any, boxSortValue: any) {
        // Creates n number of boxes specified by the user on Split Window

        for (let i = noOfBoxesToCreate; i >= 1; i--) {
            await this.clickPlusIcon(boxSortValue);
            const check = await this.hasDisabledPlusButton();
            const actualBoxQty = Number(this.getOriginalBoxQtyOnUI());
            if (actualBoxQty === 1 && check === false) {
                throw new Error("Plus Button not disabled when Actual box Qty is 1!");
            }
            else if (actualBoxQty === 1 && check === true) {
                console.log("Plus Button disabled when Actual box Qty is 1!");
            }
        }
    }

    async clickUiButtonInSplitBox(buttonName: any) {
        // Clicks on action buttons on on Split Window UI Page (Apply/Cancel)

        const frame = await this.quote.frameInEQG();
        // const buttonLocator = frame.locator(`button.ui-button:has-text("${buttonName}")`);
        await frame.getByRole('button', { name: buttonName }).click();
    }

    async validateNumberOfBoxes(boxQty: any) {
        // checks the Total Number of Boxes after Split Operation when creating Split Boxes with Qty = 1 (multi Split Boxes)

        const frame = await this.quote.frameInEQG();
        const splitBoxes = await frame.locator('span[class="splitLetter"]');
        const count = await splitBoxes.count()
        if (count === Number(boxQty)) {
            console.log("Number of Boxes are correct after Split was performed");
        }
        else { throw new Error("Number of Boxes created is not correct!") }
    }

    validateBoxQtyAfterSplit(orgBoxQtyAfrSplt: any, splitBoxQty: any, boxQty: any) {
        // Checks that the Box Qty of Original Box and the Split Box are showing correct values after Split (Split Box Qty != 1, Single split Box)

        if ((orgBoxQtyAfrSplt + splitBoxQty) === Number(boxQty)) {
            console.log("The Box Qty after split is correct");
        } else
            throw new Error(`The Box Qty after Split is not correct. Original Box Qty Before Split: ${boxQty} Box Qty after Split: ${orgBoxQtyAfrSplt} Split Box Qty: ${splitBoxQty} `)
    }

    async setNewSplitBoxQtyOnWindow(splitBoxQtyWindow: any) {
        // Gives the SplitBox Qty on the Split Box Window as specified on Input splitBoxQtyWindow

        const frame = await this.quote.frameInEQG();
        const SplitBoxQtylocatorOnWindow = frame.locator('div[class="splitBox"] div[class="boxQty"] input[class="boxQtyInput"]');
        await SplitBoxQtylocatorOnWindow.dblclick();
        await SplitBoxQtylocatorOnWindow.press('ControlOrMeta+a');
        await SplitBoxQtylocatorOnWindow.press('Delete');
        await SplitBoxQtylocatorOnWindow.waitFor({ state: 'visible' });
        await SplitBoxQtylocatorOnWindow.fill(splitBoxQtyWindow);

    }

    async checkInvalidQtyInputOnWindowForSplit() {
        // checks if the Input Entered is Invalid while giving Box Qty on Split Box, on Split box Window
        await this.page.waitForTimeout(1000);
        const frame = await this.quote.frameInEQG();
        const notifyLocator = frame.locator("span[data-notify-text]");
        // Wait for the notification element to be attached
        await notifyLocator.first().waitFor({ state: "attached", timeout: 10000 });
        const notifyText = await notifyLocator.first().textContent();
        console.log(" Notification on Page:", notifyText)
        if (notifyText?.trim().includes(`Invalid input`)) {
            console.log(" Invalid Input Found");
            return true;
        }
        else {
            console.log("Input is Valid!");
            return false;
        }
    }

    async validateSplitBoxQtyOnGrid(splitBoxQtyWindow: any) {
        // checks that the correct Box Qty is showing on Split Box header on Grid as was mentioned on input 

        await this.page.waitForTimeout(3000);
        const frame = await this.quote.frameInEQG();
        // Wait for Split Box Qty input to be visible
        await frame.locator(`input[data-split-status="CLONE"][class="quoteQty"]`).waitFor({ state: 'visible', timeout: 10000 });
        const qtyValue = await frame.locator(`input[data-split-status="CLONE"][class="quoteQty"]`).getAttribute('value');
        if (await qtyValue === splitBoxQtyWindow) {
            console.log("Box Qty value was updated");
        }
        else {
            throw new Error(`Box Qty ${splitBoxQtyWindow} could not be updated on Cloned Split Box`);
        }
    }

    async updateBoxQtyOnSplitBox(boxQty: any) {
        // Method to update the Split box Qty on the Box Header in Grid

        const frame = await this.quote.frameInEQG();
        const boxQtyLocator = frame.locator(`input[data-split-status="CLONE"][class="quoteQty"]`);
        await boxQtyLocator.dblclick();
        await boxQtyLocator.press('ControlOrMeta+a');
        await boxQtyLocator.press('Delete');
        await boxQtyLocator.waitFor({ state: 'visible' });
        await boxQtyLocator.fill(boxQty);
        await this.page.waitForTimeout(3000);
        // const qtyValue = await frame.locator(`input[data-split-status="CLONE"][class="quoteQty"]`).getAttribute('value');
        // if (await qtyValue === boxQty){
        //     console.log("Box Qty value was updated");
        // }
        // else {
        //     throw new Error(`Box Qty ${boxQty} could not be updated on Cloned Split Box`);
        // }
    }

    async checkIfSplitBoxIconFoundOnClones() {
        // Validate if newly created Split Boxes have split icon or not on Grid

        const frame = await this.quote.frameInEQG();
        const qtyValue = await frame.locator(`input[data-split-status="CLONE"][class="quoteQty"]`).getAttribute('value') || '';
        if (Number(qtyValue) > 1) {
            const splitBoxButtonLocator = await frame.locator(`input[data-split-status="CLONE"][class="quoteQty"] i[title="Split Box"]`);
            if (await splitBoxButtonLocator.count() > 0) {
                console.log("The Split Icon is available!");
                return true;
            }
            else {
                console.log(" Split Icon is not available! ");
                return false;
            }
        }
    }

    async clickDeleteButtonOnUIandValidateMerge(boxQty: any) {
        // Clicks on the delete button to merge boxes on Split Window

        const frame = await this.quote.frameInEQG();
        const deletelocator = frame.locator('button[class="removeSplitBox"] i[class="fa fa-lg fa-trash"]');
        const count = await deletelocator.count();
        for (let i = count - 1; i >= 0; i--) {
            await deletelocator.nth(i).click();
        }
        const qtyValueUI = await frame.locator(`div[class="boxQty"] input[class="boxQtyInput ui-state-disabled"]`).getAttribute('value') || '';
        if (qtyValueUI === boxQty) {
            console.log("Boxes were merged successfully!");
        }
        else {
            throw new Error("Merged Qty value does not match with original Box Quantity!");
        }
    }

    async getBoxPartNumber(boxNumber: any){
        // Gets the Part Number of Box from the Header
        const frame = await this.quote.frameInEQG();
        const partNo = await frame.locator('tr[class="ui-widget-content jqgroup ui-row-ltr qtGridghead_2"] span[class="groupText"] b').nth(boxNumber).textContent();
        return partNo;
    }

    async loadBoxHeaderDataFromEQG(boxNumber: any) {
        // Extracts the pricing from the Box spectified by boxNumber (ex boxNumber:00- means first box, 01- second and so on..)

        const frame = await this.quote.frameInEQG();
        const totListPrice = parseFloat(await frame.locator(`tr[id="qtGridghead_2_${boxNumber}"] td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__Total_List_Price__c"] span`).getAttribute('data-src') || '0');
        const varTotCost = parseFloat(await frame.locator(`tr[id="qtGridghead_2_${boxNumber}"] td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__VAR_Total_Cost__c"] span`).getAttribute('data-src') || '0');
        const varTotProfit = parseFloat(await frame.locator(`tr[id="qtGridghead_2_${boxNumber}"] td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__VAR_Total_Profit__c"] span`).getAttribute('data-src') || '0');
        const custExtPrice = parseFloat(await frame.locator(`tr[id="qtGridghead_2_${boxNumber}"] td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__Cust_Extended_Price__c"] span`).getAttribute('data-src') || '0');

        const Data = {
            "Total Extended List Price": Math.round(totListPrice * 100) / 100,
            "VAR Total Cost": Math.round(varTotCost * 100) / 100,
            "VAR Total Profit": Math.round(varTotProfit * 100) / 100,
            "Customer Extended Price": Math.round(custExtPrice * 100) / 100
        };

        return Data;
    }
    
    async loadElementHeaderDataFromEQG(elemIndex: any) {
        // Extracts the pricing from the Box or Group given by element Index

        const frame = await this.quote.frameInEQG();
        const row = await frame.locator('tbody tr[role="row"]:not(.jqgfirstrow)');      // All rows including Groups, Boxes and Items
        const totListPrice = parseFloat(await row.locator(` td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__Total_List_Price__c"] span`).nth(elemIndex).getAttribute('data-src') || '0');
        const varTotCost = parseFloat(await row.locator(` td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__VAR_Total_Cost__c"] span`).nth(elemIndex).getAttribute('data-src') || '0');
        const varTotProfit = parseFloat(await row.locator(` td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__VAR_Total_Profit__c"] span`).nth(elemIndex).getAttribute('data-src') || '0');
        const custExtPrice = parseFloat(await row.locator(` td[aria-describedby="qtGrid_${process.env.SF_ORG_PREFIX}__Cust_Extended_Price__c"] span`).nth(elemIndex).getAttribute('data-src') || '0');

        const Data = {
            "Total Extended List Price": Math.round(totListPrice * 100) / 100,
            "VAR Total Cost": Math.round(varTotCost * 100) / 100,
            "VAR Total Profit": Math.round(varTotProfit * 100) / 100,
            "Customer Extended Price": Math.round(custExtPrice * 100) / 100
        };

        return Data;
    }

}