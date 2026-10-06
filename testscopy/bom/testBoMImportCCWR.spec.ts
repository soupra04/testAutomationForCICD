import { test, BrowserContext, Page, expect } from "@playwright/test";
import { BomService } from "../../services/bom-service";
import { getExcelData} from "../../utils/excelReader";
import { TEST_DATA_PATH } from "../../assets/test_data_constants";
import { OpportunityPage } from "../../pages/opportunityPage";
import { SalesforceUtils } from "../../utils/sfUtils";
import { QuoteService } from "../../services/quote-service";
import { TestingUtils } from "../../utils/testingUtils";

test.describe("Testing different Type of BoM import in Sync Mode", () => {
    
    // Data Initialisation for beforeAll, beforeEach
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    // Read test data from Excel
    const excel= getExcelData(TEST_DATA_PATH,'CCWR');
    const rows = excel.getColumn('Test').length;

        test.beforeAll(async ( {browser}) => {
        context = await browser.newContext({viewport: { width: 1800, height: 1080 }, deviceScaleFactor: 1}); 
        page = await context.newPage();              
    });

    test.afterAll(async () => {
        if (context) {
        await context.close();
        }
    });

    for (let rowNumber = 1; rowNumber <= rows; rowNumber++){
        // Read data for each test case row
        
        const allErrors: string[] = [];
        // initialising variables that are required for BoM Import from excel
        const oppId = excel.getCell(rowNumber, 'Opportunity Id');
        const testNo = excel.getCell(rowNumber,'Test');
        const bomType = excel.getCell(rowNumber,'BoM Type');
        const quoteId = excel.getCell(rowNumber,'Quote ID');
        const Mode_of_import = excel.getCell(rowNumber,'Mode of Import');
        const Source = excel.getCell(rowNumber,'Source');
        const Profile = excel.getCell(rowNumber,'Profile');
        const type = excel.getCell(rowNumber,'Type');
        const grouping1 = excel.getCell(rowNumber,'Grouping Dropdown 1');
        const grouping2 = excel.getCell(rowNumber,'Grouping Dropdown 2');
        const grouping3 = excel.getCell(rowNumber,'Grouping Dropdown 3');
        const partNumber1 = excel.getCell(rowNumber,'Part Number Presentation Dropdown 1');
        const partNumber2 = excel.getCell(rowNumber,'Part Number Presentation Dropdown 2');
        const partNumber3 = excel.getCell(rowNumber,'Part Number Presentation Dropdown 3');
        const partNumber4 = excel.getCell(rowNumber,'Part Number Presentation Dropdown 4');
        const description1 = excel.getCell(rowNumber,'Description Presentation Dropdown 1');
        const description2 = excel.getCell(rowNumber,'Description Presentation Dropdown 2');
        const description3 = excel.getCell(rowNumber,'Description Presentation Dropdown 3');
        const description4 = excel.getCell(rowNumber,'Description Presentation Dropdown 4');
        
        // Initialising pricing values for comparison
        const Total_Extended_List_Price = excel.getCell(rowNumber,'Total Extended List Price');
        const Total_Discount = excel.getCell(rowNumber,'Total Discount');
        const Total_Extended_Net_Price = excel.getCell(rowNumber,'Total Extended Net Price');
        const Total_BoM_Line_Items_Detailed = excel.getCell(rowNumber,'Total BoM Line Items (Detailed)');
        const Total_BoM_Line_Items_Invoice = excel.getCell(rowNumber,'Total BoM Line Items (Invoice)');

       test(`[${testNo}] Check BoM Import for BoM Type: ${bomType}, Quote Id: ${quoteId}`, { tag: ["@imptBomCCWR"] }, async ({}) => {
        // Dynamic test case execution based on each row test data
            test.setTimeout(2500000);
            if (!page) throw new Error("Page not initialized in beforeAll!");
            // Initializing services and util classes
            const bom = new BomService(page);  
            const opp = new OpportunityPage(page); 
            const sf = new SalesforceUtils(page);
            const qt = new QuoteService(page);
            const tst = new TestingUtils(page);

            // Making a comparison data object for pricing values
            const comparisonDataDetailedBoM = {
                "Total Extended List Price": parseFloat(Total_Extended_List_Price) || 0,
                "Total Discount": parseFloat(Total_Discount) || 0,
                "Total Extended Net Price": parseFloat(Total_Extended_Net_Price) || 0,
                "Total BoM Line Items": parseFloat(Total_BoM_Line_Items_Detailed) || 0
            };

            const comparisonDataInvoiceBoM = {
                "Total Extended List Price": parseFloat(Total_Extended_List_Price) || 0,
                "Total Discount": parseFloat(Total_Discount) || 0,
                "Total Extended Net Price": parseFloat(Total_Extended_Net_Price) || 0,
                "Total BoM Line Items": parseFloat(Total_BoM_Line_Items_Invoice) || 0
            }

            const comparisonDataDetailedQuote = {
                "Total Extended List Price": parseFloat(Total_Extended_List_Price) || 0,
                "VAR Discount": parseFloat(Total_Discount) || 0,
                "VAR Total Cost": parseFloat(Total_Extended_Net_Price) || 0,
                "Total Quote Line Items": parseFloat(Total_BoM_Line_Items_Detailed) || 0
            };

            const comparisonDataInvoiceQuote = {
                "Total Extended List Price": parseFloat(Total_Extended_List_Price) || 0,
                "VAR Discount": parseFloat(Total_Discount) || 0,
                "VAR Total Cost": parseFloat(Total_Extended_Net_Price) || 0,
                "Total Quote Line Items": parseFloat(Total_BoM_Line_Items_Invoice) || 0
            } 

            // Validate mandatory fields
            if (bomType===''||bomType === undefined || quoteId === '' || quoteId === undefined) {
                throw new Error(`Missing BoM Type or Id in row ${rowNumber}`);
            }
            // //---------( Navigate to Opportunity )---------
            await page.goto(`${process.env.SF_INSTANCE_URL}/${oppId}`, { timeout: 90000 });
            await page.waitForLoadState('domcontentloaded', { timeout: 9000 });
            await opp.handleIntermittentError();
            //----------( Start BoM Import process )----------
            await bom.clickOnImportBoMButton();
            await bom.checkAPIProfileEnabled();
            await bom.selectModeOfImport(Mode_of_import);

            //----(1) Import BoM using API method if Mode of Import is API
            if (Mode_of_import === "API") {
                await bom.selectSource(Source);
                await bom.selectProfile(Profile);
                await bom.selectBomType(bomType);
                await bom.clickOnContinueButton();  
                await bom.putCCWRImportDetails(type, quoteId, grouping1, grouping2, grouping3, partNumber1, partNumber2, partNumber3, partNumber4, description1, description2, description3, description4);                                       
                await bom.clickOnImportBom();
                await opp.handleIntermittentError();
            }       
            
            //-------( Check Import Message )--------                                 
            const msg = await bom.UnsuccessfulBoMImport();
            if(msg=== true){throw new Error("The CCWR Import Process was not correct!")}
            
            //-------( Go to Batch Queue Manager )--------
            const bqmId = await bom.findBQMJobOfCCWRImport(quoteId)|| '';
            await qt.goToRecord(bqmId);
            await bom.reloadBQMPageUntilCompleted();
            const ids = await bom.extractRcrdIdsFrmBQM(); // Extract the Record Ids of all records

            //-------( Show warning if any Id was absent in BQM Job )--------
            await bom.showWarnIfIdNotFound(ids);
            
            //-------( Go to Record Ids and validate the Prices on each Record Id page )--------
            
            ////---- DETAILED BOM -----////
            await bom.validateRecord({id: ids["detailedBoMId"], label: "DETAILED BOM", recordIdType: "BoM", quoteId, bomType, comparisonData: comparisonDataDetailedBoM, allErrors});

            ////---- INVOICE BOM -----////
            await bom.validateRecord({id: ids["invoiceBoMId"], label: "INVOICE BOM", recordIdType: "BoM", quoteId, bomType, comparisonData: comparisonDataInvoiceBoM, allErrors});

            ////---- DETAILED QUOTE -----////
            await bom.validateRecord({id: ids["detailedQuoteId"], label: "DETAILED QUOTE", recordIdType: "Quote", quoteId, bomType, comparisonData: comparisonDataDetailedQuote, allErrors});

            ////---- INVOICE QUOTE -----////
            await bom.validateRecord({id: ids["invoiceQuoteId"], label: "INVOICE QUOTE", recordIdType: "Quote", quoteId, bomType, comparisonData: comparisonDataInvoiceQuote, allErrors });

            // Show all errors after every comparison
            await bom.throwError(allErrors);                    
        }); // End of Test Case
    } // End of for loop
}); // End of describe block