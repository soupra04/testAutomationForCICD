import { expect, Page } from "@playwright/test";
import { SalesforceUtils } from "../utils/sfUtils";
import dotenv from "dotenv";

dotenv.config();

export class BQMService {
    private page: Page;
    private sf: SalesforceUtils;

    constructor(page: Page, sf: SalesforceUtils) {
        this.page = page;
        this.sf = sf;
    }
    async openAndVerifyBQMPage() {
        // Open the BQM page and verify page got opened successfully
        await this.page.getByRole('button', { name: 'App Launcher' }).click();
        await this.page.getByRole('combobox', { name: 'Search apps and items...' }).click();
        await this.page.getByRole('combobox', { name: 'Search apps and items...' }).fill('Batch Queue Manager');
        await this.page.getByRole('option', { name: 'PQW Batch Queue Manager' }).click();
        await this.page.getByRole('button', { name: 'Select a List View: PQW Batch' }).click();
        await this.page.getByRole('combobox', { name: 'Search lists...' }).fill('all');
        await this.page.locator('span').filter({ hasText: 'All' }).first().click();
        const heading = this.page.getByRole('heading', { name: 'PQW Batch Queue Manager', exact: true });
        if (await heading.isVisible()) {
            console.log('BQM page opened successfully');
        } else {
            throw new Error('BQM page did not open successfully');
        }
    }

    /** Assert a recent BQM list row matches the job name pattern (UI check). */
    async assertRecentJobNameVisible(pattern: RegExp, timeoutMs = 60000): Promise<void> {
        await expect
            .poll(
                async () => {
                    const text = ((await this.page.locator('table, .slds-table, lightning-datatable').first().innerText().catch(() => '')) || '');
                    return pattern.test(text);
                },
                { timeout: timeoutMs, intervals: [2000, 5000] }
            )
            .toBe(true);
    }
}