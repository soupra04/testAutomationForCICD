import { test, expect} from "@playwright/test";
import { QUOTE_TEST_DATA } from "../../assets/test_data_constants";
import { QuoteService } from "../../services/quote-service";
import { SalesforceUtils } from "../../utils/sfUtils";
import { getExcelData} from "../../utils/excelReader";
import { XRLUtils } from "../../utils/xrlUtils";
// Centralized env resolver: reads .env locally and SF_VARS JSON in CI without duplicating parse/fallback logic
import { getRequiredEnv } from "../../utils/envConfig";

test.describe("Tests related to Supplier Assignment", () => {    

    let quoteService: QuoteService;
    let sf: SalesforceUtils;
    let xrl: XRLUtils;
    let rowIndex: number = -1;
    let count = 1;
    // const suppSheet = process.env.SUPP_SHEET || 'Supplier';
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const suppSheet = getRequiredEnv("SUPP_SHEET");
    // const suppSingleSheet = process.env.SUPP_SINGLE_SHEET || 'Supplier Single Tests';
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const suppSingleSheet = getRequiredEnv("SUPP_SINGLE_SHEET");
    const supplierSheet = getExcelData(QUOTE_TEST_DATA, suppSheet);  
    const singleTestSheet = getExcelData(QUOTE_TEST_DATA, suppSingleSheet);  
    const rows = supplierSheet.getColumn('Zephyr Test Number').length;
    console.log("Resolved sheetName:", suppSheet);
    console.log("Resolved sheetName:", suppSingleSheet);
    
    test.beforeEach(async ({ page}, testInfo) => {
        quoteService = new QuoteService(page);
        sf = new SalesforceUtils(page);
        xrl = new XRLUtils(page);

        // Extract Zephyr Test Number from test title
        const match = testInfo.title.match(/\[T(\d+)\]/);
        if (!match) throw new Error("Test title does not contain a valid Zephyr Test Number");
        // Get correct sheet
        const singleTestTag = testInfo.tags?.includes("@single");
        const sheet = singleTestTag ? singleTestSheet : supplierSheet;
        console.log("Using sheet:", singleTestTag ? "Supplier Single Tests" : "Bulk/Inline tests");

        const testNumber = `T${match[1]}`;
        const zephyrColumn = sheet.getColumn("Zephyr Test Number");
        rowIndex = zephyrColumn.findIndex(val => val === testNumber);
        if (rowIndex === -1) throw new Error(`Test Number ${testNumber} not found in sheet`);

        const quoteId = sheet.getCell(rowIndex + 1, "Quote Id");       
        await quoteService.openSupplierGrid(quoteId);
        await page.waitForURL(/Supplier_Assignment/, { timeout: 60000 });
        // Grid can open blank briefly; page-size combobox appears once table chrome is ready
        await page.locator('button[aria-haspopup="listbox"][role="combobox"]').first()
            .waitFor({ state: 'visible', timeout: 90000 });
    });

    // Data driven test from Excel sheet for validating Supplier assignment for items
    for(let rowNumber = 1; rowNumber <= rows; rowNumber++){
        
        // Initialising Test Data
        const testNo = supplierSheet.getCell(rowNumber,'Zephyr Test Number');
        const rowsToSelect = supplierSheet.getCell(rowNumber,"ItemToChange").toString();
        const itemToChange = JSON.parse(rowsToSelect);
        const manufToUpdate = supplierSheet.getCell(rowNumber,"ManufacturerToUpdate").toString();
        const supplierToUpdate = supplierSheet.getCell(rowNumber,"SupplierToUpdate").toString();
        const loadAllItems = supplierSheet.getCell(rowNumber,"Load All Items").toString();
        const columnFilter = supplierSheet.getCell(rowNumber,"Column filter").toString();
        const filterOperation = supplierSheet.getCell(rowNumber,"Filter Operation").toString();
        const filtrStr = supplierSheet.getCell(rowNumber,"Filter value for column").toString();

        // Test to check if Supplier can be assigned on Grid with user input
        test(`[${testNo}] Checking if Supplier or Manuf can be assigned correctly for the given Quote`,{ tag: ["@sanity", "@supplier", "@validation"] },
                    async ({page}, testInfo) => {
            
            testInfo.setTimeout(250000);

            await test.step('load all items if required', async () => {
                if(loadAllItems === 'yes'){
                    await page.locator(`c-action[data-id="showAllItems"]`).click(); 
                    await page.waitForLoadState('domcontentloaded');
                    await xrl.updateNoOfItemsPerPage('200');
                }
            });

            await test.step('change manufacturer if required', async () => {
                if(manufToUpdate){                  
                    if(itemToChange[0] === 'all'){
                        await quoteService.selectAllItemsonSupplierGrid();
                        await quoteService.changeManufacturer(itemToChange, manufToUpdate, 0);
                        await quoteService.selectAllItemsonSupplierGrid();
                    }   
                    else{
                        await xrl.applyColumnFilterOnXRLTable(columnFilter, filterOperation, filtrStr);
                        await xrl.clkCheckboxFrmList(rowsToSelect);
                        await quoteService.changeManufacturer(itemToChange, manufToUpdate, itemToChange[0]);
                        await xrl.clkCheckboxFrmList(rowsToSelect);
                    }
                }
            });

            await test.step('change supplier if required', async () => {
                if(supplierToUpdate){                  
                    if(itemToChange[0] === 'all'){
                        await quoteService.selectAllItemsonSupplierGrid();
                        await quoteService.changeSupplier(itemToChange, supplierToUpdate, 0);
                    }   
                    else{
                        await xrl.applyColumnFilterOnXRLTable(columnFilter, filterOperation, filtrStr);
                        await xrl.clkCheckboxFrmList(rowsToSelect);
                        await quoteService.changeSupplier(itemToChange, supplierToUpdate, itemToChange[0]);
                    }
                }
            });

            await test.step('save and assert Success toast', async () => {
                await xrl.clickIconOnXRLGrid(":save");          
                await page.waitForLoadState('domcontentloaded');
                const message = await sf.getUpperToastMessage();
                await expect(message).toBe("Success");
            });

            await test.step('assert manufacturer updated on UI', async () => {
                if(manufToUpdate && itemToChange[0] !== 'all'){
                    const updtManu = await page.locator(`c-data-table-item[data-colname="${process.env.SF_ORG_PREFIX}__Manufacturer__c"] a`).nth(itemToChange[0]- 1).textContent();
                    expect(updtManu?.trim()).toBe(manufToUpdate);
                }
                else if(manufToUpdate && itemToChange[0] === 'all'){
                    const updtManu = await page.locator(`c-data-table-item[data-colname="${process.env.SF_ORG_PREFIX}__Manufacturer__c"] a`).nth(0).textContent();
                    expect(updtManu?.trim()).toBe(manufToUpdate);
                }
            });

            await test.step('assert supplier updated on UI', async () => {
                if(supplierToUpdate && itemToChange[0] !== 'all'){
                    const updtSupp = await page.locator(`c-data-table-item[data-colname="${process.env.SF_ORG_PREFIX}__Supplier__c"] a`).nth(itemToChange[0]- 1).textContent();
                    expect(updtSupp?.trim()).toBe(supplierToUpdate);
                }
                else if(supplierToUpdate && itemToChange[0] === 'all'){
                    const updtSupp = await page.locator(`c-data-table-item[data-colname="${process.env.SF_ORG_PREFIX}__Supplier__c"] a`).nth(0).textContent();
                    expect(updtSupp?.trim()).toBe(supplierToUpdate);
                }
            });

            await test.step('reset supplier and manufacturer to none', async () => {
                await quoteService.resetSuppNdManuToNone(loadAllItems, itemToChange[0]);
            });
        });
    }

    test(
        "[T3946] - Verify Supplier Page Loads all items when load all button is clicked",
        { tag: ["@supplier","@single", "@sanity"] },
        async ({ page }) => {
            test.setTimeout(300000);

            await test.step('click show all items and update page size', async () => {
                await page.locator(`c-action[data-id="showAllItems"]`).click();
                await page.waitForLoadState('domcontentloaded');
                await xrl.updateNoOfItemsPerPage('200');
            });

            const quoteId = await test.step('get Quote Id from sheet', async () => {
                return singleTestSheet.getCell(rowIndex+1,'Quote Id');
            });

            const count = await test.step('get total items count from grid', async () => {
                // Supplier grid footer is "N item(s)", not Search Quotes "out of N items"
                const footer = page
                    .locator('c-data-table div[xrl-datatable_datatable][class="slds-grid slds-m-around_xx-small"]').nth(0);
                await expect(footer).toContainText(/item/i, { timeout: 60000 });
                const totItemsOnGrid = await footer.textContent() || '';
                return Number(totItemsOnGrid.match(/(\d+)\s*item/i)?.[1] ?? 0);
            });

            await test.step('assert grid count matches SF query', async () => {
                const totItemsOnQuote = await quoteService.fetchTotItmsCount(quoteId);
                console.log(`Total Items on Grid all data loading is= ${count} , and fetched sf data count is= ${totItemsOnQuote.records[0].expr0}`);
                expect (totItemsOnQuote.records[0].expr0) .toBe(count);
            });
        }
    );

    test(
        "[T3685] - Verify Supplier Page Loads all Box items correctly as default",
        { tag: ["@supplier","@single", "@sanity"] },
        async ({ page }) => {
            test.setTimeout(300000);

            await test.step('update items per page', async () => {
                await xrl.updateNoOfItemsPerPage('200');
            });

            const quoteId = await test.step('get Quote Id from sheet', async () => {
                return singleTestSheet.getCell(rowIndex+1,'Quote Id');
            });

            const count = await test.step('get total items count from grid', async () => {
                const totItemsOnGrid = await page
                    .locator('c-data-table div[xrl-datatable_datatable][class="slds-grid slds-m-around_xx-small"]').nth(0).textContent()||'';
                return Number(totItemsOnGrid.match(/\d+/)?.[0]);
            });

            await test.step('assert default grid count matches SF query', async () => {
                const totItemsOnQuote = await quoteService.fetchDefaultItmsCountOnSuppGrid(quoteId);
                console.log(`Total Items on Grid by default (without all data loading) is= ${count} , and fetched sf data count is= ${totItemsOnQuote.records[0].expr0}`);
                expect (totItemsOnQuote.records[0].expr0) .toBe(count);
            });
        }
    );

    test(
        "[T3680] - Verify if changing manufacturer on Box changes Minor Items sucessfully",
        { tag: ["@supplier","@single", "@sanity"] },
        async ({ page }) => {
            test.setTimeout(300000);

            await test.step('update items per page', async () => {
                await xrl.updateNoOfItemsPerPage('200');
            });

            const { quoteId, itemToChange, manufToUpdate } = await test.step('load test data from sheet', async () => {
                const quoteId = singleTestSheet.getCell(rowIndex+1,'Quote Id');
                const rowsToSelect = singleTestSheet.getCell(rowIndex+1,'Items To Change').toString();
                const itemToChange = JSON.parse(rowsToSelect);
                const manufToUpdate = singleTestSheet.getCell(rowIndex+1,'Manufacturer Account');
                return { quoteId, itemToChange, manufToUpdate };
            });

            await test.step('select first box and change manufacturer', async () => {
                await quoteService.selFirstBoxOnSupplierGrid();
                await quoteService.changeManufacturer(itemToChange, manufToUpdate, itemToChange[0], 'yes');
            });

            await test.step('save and load all items', async () => {
                await xrl.clickIconOnXRLGrid(":save");  
                await page.locator(`c-action[data-id="showAllItems"]`).click();
            });

            await test.step('verify manufacturer assigned on minors', async () => {
                await quoteService.verifyAccAssignedOnMinors(quoteId, "Manufacturer", manufToUpdate);
            });

            await test.step('reset supplier and manufacturer to none', async () => {
                await quoteService.resetSuppNdManuToNone('no', itemToChange[0]);
            });
        }
    );

    test(
        "[T3680] - Verify if changing supplier on Box changes Minor Items successfully",
        { tag: ["@supplier","@single", "@sanity"] },
        async ({ page }) => {
            test.setTimeout(300000);

            await test.step('update items per page', async () => {
                await xrl.updateNoOfItemsPerPage('200');
            });

            const { quoteId, itemToChange, suppToUpdate } = await test.step('load test data from sheet', async () => {
                // upcoming few params will have rowIndex+2 as there are 2 test cases with same test case number on excel sheet
                const quoteId = singleTestSheet.getCell(rowIndex+2,'Quote Id');
                const rowsToSelect = singleTestSheet.getCell(rowIndex+2,'Items To Change').toString();
                const itemToChange = JSON.parse(rowsToSelect);
                const suppToUpdate = singleTestSheet.getCell(rowIndex+2,'Supplier Account');
                return { quoteId, itemToChange, suppToUpdate };
            });

            await test.step('select first box and change supplier', async () => {
                await quoteService.selFirstBoxOnSupplierGrid();
                await quoteService.changeSupplier(itemToChange, suppToUpdate, itemToChange[0], 'yes');
            });

            await test.step('save and load all items', async () => {
                await xrl.clickIconOnXRLGrid(":save");  
                await page.locator(`c-action[data-id="showAllItems"]`).click();
            });

            await test.step('verify supplier assigned on minors', async () => {
                await quoteService.verifyAccAssignedOnMinors(quoteId, "Supplier", suppToUpdate);
            });

            await test.step('reset supplier and manufacturer to none', async () => {
                await quoteService.resetSuppNdManuToNone('no', itemToChange[0]);
            });
        }
    );

    test(
        "[T3950] - Verify if Show Unassigned Items shows 0 items after all items have manufacturer and supplier assigned",
        { tag: ["@supplier","@single", "@sanity"] },
        async ({ page }) => {
            test.setTimeout(300000);

            await test.step('update items per page', async () => {
                await xrl.updateNoOfItemsPerPage('200');
            });

            const { itemToChange, manufToUpdate, suppToUpdate } = await test.step('load test data from sheet', async () => {
                const rowsToSelect = singleTestSheet.getCell(rowIndex+1,'Items To Change').toString();
                const itemToChange = JSON.parse(rowsToSelect);
                const manufToUpdate = singleTestSheet.getCell(rowIndex+1,'Manufacturer Account');
                const suppToUpdate = singleTestSheet.getCell(rowIndex+1,'Supplier Account');
                return { itemToChange, manufToUpdate, suppToUpdate };
            });

            await test.step('load all items and assign manufacturer and supplier', async () => {
                await page.locator(`c-action[data-id="showAllItems"]`).click();
                await quoteService.selectAllItemsonSupplierGrid();
                await quoteService.changeManufacturer(itemToChange, manufToUpdate, itemToChange[0]);
                await quoteService.changeSupplier(itemToChange, suppToUpdate, itemToChange[0]);
                await xrl.clickIconOnXRLGrid(":save");
            });

            await test.step('show unassigned items and assert count is 0', async () => {
                await page.locator(`c-action[data-id="showUnAssigneditems"]`).click();
                const totItemsOnGrid = await page
                    .locator('c-data-table div[xrl-datatable_datatable][class="slds-grid slds-m-around_xx-small"]').nth(0).textContent()||'';
                const count = Number(totItemsOnGrid.match(/\d+/)?.[0]);
                console.log(`Unassigned Items count after assigning Manufacturer and Supplier to all Items is: ${count}`);
                expect(count).toBe(0);
            });

            await test.step('reset supplier and manufacturer to none', async () => {
                await page.locator(`c-action[data-id="showUnAssigneditems"]`).click();
                await quoteService.resetSuppNdManuToNone('yes', itemToChange[0]);
            });
        }
    );
}
);
