import { test, chromium, BrowserContext, expect, Page } from "@playwright/test";
import { QuoteService } from "../../services/quote-service";
import { BomService } from "../../services/bom-service";
import { OpportunityPage } from "../../pages/opportunityPage";
import { AdvanceUi } from "../../utils/advUi";
import { QUOTE_TEST_DATA } from "../../assets/test_data_constants";
import {selectAllButtonLocator, deleteButtonLocator, goToEditQuoteGridChevronName, goToCopyBoMItems } from "../../pages/editQuoteGridPage"
import * as XLSX from "xlsx";
import { TestingUtils } from "../../utils/testingUtils";
import { getExcelData} from "../../utils/excelReader";
// Centralized env resolver: reads .env locally and SF_VARS JSON in CI without duplicating parse/fallback logic
import { getRequiredEnv } from "../../utils/envConfig";

test.describe("Tests on Split Boxes", () => {
    // let browser: Browser;
    const retries = 6; //number of retries for checking if Quote is editable
    // const SplitSheetName = process.env.SPLIT_SHEET_NAME || '';
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const SplitSheetName = getRequiredEnv("SPLIT_SHEET_NAME");
    const SplitExcelsheet= getExcelData(QUOTE_TEST_DATA, SplitSheetName); 
    const testDataMap = SplitExcelsheet.getTestDataMap();
    console.log("Resolved sheetName:", SplitSheetName);

    // test.beforeAll(async ({page}) => {
    //         await page.goto("/lightning/page/home");             
    // });

    test.beforeEach(async ({page}, testInfo) => {
        // This runs before each test   
        test.setTimeout(100000);  
        // Extract test number from title like "[T33] Basic Split Box check"
        const match = testInfo.title.match(/\[T(\d+)\]/);
        if (!match) throw new Error(`Test title does not contain a valid Zephyr Test Number: ${testInfo.title}`);

        const testNo = `T${match[1]}`;
        const row = testDataMap[testNo];
        if (!row) throw new Error(`No data found for ${testNo}`);
        // Save for later use in the test
        (testInfo as any).row = row;

        // Initialising values from Json Data
        const quoteId = row["Quote Id"];
        const bomSource = row["BoM Source"];
        const bomToCopy = row["BoMs to Copy"];                
   
        const advui = new AdvanceUi(page);      
        const quote = new QuoteService(page);
        const bomService = new BomService(page);   
        // const quoteId = await quote.findQuoteId();
        await quote.goToRecord(quoteId); 
        await quote.goToSelectBoMsPage();
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

    test.afterEach(async ({page}) => {
        // This Runs After each test
        if (!page) throw new Error("Page not initialized in beforeAll!");        
        const advui = new AdvanceUi(page); 
        await advui.gotoChevron(goToCopyBoMItems);
        await advui.refreshChevronIfNotEditable(retries, goToCopyBoMItems); 
        await advui.clickOnButton(selectAllButtonLocator);
        await advui.clickOnButton(deleteButtonLocator);
        await advui.clickYesOnconfirmationPopUp();
    });

    test('[T3033] Check if Split Box icon is not visible if Box Qty = 1', { tag:  ["@sanity","@soupra", "@splitbox"] }, async ({page}, testInfo) => {
        
        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const boxSortValue = row["Box Sort Value"];
        const boxQty = row["Box Qty"].toString();        
        const advui = new AdvanceUi(page);
        testInfo.setTimeout(90000);

        await test.step('set box qty', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
        });

        await test.step('assert split icon is not present', async () => {
            const iconAvailable = await advui.checkIfSplitButtonPresent(boxSortValue);
            expect(iconAvailable).toBeFalsy();
        });
    });

    test('[T3032] if Split Box icon is visible if Box Qty = 2',{ tag:  ["@sanity",  "@soupra", "@splitbox"] }, async ({page}, testInfo) => {
        
        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const boxSortValue = row["Box Sort Value"];
        const boxQty = row["Box Qty"].toString();
        const advui = new AdvanceUi(page);
        testInfo.setTimeout(90000);

        await test.step('set box qty', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
        });

        await test.step('assert split icon is present', async () => {
            const iconAvailable = await advui.checkIfSplitButtonPresent(boxSortValue);
            expect(iconAvailable).toBeTruthy();
        });
    });   
     
    test('[T3034] Verify if Split Box is created after Split operation (Box Qty = 2)', { tag:  ["@sanity","@soupra", "@splitbox"] }, async ({page}, testInfo) => {

        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const boxSortValue = row["Box Sort Value"];
        const boxQty = row["Box Qty"].toString();
        const advui = new AdvanceUi(page);
        testInfo.setTimeout(150000);

        await test.step('set box qty', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
        });

        await test.step('perform split and apply', async () => {
            await advui.clickOnSplitButton(boxSortValue);
            await advui.clickPlusIcon(boxSortValue);
            await advui.clickUiButtonInSplitBox('Apply');
            await page.waitForTimeout(5000);
        });

        await test.step('validate number of boxes after split', async () => {
            await advui.validateNumberOfBoxes(boxQty);
        });
    }); 

    test('[T3037] Verify if Box Qty Can be Increased in Split Box Header that is created after Split',{ tag:  ["@sanity","@soupra", "@splitbox"] }, async ({page}, testInfo) => {

        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const boxSortValue = row["Box Sort Value"];
        const boxQty = row["Box Qty"].toString();
        const noOfBoxesToCreate = row["No of Boxes to create"];
        const splitBoxQty = row["Qty to set on Split Box"].toString();
        const advui = new AdvanceUi(page);
        testInfo.setTimeout(150000);

        await test.step('set box qty', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
        });

        await test.step('create split boxes and apply', async () => {
            await advui.clickOnSplitButton(boxSortValue);
            await advui.createNewBoxes(noOfBoxesToCreate, boxSortValue);
            await advui.clickUiButtonInSplitBox('Apply');
            await page.waitForTimeout(5000);
        });

        await test.step('increase split box qty and validate', async () => {
            await advui.updateBoxQtyOnSplitBox(splitBoxQty);
            await advui.validateSplitBoxQtyOnGrid(splitBoxQty);
        });
    }); 

    test('[T3036] Verify if Box Qty Can be decreased in Split Box Header that is created after Split',{ tag:  ["@sanity","@soupra", "@splitbox"] }, async ({page}, testInfo) => {

        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const boxSortValue = row["Box Sort Value"];
        const boxQty = row["Box Qty"].toString();
        const splitBoxQtyWindow = row["Set Split Box Qty on Window"];
        const splitBoxQty = row["Qty to set on Split Box"].toString();
        const advui = new AdvanceUi(page);
        testInfo.setTimeout(150000);

        await test.step('set box qty', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
        });

        await test.step('split with window qty and apply', async () => {
            await advui.clickOnSplitButton(boxSortValue);
            await advui.clickPlusIcon(boxSortValue);
            await advui.setNewSplitBoxQtyOnWindow(splitBoxQtyWindow);
            await advui.clickUiButtonInSplitBox('Apply');
            await page.waitForTimeout(5000);
            await advui.validateSplitBoxQtyOnGrid(splitBoxQtyWindow);
        });

        await test.step('decrease split box qty and validate', async () => {
            await advui.updateBoxQtyOnSplitBox(splitBoxQty);
            await advui.validateSplitBoxQtyOnGrid(splitBoxQty);
        });
    }); 

    test('[T3035] Verify if Spliting can be done in Split Box that is created after Split',{ tag:  ["@sanity","@soupra", "@splitbox"] }, async ({page}, testInfo) => {

        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const boxSortValue = row["Box Sort Value"];
        const boxQty = row["Box Qty"].toString();
        const noOfBoxesToCreate = row["No of Boxes to create"];
        const splitBoxQty = row["Qty to set on Split Box"].toString();
        const advui = new AdvanceUi(page);
        testInfo.setTimeout(150000);

        await test.step('set box qty', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
        });

        await test.step('create split boxes, apply and update qty', async () => {
            await advui.clickOnSplitButton(boxSortValue);
            await advui.createNewBoxes(noOfBoxesToCreate, boxSortValue);
            await advui.clickUiButtonInSplitBox('Apply');
            await page.waitForTimeout(5000);
            await advui.updateBoxQtyOnSplitBox(splitBoxQty);
            await advui.validateSplitBoxQtyOnGrid(splitBoxQty);
        });

        await test.step('assert split icon not found on clones', async () => {
            const check = await advui.checkIfSplitBoxIconFoundOnClones();
            expect(check).toBeFalsy();
        });
    }); 

    test('[T3038] Verify if Box Qty can be incresed on the Original Box after Split', { tag:  ["@sanity","@soupra", "@splitbox"] },async ({page}, testInfo) => {

        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const boxSortValue = row["Box Sort Value"];
        const boxQty = row["Box Qty"].toString();
        const noOfBoxesToCreate = row["No of Boxes to create"];
        const splitBoxQty = row["Qty to set on Split Box"].toString();
        const advui = new AdvanceUi(page);
        testInfo.setTimeout(150000);

        await test.step('set box qty', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
        });

        await test.step('create split boxes, apply and update split qty', async () => {
            await advui.clickOnSplitButton(boxSortValue);
            await advui.createNewBoxes(noOfBoxesToCreate, boxSortValue);
            await advui.clickUiButtonInSplitBox('Apply');
            await page.waitForTimeout(5000);
            await advui.updateBoxQtyOnSplitBox(splitBoxQty);
            await advui.validateSplitBoxQtyOnGrid(splitBoxQty);
        });

        await test.step('increase original box qty after split', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
        });
    }); 

    test('[T40] Verify if multiple boxes can be created with Split, where number of boxes does not exceed the Original box Qty', { tag:  ["@sanity","@soupra", "@splitbox"] }, async ({page}, testInfo) => {

        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const boxSortValue = row["Box Sort Value"];
        const boxQty = row["Box Qty"].toString();
        const noOfBoxesToCreate = row["No of Boxes to create"];
        const advui = new AdvanceUi(page);
        testInfo.setTimeout(150000);

        await test.step('set box qty', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
        });

        await test.step('create multiple split boxes and apply', async () => {
            await advui.clickOnSplitButton(boxSortValue);
            await advui.createNewBoxes(noOfBoxesToCreate, boxSortValue);
            await advui.clickUiButtonInSplitBox('Apply');
            await page.waitForTimeout(5000);
        });

        await test.step('validate number of boxes', async () => {
            await advui.validateNumberOfBoxes(boxQty);
        });
    }); 

    test('[T3920] Verify if Invalid Message is shown when giving Split Box Qty > Original Box Qty on Split Window', { tag:  ["@sanity","@soupra", "@splitbox"] },async ({page}, testInfo) => {

        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const boxSortValue = row["Box Sort Value"];
        const boxQty = row["Box Qty"].toString();
        const splitBoxQtyWindow = row["Set Split Box Qty on Window"];
        const advui = new AdvanceUi(page);
        testInfo.setTimeout(150000);

        await test.step('set box qty', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
        });

        await test.step('enter invalid split qty and assert invalid message', async () => {
            await advui.clickOnSplitButton(boxSortValue);
            await advui.clickPlusIcon(boxSortValue);
            await advui.setNewSplitBoxQtyOnWindow(splitBoxQtyWindow);
            const check = await advui.checkInvalidQtyInputOnWindowForSplit()
            expect(check).toBeTruthy();
        });
    });
    
    test('[T3936] Verify if All Boxes can be Merged successfully',{ tag:  ["@sanity","@soupra", "@splitbox"] }, async ({page}, testInfo) => {

        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const boxSortValue = row["Box Sort Value"];
        const boxQty = row["Box Qty"].toString();
        const noOfBoxesToCreate = row["No of Boxes to create"];
        const advui = new AdvanceUi(page);
        testInfo.setTimeout(150000);

        await test.step('set box qty', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
        });

        await test.step('create split boxes', async () => {
            await advui.clickOnSplitButton(boxSortValue);
            await advui.createNewBoxes(noOfBoxesToCreate, boxSortValue);
        });

        await test.step('merge all boxes and validate', async () => {
            await advui.clickDeleteButtonOnUIandValidateMerge(boxQty);
        });
    });

    test('[T3947] Verify if Pricing is correctly shown on Boxes after splitting is done', { tag:  ["@sanity","@soupra", "@splitbox"] },async ({page}, testInfo) => {

        if(!page) throw new Error("Page not initialised on Before all");
        const testutils = new TestingUtils(page);
        const row = (testInfo as any).row;
        const boxSortValue = row["Box Sort Value"];
        const boxQty = row["Box Qty"].toString();
        const splitBoxQtyWindow = row["Set Split Box Qty on Window"].toString();
        const boxNumber = parseInt(boxSortValue.slice(-2), 10);
        const splitBoxSortValue = `GSB-${(parseInt(boxSortValue.slice(-5)) + 1).toString().padStart(5, '0')}`;
        const advui = new AdvanceUi(page);
        const quote = new QuoteService(page);
        testInfo.setTimeout(250000);

        const orgData = await test.step('set box qty and capture original pricing', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, boxQty);
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, boxQty);
            return await advui.loadBoxHeaderDataFromEQG(boxNumber);
        });

        await test.step('perform split and apply', async () => {
            await advui.clickOnSplitButton(boxSortValue);
            await advui.clickPlusIcon(boxSortValue);
            await advui.setNewSplitBoxQtyOnWindow(splitBoxQtyWindow);
            await page.waitForTimeout(5000);
            await advui.clickUiButtonInSplitBox('Apply');
            await page.waitForTimeout(5000);
        });

        await test.step('validate box qtys and pricing after split', async () => {
            const orgBoxQtyAfrSplt = parseFloat(await advui.getBoxQtyValueOfBox(boxSortValue)|| '0');
            const splitBoxQty = parseFloat(await advui.getBoxQtyValueOfBox(splitBoxSortValue)|| '0');
            await advui.validateBoxQtyAfterSplit(orgBoxQtyAfrSplt, splitBoxQty, boxQty);
            const orgBoxData = await advui.loadBoxHeaderDataFromEQG(boxNumber);
            const splitData = await advui.loadBoxHeaderDataFromEQG((boxNumber+1));
            const exptdOrgBoxData = Object.fromEntries(Object.entries(orgData).map(([k, v]) => [k, (v / boxQty) * orgBoxQtyAfrSplt]));
            const exptdSpltBoxData = Object.fromEntries(Object.entries(orgData).map(([k, v]) => [k, (v / boxQty) * splitBoxQty]));
            
            const htmlErr = await quote.compareValues(orgBoxData, exptdOrgBoxData, "Original Box Data from Grid", "Expected Values"); 
            const orgBoxError = await testutils.parsedHTMLTable(htmlErr);
            const htmlErr2 = await quote.compareValues(splitData, exptdSpltBoxData, "Original Box Data from Grid", "Expected Values");
            const spltBoxError = await testutils.parsedHTMLTable(htmlErr2);
            if (orgBoxError || spltBoxError) {
                throw new Error(`Test did not pass:${orgBoxError} ${spltBoxError}`);
            }   
            else console.log('Test passed and Values of Box and Split Box are calculated as expected!');
        });
    });
    

});
