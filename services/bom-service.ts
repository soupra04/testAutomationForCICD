import test from "@playwright/test";
import { expect, Page } from "@playwright/test";
import dotenv from "dotenv";
import { TEST_DATA_PATH } from "../assets/test_data_constants";
import { QuoteService } from "./quote-service";
import {SalesforceUtils} from "../utils/sfUtils";
import { TestingUtils } from "../utils/testingUtils";
dotenv.config();
import * as XLSX from "xlsx";
import { OpportunityPage } from "../pages/opportunityPage";
import { Connection } from "jsforce";
const orgPrefix = process.env.SF_ORG_PREFIX;
const username = process.env.AUTH_USERNAME||'';
const password = process.env.AUTH_PASSWORD||'';

export class BomService {
    private page: Page;
    private bom: SalesforceUtils;
    private opp: OpportunityPage;
    private qs: QuoteService;
    public tst: TestingUtils;
    constructor(page: Page) {
        this.page = page;
        this.bom = new SalesforceUtils(page);
        this.opp = new OpportunityPage(page);
        this.qs = new QuoteService(page);
        this.tst = new TestingUtils(page);
    }   

    async clickOnImportBoMButton() {
        // Click on the Import BoM button
        // await this.page.getByRole('button', { name: /^Import BoM/ }).waitFor({state:'visible', timeout:20000});
        await this.bom.getItemByRoleandClick("button", /^Import BoM/ ); 
    }

    async chckAuthenticateBtnIfVisible(){
        // returns true or false
        // This button checks if "Authenticate" button is present or not on Import BoM UI
        try{ 
            await this.page.getByRole('button', { name: 'Authenticate' }).waitFor({state:'visible', timeout:3000});
                console.log("Authentication button found! Credentials need to be verified again!");
                return true;
            }catch{
                console.warn("Authenticate button is not visible!");
            return false;}
    }

    async doAuthentication(){
        // does Authentication by setting email and password
        
        const page2Promise = this.page.waitForEvent('popup');
        await this.page.getByRole('button', { name: 'Authenticate' }).click();       
        const page2 = await page2Promise;
        await page2.waitForLoadState();
        if(await page2.getByRole('heading', { name: 'Bad Request' }).isVisible({timeout:9000})){
            throw new Error(`Bad Request message found on Authentication Page!`);
        }
        await page2.getByRole('textbox', { name: 'Email' }).click();
        await page2.getByRole('textbox', { name: 'Email' }).fill(username);
        await page2.getByRole('button', { name: 'Next' }).click();
        await page2.getByRole('textbox', { name: 'Password' }).click();
        await page2.getByRole('textbox', { name: 'Password' }).fill(password);
        await page2.getByRole('button', { name: 'Verify' }).click();
        await page2.waitForTimeout(10000);
        const mfaLocator = await page2.getByText(`Verify with your Authenticator`, { exact: true });
        if(await mfaLocator.isVisible({timeout:9000})){
            console.log(`Need to Update MFA Code manually! Exiting test execution!`);
            test.skip(true,`Need to Update MFA Code manually! Exiting test execution!`);
        }
        if (await page2.getByText(`We can't log you in. Please check for an email from us, reset your password, or try again`).isVisible()){
            throw new Error(`Invalid password used for Authentication!`);
        }
        else{
            try{
            await this.page.getByText('Authentication Successful', { exact: true }).isVisible({timeout:9000});
            console.log("Authentication was successful!")
            }
            catch{
                throw new Error(`Authentication was not successful!`);
            }    
        }
    }

    async selectModeOfImport(modeOfImport: string) {
        // Select the mode of import
        // Wait on dialog combobox (title is no longer a heading; getByText matches visible + assistive labels)
        await this.page.getByRole('dialog').getByRole('combobox', { name: 'Select Mode of Import (File/API)' })
            .waitFor({ state: 'visible', timeout: 20000 });
        await this.bom.getItemByRoleandClick("combobox", "Select Mode of Import (File/API)");
        await this.bom.getItemByRoleandClick("option", modeOfImport);
    }

    async selectSource(source: string) {
        // Select the source of the BoM
        await this.bom.getItemByRoleandClick("combobox", "Source");
        await this.bom.getItemByRoleandClick("option", source);
    }

    async selectProfile(profile: string) {
        // Select the profile of the BoM
        await this.bom.getItemByRoleandClick("combobox", "Profile");
        await this.bom.getItemByRoleandClick("option", profile);
    }

    async clickOnImportBom(){
        await this.bom.getItemByRoleandClick("button", "Import BoM");
        // await this.page.waitForTimeout(5000);
    }
    
