import { test, expect, Page } from "@playwright/test";
import { QuoteService } from "../../services/quote-service";
import { getExcelData } from "../../utils/excelReader";
import { TESTDATA_COPY_CLONE_QUOTE_DATA } from "../../assets/test_data_constants";
import { OpportunityPage } from "../../pages/opportunityPage";
import { AdvanceUi } from "../../utils/advUi";
import { goToEditQuoteGridChevronName, goToQuoteChevronName } from "../../pages/editQuoteGridPage";
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

test.describe("Save As New Quote", () => {
    const retries = 3;

    // const sheetName = process.env.SAVE_AS_NEW_QUOTE_SHEET_NAME || process.env.CREATE_NEW_VERSION_SHEET_NAME || "createNewVersion";
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const sheetName = getRequiredEnv("SAVE_AS_NEW_QUOTE_SHEET_NAME");
    const excel = getExcelData(
        TESTDATA_COPY_CLONE_QUOTE_DATA,
        sheetName
    );
    const rows = excel.getColumn("OpportunityID").length;
    console.log("Resolved sheetName:", sheetName);

    for (let rowNumber = 1; rowNumber <= rows; rowNumber++) {
        const bomName = excel.getCell(rowNumber, "Name").toString();
        const bomSource = excel.getCell(rowNumber, "BoM Source")?.toString() || "Opportunity BoMs";
        const oppId = excel.getCell(rowNumber, "OpportunityID");

        const quoteIds = { original: "", new: "" };

        test.describe(`Save As New Quote - row ${rowNumber}`, () => {
            test.describe.configure({ mode: "serial" });
            test.beforeEach(async ({ page }) => {
                test.setTimeout(300000);

                await page.goto(`${process.env.SF_INSTANCE_URL}/${oppId}`);
                await page.waitForLoadState("domcontentloaded");
                console.log(`Navigating to Opportunity: ${oppId}`);

                const opp = new OpportunityPage(page);
                await opp.handleIntermittentError();

                const quoteService = new QuoteService(page);
                await quoteService.createNewQuote();
                await quoteService.goToSelectBoMsPage();

                const advui = new AdvanceUi(page);
                const canContinue = await quoteService.selectBomAndCopy(bomSource, bomName);
                if (canContinue === true) {
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

            test.afterEach(async ({ page }) => {
                const cleanupErrors: string[] = [];

                for (const [label, quoteId] of [
                    ["new", quoteIds.new],
                    ["original", quoteIds.original],
                ] as const) {
                    if (!quoteId) {
                        continue;
                    }
                    try {
                        await deleteQuoteRecord(page, quoteId);
                    } catch (e) {
                        cleanupErrors.push(`${label} quote ${quoteId}: ${e}`);
                    }
                }

                quoteIds.original = "";
                quoteIds.new = "";

                if (cleanupErrors.length > 0) {
                    throw new Error(`afterEach quote cleanup failed for row ${rowNumber}:\n${cleanupErrors.join("\n")}`);
                }
            });

            test("Save As New Quote", { tag: ["@createNew/SaveAsNewQuote", "@sanity"] }, async ({ page }) => {
                const quoteService = new QuoteService(page);

                const originalQuoteNumber = await test.step('get original quote number from heading', async () => {
                    return await quoteService.getQuoteNumberFromHeading();
                });

                const { quoteNumber: newQuoteNumber, quoteId: newQuoteId } = await test.step('save as new quote', async () => {
                    return await quoteService.saveAsNewQuote();
                });
                quoteIds.new = newQuoteId;

                await test.step('assert new quote id differs from original', async () => {
                    expect(newQuoteId).not.toEqual(quoteIds.original);
                });

                await test.step('assert new quote number differs from original', async () => {
                    expect(newQuoteNumber).not.toEqual(originalQuoteNumber);
                });

                await test.step('assert new quote number matches QT- pattern', async () => {
                    expect(newQuoteNumber).toMatch(/^QT-/);
                });

                await test.step('verify pricing copied to new quote', async () => {
                    await quoteService.verifyQuoteHeaderPricingMatches(quoteIds.original, newQuoteId);
                });

                await test.step('log save as new quote success', async () => {
                    console.log(
                        `Save As New Quote succeeded: ${originalQuoteNumber} (${quoteIds.original}) -> ${newQuoteNumber} (${newQuoteId})`
                    );
                });
            });
        });
    }
});
