import { test, chromium, BrowserContext, expect, Page } from "@playwright/test";
import { QuoteService } from "../../services/quote-service";
import { BomService } from "../../services/bom-service";
import { OpportunityPage } from "../../pages/opportunityPage";
import { AdvanceUi } from "../../utils/advUi";
import { QUOTE_TEST_DATA } from "../../assets/test_data_constants";
import { selectAllButtonLocator, deleteButtonLocator, goToEditQuoteGridChevronName, goToCopyBoMItems, } from "../../pages/editQuoteGridPage"
import * as XLSX from "xlsx";
import { getExcelData } from "../../utils/excelReader";

test.describe("Tests on Edit Quote Grid", () => {
    // let browser: Browser;
    // const bulksheetvalue = 4;
    const EQGSheet = process.env.EQG_SHEET_NAME||'';
    const bulkEditSheetName = process.env.BULK_EDIT_SHEET_NAME||'';
    const retries = 3; //number of retries for checking if Quote is editable
    const EQGExcelsheet = getExcelData(QUOTE_TEST_DATA, EQGSheet);
    const rows = EQGExcelsheet.getColumn('Zephyr Test Number').length;
    const BulkExcelsheet = getExcelData(QUOTE_TEST_DATA, bulkEditSheetName);
    const rows2 = BulkExcelsheet.getColumn('Zephyr Test Number').length;

    // test.beforeAll(async ({ browser }) => {
    //     context = await browser.newContext({ viewport: { width: 1800, height: 1080 }, deviceScaleFactor: 1 });
    //     page = await context.newPage();
    // });

    // test.afterAll(async () => {
    //     if (context) {
    //         await context.close();
    //     }
    // });

    test.beforeEach(async ({page }, testInfo) => {
        // This runs before each test         

        if (!page) throw new Error("Page not initialized in beforeAll!");
        const nonEmptyRows: any[] = [];

        // --- Logic to choose sheet for Data extraction
        // Check if test has a "bulk" tag
        const hasBulkTag = testInfo.tags?.includes("@bulk") || testInfo.title.toLowerCase().includes("bulk");
        const sheet = hasBulkTag ? BulkExcelsheet : EQGExcelsheet;
        console.log("Using sheet:", hasBulkTag ? "Bulk" : "EQG");
        const rows = sheet.getColumn('Zephyr Test Number').length;

        // Extract Zephyr Test Number from test title
        const match = testInfo.title.match(/\[T(\d+)\]/);
        if (!match) throw new Error("Test title does not contain a valid Zephyr Test Number");
        const testNumber = `T${match[1]}`;
        const zephyrColumn = sheet.getColumn("Zephyr Test Number");
        //Extracting the rownumber after matching the zephyr test number
        const rowIndex = zephyrColumn.findIndex(val => val === testNumber);
        if (rowIndex === -1) throw new Error(`Test Number ${testNumber} not found in sheet`);
        // updating the rowIndex based on counter to handle multiple beforeEach calls
        const bomSource = sheet.getCell(rowIndex + 1, 'BoM Source');
        const bomToCopy = sheet.getCell(rowIndex + 1, 'BoMs to Copy');
        const quoteId = sheet.getCell(rowIndex + 1, "Quote Id");

        const advui = new AdvanceUi(page);
        const quote = new QuoteService(page);
        const bomService = new BomService(page);
        // const quoteId = await quote.findQuoteId();
        await quote.goToRecord(quoteId);
        await quote.goToSelectBoMsPage();
        // const error1 = await quote.selectBomAndCopy(bomSource,bomToCopy);            
        // await bomService.throwError(error1); 
        const canContinue = await quote.selectBomAndCopy(bomSource, bomToCopy);
        if (canContinue == true) {
            await quote.quickAddToQuote();
            await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
        } else {
            console.log("bom was selected so it got deleted from the copy boms page");
            await advui.gotoChevron(goToEditQuoteGridChevronName);
            await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);

        }

    });

    test.afterEach(async ({page }) => {
        // This Runs After each test
        if (!page) throw new Error("Page not initialized in beforeAll!");
        const advui = new AdvanceUi(page);
        await advui.gotoChevron(goToCopyBoMItems);
        await advui.refreshChevronIfNotEditable(retries, goToCopyBoMItems);
        await advui.clickOnButton(selectAllButtonLocator);
        await advui.clickOnButton(deleteButtonLocator);
        await advui.clickYesOnconfirmationPopUp();
    });

    for (let rowNumber = 1; rowNumber <= rows; rowNumber++) {

        const testNo = EQGExcelsheet.getCell(rowNumber, 'Zephyr Test Number');
        const rowToEditOnGrid = EQGExcelsheet.getCell(rowNumber, 'Row Number');
        const quoteItemNo = EQGExcelsheet.getCell(rowNumber, 'Quote item Number');
        const fieldToChange = EQGExcelsheet.getCell(rowNumber, 'Changed Field');
        const changedValue = EQGExcelsheet.getCell(rowNumber, 'Changed Values').toString();
        const Mode: string = EQGExcelsheet.getCell(rowNumber, 'Mode').toString();
        const filterField = EQGExcelsheet.getCell(rowNumber, 'Filter Field').toString();
        const filterValue = EQGExcelsheet.getCell(rowNumber, 'Filter Value').toString();
        const filterBy = EQGExcelsheet.getCell(rowNumber, 'Filter By');
        const quoteId = EQGExcelsheet.getCell(rowNumber, 'Quote Id').toString();
        const sheetvalue = 1; //sheet to get expected values from EQG Sheet

        test(`[${testNo}] Checking Edit Quote Grid after changing ${fieldToChange} and giving value ${changedValue}`, { tag: [  "@sanity", "@soupra", "@editQuoteGrid", "@demo"] },
            async ({ page}, testInfo) => {

                if (!page) throw new Error("Page not initialized in beforeAll!");
                const advui = new AdvanceUi(page);
                const quoteService = new QuoteService(page);
                testInfo.setTimeout(500000);

                await advui.changeCalculationMode(Mode);
                await advui.filterCriteria(filterField, filterBy);
                await advui.filterByColumn(filterField, filterValue);
                const rowToEdit = await advui.findTheRow(rowToEditOnGrid);
                await advui.findTheRowAndDoubleClick(rowToEdit);
                const targetCell = await advui.findCell(rowToEdit, fieldToChange);
                await advui.putValueOnCell(targetCell, changedValue);
                const eqgUIDataList = await quoteService.getValuesFromEQG(rowToEdit, EQGSheet);   // Get the values from the Edit Quote Grid after saving
                const eqgExpectedValues = await quoteService.getActualDataFromExcel(EQGSheet, rowNumber);     // Get the expected values from the Excel file
                await quoteService.validateUIDataBeforeSave(eqgExpectedValues.rounded, eqgUIDataList); //Compare values and find the Error if any
                await advui.clickSaveButton();
                // If found Error: You cannot perform save as the record is currently locked by a batch modification. Please retry again in 1 minute.
                for (let attempt = 1; attempt <= 5; attempt++) {
                    const frameContent = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();                         
                    const errLoc = await frameContent.locator('div[aria-labelledby="swal2-title"][role="dialog"]');
                    if(await errLoc.count()>0){
                        await frameContent.getByRole('button', { name: 'OK' }).click();     // locator: div[aria-labelledby="swal2-title"] button[type="button"][class="swal2-confirm swal2-styled"] === if get By Role fails
                        await page.reload();                                                // Reload the Page
                        await advui.gotoChevron(goToEditQuoteGridChevronName);              // Goes to Edit Quote Grid
                        await advui.filterCriteria(filterField, filterBy);                  // Apply the relevant filters again
                        await advui.filterByColumn(filterField, filterValue);               // Give the filter value
                        await advui.findTheRowAndDoubleClick(rowToEdit);                    // Double click the row again to edit
                        await advui.putValueOnCell(targetCell, changedValue);               // Re-applying the changes Inline on Edit Quote Grid
                        await advui.clickSaveButton();                                      // Saving again
                    }
                    else {
                        break;
                    }
                }
                const eqgExpectedValues2 = await quoteService.getActualDataFromExcel(EQGSheet, rowNumber);     // Get the expected values from the Excel file
                const sfDatabaseValues = await quoteService.getDataBaseValuesFromSF(quoteId, EQGSheet, quoteItemNo);
                //DB validation (2-decimal, existing behavior)
                await quoteService.validateDBDataAfterSave(
                    eqgExpectedValues2.rounded,
                    sfDatabaseValues.rounded
                );

                // backend precision validation
                await quoteService.validateDBDataAfterSave(
                    eqgExpectedValues2.precise,
                    sfDatabaseValues.precise
                );
                // await advui.clickOnButton(selectAllButtonLocator);
                // await advui.clickOnButton(deleteButtonLocator);
                // await advui.clickYesOnconfirmationPopUp();
                // await advui.gotoChevron(goToQuoteChevronName);
            }
        );
    }

    // --- Row-driven tests from Bulk Edit sheet ---
    for (let rowNumber = 1; rowNumber <= rows2; rowNumber++) {

        const testNo = BulkExcelsheet.getCell(rowNumber, 'Zephyr Test Number');
        const Mode: string = BulkExcelsheet.getCell(rowNumber, 'Mode').toString();
        const filterField = BulkExcelsheet.getCell(rowNumber, 'Filter Field').toString();
        const filterValue = BulkExcelsheet.getCell(rowNumber, 'Filter Value').toString();
        const filterBy = BulkExcelsheet.getCell(rowNumber, 'Filter By').toString();
        const bulkEditfield = BulkExcelsheet.getCell(rowNumber, 'Bulk Edit Field').toString();
        const setBy = BulkExcelsheet.getCell(rowNumber, 'Set to').toString();
        const valueToUpdateWithBulk = BulkExcelsheet.getCell(rowNumber, 'Value to set with bulk').toString();
        const rowsToEdit = BulkExcelsheet.getCell(rowNumber, 'Row Number');
        const quoteId = BulkExcelsheet.getCell(rowNumber, 'Quote Id').toString();
        const boxSortValue = BulkExcelsheet.getCell(rowNumber, 'Box Sort Value').toString();
        const bulkFieldValidationOnItems = BulkExcelsheet.getCell(rowNumber, "Field to validate Bulk Edit on Items").toString();

        // Skip test if testNo or bulkEditfield is empty to avoid duplicate titles
        if (!testNo || !Mode) {
            continue;
        }

        test(`[${testNo}] Checking Edit Quote Grid after changing in BulkEdit ${valueToUpdateWithBulk} on ${bulkEditfield} ${setBy}`, { tag: [  "@sanity", "@soupra", "@editQuoteGrid", "@bulk", "@demo"] },
            async ({ page}, testInfo) => {
                // current row that is being processed on the excel data sheet
                let currentRow = rowNumber;
                let BulkSheetValue = 2;
                if (!page) throw new Error("Page not initialized in beforeAll!");
                const advui = new AdvanceUi(page);
                const quoteService = new QuoteService(page);
                testInfo.setTimeout(300000);

                await advui.changeCalculationMode(Mode);
                if (boxSortValue === '' || boxSortValue === undefined) {
                    // If Box Sort value is not present then filter and select using rows to select
                    await advui.filterCriteria(filterField, filterBy);
                    await advui.filterByColumn(filterField, filterValue);
                    await advui.clickOnButton('btnuntieBoxes');
                    await quoteService.selectGivenRows(rowsToEdit);
                    await advui.editSelectedRowsUsingBulk(bulkEditfield, setBy, valueToUpdateWithBulk);
                    const excelValues = await quoteService.getExcelValueForBulk(QUOTE_TEST_DATA, bulkEditSheetName, rowsToEdit, currentRow); // Get the expected values from the Excel file
                    const eqgUIValues = await quoteService.getDataFromGrid(rowsToEdit, bulkEditSheetName);
                    await quoteService.validateBulkUIDataBeforeSave(excelValues.rounded, eqgUIValues); //Compare values and find the Error if any
                    await advui.clickSaveButton();
                    // If found Error: You cannot perform save as the record is currently locked by a batch modification. Please retry again in 1 minute.
                    for (let attempt = 1; attempt <= 5; attempt++) {
                        const frameContent = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();                         
                        const errLoc = await frameContent.locator('div[aria-labelledby="swal2-title"][role="dialog"]');
                        if(await errLoc.count()>0){
                            await frameContent.getByRole('button', { name: 'OK' }).click();     // locator: div[aria-labelledby="swal2-title"] button[type="button"][class="swal2-confirm swal2-styled"] === if get By Role fails
                            await page.reload();                                                // Reload the Page
                            await advui.gotoChevron(goToEditQuoteGridChevronName);              // Goes to Edit Quote Grid
                            await advui.filterCriteria(filterField, filterBy);                  // Apply the relevant filters again
                            await advui.filterByColumn(filterField, filterValue);               // Give the filter value
                            await advui.clickOnButton('btnuntieBoxes');
                            await quoteService.selectGivenRows(rowsToEdit);
                            await advui.editSelectedRowsUsingBulk(bulkEditfield, setBy, valueToUpdateWithBulk);
                            await advui.clickSaveButton();                                      // Saving again
                        }
                        else {
                            break;
                        }
                    }
                    const sfData = await quoteService.getBulkDataBaseValuesFromSF(quoteId, bulkEditSheetName, rowsToEdit, filterField, filterBy, filterValue);
                    await quoteService.validateBulkDBDataAfterSave(excelValues.precise, sfData.precise);
                    await quoteService.validateBulkDBDataAfterSave(excelValues.rounded, sfData.rounded);
                }
                else {
                    await advui.clickOnBoxBySortvalue(boxSortValue);
                    await advui.editSelectedRowsUsingBulk(bulkEditfield, setBy, valueToUpdateWithBulk);
                    await quoteService.checkSuccesiveItemsAfterBulkUpdate(bulkFieldValidationOnItems, valueToUpdateWithBulk);
                }
                currentRow++;
            }
        );
    }

});