    async captureError(BoMType: any, BoMId: any){
        // If the import was unsuccessful track error
        await this.page.setDefaultTimeout(2000);

        if (await this.UnsuccessfulBoMImport() === true && (BoMType === "msdr"|| BoMType === "disti")) {                 
                const message1 = await this.opp.messageLocator1();
                const message2 = await this.opp.messageLocator2();
                throw new Error(`${message1} ${message2}-------------Error for ${BoMType} ${BoMId}-------------: The BoM ${BoMId} might be Expired, or not available on CCW for given Credential`);
            }
        else if (await this.UnsuccessfulBoMImport() === true && (BoMType === "distributor api"|| BoMType === "deal"|| BoMType === "estimate")){
            const message = await this.page.locator('span[class="toastMessage forceActionsText"][data-aura-class="forceActionsText"]').first().textContent();
            throw new Error(`${message}-------------Error for ${BoMType} ${BoMId}-------------`);
        }
        else if (await this.UnsuccessfulBoMImport() === true) { 
                // If the import was unsuccessful track error 
                const message = await this.opp.captureMessage();
                throw new Error(`${message}-------------Error for ${BoMType} ${BoMId}-------------: The BoM ${BoMId} might be Expired, or not available on CCW for given Credential`);            
        }
        else{
            console.log("No Error found");
        }
    }

    async putCCWRImportDetails(type: string, quoteId: string, grouping1: string, grouping2: string,grouping3: string, partNumber1: string, partNumber2: string, partNumber3: string, partNumber4: string, description1: string, description2: string, description3: string, description4: string){
        // Puts the relevant details for CCWR BoM Import on the BoM Import Page

        // Below constants returns true if any or all present, false if all absent.
        const hasGrouping = !!(grouping1 || grouping2 || grouping3); 
        const hasPartNumber = !!(partNumber1 || partNumber2 || partNumber3 || partNumber4);
        const hasDescription = !!(description1 || description2 || description3 || description4);

        /////... "Advanced settings" button will be clicked if Grouping/PartNumber Presentation/ Desc Presentation is present.../////
        if (hasGrouping || hasPartNumber || hasDescription) {
            await this.page.locator('span:has-text("Advanced Settings")').click();
        }
        //------- If any grouping variable has value "Grouping" Dropdown will clicked 
        if (hasGrouping) {
            await this.page.locator('span:has-text("Grouping")').click();
            const groupingMap = [
            { id: 'groupingAgg1', value: grouping1 },
            { id: 'groupingAgg2', value: grouping2 },
            { id: 'groupingAgg3', value: grouping3 },
            ];
            for (const { id, value } of groupingMap) {
            if (value) {    // Will click corresponding dropdown based on the non empty grouping variables
                await this.page.locator(`lightning-combobox[data-id='${id}'][data-type="picklist"]`).click();
                await this.bom.getItemByRoleandClick("option", value);
            }
            }
        }
        //------- If any partNumber variable has value "Part Number Presentation" Dropdown will clicked
        if (hasPartNumber) {
            await this.page.locator('span:has-text("Part Number Presentation")').click();
            const partMap = [
            { id: 'partPresentation1', value: partNumber1 },
            { id: 'partPresentation2', value: partNumber2 },
            { id: 'partPresentation3', value: partNumber3 },
            { id: 'partPresentation4', value: partNumber4 },
            ];
            for (const { id, value } of partMap) {
            if (value) {    // Will click corresponding dropdown based on the non empty partNumber variables
                await this.page.locator(`lightning-combobox[data-id='${id}'][data-type="picklist"]`).click();
                await this.bom.getItemByRoleandClick("option", value);
            }
            }
        }
        //------- If any description variable has value "Description Presentation" Dropdown will clicked
        if (hasDescription) {
            await this.page.locator('span:has-text("Description Presentation")').click();
            const descMap = [
            { id: 'descriptionPresentation1', value: description1 },
            { id: 'descriptionPresentation2', value: description2 },
            { id: 'descriptionPresentation3', value: description3 },
            { id: 'descriptionPresentation4', value: description4 },
            ];
            for (const { id, value } of descMap) {
            if (value) {    // Will click corresponding dropdown based on the non empty description variables
                await this.page.locator(`lightning-combobox[data-id='${id}'][data-type="picklist"]`).click();
                await this.bom.getItemByRoleandClick("option", value);
            }
            }
        }
        // updating Type and Quote ID for Import
        await this.bom.getItemByRoleandClick("combobox", "Type");
        await this.bom.getItemByRoleandClick("option", type);
        await this.bom.getItemByRoleandFill('textbox', 'Quote ID', quoteId); 

    }
        async putBoMId(BoMType: string, BoMId: string, isRenewal: string, import_to_Quote: string, aggregatedBy: string){
        // Puts BoMId based on the BoM type

            if (BoMType === "deal") {                              
            await this.page.locator('role=textbox[name*="Deal ID"]').click();
            await this.page.locator('role=textbox[name*="Deal ID"]').fill(BoMId);
            }
            else if (BoMType === "estimate") {
            await this.page.locator('role=textbox[name*="Estimate ID"]').click();
            await this.page.locator('role=textbox[name*="Estimate ID"]').fill(BoMId);
            }
            else if (BoMType === "distributor api") {
            await this.page.locator('role=textbox[name*="Quote ID"]').click();
            await this.page.locator('role=textbox[name*="Quote ID"]').fill(BoMId);
            if (this.isRenewalEnabled(isRenewal)) {
            await this.page.getByText('Is Renewal').click();
            }                    
            }
            else if (BoMType === "ccwr quote") {
            await this.bom.getItemByRoleandClick("combobox", "Import Into Existing Quote");
            await this.bom.getItemByRoleandClick("option", import_to_Quote);
            await this.bom.getItemByRoleandClick("combobox", "Quote Aggregated By");
            await this.bom.getItemByRoleandClick("option", aggregatedBy);
            await this.bom.getItemByRoleandFill('textbox', '*Quote ID', BoMId);                
            }
            else if (BoMType === "msdr"){
                await this.uploadFile(BoMType,BoMId); 
            }
            else {
                throw new Error(`Unsupported BoM Type: ${BoMType}`);
            }
        }

