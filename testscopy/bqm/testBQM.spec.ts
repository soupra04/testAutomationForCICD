import { test, expect, BrowserContext, Page } from "@playwright/test";
import { BQMService } from "../../services/bqm-service";
import { QuoteService } from "../../services/quote-service";
import { SalesforceUtils } from "../../utils/sfUtils";

test.describe("BQM Job Tests", () => {
    let context: BrowserContext | undefined;
    let page: Page | undefined; 
    
    test.beforeEach(async ({ page }, testInfo) => {
        testInfo.setTimeout(100000);   
        if (!page) throw new Error("Page not initialized in beforeAll!");     
        await page.waitForTimeout(10000); // Wait for the page to load completely
    });

    test(
        "[TXX] Verify Batch Queue Manager Page Loads Correctly",
        { tag: "@bqm" },
        async ({ page }) => {
            test.setTimeout(100000);
            const sf = new SalesforceUtils(page);
            const bqmService = new BQMService(page,sf);            
            await bqmService.openAndVerifyBQMPage();
        }
    );

    test(
        "[TXX] Verify Correct BQM job is getting executed for Copy Boms to Quote",
        { tag: "@bqm" },
        async ({ page }) => {
            test.setTimeout(100000);            
            const quoteService = new QuoteService(page);            
            await quoteService.gotoCopyBomItemsToQuote();        
            //[TODO] Verify and search the BQM job in the BQM page and validate

            });
});