import { test } from "@playwright/test";
import { QuoteService } from "../../services/quote-service";
import { AdvanceUi } from "../../utils/advUi";
import { QUOTE_TEST_DATA } from "../../assets/test_data_constants";
import { deleteButtonLocator, goToEditQuoteGridChevronName, goToCopyMasterItemsChevronName } from "../../pages/editQuoteGridPage";
import { getExcelData } from "../../utils/excelReader";
// Centralized env resolver: reads .env locally and SF_VARS JSON in CI without duplicating parse/fallback logic
import { getRequiredEnv } from "../../utils/envConfig";

test.describe("Tests on Master Item Grid", () => {
    // const masterItemSheetName = process.env.MASTER_ITEM_SHEET_NAME || 'CopyMasterItems';
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const masterItemSheetName = getRequiredEnv("MASTER_ITEM_SHEET_NAME");
    const retries = 3; //number of retries for checking if Quote is editable
    const masterItemSheet = getExcelData(QUOTE_TEST_DATA, masterItemSheetName);
    const rows = masterItemSheet.getColumn('Zephyr Test Number').length;
    console.log("Resolved sheetName:", masterItemSheetName);

    // Build list of rows with quoteId - each test uses its own row (parallel-safe)
    const nonEmptyRows: number[] = [];
    for (let i = 1; i <= rows; i++) {
        const quoteId = masterItemSheet.getCell(i, "Quote Id");
        if (quoteId) {
            nonEmptyRows.push(i);
        }
    }

    // Match original viewport
    test.use({ viewport: { width: 1800, height: 1080 } });

    for (const rowNumber of nonEmptyRows) {
        const testNo = masterItemSheet.getCell(rowNumber, 'Zephyr Test Number');
        const prtNoFltrBy = masterItemSheet.getCell(rowNumber, 'Part Number filter by').toString();
        const prtNum = masterItemSheet.getCell(rowNumber, 'Part Number').toString();
        const dscFltrBy = masterItemSheet.getCell(rowNumber, 'Description filter by').toString();
        const dsc = masterItemSheet.getCell(rowNumber, 'Description').toString();
        const manufrFltrBy = masterItemSheet.getCell(rowNumber, 'Manufacturer filter by').toString();
        const manufr = masterItemSheet.getCell(rowNumber, 'Manufacturer').toString();
        const itmTypeFltrBy = masterItemSheet.getCell(rowNumber, 'Item Type filter by').toString();
        const itmType = masterItemSheet.getCell(rowNumber, 'Item Type').toString();
        const itmsToCopy = masterItemSheet.getCell(rowNumber, 'Row Number');
        const filterField = masterItemSheet.getCell(rowNumber, 'Filter Field').toString();
        const filterBy = masterItemSheet.getCell(rowNumber, 'Filter By');
        const filterValue = masterItemSheet.getCell(rowNumber, 'Filter Value').toString();

        test.describe(`[${testNo}] Master Item Copy`, () => {
            test.beforeEach(async ({ page }) => {
                const quoteId = masterItemSheet.getCell(rowNumber, "Quote Id");
                const advui = new AdvanceUi(page);
                const quote = new QuoteService(page);
                await quote.goToRecord(quoteId);
                await quote.goToSelectBoMsPage();
                await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
                await advui.gotoChevron(goToCopyMasterItemsChevronName);
            });

            test.afterEach(async ({ page }) => {
                const advui = new AdvanceUi(page);
                await advui.clickOnButton(deleteButtonLocator);
                await advui.clickYesOnconfirmationPopUp();
            });

            test(`Checking Master Item Copy and copy rows ${itmsToCopy} `, { tag: ["@regression", "@copyMasterItem", "@sanity"] },
                async ({ page }, testInfo) => {
                    testInfo.setTimeout(300000);
                    const advui = new AdvanceUi(page);
                    const qs = new QuoteService(page);

                    await test.step('wait for the master item grid page to load', async () => {
                        await qs.waitForMasterItemsGridPage();
                    });

                    await test.step('filter by part number', async () => {
                        await qs.updtFltrByOnMstrItmGrd('Part_Number__c', prtNoFltrBy, 'Search Criteria');
                        await qs.fltrByColOnMstrItmGrd('Part_Number__c', prtNum, 'Search Criteria');
                    });

                    await test.step('filter by Description', async () => {
                        await qs.updtFltrByOnMstrItmGrd('Description__c', dscFltrBy, 'Search Criteria');
                        await qs.fltrByColOnMstrItmGrd('Description__c', dsc, 'Search Criteria');
                    });

                    await test.step('filter by Manufacturer filter', async () => {
                        const manufLocator = await qs.manfLocator();
                        await qs.updtFltrByOnMstrItmGrd(manufLocator, manufrFltrBy, 'Search Criteria');
                        await qs.fltrByColOnMstrItmGrd(manufLocator, manufr, 'Search Criteria');
                    });

                    await test.step('filter by Item type', async () => {
                        await qs.updtFltrByOnMstrItmGrd('Item_Type_X__c', itmTypeFltrBy, 'Search Criteria');
                        await qs.fltrByColOnMstrItmGrd('Item_Type_X__c', itmType, 'Search Criteria');
                    });

                    await test.step('click on search button', async () => {
                        await qs.clckSrchBtnOnMastrItmGrid();
                    });

                    await test.step('wait for master item grid table to load', async () => {
                        const frameforcbox = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
                        const mimGridTable = frameforcbox.locator('#gbox_mimGrid .ui-jqgrid-bdiv table tbody tr:not(.jqgfirstrow)');
                        await mimGridTable.first().waitFor({
                            state: 'visible',
                            timeout: 500000
                        });
                    });

                    await test.step('update the column filter in master item', async () => {
                        await qs.updtFltrByOnMstrItmGrd(filterField, filterBy, 'Master Items');
                        await qs.fltrByColOnMstrItmGrd(filterField, filterValue, 'Master Items');
                    });

                    await test.step('click on checkbox', async () => {
                        await advui.clkOnCheckboxFrmList(itmsToCopy);
                    });

                    await test.step('click on copy master item button', async () => {
                        await qs.clckOnCopyMstrItmsBtn(itmsToCopy);
                    });

                    const mastrItmData = await test.step('fetch selected master item data', async () => {
                        return await qs.fetchSelectedMasterItemData(itmsToCopy);
                    });

                    await test.step('navigate to edit quote grid', async () => {
                        await advui.gotoChevron(goToEditQuoteGridChevronName);
                        await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
                    });

                    await test.step('update records per page and select all rows', async () => {
                        await advui.updtRcrdsPerPage(500);
                        await advui.selectAllRows();
                    });

                    await test.step('validate copied master items match', async () => {
                        const allItms = await advui.countAllItemsInGrid();
                        const qtItmData = await advui.getRowValuesFromEQG(allItms);
                        const { isValid, htmlReport } = await qs.validateAndReportMismatches(mastrItmData, qtItmData, 'Part Number');
                        if (!isValid) {
                            console.log('Validation failed. See mismatch report:');
                            throw new Error(htmlReport);
                        } else {
                            console.log("All Master Items were copied with correct values");
                        }
                    });
                }
            );
        });
    }
});