        async selectBomType(BoMType: string) {
            // selects the BoM type from dropdown based on BomType
            await this.bom.getItemByRoleandClick("combobox", "BoM Types");
            if (BoMType === "deal" || BoMType === "deal registration") {            
            await this.bom.getItemByRoleandClick("option", "Deal Registration");
            }
            else if (BoMType === "estimate") {
            await this.bom.getItemByRoleandClick("option", "Cisco Estimate");
            }
            else if (BoMType === "distributor api") {
            await this.bom.getItemByRoleandClick("option", "Distributor API BoM");             
            }
            else if (BoMType.startsWith("CCWR")) {
            await this.bom.getItemByRoleandClick("option", BoMType);                               
            }
            else if (BoMType === "msdr"){
                await this.bom.getItemByRoleandClick("option", "Deal Registration MSDR");
            }
            else {
                throw new Error(`Unsupported BoM Type: ${BoMType}`);
            }
        }

        async clickOnContinueButton(){
            await this.bom.getItemByRoleandClick('button', 'Continue');
        }

        async gotoBoMPage(BoMId:string, BoMType:any, Mode_of_import:any, Is_Renewal:any, currency:any, distiBoxParsing:any, bomType:any, quoteId:any) {
            try{
                if (BoMType === 'disti'){                                                       // If we are importing Disti
                    let bomLinkFound = false;
                    for (let i = 1; i <= 5; i++) {
                        if(await this.checkBoMLinkIsPresent('link', "BoM Header") === true){        // If BoM link locator is visible
                            await this.bom.getItemByRoleandClick('link', "BoM Header");             // Click on BoM link
                            bomLinkFound = true;
                            break;
                        }
                        else{  
                            console.log(`BoM header link is not enabled importing again!`);         // Go back and start Importing again
                            await this.bom.getItemByRoleandClick('button', "Cancel");  
                            await this.clickOnImportBoMButton();
                            // Wait for Import BoM dialog combobox (getByText matches visible + assistive labels)
                            await this.page.getByRole('dialog').getByRole('combobox', { name: 'BoM Types' })
                                .waitFor({ state: 'visible', timeout: 20000 });
                            await this.checkAPIProfileEnabled();
                            await this.selectModeOfImport(Mode_of_import);
                            await this.continueToNextTab();
                            await this.checkRenewalcheckboxIfTrue(Is_Renewal);
                            await this.setCurrency(currency);
                            if(distiBoxParsing && distiBoxParsing !== '' ){
                                await this.setDistiBoxParsing(distiBoxParsing);
                            }
                            await this.opp.handleIntermittentError();
                            await this.uploadFile(bomType,quoteId);                
                            await this.clickOnImportBom();
                            await this.opp.handleIntermittentError();
                            await this.handleOverrideWarning();
                            await this.bom.timeout(2000);
                        }
                    }
                    if (!bomLinkFound) {
                        throw new Error(`BoM link is still not visible after multiple imports!`);
                    }
                }
                else {
                    // Click on the link with dealId
                    await this.bom.getItemByRoleandClick("link", BoMId);
                } 
            }
            catch(err){
                console.error("Error while Import:", err);
                throw err;
            }
            await this.bom.timeout(2000);
        }

        async continueToNextTab(){
            await this.bom.getItemByRoleandClick('button', 'Continue');
        }

        private isRenewalEnabled(isRenewal: any): boolean {
            // Excel may return boolean true or string forms like "true"/"yes"
            if (isRenewal === true) return true;
            const normalized = String(isRenewal ?? "").trim().toLowerCase();
            return normalized === "true" || normalized === "yes";
        }

        async checkRenewalcheckboxIfTrue(isRenewal: any){
            // Checks Is renewal option if mentioned on excel data
            if (this.isRenewalEnabled(isRenewal)) {
                await this.page.getByText('Is Renewal').click();
            }
        }

