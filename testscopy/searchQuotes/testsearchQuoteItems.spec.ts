import { test, expect } from "@playwright/test";
import { XRLUtils } from "../../utils/xrlUtils";
import { SalesforceUtils } from "../../utils/sfUtils";
import { SEARCH_QUOTES_AND_ITEMS } from "../../assets/test_data_constants";
import { getExcelData} from "../../utils/excelReader";
import { Connection } from "jsforce";
// Centralized env resolver: reads .env locally and SF_VARS JSON in CI without duplicating parse/fallback logic
import { getRequiredEnv } from "../../utils/envConfig";


test.describe("Search Quotes Items", () => {
    // const srchQtItmsSheet = process.env.SEARCH_QUOTE_ITEMS_SERVER_SHEET_NAME || 'Search Quote itms server filter';
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const srchQtItmsSheet = getRequiredEnv("SEARCH_QUOTE_ITEMS_SERVER_SHEET_NAME");
    const searchQuoteItmsServerSheet= getExcelData(SEARCH_QUOTES_AND_ITEMS,srchQtItmsSheet);  
    const rows = searchQuoteItmsServerSheet.getColumn('Zephyr Test Number').length;
    console.log("Resolved sheetName:", srchQtItmsSheet);
    // const srchQtItmsClientSheet= process.env.SEARCH_QUOTE_ITEMS_CLIENT_SHEET_NAME || 'Search Quote itms client filter';
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const srchQtItmsClientSheet = getRequiredEnv("SEARCH_QUOTE_ITEMS_CLIENT_SHEET_NAME");
    const searchQuoteItmsClientSheet= getExcelData(SEARCH_QUOTES_AND_ITEMS,srchQtItmsClientSheet); 
    const rows2 = searchQuoteItmsClientSheet.getColumn('Zephyr Test Number').length;
    console.log("Resolved sheetName:", srchQtItmsClientSheet);

    test.beforeEach(async ({ page }, testInfo) => {
        // Navigate to Search Quotes page
        testInfo.setTimeout(380000);   
        await page.goto(`/lightning/n/${process.env.SF_ORG_PREFIX}__Search_Quotes_and_Quote_Items`);
        await page.getByRole('tab', {name:'Search Quote Items'}).click();
        // Wait for Lightning to load
        await page.waitForLoadState('domcontentloaded');
    });
    

    test("Verify if the Account Server side filters exists", { tag: ["@sanity", "@searchQuotes", "@demo"] }, async ({ page }) => {
        const xrlUtils = new XRLUtils(page);

        const AccountFilter = await test.step('get Account filter locator', async () => {
            return await xrlUtils.getFilter(`${process.env.SF_ORG_PREFIX}__CustomerBoM__r.${process.env.SF_ORG_PREFIX}__Account__c`);
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

    test("Verify if the Opportunity Server side filters exists",{ tag: ["@sanity", "@searchQuotes", "@demo"] }, async ({ page }) => {
        const xrlUtils = new XRLUtils(page);

        const OpportunityFilter = await test.step('get Opportunity filter locator', async () => {
            return await xrlUtils.getFilter(`${process.env.SF_ORG_PREFIX}__CustomerBoM__r.${process.env.SF_ORG_PREFIX}__Opportunity__c`);
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
        const testNo = searchQuoteItmsServerSheet.getCell(rowNumber,'Zephyr Test Number');
        const serverField = searchQuoteItmsServerSheet.getCell(rowNumber,"Server side Filter Field");
        const serverSideInput = searchQuoteItmsServerSheet.getCell(rowNumber,"Server Side Input").toString();
        const operator = searchQuoteItmsServerSheet.getCell(rowNumber,"Server Filter Operator").toString();
        const sfQuery = searchQuoteItmsServerSheet.getCell(rowNumber,"Query").toString();
        const no = searchQuoteItmsServerSheet.getCell(rowNumber,"Sl No.");

        test(`[${testNo}] ${no} Checking if correct Number of records is loaded in UI after putting value in Server Filter: ${serverField}`,{ tag: ["@sanity", "@searchQuotes", "@demo"] },
                    async ({ page }, testInfo) => {
            
            const sfUtils = new SalesforceUtils(page);
            const xrlUtils = new XRLUtils(page);

            await test.step('wait for Lightning load and Quote Number filter ready', async () => {
                await sfUtils.waitForLightningLoad();
                await xrlUtils.getFilter(`${process.env.SF_ORG_PREFIX}__CustomerBoM__r.Name`).waitFor({ state: 'visible', timeout: 100000 });
            });

            await test.step('reset Account/Opportunity dropdown if needed', async () => {
                if(["Account" ,"Opportunity"].includes(serverField)){
                    await xrlUtils.selectDropdownOption(`[data-id="${process.env.SF_ORG_PREFIX}__CustomerBoM__r.${process.env.SF_ORG_PREFIX}__${serverField}__c"]`, "All");
                }
            });

            await test.step('apply server filter', async () => {
                if(["Account" ,"Opportunity", "Name"].includes(serverField)){
                    await xrlUtils.applyFilter(serverField, serverSideInput, operator, 'searchQuoteItems'); 
                    await xrlUtils.clickIconOnXRLGrid("ssFilter:dialog");
                    await xrlUtils.clickCrossOnServerFilter("OwnerId", 'searchQuoteItems');
                    await page.getByText('Add remaining filters.').click({delay:2000});
                }
                else{
                    await xrlUtils.clickIconOnXRLGrid("ssFilter:dialog");
                    await xrlUtils.clickCrossOnServerFilter("OwnerId", 'searchQuoteItems');
                    await page.getByText('Add remaining filters.').click({delay:2000});
                    await xrlUtils.clickCrossOnServerFilter(serverField, 'searchQuoteItems');
                    await xrlUtils.applyFilter(serverField, serverSideInput, operator, 'searchQuoteItems', no);                 
                }
            });

            await test.step('save server filter', async () => {
                await xrlUtils.clickOnSaveBtnOnServerFltr();
            });

            await test.step('load first chunk and show errors', async () => {
                await xrlUtils.clickXRLButtons("loadFirstChunk"); 
                await xrlUtils.showErrors();
            });

            const records = await test.step('get UI record count', async () => {
                return await xrlUtils.getTotalRecords("server");
            });

            await test.step('log Quote Item Name cell values', async () => {
                const table = await xrlUtils.getXRLTable(`${process.env.SF_ORG_PREFIX}__Cust_BoM_Item__c`)
                await table.waitFor({ state: 'visible', timeout: 500000 });
                const cellValue = await xrlUtils.getAllCellValues("Quote Item Name");
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
        const testNo = searchQuoteItmsClientSheet.getCell(rowNumber,'Zephyr Test Number');
        const serverField = searchQuoteItmsClientSheet.getCell(rowNumber,"Server side Filter Field");
        const serverSideInput = searchQuoteItmsClientSheet.getCell(rowNumber,"Server Side Input").toString();
        const operator = searchQuoteItmsClientSheet.getCell(rowNumber,"Server Filter Operator").toString();
        const sfQuery = searchQuoteItmsClientSheet.getCell(rowNumber,"Query").toString();
        const no = searchQuoteItmsClientSheet.getCell(rowNumber,"Sl No.");
        const clientFilter = searchQuoteItmsClientSheet.getCell(rowNumber,"Column filter").toString();
        const clientOpertn = searchQuoteItmsClientSheet.getCell(rowNumber,"Filter Operation").toString();
        const filtrStr = searchQuoteItmsClientSheet.getCell(rowNumber,"Filter value for column").toString();

        test(`[${testNo}] ${no} Checking if correct Number of records is loaded in UI after putting value in Client Filter: ${clientFilter} ,${clientOpertn}, ${filtrStr}`,{ tag: ["@sanity", "@searchQuotes", "@demo"] },
                    async ({ page }, testInfo) => {
            
            const sfUtils = new SalesforceUtils(page);
            const xrlUtils = new XRLUtils(page);

            await test.step('wait for Lightning load and Quote Number filter ready', async () => {
                await sfUtils.waitForLightningLoad();
                await xrlUtils.getFilter(`${process.env.SF_ORG_PREFIX}__CustomerBoM__r.Name`).waitFor({ state: 'visible', timeout: 100000 });
            });

            await test.step('reset Account/Opportunity dropdown if needed', async () => {
                if(["Account" ,"Opportunity"].includes(serverField)){
                    await xrlUtils.selectDropdownOption(`[data-id="${process.env.SF_ORG_PREFIX}__CustomerBoM__r.${process.env.SF_ORG_PREFIX}__${serverField}__c"]`, "All");
                }
            });

            await test.step('apply server filter', async () => {
                if(["Account" ,"Opportunity", "Name"].includes(serverField)){
                    await xrlUtils.applyFilter(serverField, serverSideInput, operator, 'searchQuoteItems'); 
                    await xrlUtils.clickIconOnXRLGrid("ssFilter:dialog");
                    await xrlUtils.clickCrossOnServerFilter("OwnerId", 'searchQuoteItems');
                }
                else{
                    await xrlUtils.clickIconOnXRLGrid("ssFilter:dialog");
                    await xrlUtils.clickCrossOnServerFilter("OwnerId", 'searchQuoteItems');
                    await xrlUtils.clickCrossOnServerFilter(serverField, 'searchQuoteItems');
                    await xrlUtils.applyFilter(serverField, serverSideInput, operator, 'searchQuoteItems', no);                 
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
                if (['Status', 'Quote_Category', 'Item_Type'].includes(clientFilter)){
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

            await test.step('log Quote Item Name cell values', async () => {
                const table = await xrlUtils.getXRLTable(`${process.env.SF_ORG_PREFIX}__Cust_BoM_Item__c`)
                await table.waitFor({ state: 'visible', timeout: 500000 });
                const cellValue = await xrlUtils.getAllCellValues("Quote Item Name");
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
