import { test, chromium, BrowserContext, expect, Page } from "@playwright/test";
import { QuoteService } from "../../services/quote-service";
import { BomService } from "../../services/bom-service";
import { AdvanceUi } from "../../utils/advUi";
import { QUOTE_TEST_DATA } from "../../assets/test_data_constants";
import { selectAllButtonLocator, deleteButtonLocator, goToEditQuoteGridChevronName, goToCopyBoMItems, cloneBoxesButtonLocator, goToCopyMasterItemsChevronName, setGroupingButtonLocator, goToSelectBomsChevronName, EditQuoteGridPage } from "../../pages/editQuoteGridPage"
import { getExcelData } from "../../utils/excelReader";
// Centralized env resolver: reads .env locally and SF_VARS JSON in CI without duplicating parse/fallback logic
import { getRequiredEnv } from "../../utils/envConfig";

test.describe("Tests on Clone Boxes", () => {
    // let browser: Browser;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let counter = 1;
    // const cloneSheet = process.env.CLONE_SHEET_NAME || '';
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const cloneSheet = getRequiredEnv("CLONE_SHEET_NAME");
    const retries = 6; //number of retries for checking if Quote is editable
    const CloneExcelsheet = getExcelData(QUOTE_TEST_DATA, cloneSheet);
    const testDataMap = CloneExcelsheet.getTestDataMap();
    console.log("Resolved sheetName:", cloneSheet);

    // test.beforeAll(async ({page}) => {
    //         await page.goto("/lightning/page/home");             
    // });

    test.afterAll(async () => {
        if (context) {
            await context.close();
        }
    });

    test.beforeEach(async ({ page }, testInfo) => {
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
        await quote.goToSelectBoMsPage();
        const canContinue = await quote.selectBomAndCopy(bomSource, bomToCopy);
        if (canContinue == true) {
            await quote.quickAddToQuote();
            await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
            counter++;
        } else {
            console.log("bom was selected so it got deleted from the copy boms page");
            await advui.gotoChevron(goToEditQuoteGridChevronName);
            await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
            counter++;
        }


    });

    test.afterEach(async ({ page }, testInfo) => {
        // This Runs After each test
        if (!page) throw new Error("Page not initialized in beforeAll!");
        const advui = new AdvanceUi(page);
        try {
            await advui.gotoChevron(goToCopyBoMItems);
            await advui.refreshChevronIfNotEditable(retries, goToCopyBoMItems);
            await advui.clickOnButton(selectAllButtonLocator);
            await advui.clickOnButton(deleteButtonLocator);
            await advui.clickYesOnconfirmationPopUp();
        } catch (e) {
            console.warn(`afterEach cleanup failed for ${testInfo.title}: ${e}`);
        }
    });

    test('[T3749] Check Qty Box is not disabled when MIT is added and Boxes can be cloned', { tag: ["@sanity", "@soupra", "@cloneBoxes"] }, async ({ page }, testInfo) => {

        if (!page) throw new Error("Page not initialised on Before all");
        // Initialising Test Data
        const row = (testInfo as any).row; // Getting the Json Row Values
        const quoteId = row["Quote Id"];
        const boxSortValue = row["Box Sort Value"];
        const boxNumber = parseInt(boxSortValue.slice(-2), 10);
        const dragTo = row["Drag Item Under"];
        const cloneCount = String(row["Clone count"]);
        const addClones = row["Add clones to new group"];
        const grpName = row["Group name"];
        const advui = new AdvanceUi(page);
        const qs = new QuoteService(page);
        testInfo.setTimeout(900000);

        await test.step('Go to Master Item Grid from given Quote', async () => {
            //------- Going to Master Item Grid and copying a Master Item with Part number CON and ItemType as Service
            await advui.gotoChevron(goToCopyMasterItemsChevronName);
            await qs.waitForMasterItemsGridPage();
        });

        await test.step('Apply Filters on search Criteria and search on Master Item Grid', async () => {
            await qs.fltrByColOnMstrItmGrd('Part_Number__c', "CON", 'Search Criteria');
            await qs.fltrByColOnMstrItmGrd('Item_Type_X__c', "Service", 'Search Criteria');
            await qs.clckSrchBtnOnMastrItmGrid();                                   // Searching relevant Master items after filtering
            await qs.waitForMasterItemGridDataLoad();                               // Waiting for data to load after searching
        });

        await test.step('Selecting the first Master Item and Copy the item', async () => {
            await advui.clkOnCheckboxFrmList("[1]");                                // Selecting first Row
            await qs.clckOnCopyMstrItmsBtn("[1]");                                  // Clicking Copy master Items button             
        });

        await test.step('Go Back to Edit Quote Grid and move MIT under last item of first Box', async () => {
            const mastrItmData = await qs.fetchSelectedMasterItemData("[1]");       // Getting the data of the selected Master Item 
            const partNumber = (mastrItmData?.[0]?.["Part Number"] ?? "").trim();   // Finding Part Number that was copied
            //------- Navigating back to Edit Quote Grid
            await advui.gotoChevron(goToEditQuoteGridChevronName);
            await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
            //------- Selecting Master Item and moving it to last item in first Box
            await advui.clickOnButton(setGroupingButtonLocator);
            const iframe = await page.locator('iframe[name^="vfFrameId_"]').contentFrame();
            await advui.clckOnUnlockBoxes();                                        // Clicking on Unlock boxes checkbox
            await advui.expandBoxesInSetGrouping("last");                           // Expanding the items under last box
            await advui.expandBoxesInSetGrouping("first");                          // Expanding the items under first box
            const mastrItmLoc = await iframe.getByRole('link', { name: `${partNumber}`, exact: true }); // Locator of Item to be dragged
            const dragToLoc = await iframe.locator(`a[href="#"][id="${dragTo}_anchor"]`);               // Locator of last item under first Box
            await advui.dragAndDropUnderItem(mastrItmLoc, dragToLoc);               // Dragging and dropping the copied Master Item under the last item of First Box
            await advui.clickOnSaveInSetGrouping();                                 // Saving the Set Grouping changes
            const rowNo = parseInt(dragTo.replace(/\D/g, ""), 10);                  // Extracting Row Number from DragToLocator
            await qs.verifyItemAddedOnCorrectPosition(partNumber, (rowNo + 1));       // Verifying if the Item was dragged to the Box successfully on correct position
        });

        await test.step('Changing Box Qty and cloning Boxes and verification after cloning', async () => {
            try {
                await advui.goToBoxQtyAndSetValue(boxSortValue, "4");
                await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, "4");
                // Before clone â€” from Quote Details (after MIT + qty change)
                await qs.goToRecord(quoteId);
                const quoteHeaderBeforeClone = await advui.getPricingFromQuoteHeader();
                await qs.goToEditQuoteGrid();
                await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
                await advui.selectBox(boxSortValue);
                const selectedBoxData = await advui.loadBoxHeaderDataFromEQG(boxNumber);
                const selectedPartNo = await advui.getBoxPartNumber(boxNumber);
                await advui.clickOnButton(cloneBoxesButtonLocator);
                await advui.updateCloneBoxesDetails(cloneCount, addClones, grpName);
                await advui.clickOnCloneBtn();
                await qs.verifyCloneBoxesAdded(selectedBoxData, cloneCount, selectedPartNo);
                if (grpName && grpName.trim() !== "") {
                    await qs.verifyCreatedGroups(grpName, cloneCount, selectedBoxData);
                }
                // After clone â€” from Quote Details
                await qs.goToRecord(quoteId);
                const summaryDataAftrClone = await advui.getPricingFromQuoteHeader();
                await qs.verifyEQGSummaryPricingAftrClone(quoteHeaderBeforeClone, summaryDataAftrClone, selectedBoxData, parseInt(cloneCount));
                await qs.validateSortOrder(quoteId);
            } finally {
                // Always return to Edit Quote Grid so afterEach cleanup can reach Copy BoM Items chevron
                await qs.goToEditQuoteGrid();
                await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
            }
        });
    });

    test('[T3752] Check the scenario after adding whole Bom to Quote', { tag: ["@sanity", "@soupra", "@cloneBoxes"] }, async ({ page }, testInfo) => {

        if (!page) throw new Error("Page not initialised on Before all");
        // Initialising Test Data
        const row = (testInfo as any).row; // Getting the Json Row Values
        const quoteId = row["Quote Id"];
        const boxSortValue = row["Box Sort Value"];
        const boxNumber = parseInt(boxSortValue.slice(-2), 10);
        const bom = String(row["BoM to copy"]);
        const opportunity = String(row["Opportunity"]);
        const cloneCount = String(row["Clone count"]);
        const addClones = row["Add clones to new group"];
        const grpName = row["Group name"];
        const advui = new AdvanceUi(page);
        const qs = new QuoteService(page);
        const bomSer = new BomService(page);
        testInfo.setTimeout(900000);

        await test.step('Cloning the First Box and verification after adding whole BoM using Copy BoM items to Quote', async () => {
            const summaryDataBeforeClone = await advui.getPricingFromEQGSummary();  // Getting the Summary Values from EQG (before clone)
            await advui.selectBox(boxSortValue);                                    // Selecting the Box to clone
            const selectedBoxData = await advui.loadBoxHeaderDataFromEQG(boxNumber);// Extracting Selected Box Header Pricing
            const selectedPartNo = await advui.getBoxPartNumber(boxNumber);         // Getting Part Number of the selected Box that will be cloned
            await advui.clickOnButton(cloneBoxesButtonLocator);                     // clicking on Clone Boxes button
            await advui.updateCloneBoxesDetails(cloneCount, addClones, grpName);    // Giving clone count and GroupName
            await advui.clickOnCloneBtn();
            await qs.verifyCloneBoxesAdded(selectedBoxData, cloneCount, selectedPartNo);
            if (grpName && grpName.trim() !== "") {
                await qs.verifyCreatedGroups(grpName, cloneCount, selectedBoxData);
            }
            const summaryDataAftrClone = await advui.getPricingFromEQGSummary();    // Getting the Summary Values from EQG (after clone)
            await qs.verifyEQGSummaryPricingAftrClone(summaryDataBeforeClone, summaryDataAftrClone, selectedBoxData, parseInt(cloneCount));
            await qs.validateSortOrder(quoteId);

            // Copy a whole BoM and then verification of Sort Order
            await advui.gotoChevron(goToSelectBomsChevronName);                                 // Navigating to the Select BoMs chevron
            await advui.refreshChevronIfNotEditable(retries, goToSelectBomsChevronName);
            await qs.selectBomAndCopy(opportunity, bom);                          // Selecting BoM given on input 
            await advui.gotoChevron(goToCopyBoMItems);                                          // Navigating to the Copy BoM Items chevron
            await advui.refreshChevronIfNotEditable(retries, goToCopyBoMItems);
            await advui.clickOnCheckboxByBoMId(bom);                                            // Selecting the whole BoM for copy
            await advui.clickOnCopyBoMItemsButton();
            await advui.gotoChevron(goToEditQuoteGridChevronName);
            await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
            await qs.validateSortOrder(quoteId);
            await qs.checkClonesAreIntact(selectedPartNo, parseInt(cloneCount));
        });

    });

    test('[T3753] Check scenario after adding whole Bom to Quote using "Quick Add to Quote', { tag: ["@sanity", "@soupra", "@cloneBoxes"] }, async ({ page }, testInfo) => {
        if (!page) throw new Error("Page not initialised on Before all");
        // Initialising Test Data
        const row = (testInfo as any).row; // Getting the Json Row Values
        const quoteId = row["Quote Id"];
        const boxSortValue = row["Box Sort Value"];
        const boxNumber = parseInt(boxSortValue.slice(-2), 10);
        const bom = String(row["BoM to copy"]);
        const opportunity = String(row["Opportunity"]);
        const cloneCount = String(row["Clone count"]);
        const addClones = row["Add clones to new group"];
        const grpName = row["Group name"];
        const advui = new AdvanceUi(page);
        const qs = new QuoteService(page);
        const bomSer = new BomService(page);
        testInfo.setTimeout(900000);

        await test.step('Cloning the First Box and then copying boms to Quote using Quick Add to Quote', async () => {
            const summaryDataBeforeClone = await advui.getPricingFromEQGSummary();  // Getting the Summary Values from EQG (before clone)
            await advui.selectBox(boxSortValue);                                    // Selecting the Box to clone
            const selectedBoxData = await advui.loadBoxHeaderDataFromEQG(boxNumber);// Extracting Selected Box Header Pricing
            const selectedPartNo = await advui.getBoxPartNumber(boxNumber);         // Getting Part Number of the selected Box that will be cloned
            await advui.clickOnButton(cloneBoxesButtonLocator);                     // clicking on Clone Boxes button
            await advui.updateCloneBoxesDetails(cloneCount, addClones, grpName);    // Giving clone count and GroupName
            await advui.clickOnCloneBtn();
            await qs.verifyCloneBoxesAdded(selectedBoxData, cloneCount, selectedPartNo);
            if (grpName && grpName.trim() !== "") {
                await qs.verifyCreatedGroups(grpName, cloneCount, selectedBoxData);
            }
            const summaryDataAftrClone = await advui.getPricingFromEQGSummary();    // Getting the Summary Values from EQG (after clone)
            await qs.verifyEQGSummaryPricingAftrClone(summaryDataBeforeClone, summaryDataAftrClone, selectedBoxData, parseInt(cloneCount));
            await qs.validateSortOrder(quoteId);
            // Selecting the BoM and doing Quick add to Quote
            await advui.gotoChevron(goToSelectBomsChevronName);                                 // Navigating to the Select BoMs chevron
            await advui.refreshChevronIfNotEditable(retries, goToSelectBomsChevronName);
            await qs.selectBomAndCopy(opportunity, bom);                          // Selecting BoM given on input
            await qs.quickAddToQuote();
            await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
            await qs.validateSortOrder(quoteId);
            await qs.checkClonesAreIntact(selectedPartNo, parseInt(cloneCount));
        });
    });

    test('[T3760] Check Clone Box functionality after Split Box functionality', { tag: ["@sanity", "@soupra", "@cloneBoxes"] }, async ({ page }, testInfo) => {

        if (!page) throw new Error("Page not initialised on Before all");
        // Initialising Test Data
        const row = (testInfo as any).row; // Getting the Json Row Values
        const quoteId = row["Quote Id"];
        const boxSortValue = row["Box Sort Value"];
        const boxNumber = parseInt(boxSortValue.slice(-2), 10);
        const cloneCount = String(row["Clone count"]);
        const addClones = row["Add clones to new group"];
        const grpName = row["Group name"];
        const advui = new AdvanceUi(page);
        const qs = new QuoteService(page);
        testInfo.setTimeout(900000);
        await test.step('Set Qty on box and perform split', async () => {
            await advui.goToBoxQtyAndSetValue(boxSortValue, "4");                   // Changing Box Qty on the Box to 4
            await advui.validateChangedOriginalBoxQtyOnGrid(boxSortValue, "4");     // Validating the changed Qty on Box
            await advui.clickOnSplitButton(boxSortValue);                           // Clicking on Split Box Icon in First Box
            await advui.clickPlusIcon(boxSortValue);
            await advui.setNewSplitBoxQtyOnWindow("3");
            await page.waitForTimeout(5000);
            await advui.clickUiButtonInSplitBox('Apply');
            await page.waitForTimeout(5000);                                        // waiting for split boxes to appear with boxes and autosave
            await advui.updateBoxQtyOnSplitBox("2");                                // Updating the Quantity on Split Box to 2
            await advui.validateSplitBoxQtyOnGrid("2");                             // Verifying the change
        });
        await test.step('Clone the Split box and verify', async () => {
            const summaryDataBeforeClone = await advui.getPricingFromEQGSummary();
            await advui.selectBox(`GSB-0000${boxNumber + 1}`);                        // Selecting the Next Box to clone as we did split on the first box
            const selectedBoxData = await advui.loadBoxHeaderDataFromEQG(boxNumber + 1);
            const selectedPartNo = await advui.getBoxPartNumber(boxNumber + 1);
            await advui.clickOnButton(cloneBoxesButtonLocator);                     // clicking on Clone Boxes button
            await advui.updateCloneBoxesDetails(cloneCount, addClones, grpName);
            await advui.clickOnCloneBtn();
            await qs.verifyCloneBoxesAdded(selectedBoxData, cloneCount, selectedPartNo);
            if (grpName && grpName.trim() !== "") {
                await qs.verifyCreatedGroups(grpName, cloneCount, selectedBoxData);
            }
            const summaryDataAftrClone = await advui.getPricingFromEQGSummary();
            await qs.verifyEQGSummaryPricingAftrClone(summaryDataBeforeClone, summaryDataAftrClone, selectedBoxData, parseInt(cloneCount));
            await qs.validateSortOrder(quoteId);
        });
    });

    test('[T3751] Check the Cloned Boxes when an Item or Box is deleted', { tag: ["@sanity", "@soupra", "@cloneBoxes"] }, async ({ page }, testInfo) => {
        if (!page) throw new Error("Page not initialised on Before all");
        // Initialising Test Data
        const row = (testInfo as any).row; // Getting the Json Row Values
        const quoteId = row["Quote Id"];
        const boxSortValue = row["Box Sort Value"];
        const boxNumber = parseInt(boxSortValue.slice(-2), 10);
        const cloneCount = String(row["Clone count"]);
        const addClones = row["Add clones to new group"];
        const grpName = row["Group name"];
        const itemsToDel = String(row["Items to delete"]);
        const boxToDel = String(row["Box to delete"]);
        const advui = new AdvanceUi(page);
        const qs = new QuoteService(page);

        await test.step('Cloning the First Box and verification', async () => {
            const summaryDataBeforeClone = await advui.getPricingFromEQGSummary();  // Getting the Summary Values from EQG (before clone)
            await advui.selectBox(boxSortValue);                                    // Selecting the Box to clone
            const selectedBoxData = await advui.loadBoxHeaderDataFromEQG(boxNumber);// Extracting Selected Box Header Pricing
            const selectedPartNo = await advui.getBoxPartNumber(boxNumber);         // Getting Part Number of the selected Box that will be cloned
            await advui.clickOnButton(cloneBoxesButtonLocator);                     // clicking on Clone Boxes button
            await advui.updateCloneBoxesDetails(cloneCount, addClones, grpName);    // Giving clone count and GroupName
            await advui.clickOnCloneBtn();
            await qs.verifyCloneBoxesAdded(selectedBoxData, cloneCount, selectedPartNo);
            if (grpName && grpName.trim() !== "") {
                await qs.verifyCreatedGroups(grpName, cloneCount, selectedBoxData);
            }
            const summaryDataAftrClone = await advui.getPricingFromEQGSummary();    // Getting the Summary Values from EQG (after clone)
            await qs.verifyEQGSummaryPricingAftrClone(summaryDataBeforeClone, summaryDataAftrClone, selectedBoxData, parseInt(cloneCount));
            await qs.validateSortOrder(quoteId);
        });

        await test.step('Verifying Sort Order after deletion of items and box', async () => {
            await advui.clickOnButton('btnuntieBoxes');
            await advui.clkOnCheckboxFrmList(itemsToDel);                           // Selecting Items to delete (major and minors)
            await advui.clickOnBoxBySortvalue(boxToDel);                            // Selecting Box to delete
            await advui.clickOnButton(deleteButtonLocator);                         // Clicking on delete button
            await advui.clickYesOnconfirmationPopUp();                              // Clicking Yes on popup for corfirmation
            await qs.validateSortOrder(quoteId);                                    // Finally checking the Sort Order again
        });
    });

    test('[T3764] Check by deleting one item from the Box and again cloning the same Box', { tag: ["@sanity", "@soupra", "@cloneBoxes"] }, async ({ page }, testInfo) => {
        if (!page) throw new Error("Page not initialised on Before all");
        // Initialising Test Data
        const row = (testInfo as any).row; // Getting the Json Row Values
        const quoteId = row["Quote Id"];
        const boxSortValue = row["Box Sort Value"];
        const boxNumber = parseInt(boxSortValue.slice(-2), 10);
        const cloneCount = String(row["Clone count"]);
        const addClones = row["Add clones to new group"];
        const grpName = row["Group name"];
        const itemsToDel = String(row["Items to delete"]);
        const advui = new AdvanceUi(page);
        const qs = new QuoteService(page);
        testInfo.setTimeout(900000);

        await test.step('Deleting an item and verifying Sort Order', async () => {
            await advui.clickOnButton('btnuntieBoxes');
            await advui.clkOnCheckboxFrmList(itemsToDel);                           // Selecting Items to delete (major or minors)
            await advui.clickOnButton(deleteButtonLocator);                         // Clicking on delete button
            await advui.clickYesOnconfirmationPopUp();                              // Clicking Yes on popup for corfirmation
            await page.waitForTimeout(8000);                                        // Adding timeout after deletion to update the Sort Order 
            await qs.validateSortOrder(quoteId);                                    // Checking the Sort Order 
        });

        await test.step('Cloning the First Box and verification', async () => {
            try {
                // Before clone â€” from Quote Details (after item delete)
                await qs.goToRecord(quoteId);
                const quoteHeaderBeforeClone = await advui.getPricingFromQuoteHeader();
                await qs.goToEditQuoteGrid();
                await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);

                await advui.selectBox(boxSortValue);
                const selectedBoxData = await advui.loadBoxHeaderDataFromEQG(boxNumber);
                const selectedPartNo = await advui.getBoxPartNumber(boxNumber);
                await advui.clickOnButton(cloneBoxesButtonLocator);
                await advui.updateCloneBoxesDetails(cloneCount, addClones, grpName);
                await advui.clickOnCloneBtn();
                await qs.verifyCloneBoxesAdded(selectedBoxData, cloneCount, selectedPartNo);
                if (grpName && grpName.trim() !== "") {
                    await qs.verifyCreatedGroups(grpName, cloneCount, selectedBoxData);
                }

                // After clone â€” from Quote Details
                await qs.goToRecord(quoteId);
                const quoteHeaderAftrClone = await advui.getPricingFromQuoteHeader();
                await qs.verifyEQGSummaryPricingAftrClone(quoteHeaderBeforeClone, quoteHeaderAftrClone, selectedBoxData, parseInt(cloneCount));
                await qs.validateSortOrder(quoteId);
            } finally {
                // Always return to Edit Quote Grid so afterEach cleanup can reach Copy BoM Items chevron
                await qs.goToEditQuoteGrid();
                await advui.refreshChevronIfNotEditable(retries, goToEditQuoteGridChevronName);
            }
        });
    });
});
