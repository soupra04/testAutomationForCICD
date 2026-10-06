import { test, expect } from "@playwright/test";
import { QuoteService } from "../../services/quote-service";
import { AdvanceUi } from "../../utils/advUi";
import { QUOTE_TEST_DATA } from "../../assets/test_data_constants";
import { getExcelData} from "../../utils/excelReader";
import {SalesforceUtils} from "../../utils/sfUtils";
// Centralized env resolver: reads .env locally and SF_VARS JSON in CI without duplicating parse/fallback logic
import { getRequiredEnv } from "../../utils/envConfig";

test.describe("Tests on ShipTo Assignment Grid", () => {
    let count = 1;
    // const shipToSheetName = process.env.SHIP_TO_SHEET_NAME || 'ShipTo';
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const shipToSheetName = getRequiredEnv("SHIP_TO_SHEET_NAME");
    const shipToSheet= getExcelData(QUOTE_TEST_DATA, shipToSheetName);  
    const rows = shipToSheet.getColumn('Zephyr Test Number').length;
    console.log("Resolved sheetName:", shipToSheetName);
    // const shipToSingleSheetName = process.env.SHIP_TO_SINGLE_SHEET_NAME || 'ShipTo Single Tests';
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const shipToSingleSheetName = getRequiredEnv("SHIP_TO_SINGLE_SHEET_NAME");
    const shipToValidationSheet= getExcelData(QUOTE_TEST_DATA, shipToSingleSheetName);    
    const rows2 = shipToValidationSheet.getColumn('Zephyr Test Number').length;
    console.log("Resolved sheetName:", shipToSingleSheetName);

    test.beforeEach(async ({page}, testInfo) => {
        // This runs before each test         
        // --- Logic to choose sheet for Data extraction
        // Check if test has a "bulk" tag
        const singleTestTag = testInfo.tags?.includes("@validation") || testInfo.title.toLowerCase().includes("loads");
        const sheet = singleTestTag ? shipToValidationSheet : shipToSheet;
        console.log("Using sheet:", singleTestTag ? "Single Test" : "Bulk/Inline tests");
        
        // Extract Zephyr Test Number from test title
        const match = testInfo.title.match(/\[T(\d+)\]/);
        if (!match) throw new Error("Test title does not contain a valid Zephyr Test Number");

        const testNumber = `T${match[1]}`;
        const zephyrColumn = sheet.getColumn("Zephyr Test Number");
        const rowIndex = zephyrColumn.findIndex(val => val === testNumber);
        if (rowIndex === -1) throw new Error(`Test Number ${testNumber} not found in sheet`);

        const quoteId = sheet.getCell(rowIndex + 1, "Quote Id");                      
        const quote = new QuoteService(page);
        const sf = new SalesforceUtils(page); 
        await quote.goToRecord(quoteId); 
        await sf.getItemByRoleandClick('button','Show more actions');
        await sf.clickOnQuoteButton('ShipTo Assignment');
        count++; 
    });

    // Data driven test from Excel sheet for validating ShipTo Grid load with all items
    for (let rowNumber = 1; rowNumber <= rows2; rowNumber++){
        const testNo = shipToValidationSheet.getCell(rowNumber,'Zephyr Test Number');
        const quoteId = shipToValidationSheet.getCell(rowNumber,"Quote Id");

        test(`[${testNo}] Checking if ShipTo Grid loads correctly for the given Quote ${quoteId}`,{ tag: ["@sanity", "@shipToGrid", "@validation"] },
                    async ({page}, testInfo) => {
            const quoteId = shipToValidationSheet.getCell(rowNumber,"Quote Id");
            const sf = new SalesforceUtils(page);
            const quote = new QuoteService(page);
            const advui = new AdvanceUi(page);
            testInfo.setTimeout(200000);

            const frame = await test.step('get ShipTo grid frame', async () => {
                return await sf.frameInEQG();
            });

            await test.step('wait for ShipTo title', async () => {
                await quote.waitForShipToTitle();
            });

            await test.step('update records per page', async () => {
                await advui.updtRcrdsPerPage(500);
            });

            const partNoListDB = await test.step('fetch total items from DB', async () => {
                return await quote.ftchTotItemsOnShipTo(quoteId);
            });

            const partNoListUI = await test.step('fetch Part Numbers from ShipTo grid UI', async () => {
                return await quote.fetchValuesfrmShipToGrid("Part_Number__c");
            });

            await test.step('assert UI Part Numbers match DB', async () => {
                expect(partNoListUI.sort()).toEqual(partNoListDB.sort());
            });

            await test.step('assert ShipTo grid header text', async () => {
                await expect(frame.locator('span.ui-jqgrid-title')).toHaveText('ShipTo Assignment for Quote Items');
            });
        });
    }

    // Data driven test from Excel sheet for Running Bulk and Inline ShipTo update scenarios
    for (let rowNumber = 1; rowNumber <= rows; rowNumber++){
        
        const testNo = shipToSheet.getCell(rowNumber,'Zephyr Test Number');
        const rowsToSelect = shipToSheet.getCell(rowNumber,'Items to change');
        const mode = shipToSheet.getCell(rowNumber,'Mode').toString();
        const shipToAccnt = shipToSheet.getCell(rowNumber,'ShipTo Account').toString();
        const siteAdd = shipToSheet.getCell(rowNumber,'Site Address').toString();
        const siteCity = shipToSheet.getCell(rowNumber,'Site City').toString();
        const siteCountry = shipToSheet.getCell(rowNumber,'Site Country').toString();
        const filterField = shipToSheet.getCell(rowNumber,'Filter Field').toString();
        const filterBy = shipToSheet.getCell(rowNumber,'Filter By');
        const filterValue = shipToSheet.getCell(rowNumber,'Filter Value').toString();

        if (mode === 'Bulk') {     // If Mode is Bulk         
            test(`[${testNo}] Checking ShipTo Grid with Bulk update for Items ${rowsToSelect}`,{ tag: ["@sanity", "@shipToGrid"] },
                async ({page}, testInfo) => {
                
                const advui = new AdvanceUi(page);
                const quote = new QuoteService(page);
                const currRow = JSON.parse(rowsToSelect);
                testInfo.setTimeout(200000);

                await test.step('wait for ShipTo title', async () => {
                    await quote.waitForShipToTitle();
                });

                await test.step('update records per page', async () => {
                    await advui.updtRcrdsPerPage(500);
                });

                await test.step('apply column filter', async () => {
                    await advui.filterCriteria(filterField, filterBy);
                    await advui.filterByColumn(filterField,filterValue);
                });

                await test.step('select rows and open ShipTo cell', async () => {
                    if(currRow[0] === 'all'){
                        await quote.selctAllBtnOnShipTo();
                        await advui.findShipToCellAndDblClk(0);
                    }
                    else{
                        await advui.clkOnCheckboxFrmList(rowsToSelect); 
                        await advui.findShipToCellAndDblClk(currRow[0]);
                    }
                });

                await test.step('update ShipTo account', async () => {
                    await quote.updtShipToAcc(shipToAccnt);
                    await quote.clkUpdtBtnOnShipTo();
                });

                const selRec = await test.step('fetch selected records count', async () => {
                    return await quote.fetchSelRcdsOnShipTo();
                });

                await test.step('save records and validate notification', async () => {
                    await quote.clkOnSaveRecrds();
                    await quote.chckNotfictnAndValidateOnShpTo(selRec);
                });

                await test.step('validate ShipTo grid after save', async () => {
                    await quote.validateShipToGridAfterSave(rowsToSelect, siteAdd, siteCity, siteCountry);
                });
            });
        }

        else if (mode === 'Inline' ) {     // If Mode is Inline 
            test(`[${testNo}] Checking ShipTo Grid after selecting Items ${rowsToSelect}`,{ tag: ["@sanity", "@shipToGrid"] },
                async ({page}, testInfo) => {

                const advui = new AdvanceUi(page);
                const quote = new QuoteService(page);
                const currRow = JSON.parse(rowsToSelect);
                testInfo.setTimeout(200000);

                await test.step('wait for ShipTo title', async () => {
                    await quote.waitForShipToTitle();
                });

                await test.step('update records per page', async () => {
                    await advui.updtRcrdsPerPage(500);
                });

                await test.step('apply column filter', async () => {
                    await advui.filterCriteria(filterField, filterBy);
                    await advui.filterByColumn(filterField,filterValue);
                });

                await test.step('update ShipTo account inline for selected rows', async () => {
                    for (let i=0; i< currRow.length; i++){
                        await advui.findShipToCellAndDblClk(currRow[i]);
                        await quote.updtShipToAccInLine(shipToAccnt);
                    }
                });

                const selRec = await test.step('fetch selected records count', async () => {
                    return await quote.fetchSelRcdsOnShipTo();
                });

                await test.step('save records and validate notification', async () => {
                    await quote.clkOnSaveRecrds();
                    await quote.chckNotfictnAndValidateOnShpTo(selRec);
                });

                await test.step('validate ShipTo grid after save', async () => {
                    await quote.validateShipToGridAfterSave(rowsToSelect, siteAdd, siteCity, siteCountry);
                });
            });
        }
    }
});
