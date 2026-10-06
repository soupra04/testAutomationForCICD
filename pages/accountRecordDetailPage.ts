import { Page } from "@playwright/test";

export class AccountPage {
    constructor(private page: Page) {}
  
    async goto(accountId: string) {
      await this.page.goto(`${process.env.SF_INSTANCE_URL}/${accountId}`);
    }
  }
  