        async setCurrency(currency: any){            
            if(await this.page.getByRole('combobox', { name: 'Currency' }).isVisible()){
                await this.bom.getItemByRoleandClick('combobox', 'Currency');
                await this.bom.getItemByRoleandClick('option', currency);          
            } else {return 0;}
        }

        async setDistiBoxParsing(distiBoxParsing: any){
            try {
                //const locator1 = this.page.locator('role=combobox[name="Disti Box Parsing"]');
                const locator1=  this.page.getByRole('combobox', { name: 'Disti Box Parsing' })
                // const locator2 = this.page.locator('role=combobox[aria-label="Disti Box Parsing"][class*="disabled"]');
                // if (await locator2.isVisible()) {
                //     console.log("Disti Box Parsing is disabled, skipping selection.");
                //     return 0; // disabled, so skip
                // }
                // await locator1.click();
                if(await locator1.isDisabled()) {
                    console.log("Disti Box Parsing is disabled, skipping selection.");
                    return;
                } else {
                    await locator1.click();
                }
                //const option = this.page.locator('role=option[name="distiBoxParsing"]');
                const option = this.page.getByRole('option', { name: distiBoxParsing });

                //await option.waitFor({ state: 'visible', timeout: 3000 });
                await option.click();
            } catch (error) {
                console.warn(`Error found`, error);
            }
        }

        async uploadFile(BoMType: any, BoMFile: any){            
            const bomFileType = BoMType === "disti" ? "distiFile" : "msdrFile";            
            await this.opp.uploadFileByBoMType(bomFileType, BoMFile);
            await this.bom.getItemByRoleandClick("button", "Done" );
        }

        async handleOverrideWarning() {
            // This method handles the override warning if it appears during BoM import
            const warningText = this.page.locator('span:has-text("Another BoM exist with different ID. Do you want to override it?")');
            const yesButton = this.page.getByRole('button', { name: 'Yes' });

            try {
                // Wait for the message to appear within 8 seconds
                await warningText.waitFor({ state: 'visible', timeout: 8000 });
                await yesButton.click();
                console.log('Clicked "Yes" on override warning.');
            } catch (error) {
                console.log('Override warning not present or not clickable.');
            }
        }

        async checkBoMLinkIsPresent(role: any, name: any){
            // This method checks if link to the BoM is present after Import BoM is clicked          
            const locator = this.page.locator(`role=${role}[name="${name}"]`);            
            try {
                    await locator.waitFor({ state: 'visible', timeout: 20000 });
                    return true;   // Link is present
                } catch (error) {
                    return false;  // Link not present (timeout or not found)
                }
        }

        async reloadBQMPageUntilCompleted(){
            // Reloads the BQM Page Until the BQM job is not complete
            let retries = 0;
            const maxRetries = 5;
            let locatorValue:  string | null = null;

            while (retries < maxRetries) {
                // Find the output-field slot for locatorToCheck
                const statusLocator = this.page.locator(`div[data-target-selection-name="sfdc:RecordField.${orgPrefix}__Batch_Queue_Manager__c.${orgPrefix}__Status__c"]`);    
                locatorValue = await statusLocator.textContent(); // extracts the text on Status of BQM Job 
                const status = locatorValue?.split(" ")[0].replace("Status", "").replace("Edit", "").trim();
                // If status is found as "Completed", break the loop
                
                if (status === "Completed") {
                    const summaryLocator = this.page.locator(`div[data-target-selection-name="sfdc:RecordField.${orgPrefix}__Batch_Queue_Manager__c.${orgPrefix}__Summary__c"]`);
                    const summaryText = await summaryLocator.textContent();
                    // Sometimes just after BQM Job completes, we may see missing Quote links as they take time to attach on summary, hence a logic to make sure quote links are attached
                    if (summaryText?.includes("Click to view the Detailed quote:") && summaryText?.includes("Click to view the quote:")) {
                        console.log("Detailed quote and Invoice Quote text is visible. Proceeding...");
                        return;
                    } else {
                        console.log("Job completed but detailed quote or Invoice Quote link is not yet visible. Waiting...");
                        await this.page.waitForTimeout(120000); // wait 120s
                        await this.page.reload();
                        await summaryLocator.waitFor({ state: 'visible', timeout: 5000 });
                        return;
                    }
                }
                else if (status === "Failed"){
                    throw new Error("The BQM job has failed!");
                }
                else{
                    // Retry: wait and reload
                    await this.page.waitForTimeout(80000); // 1min20s timeout
                    await this.page.reload();
                    console.log(`When Retrying for Number: ${retries + 1}, The Status Value is ${status}`);
                    retries++;
                }
            }
            
            if(retries===maxRetries) {console.error("BQM Job failed to complete in the max retries"); }           
        }

