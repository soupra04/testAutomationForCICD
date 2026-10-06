import { test, BrowserContext, Page, expect } from "@playwright/test";
import { BomService } from "../../services/bom-service";
import { getExcelData} from "../../utils/excelReader";
import { TEST_DATA_PATH } from "../../assets/test_data_constants";
import { OpportunityPage } from "../../pages/opportunityPage";
import { TestingUtils } from "../../utils/testingUtils";
import { QuoteService } from "../../services/quote-service";
import dotenv from "dotenv";
import { time } from "console";
// Centralized env resolver: reads .env locally and SF_VARS JSON in CI without duplicating parse/fallback logic
import { getRequiredEnv } from "../../utils/envConfig";
dotenv.config();

test.describe("Testing different Type of BoM import in Sync Mode", () => {
    
    // Data Initialisation for beforeAll, beforeEach
    let context: BrowserContext | undefined;
    let page: Page | undefined; 
    // Read test data from Excel
    // const excel= getExcelData(TEST_DATA_PATH,process.env.BOM_IMPORT_SHEET_NAME||'');
    // Replaces inline process.env read above â€” same behavior via shared utils/envConfig.ts
    const excel = getExcelData(TEST_DATA_PATH, getRequiredEnv("BOM_IMPORT_SHEET_NAME"));
    const rows = excel.getColumn('Test').length;

    for (let rowNumber = 1; rowNumber <= rows; rowNumber++){ //addss
        // Read data for each test case row
        
        const allErrors: string[] = [];
        // initialising variables that are required for BoM Import from excel
        const oppId = excel.getCell(rowNumber, 'Opportunity Id');
        const testNo = excel.getCell(rowNumber,'Test');
        const bomType = excel.getCell(rowNumber,'BoM Type').toLowerCase();
        const quoteId = excel.getCell(rowNumber,'Id / Path').toString();
        const Mode_of_import = excel.getCell(rowNumber,'Mode of Import');
        const Source = excel.getCell(rowNumber,'Source');
        const Profile = excel.getCell(rowNumber,'Profile');
        const Is_Renewal = excel.getCell(rowNumber,'Is Renewal');
        const currency = excel.getCell(rowNumber,'Currency');
        const distiBoxParsing = excel.getCell(rowNumber,'Disti Box Parsing');
        
        // Initialising pricing values for comparison
        const Total_Extended_List_Price = excel.getCell(rowNumber,'Total Extended List Price');
        const Total_Discount = excel.getCell(rowNumber,'Total Discount');
        const Total_Extended_Net_Price = excel.getCell(rowNumber,'Total Extended Net Price');
        const Total_BoM_Line_Items = excel.getCell(rowNumber,'Total BoM Line Items');
        const New_Total_Extended_List_Price__c = excel.getCell(rowNumber,'New Total Extended List Price');
        const Previous_Total_Extended_List_Price__c = excel.getCell(rowNumber,'Previous Total Extended List Price');
        const New_Total_Extended_Net_Price__c = excel.getCell(rowNumber,'New Total Extended Net Price');
        const Previous_Total_Extended_Net_Price__c = excel.getCell(rowNumber,'Previous Total Extended Net Price');
        const New_Total_Discount__c = excel.getCell(rowNumber,'New Total Discount');
        const Previous_Total_Discount__c = excel.getCell(rowNumber,'Previous Total Discount');
        const SubscriptionOriginalUnroundRemainingTerm__c = excel.getCell(rowNumber,'Subscription Original Unround Remaining Term');
        const SubscriptionOriginalInitialTerm__c = excel.getCell(rowNumber,'Subscription Original Initial Term');
        const SubscriptionOriginalAutoRenewalTerm__c = excel.getCell(rowNumber,'Subscription Original Auto Renewal Term');
        const SubscriptionOriginalBillingModel__c = excel.getCell(rowNumber,'Subscription Original Billing Model');

       test(`[${testNo}] Check BoM Import for BoM Type: ${bomType}, Quote Id: ${quoteId}`, { tag:  [  "@importBom","@soupra", "@demo"] }, async ({page}) => {
        // Dynamic test case execution based on each row test data
            test.setTimeout(800000);
            if (!page) throw new Error("Page not initialized in beforeAll!");
            // Initializing services and util classes
            const bom = new BomService(page);  
            const opp = new OpportunityPage(page); 
            const testutils = new TestingUtils(page);
            const quote = new QuoteService(page);

            const { comparisonData, comparisonDataMSDR } = await test.step('build comparison data objects', async () => {
                const comparisonData = {
                    "Total Extended List Price": parseFloat(Total_Extended_List_Price) || 0,
                    "Total Discount": parseFloat(Total_Discount) || 0,
                    "Total Extended Net Price": parseFloat(Total_Extended_Net_Price) || 0,
                    "Total BoM Line Items": parseFloat(Total_BoM_Line_Items) || 0
                };
                const comparisonDataMSDR = {
                    "New Total Extended List Price": parseFloat(New_Total_Extended_List_Price__c) || 0,
                    "Previous Total Extended List Price": parseFloat(Previous_Total_Extended_List_Price__c) || 0,
                    "New Total Extended Net Price": parseFloat(New_Total_Extended_Net_Price__c) || 0,
                    "Previous Total Extended Net Price": parseFloat(Previous_Total_Extended_Net_Price__c) || 0,
                    "New Total Discount": parseFloat(New_Total_Discount__c) || 0,
                    "Previous Total Discount": parseFloat(Previous_Total_Discount__c) || 0,
                    "Subscription Original Unround Remaining Term": parseFloat(SubscriptionOriginalUnroundRemainingTerm__c) || 0,
                    "Subscription Original Initial Term": parseFloat(SubscriptionOriginalInitialTerm__c) || 0,
                    "Subscription Original Auto Renewal Term": parseFloat(SubscriptionOriginalAutoRenewalTerm__c) || 0,
                    "Subscription Original Billing Model": SubscriptionOriginalBillingModel__c || ''
                };
                return { comparisonData, comparisonDataMSDR };
            });

            await test.step('validate mandatory fields', async () => {
                if (bomType===''||bomType === undefined || quoteId === '' || quoteId === undefined) {
                    throw new Error(`Missing BoM Type or Id in row ${rowNumber}`);
                }
            });

            await test.step('navigate to Opportunity', async () => {
                await page.goto(`${process.env.SF_INSTANCE_URL}/${oppId}`, { timeout: 90000 });
                await page.waitForLoadState('domcontentloaded');
                await opp.handleIntermittentError();
            });

            await test.step('start BoM import process', async () => {
                await bom.clickOnImportBoMButton();
                await bom.checkAPIProfileEnabled();
                await bom.selectModeOfImport(Mode_of_import);
            });

            await test.step(`import BoM via ${Mode_of_import || 'invalid'} mode`, async () => {
                if (Mode_of_import === "API") {
                    await bom.selectSource(Source);
                    await bom.selectProfile(Profile);
                    await bom.selectBomType(bomType);
                    const visibility = await bom.chckAuthenticateBtnIfVisible();
                    if (visibility === true){await bom.doAuthentication();}
                    else{await bom.clickOnContinueButton();}                  
                    await bom.putBoMId(bomType, quoteId, Is_Renewal, "", "");                                         
                    await bom.clickOnImportBom();
                    await opp.handleIntermittentError();
                }
                else if (Mode_of_import === "File"){
                    await bom.continueToNextTab();
                    await bom.checkRenewalcheckboxIfTrue(Is_Renewal);
                    await bom.setCurrency(currency);
                    if(distiBoxParsing && distiBoxParsing !== '' ){
                        await bom.setDistiBoxParsing(distiBoxParsing);
                    }
                    await opp.handleIntermittentError();
                    await bom.uploadFile(bomType,quoteId);                
                    await bom.clickOnImportBom();
                    await opp.handleIntermittentError();
                    await bom.handleOverrideWarning();
                }            
                else { 
                    await bom.throwError([`Invalid BoM Type: ${bomType} in row ${rowNumber}`]);
                }
            });

            await test.step('capture errors and go to BoM page', async () => {
                await bom.captureError(bomType, quoteId);
                await bom.gotoBoMPage(quoteId, bomType, Mode_of_import, Is_Renewal, currency, distiBoxParsing, bomType, quoteId);  
            });

            await test.step('close notifications after import', async () => {
                await bom.closeAllfNotifications();
                await page.waitForTimeout(5000);
            });

            const { excelData, sfData } = await test.step('get Excel and Salesforce pricing data', async () => {
                const excelData = bomType === "msdr" ? comparisonDataMSDR : comparisonData; 
                const BoM_ID = await bom.findBomId();
                const sfData = await bom.getPricesFromSfForBoM(BoM_ID, bomType);        
                console.log("Excel Data =", excelData);
                console.log("Salesforce Data =", sfData);
                return { excelData, sfData };
            });

            await test.step('compare Excel vs Salesforce pricing and throw errors', async () => {
                const htmlErr = await quote.compareValues(excelData, sfData, "Excel Input Value", "Salesforce Value");
                if (htmlErr) {
                    const errTable = await testutils.parsedHTMLTable(htmlErr);
                    allErrors.push(`-------------Error for ${bomType} ${quoteId}-------------: ${errTable}`);
                }
                await bom.throwError(allErrors);
            });
                     
                               
        }); // End of Test Case
    } // End of for loop

    test.skip("[T3913] Negative scenario: Correct Message shown for import failure", { tag: ["@soupra", "@importBom", "@demo"] }, async ({page}) => {
        test.setTimeout(500000);

        const { excel2, sheetNo, no_of_rows } = await test.step('load negative scenario sheet', async () => {
            const excel2= getExcelData(TEST_DATA_PATH,'Negative Scenario demo int qa');
            const sheetNo = 2;
            const no_of_rows = excel2.getColumn('Id').length;
            return { excel2, sheetNo, no_of_rows };
        });

        if (!page) throw new Error("Page not initialized in beforeAll!");
        const bom = new BomService(page);  
        const opp = new OpportunityPage(page); 
        let errorsCaptured: string[] = []; 

        for (let rowNumber = 1; rowNumber <= no_of_rows; rowNumber++){

            const oppId = excel2.getCell(rowNumber, 'Opportunity Id');
            const bomType = excel2.getCell(rowNumber,'BoM Type').toLowerCase();
            const quoteId = excel2.getCell(rowNumber,'Id').toString();
            const Mode_of_import = excel2.getCell(rowNumber,'Mode of Import');
            const Source = excel2.getCell(rowNumber,'Source');
            const Profile = excel2.getCell(rowNumber,'Profile');
            const Is_Renewal = excel2.getCell(rowNumber,'Is Renewal');
            const currency = excel2.getCell(rowNumber,'Currency');
            const distiBoxParsing = excel2.getCell(rowNumber,'Disti Box Parsing');

            await test.step(`[row ${rowNumber}] navigate to Opportunity`, async () => {
                await page.goto(`${process.env.SF_INSTANCE_URL}/${oppId}`, { timeout: 90000 });
                await page.waitForLoadState('domcontentloaded', { timeout: 9000 });
                await opp.handleIntermittentError();
            });

            await test.step(`[row ${rowNumber}] start BoM import process`, async () => {
                await bom.clickOnImportBoMButton();
                await bom.checkAPIProfileEnabled();
                await bom.selectModeOfImport(Mode_of_import);
            });

            await test.step(`[row ${rowNumber}] import BoM via ${Mode_of_import || 'invalid'} mode`, async () => {
                if (Mode_of_import === "API") {
                    await bom.selectSource(Source);
                    await bom.selectProfile(Profile);
                    await bom.selectBomType(bomType);
                    const visibility = await bom.chckAuthenticateBtnIfVisible();
                    if (visibility === true){await bom.doAuthentication();}
                    else{await bom.clickOnContinueButton();}   
                    await bom.putBoMId(bomType, quoteId, Is_Renewal, "", "");                                         
                    await bom.clickOnImportBom();
                    await opp.handleIntermittentError();
                }            
                else if (Mode_of_import === "File"){
                    await bom.continueToNextTab();
                    await bom.checkRenewalcheckboxIfTrue(Is_Renewal);
                    await bom.setCurrency(currency);
                    if(distiBoxParsing && distiBoxParsing !== ''){
                        await bom.setDistiBoxParsing(distiBoxParsing);
                    }                
                    await opp.handleIntermittentError();
                    await bom.uploadFile(bomType,quoteId);                
                    await bom.clickOnImportBom();
                    await opp.handleIntermittentError();
                }
                else { 
                    await bom.throwError([`Invalid BoM Type: ${bomType} in row ${rowNumber}`]);
                }
            });

            await test.step(`[row ${rowNumber}] capture import failure message`, async () => {
                const captured = await opp.messageLocator1();
                errorsCaptured[rowNumber] = captured;
            });
        }

        await test.step('assert correct error messages for import failure', async () => {
            await bom.ifCorrectErrorShownForImportFailure(errorsCaptured, sheetNo);
        });
    });
}); // End of describe block
