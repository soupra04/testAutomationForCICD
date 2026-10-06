import { expect, Page, Locator } from "@playwright/test";
import { SalesforceUtils } from "../utils/sfUtils";

const orgPrefix = process.env.SF_ORG_PREFIX;

export const saveAsNewQuoteActionLabel = "Save As New Quote";

export const quoteHeaderPricingFields = [
    "Total Extended List Price",
    "VAR Total Cost",
    "VAR Discount",
    "Total Quote Line Items",
] as const;

/** Logical keys returned by AdvanceUi.getPricingFromQuoteHeader (EQG-compatible names). */
export const eqgQuoteHeaderPricingFields = [
    "Total Extended List Price",
    "VAR Total Cost",
    "VAR Total Profit",
    "Customer Extended Price",
] as const;

/** Map logical key → Details > Financials UI label (may differ from EQG naming). */
export const eqgQuoteHeaderUiLabels: Record<(typeof eqgQuoteHeaderPricingFields)[number], string> = {
    "Total Extended List Price": "Total Extended List Price",
    "VAR Total Cost": "VAR Total Cost",
    "VAR Total Profit": "VAR Total Profit",
    "Customer Extended Price": "Total Customer Extended Price",
};

export class QuotePage {
    private sf: SalesforceUtils;

    constructor(private page: Page) {
        this.sf = new SalesforceUtils(page);
    }

    async clickFirstSupplierLocation() {
        await this.page.locator(`td[data-colname="${orgPrefix}__Supplier__c"][role="gridcell"][data-rowind="0"]`).first().click();
    }

    getExportQuoteButton(): Locator {
        return this.page.getByRole("button", { name: "Export Quote" });
    }

    getQuoteHeading(): Locator {
        // Entity label "Quote" is often outside the h1; heading may be "QT-…" or "Quote QT-…".
        return this.page
            .getByRole("heading", { name: /^Quote\s+QT-/i })
            .or(this.page.getByRole("heading", { name: /^QT-\d+/i }))
            .first();
    }

    getPricingField(fieldLabel: string): Locator {
        return this.page
            .locator(`records-record-layout-item[field-label="${fieldLabel}"] [slot="outputField"]`)
            .first();
    }

    /** Highlight-panel value next to a field label (secondary fields on quote header). */
    getHighlightPricingField(fieldLabel: string): Locator {
        return this.page.locator(`p[title="${fieldLabel}"]`).locator("xpath=following-sibling::*[1]").first();
    }