        async extractRcrdIdsFrmBQM() {
            // Gives the BoM and Quote Ids of the BQM job from the Summary
            const summaryTxt = await this.page.locator(`div[data-target-selection-name="sfdc:RecordField.${orgPrefix}__Batch_Queue_Manager__c.${orgPrefix}__Summary__c"]`).textContent()||'';
            console.log(`Summary Text on BQM Job is: ${summaryTxt}`);
            // Defining pattern to search what for each record ID
            const patterns = [
                { key: 'invoiceBoMId', label: 'Click to view BoM:' },
                { key: 'invoiceQuoteId', label: 'Click to view the quote:' },
                { key: 'detailedQuoteId', label: 'Click to view the Detailed quote:' },
                { key: 'detailedBoMId', label: 'Click to view SMS BoM:' } 
            ];

            const result: Record<string, string | null> = {};
            for (const pattern of patterns) {
                const key = pattern.key;
                const label = pattern.label;
                // Using regex to extract the record ID following the label
                const match = summaryTxt.match(
                new RegExp(`${label}\\s*(https:\\/\\/[^\\s]+\\/([a-zA-Z0-9]{18}))`, 'i')); // Fiters the characters to 18 characters as ID consists of 18 chars

                result[key] = match ? match[2] : null;
            }
            return result;
        }
        
        async showWarnIfIdNotFound(ids: Record<string, string | null | undefined>){
            // Will show a warning if a ID value is not found on BQM
            for (const [key, value] of Object.entries(ids)) {
                if (!value || value.trim() === "") {
                    console.warn(`Warning: ${key} is missing or blank.`);
                }
            }
        }

        async validateRecord({ id, label, recordIdType, quoteId, bomType, comparisonData, allErrors }: { id: string | null | undefined; label: string; quoteId: string; recordIdType: string | null | undefined; bomType: string; comparisonData: any; allErrors: string[]; }) {
            // Reusable helper to validate pricing data on a given CCWR record page
            // Skip if ID is missing or blank
            if (!id || id.trim() === "") return;
            
            await this.qs.goToRecord(id); // Navigate to the record page    
            //------- Extract Salesforce pricing data for the given BoM or Quote record        
            const sfData = (recordIdType === "BoM") ? await this.getPricesFromSfForBoM(id, bomType): await this.getPricesFromSfForQuote(id, bomType);             
            const htmlErr = await this.qs.compareValues(comparisonData, sfData, "Excel Input Value", "Salesforce Value"); // Compare Excel input values with Salesforce values
            if(htmlErr){
                const errTable = await this.tst.parsedHTMLTable(htmlErr);        // removes HTML tags and prints table in text format
                // Capture and log any mismatches found during validation
                if (errTable !== undefined) {
                    allErrors.push(
                    `-------------Error for ${label} ${quoteId}-------------: ${errTable}`
                    );
                }
            }            
        }        
    
        async reloadPageUntilLoaded(locatorToCheck: any) {
            // Reload Page to ensure the rollup financials are fully loaded and visible on Header Page     
            let retries = 0;
            const maxRetries = 5;
            let locatorValue = "";
    
            while (retries < maxRetries) {
                // Find the output-field slot for locatorToCheck
                const locator = locatorToCheck;
    
                    locatorValue = (await locator.textContent())?.replace(/[%\s,$]/g, '').trim() || "";
                    // If value is found and not empty or "0", break the loop
                    if (locatorValue !== "" && locatorValue !== '0.00') {
                        break;
                    }
                    else{
                        // Retry: wait and reload
                        await this.page.waitForTimeout(18000);
                        await this.page.reload();
                        retries++;
                    }
            }
            if (locatorValue === "") {
                console.error("Failed to retrieve the reference locator required for page reloading.. Or locator is not present on the page.");
            }
        }
    
        async UnsuccessfulBoMImport() {
            // Find if a BoM import is unsuccessful or not
            const searchText = "Import BoM Unsuccessful";
            const match = await this.page.locator(`:text("${searchText}")`).count();
            if (match > 0) {
                return true; // Unsuccessful imports found
            }
            else {
                return false; // No unsuccessful imports found
            }
        }

        async checkAPIProfileEnabled(){
            // Wait on dialog combobox (title is no longer a heading; getByText matches visible + assistive labels)
            await this.page.getByRole('dialog').getByRole('combobox', { name: 'Select Mode of Import (File/API)' })
                .waitFor({ state: 'visible', timeout: 20000 });
            const isAPIProfile = await this.apiProfile();
            if (isAPIProfile === true){
                console.log("API Profile Enabled");
            }
            else {
                throw new Error("API Profile Not found !");
            }
        }
    
        async apiProfile() {
            // Check if the API profile is enabled
            await this.page.getByRole('dialog').getByRole('combobox', { name: 'Select Mode of Import (File/API)' })
                .waitFor({ state: 'visible', timeout: 20000 });
            const searchText = "Select Mode of Import (File/API)";
            const match = await this.page.getByRole('dialog').getByRole('combobox', { name: searchText }).count();
    
            if (match > 0) {
            console.log(`API Profile Found: "${searchText}"`);
            return true;
            } 
            else {
            console.log(`API Profile Not found: "${searchText}"`);
            return false;
            }
        }
    
