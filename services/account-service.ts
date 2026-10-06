import { Page } from "@playwright/test";
import dotenv from "dotenv";
import { Connection } from "jsforce";
dotenv.config();

export class AccountService {
    private page: Page;
    constructor(page: Page) {
        this.page = page;
    }
  
    async visitTestAccountPage() {
        const accountId = await this.findTestAccount();
        if (accountId) {
            // await this.page.goto(`${process.env.SF_INSTANCE_URL}/lightning/r/Account/${accountId}/view`);
            await this.page.goto(`https://demosales--sdo1intqa.sandbox.lightning.force.com/lightning/r/Account/${accountId}/view`);
        } else {
            console.error("No test account found.");
        }
    }
    async findTestAccount() {
        const query = "SELECT Id, Name FROM Account WHERE Name LIKE 'Test Account%' ORDER BY CreatedDate DESC LIMIT 1 ";
        const sfConn = new Connection({instanceUrl: process.env.SF_INSTANCE_URL, accessToken: process.env.SF_SESSION_ID});
        const result = await sfConn.query(query);  // Return only the Id of the first record
        return result;
    }
}
