import { Page } from "@playwright/test";
import { libs, globalVars } from "../libs/lib";
import type { Connection, QueryResult } from "jsforce";

export class OpportunityPage {
  constructor(private page: Page) {}

  /**
   * Initialize Salesforce session & inject cookies.
   * Must be called before any SF API queries.
   */
  async init(): Promise<void> {
    await libs.SF_INIT(this.page);
  }

  /**
   * Navigate to the test opportunity page.
   */
    async openOpportunity(): Promise<void> {
        if (!globalVars.sfConn) {
            await this.init();   // ensure init before querying
        }

        const opportunityId = await this.findTestOpportunity();

        if (opportunityId) {
            await this.page.goto(`${globalVars.salesforceBaseUrl}/${opportunityId}`);
        } else {
            throw new Error(
            `Test Opportunity named "${globalVars.SF_OPPORTUNITY_NAME}" not found.`
            );
        }
    }

  /**
   * Query Salesforce to find the Opportunity ID based on name in .env
   */
  async findTestOpportunity(): Promise<string | undefined> {
        // Ensure connection is initialized
        const conn: Connection | undefined = globalVars.sfConn;
        if (!conn) {
        throw new Error("SF connection not initialized. Call init() first.");
        }

        const query = `SELECT Id FROM Opportunity WHERE Name = '${globalVars.SF_OPPORTUNITY_NAME}' LIMIT 1`;

        // Run query with proper type
        const result: QueryResult<{ Id: string }> = await conn.query<{ Id: string }>(
        query
        );

        return result.records[0]?.Id;
  }

    async messageLocator1() {
        // Locator for the first message element for unsuccessful import
        const msgloc = await this.page.locator("div[class='toastTitle slds-text-heading--small']").first();
        await msgloc.waitFor({state:'visible', timeout:30000});
        const message = await msgloc.textContent();    
        return message?.trim() || "";     
    }

    async messageLocator2() {
        // Locator for the second message element for unsuccessful import
        return await this.page.locator("span[class='toastMessage forceActionsText']").first().textContent();           
    }

    async uploadFileByBoMType(BoMType: string, filePath: string) {
        // Uploads file to the Opportunity based on the BoMType
        await this.page.locator(`input[type="file"][name="${BoMType}"]`).setInputFiles(filePath);
    }

    async xrlPopupLocator() {
        // Locator for the XRL pop-up error message
        return this.page.locator("div[class='msg ltngDeveloperError'][data-aura-class='ltngDeveloperError']");           
    }

    async handleIntermittentError(){
        try {
                const popup = await this.xrlPopupLocator();
                await popup.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}); // Wait up to 3s if it appears

                if (await popup.count() > 0) {
                    console.warn("Intermittent popup detected. Attempting to close...");
                    await this.clickXrlPopupCloseButton();
                }
            } catch (err) {
                console.error("Error while checking or closing popup:", err);
            }
    }

    async clickXrlPopupCloseButton() {
        // Clicks the close button on the XRL pop-up error message
        await this.page.locator("button[title='Cancel and close'][class='slds-button slds-modal__close slds-button_icon-bare uiButton--modal-closeBtn uiButton']").first().click();           
    }

    async captureMessage() {
        // Captures the unsuccessful import message from poup
        await this.page.locator("span[class='toastContent slds-notify__content slds-align-middle']").first().textContent();        
    }  
    
    async PricingValueLocator(fieldname: string) {
        // Locator for the pricing value field based on the field name on MSDR BoM
        return this.page.locator(`records-record-layout-item[field-label="${fieldname}"] [slot="outputField"]`).first();           
    }

    async sfPopUpCloseButton() {
        // Locator for the Salesforce pop-up close button
        return this.page.locator(".slds-notify__close button");           
    }
}
  