        async closeAllfNotifications() {
            // Close all popup notifications in Salesforce

            const buttons = await this.opp.sfPopUpCloseButton();
            const count = await buttons.count();
            for (let i = 0; i < count; i++) {
                await buttons.nth(i).click();
            }
        }
    
        async findBomId() {
            // Find the BoM ID from the BoM page URL
            
            await this.page.waitForURL(`**/${orgPrefix}__BoM__c/**`,{timeout:50000});
            const bomIdText = this.page.url().split(`/${orgPrefix}__BoM__c/`)[1]?.split('/')[0];
            if (bomIdText=='' ) {
                throw new Error("BoM ID not found on the page");
            }
            return bomIdText.trim();
        }

        async findBQMJobOfCCWRImport(quoteId: string){
            // Search and returns the relevant BQM Job after CCWR Import is requested on Opportunity

            const sfConn = new Connection({instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID});
            const query = `SELECT Id, Name, ${orgPrefix}__Job_Params__c FROM ${orgPrefix}__Batch_Queue_Manager__c WHERE ${orgPrefix}__Batch_Creator__c = 'ImportMaintenanceBoM' ORDER BY CreatedDate DESC LIMIT 5`;
            const result = await sfConn.query(query); 
            const records = result.records;
            for (const record of records) {
                const jobParams = record[`${orgPrefix}__Job_Params__c`];
                if (jobParams && jobParams.includes(`"CCWR_quote_id":"${quoteId}"`)) {
                    console.log(`Latest Matching BQM ID for CCWR Quote- ${quoteId} is:`, record.Id);
                    return record.Id;
                }
                else {
                    console.log("No BQM Found!")
                    return null;}
            }
        }
        
        // async getPricesFromExcel(dataPath: string) {
        //         // Read the Excel file and extract prices
        
        //         const workbook = XLSX.readFile(dataPath);
        //         const sheetName = workbook.SheetNames[0];
        //         const worksheet = workbook.Sheets[sheetName];
        //         const data: Record<string, string | number> = {};
        //         const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 , raw: true});
        //         // Assuming the first column contains the label and the second column contains the value
        //         for (const row of rows) {
        //             const [label, value] = row;
        //             if (typeof label === "string" && value !== undefined && !isNaN(Number(value))) {
        //                 data[label.trim()] = parseFloat(value as string);
        //             }
        //             else if (typeof label === "string" && value !== undefined) {
        //                 data[label.trim()] = value.trim();
        //             }
        //             else if (typeof label === "number" && value !== undefined) {
        //                 const rawValue = value.toString();
        //                 data[label.toString().trim()] = rawValue.includes('.') ? parseFloat(rawValue) : Number(rawValue);
        //             }
        //         }
        //         return data;
        //     }
    