    /** Details > Financials form row for a field label. */
    getFinancialsFieldRow(uiLabel: string): Locator {
        return this.page
            .locator("div.slds-form-element", {
                has: this.page.locator("span.test-id__field-label", { hasText: new RegExp(`^${uiLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }),
            })
            .first();
    }

    async waitForQuoteDetailsPage(): Promise<void> {
        await this.getExportQuoteButton().waitFor({ state: "visible", timeout: 90000 });
    }

    async getQuoteNumberFromHeading(): Promise<string> {
        const headingText = await this.getQuoteHeading().textContent();
        return headingText?.replace(/^Quote/i, "").trim() ?? "";
    }

    async getPricingFieldValue(fieldLabel: string): Promise<string | null> {
        const field = this.getPricingField(fieldLabel);
        if ((await field.count()) === 0) {
            return null;
        }
        return (await field.textContent())?.trim() ?? null;
    }

    /**
     * Reads Quote Version from the quote header/details UI.
     * "Quote Version" appears twice on the page (highlight panel + Details form row);
     * prefer the visible highlight-panel value, then fall back to form rows.
     */
    async getQuoteVersionValue(): Promise<string | null> {
        const fieldLabel = "Quote Version";

        const highlightValue = this.getHighlightPricingField(fieldLabel);
        if ((await highlightValue.count()) > 0) {
            try {
                await highlightValue.waitFor({ state: "visible", timeout: 5000 });
                const highlightText = (await highlightValue.innerText())?.trim();
                if (highlightText) {
                    return highlightText;
                }
            } catch {
                // Fall through to form-row locators
            }
        }

        const formRow = this.getFinancialsFieldRow(fieldLabel);
        if ((await formRow.count()) > 0) {
            const value = formRow.locator(
                ".test-id__field-value, lightning-formatted-number, lightning-formatted-text, .slds-form-element__static"
            ).first();
            const formText = (await value.textContent())?.trim();
            if (formText) {
                return formText;
            }
        }

        const formElements = this.page.locator(".slds-form-element", {
            has: this.page.getByText(fieldLabel, { exact: true }),
        });
        for (let i = 0; i < (await formElements.count()); i++) {
            const row = formElements.nth(i);
            if (!(await row.isVisible())) {
                continue;
            }
            const value = row.locator(
                ".test-id__field-value, lightning-formatted-number, lightning-formatted-text, .slds-form-element__static"
            ).first();
            if ((await value.count()) === 0) {
                continue;
            }
            const text = (await value.textContent())?.trim();
            if (text) {
                return text;
            }
        }

        return null;
    }

    /** Opens Details tab and expands the Financials section when present. */
    async openDetailsFinancialsSection(): Promise<void> {
        const detailsTab = this.page.getByRole("tab", { name: "Details", exact: true });
        if (await detailsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
            await detailsTab.click();
        }

        const financials = this.page.getByRole("button", { name: "Financials", exact: true });
        if (await financials.isVisible({ timeout: 10000 }).catch(() => false)) {
            if ((await financials.getAttribute("aria-expanded")) === "false") {
                await financials.click();
            }
            await financials.scrollIntoViewIfNeeded();
        }
    }

    /**
     * Reads a pricing field from Details > Financials (preferred), then highlight panel.
     * Does not change getPricingFieldValue behavior used by create-quote flows.
     */
    async getEqgHeaderPricingFieldValue(fieldLabel: string, timeout = 15000): Promise<string | null> {
        const uiLabel =
            eqgQuoteHeaderUiLabels[fieldLabel as (typeof eqgQuoteHeaderPricingFields)[number]] ?? fieldLabel;

        const financialsRow = this.getFinancialsFieldRow(uiLabel);
        try {
            await financialsRow.waitFor({ state: "attached", timeout });
            await financialsRow.scrollIntoViewIfNeeded();
            const valueText = (await financialsRow.locator(".test-id__field-value").innerText({ timeout: 5000 }))?.trim();
            if (valueText) {
                return valueText;
            }
        } catch {
            // Fall through to highlight / legacy layout locators
        }

        const highlightValue = this.getHighlightPricingField(uiLabel);
        if ((await highlightValue.count()) > 0) {
            try {
                await highlightValue.waitFor({ state: "visible", timeout: 5000 });
                const highlightText = (await highlightValue.innerText())?.trim() ?? null;
                if (highlightText) {
                    return highlightText;
                }
            } catch {
                // Fall through
            }
        }

        const layoutField = this.getPricingField(uiLabel);
        try {
            await layoutField.waitFor({ state: "visible", timeout: 5000 });
            await layoutField.scrollIntoViewIfNeeded();
            return (await layoutField.innerText())?.trim() ?? null;
        } catch {
            return null;
        }
    }

    async openRelatedTab(): Promise<void> {
        await this.page.getByRole("tab", { name: "Related", exact: true }).click();
        await this.sf.waitForLightningLoad();
    }

    /**
     * Quote Items XRL card on Related (not "Taxes on Quote Items").
     * MCP-verified: header shows "Quote Items" + item(s) count + Show menu / Settings.
     */
    getQuoteItemsSection(): Locator {
        return this.page
            .locator("article, .slds-card")
            .filter({ has: this.page.getByText("Quote Items", { exact: true }) })
            .filter({ hasText: /\d+\s+item\(s\)/i })
            .first();
    }

    /**
     * Related → Quote Items → Show menu (9-dot) → New → Part Number + List Price → Save.
     * MCP-verified: New opens VF QuoteItemDetail in iframe title "Edit Quote Item"
     * (not Lightning record form). Menu items: Export, New, Refresh, …
     * @returns Salesforce Id of the created Quote Item when parseable from the URL.
     */
    async createQuoteItemFromRelated(options: {
        partNumber: string;
        listPrice: string;
        quantity?: string;
    }): Promise<string | undefined> {
        const partNumber = String(options.partNumber || "").trim();
        const listPrice = String(options.listPrice || "").trim();
        const quantity = String(options.quantity ?? "1").trim();
        if (!partNumber) throw new Error("Part Number is required to create a Quote Item");
        if (!listPrice) throw new Error("List Price is required to create a Quote Item");

        await this.openRelatedTab();

        // Quote Items is often below the fold on Related.
        const quoteItemsLabel = this.page.getByText("Quote Items", { exact: true }).first();
        for (let i = 0; i < 15 && !(await quoteItemsLabel.isVisible().catch(() => false)); i++) {
            await this.page.mouse.wheel(0, 1000);
            await this.page.waitForTimeout(500);
        }

        const quoteItems = this.getQuoteItemsSection();
        await expect(quoteItems).toBeVisible({ timeout: 60000 });
        await quoteItems.scrollIntoViewIfNeeded();

        // 9-dot control accessible name is "Show menu" (not Settings — that is Configure/Help).
        const showMenu = quoteItems.getByRole("button", { name: /^Show menu$/i });
        await expect(showMenu).toBeVisible({ timeout: 30000 });
        await showMenu.click();

        const newMenuItem = this.page.getByRole("menuitem", { name: /^New$/i });
        await expect(newMenuItem).toBeVisible({ timeout: 15000 });
        await newMenuItem.click();

        // Wait for New Quote Item Lightning shell, then VF iframe with the form.
        await this.page
            .waitForURL(/Cust_BoM_Item__c\/new|QuoteItemDetail/i, { timeout: 90000 })
            .catch(() => undefined);
        await expect(this.page).toHaveTitle(/New Quote Item|Quote Item/i, { timeout: 90000 });

        // FrameLocator has no .or() — wait for either iframe locator, then attach.
        const editQuoteItemIframe = this.page.locator('iframe[title="Edit Quote Item"]');
        const vfNamedIframe = this.page.locator('iframe[name^="vfFrameId_"]');
        await expect(editQuoteItemIframe.or(vfNamedIframe).first()).toBeVisible({ timeout: 90000 });
        const vfFrame = (await editQuoteItemIframe.isVisible().catch(() => false))
            ? this.page.frameLocator('iframe[title="Edit Quote Item"]')
            : this.page.frameLocator('iframe[name^="vfFrameId_"]');

        const partInput = vfFrame.locator('input[id$="partNumber"], input[name*="partNumber"]').first();
        await expect(partInput).toBeVisible({ timeout: 90000 });
        await partInput.fill(partNumber);

        const listPriceInput = vfFrame
            .locator('input[id*="List_Price__c"], input[name*="List_Price__c"]')
            .first();
        await expect(listPriceInput).toBeVisible({ timeout: 30000 });
        await listPriceInput.fill(listPrice);

        const quantityInput = vfFrame
            .locator('input[id*="Quantity__c"], input[name*="Quantity__c"]')
            .first();
        if (await quantityInput.isVisible().catch(() => false)) {
            const current = (await quantityInput.inputValue().catch(() => "")) || "";
            if (!current || current === "0") {
                await quantityInput.fill(quantity);
            }
        }

        // Prefer exact Save (not Quick Save).
        const saveBtn = vfFrame
            .locator('input[type="submit"][value="Save"]')
            .or(vfFrame.getByRole("button", { name: /^Save$/i }))
            .first();
        await expect(saveBtn).toBeVisible({ timeout: 15000 });
        await saveBtn.click();
        await this.sf.waitForLightningLoad();
        await this.page
            .waitForURL(/Cust_BoM_Item__c\/[a-zA-Z0-9]{15,18}|QuoteItemDetail/i, { timeout: 90000 })
            .catch(() => undefined);

        const url = this.page.url();
        const match = url.match(
            /\/(?:[A-Za-z0-9_]+__)?Cust_BoM_Item__c\/([a-zA-Z0-9]{15,18})(?:\/|$)/
        );
        return match?.[1];
    }
}
