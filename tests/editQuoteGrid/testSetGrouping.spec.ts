import { test, chromium, BrowserContext, expect, Page } from "@playwright/test";
import { QuoteService } from "../../services/quote-service";
import { BomService } from "../../services/bom-service";
import { AdvanceUi } from "../../utils/advUi";
import { QUOTE_TEST_DATA } from "../../assets/test_data_constants";
import {selectAllButtonLocator, deleteButtonLocator, goToEditQuoteGridChevronName, goToCopyBoMItems, setGroupingButtonLocator, goToSelectBomsChevronName } from "../../pages/editQuoteGridPage"
import { getExcelData} from "../../utils/excelReader";
import { TestingUtils } from "../../utils/testingUtils";
// Centralized env resolver: reads .env locally and SF_VARS JSON in CI without duplicating parse/fallback logic
import { getRequiredEnv } from "../../utils/envConfig";

test.describe("Tests on Set Grouping", () => {
    // let browser: Browser;
    const retries = 6; //number of retries for checking if Quote is editable
    // const sheetName = process.env.SET_GROUPING_SHEET_NAME;
    // if (!sheetName) {
    //   throw new Error(
    //     "SET_GROUPING_SHEET_NAME is not set. Provide it via .env locally or a Bitbucket variable in CI."
    //   );
    // } 
    // In CI, Bitbucket packs the `vars` block into a single JSON string: process.env.SF_VARS
    // const sfVars = process.env.SF_VARS ? JSON.parse(process.env.SF_VARS) : {};
    // Local runs read the direct .env variable; CI runs read it from inside SF_VARS
    // const sheetName = process.env.SET_GROUPING_SHEET_NAME || sfVars.SET_GROUPING_SHEET_NAME;
    // if (!sheetName) {
    //   throw new Error(
    //     "SET_GROUPING_SHEET_NAME is not set. Provide it via .env locally or inside SF_VARS (Bitbucket vars) in CI."
    //   );
    // }
    // Replaces inline SF_VARS parsing above â€” same behavior via shared utils/envConfig.ts
    const sheetName = getRequiredEnv("SET_GROUPING_SHEET_NAME");
    const SetGroupingsheet= getExcelData(QUOTE_TEST_DATA, sheetName); 
    const testDataMap = SetGroupingsheet.getTestDataMap();
    // console.log("SF_VARS raw:", process.env.SF_VARS);
     console.log("Resolved sheetName:", sheetName);
    // test.beforeAll(async ({page}) => {
    //         await page.goto("/lightning/page/home");             
    // });

    // test.afterAll(async () => {
    //     if (context) {
    //     await context.close();
    //     }
    // });

    test.beforeEach(async ({page}, testInfo) => {
        // This runs before each test   
        test.setTimeout(300000);  
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
        // const quoteId = await quote.findQuoteId();
        await quote.goToRecord(quoteId); 
       await page.getByRole('tab', { name: 'Details', exact: true }).isVisible({timeout:20000});   // Waiting till Details tab is loaded on the Quote Page
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

    /** Checking that Grouping window opens successfully after clicking on 'Set Grouping' button */
    test('[T125] Test Set Grouping Button opens Set Grouping Window', { tag:  ["@sanity",  "@soupra", "@setGrouping"] }, async ({page}, testInfo) => {

        if(!page) throw new Error("Page not initialised on Before all");
        const advui = new AdvanceUi(page);
        testInfo.setTimeout(900000);

        await test.step('click Set Grouping button', async () => {
            await advui.clickOnButton(setGroupingButtonLocator);
        });

        await test.step('assert grouping toolbar is visible', async () => {
            const iframe = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
            const grpingToolBar = await iframe.locator('div[class="groupingTreeToolbar"]');
            await expect(grpingToolBar).toBeVisible();
        });
    });

    /** In this test case we are creating a new Box and renaming it and validating that the name is correctly shown on EQG after saving on set grouping window */
    test('[T127] Creating Box and Checking the Box position is correct on EQG after saving on Set Grouping', { tag:  ["@sanity",  "@soupra", "@setGrouping"] }, async ({page}, testInfo) => {
        
        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const quoteId = row["Quote Id"];
        const boxName = String(row["Newly Created Element Name"]);
        const renameTxt = String(row["Rename Text"]);
        const eleName = String(row["Select Element"]);
        const expandBox = String(row["Expand Box"]);
        const itmTomove = String(row["Item to move"]);

        const advui = new AdvanceUi(page);
        const qs = new QuoteService(page);
        testInfo.setTimeout(90000);

        await test.step('wait for Part Number column and capture summary before set grouping', async () => {
            await page.getByRole('columnheader', { name: 'Part Number' }).isVisible({timeout:10000});
        });

        const summBfrSetGrouping = await test.step('get EQG summary pricing before set grouping', async () => {
            return await advui.getPricingFromEQGSummary();
        });

        await test.step('open Set Grouping window', async () => {
            await advui.clickOnButton(setGroupingButtonLocator);
            const iframe = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
            const grpingToolBar = await iframe.locator('div[class="groupingTreeToolbar"]');
            await expect(grpingToolBar).toBeVisible();
        });

        const itemPartNo = await test.step('create box, rename, expand and drag item', async () => {
            await advui.clckOnUnlockBoxes();
            await advui.clckOnCreateBoxBtn(boxName);
            await advui.selectElementInSetGrping(eleName);
            await advui.clckOnRenameBtnAndRename(renameTxt);
            await advui.expandBoxesInSetGrouping(expandBox);
            const iframe = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
            const itemLoc = await iframe.locator(`a[href="#"][id="${itmTomove}_anchor"]`);
            const itemPartNo = await itemLoc.textContent();
            const dragToLoc = await iframe.getByRole('treeitem', { name: renameTxt});
            await advui.dragAndDropInsideElement(itemLoc, dragToLoc);
            return itemPartNo;
        });

        await test.step('save set grouping', async () => {
            await advui.clickOnSaveInSetGrouping();
        });

        await test.step('verify item and box position and totals', async () => {
            await qs.verifyItemAddedOnCorrectPosition(itemPartNo, 'first');
            await qs.verifyBoxAddedOnCorrectPosition(renameTxt, 'first');
            await qs.checkBoxTotalIsCorrect(renameTxt);
            await qs.validateSortOrder(quoteId);
        });

        await test.step('assert EQG summary pricing unchanged', async () => {
            const summAfterSetGrouping = await advui.getPricingFromEQGSummary();
            expect(summAfterSetGrouping).toStrictEqual(summBfrSetGrouping);
            console.log('Edit Quote Grid Summary Prices before and after Set grouping was same');
        });
    });

    /** We are checking that a group can be renamed and a the Group name is showing correctly on EQG Page after saving on set grouping window */
    test('[T129] Checking Renaming Function on Group with Unlock Checkbox', { tag:  ["@sanity",  "@soupra", "@setGrouping"] }, async ({page}, testInfo) => {
        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const quoteId = row["Quote Id"];
        const grpName = String(row["Newly Created Element Name"]);
        const renameTxt = String(row["Rename Text"]);
        const eleName = String(row["Select Element"]);
        const boxToMove = String(row["Box to move"]);

        const advui = new AdvanceUi(page);
        const qs = new QuoteService(page);
        testInfo.setTimeout(900000);

        const summBfrSetGrouping = await test.step('get EQG summary pricing before set grouping', async () => {
            return await advui.getPricingFromEQGSummary();
        });

        await test.step('open Set Grouping window', async () => {
            await advui.clickOnButton(setGroupingButtonLocator);
            const iframe = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
            const grpingToolBar = await iframe.locator('div[class="groupingTreeToolbar"]');
            await expect(grpingToolBar).toBeVisible();
        });

        const boxPartNo = await test.step('create group, rename and drag box', async () => {
            await advui.clckOnUnlockBoxes();
            await advui.clckOnCreateGroupBtn(grpName);
            await advui.selectElementInSetGrping(eleName);
            await advui.clckOnRenameBtnAndRename(renameTxt);
            const iframe = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
            const itemLoc = await iframe.locator(`a[href="#"][id="${boxToMove}_anchor"]`);
            const boxPartNo = await itemLoc.textContent();
            const dragToLoc = await iframe.getByRole('link', { name: new RegExp(`${renameTxt}$`)});
            await advui.dragAndDropInsideElement(itemLoc, dragToLoc);
            return boxPartNo;
        });

        await test.step('save set grouping', async () => {
            await advui.clickOnSaveInSetGrouping();
        });

        await test.step('verify box under group and totals', async () => {
            await qs.verifyBoxAddedToCorrectGroup(renameTxt, boxPartNo);
            await qs.checkGrpTotalIsCorrect(renameTxt);
            await qs.validateSortOrder(quoteId);
        });

        await test.step('assert EQG summary pricing unchanged', async () => {
            const summAfterSetGrouping = await advui.getPricingFromEQGSummary();
            expect(summAfterSetGrouping).toStrictEqual(summBfrSetGrouping);
            console.log('Edit Quote Grid Summary Prices before and after Set grouping was same');
        });
    });

    /** In this test we are trying to Rename an item, a box and a Group while unlock boxes is unchecked and checking the validation message
     * Also, when unlock checkboxes is checked we are renaming a Group and a Box we are checking that the name is saved successfully and shown on EQG
     */
    test('[T132] Testing Rename button on Set Grouping and checking validations', { tag:  ["@sanity",  "@soupra", "@setGrouping"] }, async ({page}, testInfo) => {
        if(!page) throw new Error("Page not initialised on Before all");
        const row = (testInfo as any).row;
        const tst = new TestingUtils(page);
        const renameTxt = JSON.parse(row["Rename Text"]);
        const expandBox = String(row["Expand Box"]);
        const eleName = JSON.parse(row["Select Element"]);
        const boxToMove = String(row["Box to move"]);
        
        const advui = new AdvanceUi(page);
        const qs = new QuoteService(page);
        testInfo.setTimeout(900000);

        await test.step('open Set Grouping window', async () => {
            await advui.clickOnButton(setGroupingButtonLocator);
            const iframe = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
            const grpingToolBar = await iframe.locator('div[class="groupingTreeToolbar"]');
            await expect(grpingToolBar).toBeVisible();
        });

        await test.step('assert locked rename validation for item', async () => {
            await advui.expandBoxesInSetGrouping(expandBox);
            await advui.selectElementInSetGrping(eleName[0]);
            await advui.clckOnRenameBtnOnSetGrpng();
            expect(await tst.verifyNotificationMessage('Selected group is locked')).toBe(true);
            await advui.selectElementInSetGrping(eleName[0]);
        });

        // await test.step('assert locked rename validation for box then rename after unlock', async () => {
        //     await advui.selectElementInSetGrping(eleName[1]);
        //     await advui.clckOnRenameBtnOnSetGrpng();
        //     expect(await tst.verifyNotificationMessage('Selected group is locked')).toBe(true);
        //     await advui.clckOnUnlockBoxes();
        //     await advui.expandBoxesInSetGrouping(expandBox);
        //     await advui.clckOnRenameBtnAndRename(renameTxt[1]);
        //     expect(await advui.elementRenamed(renameTxt[1])).toBe(true);
        // });

        await test.step('create group, drag box, rename group and save', async () => {
            await advui.clckOnCreateGroupBtn();
            const iframe = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
            const itemLoc = await iframe.locator(`a[href="#"][id="${boxToMove}_anchor"]`);
            const dragToLoc = await iframe.getByRole('link', { name: new RegExp(`${eleName[2]}$`)});
            await advui.dragAndDropInsideElement(itemLoc, dragToLoc);
            await advui.selectElementInSetGrping(eleName[2]);
            await advui.clckOnRenameBtnAndRename(renameTxt[2]);
            expect(await advui.elementRenamed(renameTxt[2])).toBe(true);
            await advui.clickOnSaveInSetGrouping();
        });

        await test.step('assert renamed group present on EQG', async () => {
            expect(await qs.returnIndexOfElement('group', renameTxt[2])).not.toBe(-1);
        });
    });

    /** This test is regarding checking the validation when trying to delete an Item, a Box, a Group on Set Grouping Window
     * We are also checking if we can delete an Empty Group
     */
    test('[T134] Testing Validations on Deletion and Delete functionality', { tag:  ["@sanity",  "@soupra", "@setGrouping"] }, async ({page}, testInfo) => {
        if(!page) throw new Error("Page not initialised on Before all");
        const tst = new TestingUtils(page);
        const row = (testInfo as any).row;
        const grpName = String(row["Newly Created Element Name"]);
        const expandBox = String(row["Expand Box"]);
        const eleName = JSON.parse(row["Select Element"]);
        const boxToMove = String(row["Box to move"]);
        const advui = new AdvanceUi(page);
        const qs = new QuoteService(page);
        testInfo.setTimeout(900000);

        await test.step('open Set Grouping window', async () => {
            await advui.clickOnButton(setGroupingButtonLocator);
            const iframe = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
            const grpingToolBar = await iframe.locator('div[class="groupingTreeToolbar"]');
            await expect(grpingToolBar).toBeVisible();
        });

        await test.step('assert delete without selection validation', async () => {
            await advui.clckOnUnlockBoxes();
            await advui.clckOnCreateGroupBtn();
            await advui.clckOnDeleteBtnOnSetGrpng();
            expect(await tst.verifyNotificationMessage('No row selected')).toBe(true);
            await page.waitForTimeout(5000);
        });

        await test.step('assert cannot delete non-empty group', async () => {
            const iframe = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
            const itemLoc = await iframe.locator(`a[href="#"][id="${boxToMove}_anchor"]`);
            const dragToLoc = await iframe.getByRole('link', { name: new RegExp(`${eleName[1]}$`)});
            await advui.dragAndDropInsideElement(itemLoc, dragToLoc);
            await advui.selectElementInSetGrping(eleName[1]);
            await advui.clckOnDeleteBtnOnSetGrpng();
            expect(await tst.verifyNotificationMessage('You can only delete empty groups.')).toBe(true);
            await advui.selectElementInSetGrping(eleName[1]);
            await page.waitForTimeout(5000);
        });

        // await test.step('assert cannot delete box', async () => {
        //     await advui.selectElementInSetGrping(eleName[2]);
        //     await advui.clckOnDeleteBtnOnSetGrpng();
        //     expect(await tst.verifyNotificationMessage('You can only delete empty groups.')).toBe(true);
        //     await advui.selectElementInSetGrping(eleName[2]);
        //     await page.waitForTimeout(5000);
        // });

        await test.step('assert cannot delete item', async () => {
            await advui.expandBoxesInSetGrouping(expandBox);
            await advui.selectElementInSetGrping(eleName[3]);
            await advui.clckOnDeleteBtnOnSetGrpng();
            expect(await tst.verifyNotificationMessage('You can only delete empty groups.')).toBe(true);
            await advui.selectElementInSetGrping(eleName[3]);
            await page.waitForTimeout(5000);
        });

        await test.step('delete empty group, save and assert absent on EQG', async () => {
            await advui.clckOnCreateGroupBtn(grpName);
            await advui.selectElementInSetGrping(grpName);
            await advui.clckOnDeleteBtnOnSetGrpng();
            await advui.clickOnSaveInSetGrouping();
            const allData = await qs.extractEQGTableData();
            expect(allData).toEqual(expect.not.arrayContaining([expect.stringContaining(grpName)]));
        });
    });

    // /** On this test we are Copying a BoM and then creating a Group and adding a Box under it
    //  * After that we are adding a BoM and checking that the previous Grouping is Intact 
    //  */
    // test('[T202] Testing Group Arrangement keeps same after adding a BoM', { tag:  ["@sanity", "@setGrouping"] }, async ({page}, testInfo) => {
    //     if(!page) throw new Error("Page not initialised on Before all");
    //     // Initialising Test Data
    //     const row = (testInfo as any).row; // Getting the Json Row Values
    //     const bomToCopy = String(row["BoM to Copy for test"]);
    //     const bomSrc = String(row["BoM Source for test"]);
    //     const grpName = String(row["Newly Created Element Name"]);
    //     const renameTxt = String(row["Rename Text"]);
    //     const eleName = String(row["Select Element"]);
    //     const boxToMove = String(row["Box to move"]);

    //     const advui = new AdvanceUi(page);
    //     const qs = new QuoteService(page);
    //     testInfo.setTimeout(900000);
    //     await advui.clickOnButton(setGroupingButtonLocator);
    //     const iframe = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
    //     const grpingToolBar = await iframe.locator('div[class="groupingTreeToolbar"]');
    //     await expect(grpingToolBar).toBeVisible();
    //     await advui.clckOnUnlockBoxes();
    //     await advui.clckOnCreateGroupBtn(grpName);
    //     const itemLoc = await iframe.locator(`a[href="#"][id="${boxToMove}_anchor"]`);            // Box to be dragged
    //     const boxPartNo = await itemLoc.textContent();
    //     const dragToLoc = await iframe.getByRole('link', { name: new RegExp(`${eleName}$`)});     // Dragging box to the renamed Group
    //     await advui.dragAndDropInsideElement(itemLoc, dragToLoc);                                 // Performing Drag and drop operation
    //     await advui.clickOnSaveInSetGrouping();                                                   // Saving the Grouping setup on Grid
    //     await qs.verifyBoxAddedToCorrectGroup(renameTxt, boxPartNo);                              // Verifying if the Box was added correctly on correct position
    //     const allDataRows = await qs.extractEQGTableData();  
    //     await advui.gotoChevron(goToSelectBomsChevronName);   
    //     await qs.selectBomAndCopyOnly(bomSrc, bomToCopy);
    //     await qs.quickAddToQuote();
    //     await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);  
    //     const allDataRowsAftrCopy = await qs.extractEQGTableData();  
    //     await qs.verifyGroupingIsIntact(allDataRows,allDataRowsAftrCopy);
    // });
});