        async getPricesFromSfForBoM(BOM_ID: string, Bom_Type: string) {
            // Query Salesforce DB for prices for BoM Header fields
    
            const BoMId = BOM_ID;
            let query: string;
            const sfConn = new Connection({instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID});
            if (Bom_Type === "MSDR") {
                query = `SELECT Id, ${orgPrefix}__New_Curr_Total_Extended_List_Price__c, ${orgPrefix}__Previous_Curr_Total_Extended_List_Price__c, ${orgPrefix}__New_Curr_Total_Extended_Net_Price__c, ${orgPrefix}__Previous_Total_Extended_Net_Price__c, ${orgPrefix}__New_Total_Discount__c, ${orgPrefix}__Previous_Total_Discount__c, ${orgPrefix}__SubscriptionOriginalUnroundRemainingTerm__c, ${orgPrefix}__SubscriptionOriginalInitialTerm__c, ${orgPrefix}__SubscriptionOriginalAutoRenewalTerm__c, ${orgPrefix}__SubscriptionOriginalBillingModel__c from ${orgPrefix}__BoM__c where id = '${BoMId}'`;
            }
            else{
                query = `SELECT Id, ${orgPrefix}__Total_Extended_List_Price__c, ${orgPrefix}__Total_Discount__c, ${orgPrefix}__Total_Extended_Net_Price__c, ${orgPrefix}__Total_BoM_Line_Items__c from ${orgPrefix}__BoM__c where id = '${BoMId}'`;
            }
            const result = await sfConn.query(query);
            
            // Create a data list with the required fields and their values
            const dataList: Record<string, number | string> = {};
            if (result.records && result.records.length > 0) {
                const record = result.records[0] as Record<string, string>;
                const orgprefix = (orgPrefix ?? "").replace(/['"]/g, '').trim();
    
                // Map the fields to the dataList
                if (Bom_Type === "MSDR") {
                    // Mapping For MSDR BoM type
                    dataList["New Total Extended List Price"] = parseFloat(record[`${orgprefix}__New_Curr_Total_Extended_List_Price__c`]) || 0;
                    dataList["Previous Total Extended List Price"] = parseFloat(record[`${orgprefix}__Previous_Curr_Total_Extended_List_Price__c`]) || 0;
                    dataList["New Total Extended Net Price"] = parseFloat(record[`${orgprefix}__New_Curr_Total_Extended_Net_Price__c`]) || 0;
                    dataList["Previous Total Extended Net Price"] = parseFloat(record[`${orgprefix}__Previous_Total_Extended_Net_Price__c`]) || 0;
                    dataList["New Total Discount"] = parseFloat(record[`${orgprefix}__New_Total_Discount__c`]) || 0;
                    dataList["Previous Total Discount"] = parseFloat(record[`${orgprefix}__Previous_Total_Discount__c`]) || 0;
                    dataList["Subsc Origin Unround Remaining Term"] = parseFloat(record[`${orgprefix}__SubscriptionOriginalUnroundRemainingTerm__c`]) || 0;
                    dataList["Subscription Original Initial Term"] = parseFloat(record[`${orgprefix}__SubscriptionOriginalInitialTerm__c`]) || 0;
                    dataList["Subscription Original Auto Renewal Term"] = parseFloat(record[`${orgprefix}__SubscriptionOriginalAutoRenewalTerm__c`]) || 0;
                    dataList["Subscription Original Billing Model"] = record[`${orgprefix}__SubscriptionOriginalBillingModel__c`] || '';
                }
                
                else{   
                    // Mapping For Deal, Estimate and Disti BoM types
                    dataList["Total Extended List Price"] = parseFloat(record[`${orgprefix}__Total_Extended_List_Price__c`]) || 0;
                    dataList["Total Discount"] = parseFloat(record[`${orgprefix}__Total_Discount__c`]) || 0;
                    dataList["Total Extended Net Price"] = parseFloat(record[`${orgprefix}__Total_Extended_Net_Price__c`]) || 0;
                    dataList["Total BoM Line Items"] = parseFloat(record[`${orgprefix}__Total_BoM_Line_Items__c`]) || 0;
                }
            }
            return dataList;
        }

        async getPricesFromSfForQuote(Quote_ID: string, Quote_Type: string) {
            // Query Salesforce DB for prices for Quote Header fields
    
            // const QuoteID = Quote_ID;
            let query: string;
            const sfConn = new Connection({instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID});
            if (Quote_Type === "MSDR") {
                query = `SELECT Id, ${orgPrefix}__New_Total_Extended_List_Price__c, ${orgPrefix}__Previous_Total_Extended_List_Price__c, ${orgPrefix}__New_VAR_Total_Cost__c, ${orgPrefix}__Previous_VAR_Total_Cost__c, ${orgPrefix}__New_VAR_Discount__c, ${orgPrefix}__Previous_VAR_Discount__c, ${orgPrefix}__SubscriptionOriginalUnroundRemainingTerm__c, ${orgPrefix}__SubscriptionOriginalInitialTerm__c, ${orgPrefix}__SubscriptionOriginalAutoRenewalTerm__c, ${orgPrefix}__SubscriptionOriginalBillingModel__c from ${orgPrefix}__CustomerBoM__c where id = '${Quote_ID}'`;
            }
            else{
                query = `SELECT Id, ${orgPrefix}__Total_Extended_List_Price__c, ${orgPrefix}__VAR_Discount__c,${orgPrefix}__Customer_Discount__c,${orgPrefix}__Margin_Pct__c, ${orgPrefix}__VAR_Total_Cost__c, ${orgPrefix}__Total_Quote_Line_Items__c from ${orgPrefix}__CustomerBoM__c where id = '${Quote_ID}'`;
            }
            const result = await sfConn.query(query);
            
            // Create a data list with the required fields and their values
            const sfDataList: Record<string, number | string> = {};
            if (result.records && result.records.length > 0) {
                const record = result.records[0] as Record<string, string>;
                const orgprefix = (orgPrefix ?? "").replace(/['"]/g, '').trim();
    
                // Map the fields to the dataList
                if (Quote_Type === "MSDR") {
                    // Mapping For MSDR BoM type
                    sfDataList["New Total Extended List Price"] = parseFloat(record[`${orgprefix}__New_Total_Extended_List_Price__c`]) || 0;
                    sfDataList["Previous Total Extended List Price"] = parseFloat(record[`${orgprefix}__Previous_Total_Extended_List_Price__c`]) || 0;
                    sfDataList["New VAR Total Cost"] = parseFloat(record[`${orgprefix}__New_VAR_Total_Cost__c`]) || 0;
                    sfDataList["Previous VAR Total Cost"] = parseFloat(record[`${orgprefix}__Previous_VAR_Total_Cost__c`]) || 0;
                    sfDataList["New VAR Discount"] = parseFloat(record[`${orgprefix}__New_VAR_Discount__c`]) || 0;
                    sfDataList["Previous VAR Discount"] = parseFloat(record[`${orgprefix}__Previous_VAR_Discount__c`]) || 0;
                    sfDataList["Subsc Origin Unround Remaining Term"] = parseFloat(record[`${orgprefix}__SubscriptionOriginalUnroundRemainingTerm__c`]) || 0;
                    sfDataList["Subscription Original Initial Term"] = parseFloat(record[`${orgprefix}__SubscriptionOriginalInitialTerm__c`]) || 0;
                    sfDataList["Subscription Original Auto Renewal Term"] = parseFloat(record[`${orgprefix}__SubscriptionOriginalAutoRenewalTerm__c`]) || 0;
                    sfDataList["Subscription Original Billing Model"] = record[`${orgprefix}__SubscriptionOriginalBillingModel__c`] || '';
                }
                
                else{   
                    // Mapping For Deal, Estimate and Disti BoM types
                    sfDataList["Total Extended List Price"] = parseFloat(record[`${orgprefix}__Total_Extended_List_Price__c`]) || 0;
                    sfDataList["VAR Discount"] = parseFloat(record[`${orgPrefix}__VAR_Discount__c`]) || 0;
                    sfDataList["VAR Total Cost"] = parseFloat(record[`${orgPrefix}__VAR_Total_Cost__c`]) || 0;
                    sfDataList["Total Quote Line Items"] = parseFloat(record[`${orgPrefix}__Total_Quote_Line_Items__c`]) || 0;
                    sfDataList["Customer Discount"] = parseFloat(record[`${orgPrefix}__Customer_Discount__c`]) || 0;
                    sfDataList["Margin Pct"] = parseFloat(record[`${orgPrefix}__Margin_Pct__c`]) || 0;
                    
                }
            }
            return sfDataList;
        }

    
        async throwError(allErrors : string[]) {
            if (allErrors.length > 0) {
                const errorDetails = allErrors.join('');
            throw new Error(
                `Process completed with ${allErrors.length} error(s):\n${errorDetails}`
            );
        }
    } 
    
    async ifXrlPopUpIsShown() {
        // Check if the XRL pop-up is shown and close it
        const locator = await this.opp.xrlPopupLocator();
        if (await locator.count() > 0) {
            await this.opp.clickXrlPopupCloseButton();
        }
    }

    async ifCorrectErrorShownForImportFailure(allErrors: string[], workbooksheetnumber: number) {
        // Check if the correct error is shown for import failure
        const workbook = XLSX.readFile(TEST_DATA_PATH);
        const worksheet = workbook.Sheets[workbook.SheetNames[workbooksheetnumber]];
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, raw: true });
        const dataRows = rows.slice(1); // Skip header row
        
        const allError: string[] = [];
        for (let i = 1; i < dataRows.length; i++) {
            const row = dataRows[i];
            const expectedError = row[8]?.toString().trim(); // Error from excel
            const actualError = allErrors[i] || ""; // error that was captured during import BoM
            if (actualError.includes(expectedError)) {
                console.log(`Correct error message shown for import failure for BoM  ${row[0]}, Id: ${row[1]}, message: "${actualError}"`);
            } else {
                allError.push(`Incorrect error message for ${row[0]},${row[1]} in row ${i + 2}: Expected to include "${expectedError}", but got "${actualError}"`);
            }            
        }
        if (allError.length>0){
            throw new Error(allError.join('\n'));          
        }
    }

    async verifyNewBoMImportPageIsLoaded() {
        // Verify if the BoM Import page is loaded
        await this.bom.getItemByRoleandClick("button", /^Import BoM/ );   // Click on the Import BoM button
        await this.bom.timeout(9000);
        // await expect(this.page.getByText('Select Mode of Import (File/API)')).toBeVisible();
        if (await this.page.getByText('Select Mode of Import (File/API)').isVisible()) {
            console.log("BoM Import Page is loaded successfully");
            }
            else {
            throw new Error("BoM Import Page is not loaded or Old BoM import Page is loaded");
            }
    }
    
    async getPricesFromExcel(dataPath: string) {
        // Read the Excel file and extract prices

        const workbook = XLSX.readFile(dataPath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data: Record<string, string | number> = {};
        const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 , raw: true});
        // Assuming the first column contains the label and the second column contains the value
        for (const row of rows) {
            const [label, value] = row;
            if (typeof label === "string" && value !== undefined && !isNaN(Number(value))) {
                data[label.trim()] = parseFloat(value as string);
            }
            else if (typeof label === "string" && value !== undefined) {
                data[label.trim()] = value.trim();
            }
            else if (typeof label === "number" && value !== undefined) {
                const rawValue = value.toString();
                data[label.toString().trim()] = rawValue.includes('.') ? parseFloat(rawValue) : Number(rawValue);
            }
        }
        return data;
    }   

}

