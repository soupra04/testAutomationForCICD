import { test, expect, Page } from "@playwright/test";
import { QuoteService } from "../../services/quote-service";
import { getExcelData } from "../../utils/excelReader";
import { TESTDATA_CREATE_QUOTE } from "../../assets/test_data_constants";
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

test.describe("Create Quote", () => {
    const retries = 3;

    // const sheetName = process.env.CREATE_QUOTE_SHEET_NAME || "createQuote";
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const sheetName = getRequiredEnv("CREATE_QUOTE_SHEET_NAME");
    const excel = getExcelData(
        TESTDATA_CREATE_QUOTE,
        sheetName
    );
    const rows = excel.getColumn("OpportunityID").length;
    console.log("Resolved sheetName:", sheetName);

    for (let rowNumber = 1; rowNumber <= rows; rowNumber++) {
        const bomName = excel.getCell(rowNumber, "Name").toString();
        const bomNames = bomName.split(",").map((s) => s.trim()).filter(Boolean);
        const bomSource = excel.getCell(rowNumber, "BoM Source")?.toString() || "Opportunity BoMs";
        const oppId = excel.getCell(rowNumber, "OpportunityID");
        const bomType = excel.getCell(rowNumber, "Bom Type")?.toString() || "Deal";

        const quoteId = { value: "" };
        const bomBaseline = { extListPrice: 0, extNetPrice: 0 };

        test.describe(`Create Quote - row ${rowNumber} (BoM: ${bomName})`, () => {
            test.describe.configure({ mode: "serial" });

            test.beforeEach(async ({ page }) => {
                test.setTimeout(300000);

                // Step 1 â€” Open the Opportunity
                await page.goto(`${process.env.SF_INSTANCE_URL}/${oppId}`);
                await page.waitForLoadState("domcontentloaded");
                console.log(`Navigating to Opportunity: ${oppId}`);

                const opp = new OpportunityPage(page);
                await opp.handleIntermittentError();

                // Step 2 â€” Create New Quote
                const quoteService = new QuoteService(page);
                await quoteService.createNewQuote();
                console.log(`New Quote created`);

                // Step 3 â€” Open Copy BoMs to Quote and select the BoM(s)
                await quoteService.goToSelectBoMsPage();
                let canContinue: boolean;
                if (bomNames.length > 1) {
                    await quoteService.selectMultipleBomsOnSelectorPage(bomSource, bomNames);
                    canContinue = true;
                    console.log(`Selected ${bomNames.length} BoMs: ${bomNames.join(", ")}`);
                } else {
                    canContinue = await quoteService.selectBomAndCopy(bomSource, bomNames[0]);
                }

                const advui = new AdvanceUi(page);

                if (canContinue === true) {
                    // Step 3 continued â€” Navigate to Copy BoM Items tab
                    await quoteService.gotoCopyBomItemsToQuote();
                    console.log(`Navigated to Copy BoM Items tab`);

                    // Step 4 â€” Record baseline pricing from Copy BoM Items tab
                    const pricing = await quoteService.getBoMHeaderPricingFromCopyBoMItemsTab();
                    bomBaseline.extListPrice = pricing.extListPrice;
                    bomBaseline.extNetPrice = pricing.extNetPrice;
                    console.log(`Baseline â€” Ext List Price: ${bomBaseline.extListPrice}, Ext Net Price: ${bomBaseline.extNetPrice}`);

                    // Step 6 â€” Select all items and copy to Quote
                    await advui.selectAllRows();
                    const itemCountStr = await quoteService.getItemsCountOnCopyBoMItemsTab();
                    const itemCount = parseInt(itemCountStr, 10);
                    console.log(`Selected BoM items count: ${itemCount}`);

                    await advui.clickOnCopyBoMItemsButton();

                    const copyErrors = await quoteService.checkNotificationAndValidate("copy", itemCount);
                    if (copyErrors.length > 0) {
                        throw new Error(`Copy BoM Items failed for row ${rowNumber}:\n${copyErrors.join("\n")}`);
                    }
                    console.log(`${itemCount} row(s) copied to Quote successfully`);

                    // Step 7 â€” Go to Edit Quote Grid, then Go to Quote
                    await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
                } else {
                    console.log(`BoM was already selected; items were deleted and re-copied during selectBomAndCopy`);
                    await advui.gotoChevron(goToEditQuoteGridChevronName);
                    await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
                }

                await advui.gotoChevron(goToQuoteChevronName);
                await quoteService.waitForQuoteDetailsPageReady();
                quoteId.value = await quoteService.parseQuoteIdFromUrl();
                console.log(`Quote ID: ${quoteId.value}`);
            });

            test.afterEach(async ({ page }) => {
                if (!quoteId.value) return;
                try {
                    await deleteQuoteRecord(page, quoteId.value);
                } catch (e) {
                    console.error(`afterEach cleanup failed for quote ${quoteId.value}: ${e}`);
                    throw new Error(`afterEach quote cleanup failed for row ${rowNumber}: quote ${quoteId.value}: ${e}`);
                } finally {
                    quoteId.value = "";
                    bomBaseline.extListPrice = 0;
                    bomBaseline.extNetPrice = 0;
                }
            });

            test(
                `[Row ${rowNumber}] Create Quote â€” validate BoM Type: ${bomType} | BoM: ${bomName}`,
                { tag: ["@createQuote", "@sanity"] },
                async ({ page }) => {
                    const quoteService = new QuoteService(page);
                    const advui = new AdvanceUi(page);

                    await test.step('wait for quote details page ready', async () => {
                        await quoteService.waitForQuoteDetailsPageReady();
                    });

                    await test.step('get quote number and assert QT- pattern', async () => {
                        const quoteNumber = await quoteService.getQuoteNumberFromHeading();
                        console.log(`Validating Quote: ${quoteNumber} (${quoteId.value})`);
                        expect(quoteNumber).toMatch(/^QT-/);
                    });

                    // Pricing validation is only meaningful when we actually ran through Copy BoM Items
                    const shouldSkipPricing = await test.step('check if baseline pricing was captured', async () => {
                        if (bomBaseline.extListPrice === 0 && bomBaseline.extNetPrice === 0) {
                            console.warn(`Skipping pricing assertion for row ${rowNumber}: baseline pricing was not captured (BoM pre-selected path).`);
                            return true;
                        }
                        return false;
                    });
                    if (shouldSkipPricing) {
                        return;
                    }

                    // Step 7 â€” Validate pricing in the Financials section
                    // Quote Total Extended List Price = sum of all BoM Item Extended List Prices
                    // Quote VAR Total Cost            = sum of all BoM Item Extended Net Prices
                    const { quoteTotalExtListPrice, quoteVarTotalCost } = await test.step('get quote header pricing from UI', async () => {
                        const quoteHeaderPricing = await advui.getPricingFromQuoteHeader();
                        const pricingUI = quoteHeaderPricing[0] ?? {};
                        console.log(`Quote Financials from UI:`, pricingUI);

                        const totalExtListPrice = parseFloat(pricingUI["Total Extended List Price"] ?? "0") || 0;
                        const varTotalCost = parseFloat(pricingUI["VAR Total Cost"] ?? "0") || 0;

                        console.log(`Quote Total Extended List Price (UI): ${totalExtListPrice}`);
                        console.log(`BoM Baseline Ext List Price:          ${bomBaseline.extListPrice}`);
                        console.log(`Quote VAR Total Cost (UI):            ${varTotalCost}`);
                        console.log(`BoM Baseline Ext Net Price:           ${bomBaseline.extNetPrice}`);

                        return { quoteTotalExtListPrice: totalExtListPrice, quoteVarTotalCost: varTotalCost };
                    });

                    await test.step('assert Total Extended List Price matches baseline', async () => {
                        expect(quoteTotalExtListPrice).toEqual(bomBaseline.extListPrice);
                    });

                    await test.step('assert VAR Total Cost matches baseline', async () => {
                        expect(quoteVarTotalCost).toEqual(bomBaseline.extNetPrice);
                    });

                    await test.step('log pricing validation success', async () => {
                        console.log(`Row ${rowNumber} pricing validation passed: ExtList=${quoteTotalExtListPrice}, VarCost=${quoteVarTotalCost}`);
                    });
                }
            );
        });
    }
});
