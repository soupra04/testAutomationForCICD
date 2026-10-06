import { test, expect, Page } from "@playwright/test";
import { QuoteService } from "../../services/quote-service";
import { getExcelData } from "../../utils/excelReader";
import { TESTDATA_COPY_CLONE_QUOTE_DATA } from "../../assets/test_data_constants";
import { OpportunityPage } from "../../pages/opportunityPage";
import { SalesforceUtils } from "../../utils/sfUtils";
import { AdvanceUi } from "../../utils/advUi";
import { goToEditQuoteGridChevronName, goToQuoteChevronName, selectAllButtonLocator } from "../../pages/editQuoteGridPage";
import { BomService } from "../../services/bom-service";
// Centralized env resolver: reads .env locally and SF_VARS JSON in CI without duplicating parse/fallback logic
import { getRequiredEnv } from "../../utils/envConfig";


async function deleteQuoteRecord(page: Page, quoteId: string): Promise<void> {
    const quoteService = new QuoteService(page);
    const advui = new AdvanceUi(page);

    console.log(`afterEach: deleting quote ${quoteId}`);
    await quoteService.goToRecord(quoteId);
    await quoteService.waitForQuoteDetailsPageReady();
    await advui.deleteQuote();
    const confirmDelete = page.getByRole("dialog").getByRole("button", { name: "Delete" });
    await confirmDelete.waitFor({ state: "visible", timeout: 30000 });
    await confirmDelete.click();
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 60000 });
    console.log(`afterEach: quote ${quoteId} deleted`);
}



test.describe("Create New Version", () => {
    const retries = 3;
    // const sheetName = process.env.CREATE_NEW_VERSION_SHEET_NAME || 'createNewVersion';
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const sheetName = getRequiredEnv("CREATE_NEW_VERSION_SHEET_NAME");
    const excel = getExcelData(
        TESTDATA_COPY_CLONE_QUOTE_DATA,
        sheetName
    );
    const rows = excel.getColumn('OpportunityID').length;
    console.log("Resolved sheetName:", sheetName);

    for (let rowNumber = 1; rowNumber <= rows; rowNumber++) {
        const bomName = excel.getCell(rowNumber, 'Name').toString();
        const bomSource = excel.getCell(rowNumber, 'BoM Source')?.toString() || 'Opportunity BoMs';
        const oppId = excel.getCell(rowNumber, 'OpportunityID');

        const quoteIds = { original: "", new: "" };
        let browserLogs: string[] = [];
        test.describe(`Create New Version - row ${rowNumber}`, () => {
            test.describe.configure({ mode: "serial" });
            test.beforeEach(async ({ page }) => {
                test.setTimeout(300000);
                browserLogs = [];
                const advui = new AdvanceUi(page);
                browserLogs = advui.getbrowserlogs();
                await page.goto(`${process.env.SF_INSTANCE_URL}/${oppId}`);
                await page.waitForLoadState("domcontentloaded");
                console.log(`Navigating to Opportunity: ${oppId}`);

                const opp = new OpportunityPage(page);
                await opp.handleIntermittentError();
                const quoteService = new QuoteService(page);
                await quoteService.createNewQuote();
                await quoteService.goToSelectBoMsPage();
                //const advui = new AdvanceUi(page);
                const canContinue = await quoteService.selectBomAndCopy(bomSource, bomName);
                if (canContinue == true) {
                    await quoteService.quickAddToQuote();
                    await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
                } else {
                    console.log("bom was selected so it got deleted from the copy boms page");
                    await advui.gotoChevron(goToEditQuoteGridChevronName);
                    await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
                }
                await advui.gotoChevron(goToQuoteChevronName);
                await quoteService.waitForQuoteDetailsPageReady();
                quoteIds.original = await quoteService.parseQuoteIdFromUrl();
                quoteIds.new = "";

            });

            test.afterEach(async ({ page }, testInfo) => {
                if (testInfo.status !== testInfo.expectedStatus && browserLogs.length > 0) {
                    await testInfo.attach(`browser-console-row-${rowNumber}`, {
                        body: browserLogs.join("\n"),
                        contentType: "text/plain",
                    });
                }

                const quoteIdToDelete = quoteIds.new || quoteIds.original;
                if (!quoteIdToDelete) {
                    return;
                }
            
                const label = quoteIds.new ? "new version" : "original";
            
                try {
                    await deleteQuoteRecord(page, quoteIdToDelete);
                } catch (e) {
                    throw new Error(
                        `afterEach quote cleanup failed for row ${rowNumber}: ${label} quote ${quoteIdToDelete}: ${e}`
                    );
                }
            
                quoteIds.original = "";
                quoteIds.new = "";
            });

            test("Create New Version", { tag: ["@createNew/SaveAsNewQuote", "@sanity"] }, async ({ page }) => {
                const quoteService = new QuoteService(page);

                const originalQuoteNumber = await test.step('get original quote number from heading', async () => {
                    return await quoteService.getQuoteNumberFromHeading();
                });
                const originalVersion = await test.step('get original quote version from header', async () => {
                    const originalVersionText = await quoteService.getQuoteVersionFromHeader();
                    console.log("originalVersion: ", originalVersionText);
                    expect(originalVersionText, "Quote Version should be visible on quote header").not.toBeNull();
                    return parseInt(originalVersionText!, 10);
                });


                const { quoteNumber: newQuoteNumber, quoteId: newQuoteId } = await test.step('create new version', async () => {
                    return await quoteService.createnewVersion();
                });
                quoteIds.new = newQuoteId;

                // Hard refresh new quote so highlight-panel Version is not stale from SPA navigation
                await test.step('hard refresh new quote before reading version', async () => {
                    await quoteService.goToRecord(newQuoteId);
                    await quoteService.waitForQuoteDetailsPageReady();
                });

                await test.step('assert new quote version is original + 1', async () => {
                    const newVersionText = await quoteService.getQuoteVersionFromHeader();
                    console.log("newVersionText: ", newVersionText);
                    expect(newVersionText, "Quote Version should be visible on new quote header").not.toBeNull();
                    expect(parseInt(newVersionText!, 10)).toEqual(originalVersion + 1);
                });

                await test.step('assert new quote id differs from original', async () => {
                    expect(newQuoteId).not.toEqual(quoteIds.original);
                });

                await test.step('assert new quote number equals original quote number', async () => {
                    expect(newQuoteNumber).toEqual(originalQuoteNumber);
                });

                await test.step('assert new quote number matches QT- pattern', async () => {
                    expect(newQuoteNumber).toMatch(/^QT-/);
                });

                await test.step('verify pricing copied to new quote', async () => {
                    await quoteService.verifyQuoteHeaderPricingMatches(quoteIds.original, newQuoteId);
                });

                await test.step('log create new version success', async () => {
                    console.log(`Create New Version succeeded: ${originalQuoteNumber} (${quoteIds.original}) -> ${newQuoteNumber} (${newQuoteId})`);
                });
            });
            // End of test

        }); // End of test.describe for row ${rowNumber}
    }
}); // End of test.describe 
