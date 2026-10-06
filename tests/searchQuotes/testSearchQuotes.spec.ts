import { test, expect, BrowserContext, Page } from "@playwright/test";
import { XRLUtils } from "../../utils/xrlUtils";
import { SalesforceUtils } from "../../utils/sfUtils";
import { SEARCH_QUOTES_AND_ITEMS } from "../../assets/test_data_constants";
import { getExcelData} from "../../utils/excelReader";
import { Connection } from "jsforce";
// Centralized env resolver: reads .env locally and SF_VARS JSON in CI without duplicating parse/fallback logic
import { getRequiredEnv } from "../../utils/envConfig";


test.describe("Search Quotes", () => {
    let context: BrowserContext | undefined;
    let page: Page | undefined; 
    let count = 1;
    // const searchQuoteServerSheetName= process.env.SEARCH_QUOTES_SERVER_SHEET_NAME || "Search Quotes";
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const searchQuoteServerSheetName = getRequiredEnv("SEARCH_QUOTES_SERVER_SHEET_NAME");
    const searchQuoteServerSheet= getExcelData(SEARCH_QUOTES_AND_ITEMS, searchQuoteServerSheetName);  
    const rows = searchQuoteServerSheet.getColumn('Zephyr Test Number').length;
    console.log("Resolved sheetName:", searchQuoteServerSheetName);
    // const srchQtClientSheetName= process.env.SEARCH_QUOTES_CLIENT_SHEET_NAME || 'Search Quotes Client Filters';
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const srchQtClientSheetName = getRequiredEnv("SEARCH_QUOTES_CLIENT_SHEET_NAME");
    const searchQuoteClientSheet= getExcelData(SEARCH_QUOTES_AND_ITEMS, srchQtClientSheetName); 
    const rows2 = searchQuoteClientSheet.getColumn('Zephyr Test Number').length;
    console.log("Resolved sheetName:", srchQtClientSheetName);


    test.beforeAll(async ( {browser}) => {
        context = await browser.newContext({viewport: { width: 1800, height: 1080 }, deviceScaleFactor: 1}); 
        page = await context.newPage();              
    });

    test.afterAll(async () => {
        if (context) {
        await context.close();
        }
    });

    test.beforeEach(async ({}, testInfo) => {
        // Navigate to Search Quotes page
        testInfo.setTimeout(180000);   
        if (!page) throw new Error("Page not initialized in beforeAll!");     
        await page.goto(`/lightning/n/${process.env.SF_ORG_PREFIX}__Search_Quotes_and_Quote_Items`);

        // Wait for Lightning to load
        await page.waitForLoadState('domcontentloaded');
    });
    

    test("Verify if the Account Server side filters exists",  { tag:  ["@sanity", "@searchQuotes"] },async ({}) => {
        if (!page) throw new Error("Page not initialized in beforeAll!");
        const xrlUtils = new XRLUtils(page);

        const AccountFilter = await test.step('get Account filter locator', async () => {
            return await xrlUtils.getFilter(`${process.env.SF_ORG_PREFIX}__Account__c`);
        });

        await test.step('wait for Account filter to be visible', async () => {
            await AccountFilter.waitFor({ state: 'visible', timeout: 100000 });
        });

        await test.step('log Account filter visibility and text', async () => {
            const isVisible = await AccountFilter.isVisible();
            console.log("Account filter visible:", isVisible);
            const text = await AccountFilter.textContent();
            console.log("Account filter text:", text);
        });
    });

    test("Verify if the Opportunity Server side filters exists", { tag:  ["@sanity", "@searchQuotes"] }, async ({}) => {
        if (!page) throw new Error("Page not initialized in beforeAll!");
        const xrlUtils = new XRLUtils(page);

        const OpportunityFilter = await test.step('get Opportunity filter locator', async () => {
            return await xrlUtils.getFilter(`${process.env.SF_ORG_PREFIX}__Opportunity__c`);
        });

        await test.step('wait for Opportunity filter to be visible', async () => {
            await OpportunityFilter.waitFor({ state: 'visible', timeout: 100000 });
        });

        await test.step('log Opportunity filter visibility and text', async () => {
            const isVisible = await OpportunityFilter.isVisible();
            console.log("Opportunity filter visible:", isVisible);
            const text = await OpportunityFilter.textContent();
            console.log("Opportunity filter text:", text);
        });
    });

    //========== Tests Related to Search Quote Server Filters ==========//
    for (let rowNumber = 1; rowNumber <= rows; rowNumber++){
        // Initialising Test Data
        const testNo = searchQuoteServerSheet.getCell(rowNumber,'Zephyr Test Number');
        const serverField = searchQuoteServerSheet.getCell(rowNumber,"Server side Filter Field");
        const serverSideInput = searchQuoteServerSheet.getCell(rowNumber,"Server Side Input").toString();
        const operator = searchQuoteServerSheet.getCell(rowNumber,"Server Filter Operator").toString();
        const sfQuery = searchQuoteServerSheet.getCell(rowNumber,"Query").toString();
        const no = searchQuoteServerSheet.getCell(rowNumber,"Sl No.");

        test(`[${testNo}] ${no} Checking if correct Number of records is loaded in UI after putting value in Server Filter: ${serverField},where query:${sfQuery}`,{ tag: ["@sanity", "@searchQuotes"] },
                    async ({}, testInfo) => {
            
            if (!page) throw new Error("Page not initialized in beforeAll!");
            test.setTimeout(900000);
            const sfUtils = new SalesforceUtils(page);
            const xrlUtils = new XRLUtils(page);

            await test.step('wait for Lightning load and filter ready', async () => {
                await sfUtils.waitForLightningLoad();
                await xrlUtils.getFilter(`${process.env.SF_ORG_PREFIX}__New_Total_Customer_Extended_Price__c`).waitFor({ state: 'visible', timeout: 100000 });
            });

            await test.step('reset Account/Opportunity dropdown if needed', async () => {
                if(["Account" ,"Opportunity"].includes(serverField)){
                    await xrlUtils.selectDropdownOption(`[data-id=${process.env.SF_ORG_PREFIX}__${serverField}__c]`, "All");
                }
            });

            await test.step('apply server filter', async () => {
                if(["Account" ,"Opportunity", "New_Total_Customer_Extended_Price"].includes(serverField)){
                    await xrlUtils.applyFilter(serverField, serverSideInput, operator); 
                    await xrlUtils.clickIconOnXRLGrid("ssFilter:dialog");
                    await xrlUtils.clickCrossOnServerFilter("CreatedById");
                }
                else{
                    if (serverField === "CreatedDate" || serverField === "CreatedDatee") {
                        await xrlUtils.resetServerFilters();
                    }
                    await xrlUtils.clickIconOnXRLGrid("ssFilter:dialog");
                    await xrlUtils.clickCrossOnServerFilter("CreatedById");
                    if (serverField === "CreatedDatee") {
                        await xrlUtils.clickCrossOnServerFilter("CreatedDate");
                    } else if (serverField === "CreatedDate") {
                        await xrlUtils.clickCrossOnServerFilter("CreatedDatee");
                    }
                    await xrlUtils.clickCrossOnServerFilter(serverField);
                    await xrlUtils.applyFilter(serverField, serverSideInput, operator);                 
                }
            });

            await test.step('save server filter', async () => {
                await xrlUtils.clickOnSaveBtnOnServerFltr();
            });

            await test.step('load all records', async () => {
                await xrlUtils.clickIconOnXRLGrid("loadAll"); 
                await xrlUtils.clickYesOnconfirmation();
            });

            const records = await test.step('get UI record count', async () => {
                return await xrlUtils.getTotalRecords("server");
            });

            await test.step('log Quote Number cell values', async () => {
                const table = await xrlUtils.getXRLTable(`${process.env.SF_ORG_PREFIX}__CustomerBoM__c`)
                await table.waitFor({ state: 'visible', timeout: 500000 });
                const cellValue = await xrlUtils.getAllCellValues("Quote Number");
                console.log("First row Name value:", cellValue); 
            });

            await test.step('query Salesforce and assert UI count matches DB', async () => {
                const sfConn = new Connection({instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID});
                const prefix = (process.env.SF_ORG_PREFIX ?? "").trim();
                let query = sfQuery.replace(/\$\{process\.env\.SF_ORG_PREFIX\}/g, prefix);
                const result = await sfConn.query(query);     
                const count = parseInt(result.records[0].expr0);   
                console.log("Number of records from database:",count);
                test.expect(count).toBe(records);
            });
        });
    }

    //========== Tests Related to Search Quote Client Filters ==========//
    for (let rowNumber = 1; rowNumber <= rows2; rowNumber++){
        // Initialising Test Data
        const testNo = searchQuoteClientSheet.getCell(rowNumber,'Zephyr Test Number');
        const serverField = searchQuoteClientSheet.getCell(rowNumber,"Server side Filter Field");
        const serverSideInput = searchQuoteClientSheet.getCell(rowNumber,"Server Side Input").toString();
        const operator = searchQuoteClientSheet.getCell(rowNumber,"Server Filter Operator").toString();
        const sfQuery = searchQuoteClientSheet.getCell(rowNumber,"Query").toString();
        const no = searchQuoteClientSheet.getCell(rowNumber,"Sl No.");
        const clientFilter = searchQuoteClientSheet.getCell(rowNumber,"Column filter").toString();
        const clientOpertn = searchQuoteClientSheet.getCell(rowNumber,"Filter Operation").toString();
        const filtrStr = searchQuoteClientSheet.getCell(rowNumber,"Filter value for column").toString();

        test(`[${testNo}] ${no} Checking if correct Number of records is loaded in UI after putting value in Client Filter: ${clientFilter} ,${clientOpertn}, ${filtrStr},where query:${sfQuery}`,{ tag: ["@sanity", "@searchQuotes"] },
                    async ({}, testInfo) => {
            
            if (!page) throw new Error("Page not initialized in beforeAll!");
            test.setTimeout(900000);
            const sfUtils = new SalesforceUtils(page); //
            const xrlUtils = new XRLUtils(page);

            await test.step('wait for Lightning load and filter ready', async () => {
                await sfUtils.waitForLightningLoad();
                await xrlUtils.getFilter(`${process.env.SF_ORG_PREFIX}__New_Total_Customer_Extended_Price__c`).waitFor({ state: 'visible', timeout: 100000 });
            });

            await test.step('reset Account/Opportunity dropdown if needed', async () => {
                if(["Account" ,"Opportunity"].includes(serverField)){
                    await xrlUtils.selectDropdownOption(`[data-id=${process.env.SF_ORG_PREFIX}__${serverField}__c]`, "All");
                }
            });

            await test.step('apply server filter', async () => {
                if(["Account" ,"Opportunity", "New_Total_Customer_Extended_Price"].includes(serverField)){
                    await xrlUtils.applyFilter(serverField, serverSideInput, operator); 
                    await xrlUtils.clickIconOnXRLGrid("ssFilter:dialog");
                    await xrlUtils.clickCrossOnServerFilter("CreatedById");
                }
                else{
                    if (serverField === "CreatedDate" || serverField === "CreatedDatee") {
                        await xrlUtils.resetServerFilters();
                    }
                    await xrlUtils.clickIconOnXRLGrid("ssFilter:dialog");
                    await xrlUtils.clickCrossOnServerFilter("CreatedById");
                    if (serverField === "CreatedDatee") {
                        await xrlUtils.clickCrossOnServerFilter("CreatedDate");
                    } else if (serverField === "CreatedDate") {
                        await xrlUtils.clickCrossOnServerFilter("CreatedDatee");
                    }
                    await xrlUtils.clickCrossOnServerFilter(serverField);
                    await xrlUtils.applyFilter(serverField, serverSideInput, operator);                 
                }
            });

            await test.step('save server filter', async () => {
                await xrlUtils.clickOnSaveBtnOnServerFltr();
            });

            await test.step('load all records', async () => {
                await xrlUtils.clickIconOnXRLGrid("loadAll"); 
                await xrlUtils.clickYesOnconfirmation();
            });

            await test.step('apply client filter', async () => {
                await xrlUtils.clickOnClientFilter(clientFilter);            
                await xrlUtils.clickOperationDropdwn();
                await page.getByText(clientOpertn,{exact:true}).nth(0).click();
                if (clientFilter === 'Status' || clientFilter === 'Quote_Category'){
                    await xrlUtils.slctClientFltrInptDropdwn(filtrStr);
                }
                else if (clientOpertn === 'Range'){
                    await xrlUtils.inputRange(filtrStr, clientFilter);
                }
                else{
                    await xrlUtils.inputFilterStr(filtrStr);
                }
            });

            await test.step('save client filter', async () => {
                await xrlUtils.clickOnSaveBtnOnClientFltr();
            });

            const records = await test.step('get UI record count', async () => {
                return await xrlUtils.getTotalRecords("client");
            });

            await test.step('log Quote Number cell values', async () => {
                const table = await xrlUtils.getXRLTable(`${process.env.SF_ORG_PREFIX}__CustomerBoM__c`)
                await table.waitFor({ state: 'visible', timeout: 500000 });
                const cellValue = await xrlUtils.getAllCellValues("Quote Number");
                console.log("First row Name value:", cellValue); 
            });

            await test.step('query Salesforce and assert UI count matches DB', async () => {
                const sfConn = new Connection({instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID});
                const prefix = (process.env.SF_ORG_PREFIX ?? "").trim();
                let query = sfQuery.replace(/\$\{process\.env\.SF_ORG_PREFIX\}/g, prefix);
                const result = await sfConn.query(query);     
                const count = parseInt(result.records[0].expr0);   
                console.log("Number of records from database:",count);
                test.expect(count).toBe(records);
            });
        });
    }
});
