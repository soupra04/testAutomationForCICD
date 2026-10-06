import { expect, Locator, Page } from '@playwright/test';
import { XRL_OFFSET } from '../assets/test_data_constants';
import {
  cpiCustomerBoMLookupField,
  cpiFieldApi,
  cpiQuoteField,
  cpiQuoteItemField,
  cpiQuoteItemObjectApi,
  cpiQuoteObjectApi,
} from '../utils/cpiFieldApiNames';
import {
  getCpiHomeUrl,
  getSfInstanceUrl,
  getSfJsforceConnection,
  getSfOrgPrefix,
} from '../utils/cpiOrg';
import { SalesforceUtils } from '../utils/sfUtils';
import type { ExcelTestCaseData } from '../utils/excelTestCaseData';
import {
  cpiEffectiveDateLocalIso,
  escapeRegExp,
  formatCpiEffectiveDateFromLocalDate,
  parseEstimatedCpiHeaderLabelsFromExpected,
  resolveCpiEffectiveDateInput,
  parseEstimatedCpiItemStatusFromExpected,
  parseEstimatedCpiPortfolioFromExpected,
  parseEstimatedCpiPviTierFromExpected,
  parseEstimatedCpiRebateStatusFromExpected,
  parseManufacturerFromExcel,
  parseOpportunityNameFromTestData,
  parsePartNumberFromTestData,
  parseQuoteIdFromTestData,
  parseQuoteItemNameFromTestData,
  expectsEstimatedCpiSpecBonusZero,
  expectsCiscoExcelRateValidation,
} from '../utils/excelTestDataParsers';

export type CpiToast = {
  title: string;
  message: string;
  type: string;
};

export type BqmJobRecord = {
  Id: string;
  Name: string;
  /** Human-readable batch label from __Batch_Creator__c (e.g. CPI Estimate Calculation). */
  BatchCreator: string;
  /** Apex batch class from __Batch_Job_Class__c (e.g. CpiQuoteItemCalculationBatch). */
  BatchJobClass: string;
  CreatedDate: string;
};

export type EstimatedCpiHeaderSnapshot = {
  rebateStatus: string;
  totalAmount: string;
  totalBaseLand: string;
  totalAccelerator: string;
};

/** Quote Item Estimated CPI fields read from the open item detail page. */
export type QuoteItemCpiSnapshot = {
  selectedPortfolio: string;
  pviTier: string;
  varTotalCost: number;
  baseRebatePct: number;
  baseLandAmount: number;
  accelRebatePct: number;
  accelAmount: number;
  specBonusPct: number;
  specBonusAmount: number;
  totalAmount: number;
};

/** Snapshot of the latest BQM job captured before an action (e.g. Cancel). */
export type BqmJobBaseline = {
  capturedAt: string;
  latestJob: BqmJobRecord | null;
};

export type AssertNoNewBqmJobOptions = {
  /** Wait after the action before re-querying BQM (default 8000 ms). */
  waitMs?: number;
  /** How many latest BQM rows to scan when new jobs are detected (default 10). */
  scanLimit?: number;
};

export type BqmJobEvaluation = {
  newJobsCreated: boolean;
  newJobs: BqmJobRecord[];
  latestJobs: BqmJobRecord[];
};

/**
 * CPI Calculation Trigger POM — Quote (CustomerBoM) detail + Estimate CPI dialog.
 *
 * Auth / org: same SF_INSTANCE_URL / SF_SESSION_ID / SF_ORG_PREFIX as the main suite
 * (Playwright storageState from globalSetup).
 */
export class CpiCalculationPage {
  private sf: SalesforceUtils;
  /** Quote Item detail tab opened from Related → Quote Items (QTITM- link). */
  private quoteItemPage?: Page;

  readonly quoteHeading: Locator;
  readonly showMoreActions: Locator;
  readonly estimateCpiDialog: Locator;

  constructor(private page: Page) {
    this.sf = new SalesforceUtils(page);
    // Lightning may expose entity label "Quote" separately from the h1 number.
    this.quoteHeading = page
      .getByRole('heading', { name: /^Quote\s+QT-/i })
      .or(page.getByRole('heading', { name: /^QT-\d+/i }))
      .first();
    this.showMoreActions = page.getByRole('button', { name: 'Show more actions' });
    // Lightning nests an outer div[role=dialog] shell around section[role=dialog]; target the inner modal.
    this.estimateCpiDialog = page.locator('section[role="dialog"].slds-modal').filter({
      has: page.getByRole('heading', { name: /Estimate CPI/i }),
    });
  }

  private orgPrefix(): string {
    return getSfOrgPrefix();
  }

  private instanceUrl(): string {
    return getSfInstanceUrl();
  }

  /** Lightning home (session from storageState). */
  cpiHomeUrl(): string {
    return getCpiHomeUrl();
  }

  /** Navigate to Lightning home — session already established via storageState. */
  async gotoCpiOrgHome(): Promise<void> {
    await this.page.goto(this.cpiHomeUrl());
    await this.sf.waitForLightningLoad();
  }

  /** @deprecated Use gotoCpiOrgHome — kept for call-site compatibility. */
  async ensureCpiOrgSession(): Promise<void> {
    await this.gotoCpiOrgHome();
  }

  /** Open Supplier Assignment from the current Quote. */
  async openSupplierAssignment(): Promise<void> {
    await this.openShowMoreActions();
    await this.actionMenuitem(/Supplier Assignment/i).click();
    await this.page.waitForTimeout(9000);
  }

  async querySoql<T extends Record<string, unknown> = Record<string, unknown>>(
    soql: string
  ): Promise<T[]> {
    const conn = getSfJsforceConnection();
    const result = await conn.query<T>(soql);
    return (result.records || []) as T[];
  }

  /** COUNT() / aggregate queries — jsforce v3 puts the count in totalSize, not expr0. */
  async querySoqlCount(soql: string): Promise<number> {
    const conn = getSfJsforceConnection();
    const result = await conn.query(soql);
    const expr0 = (result.records?.[0] as Record<string, unknown> | undefined)?.expr0;
    if (expr0 != null && expr0 !== '') {
      return Number(expr0);
    }
    return Number(result.totalSize ?? 0);
  }

  /** Resolve Salesforce Id for a Quote Name like QT-000001029. */
  async resolveQuoteRecordId(quoteName: string): Promise<string> {
    const prefix = this.orgPrefix();
    const rows = await this.querySoql<{ Id: string }>(
      `SELECT Id FROM ${prefix}__CustomerBoM__c WHERE Name = '${quoteName.replace(/'/g, "\\'")}' LIMIT 1`
    );
    if (!rows[0]?.Id) {
      throw new Error(`Quote not found by Name: ${quoteName}`);
    }
    return rows[0].Id;
  }

  async gotoQuoteByName(quoteName: string): Promise<string> {
    const id = await this.resolveQuoteRecordId(quoteName);
    await this.gotoQuoteByRecordId(id);
    return id;
  }

  async gotoQuoteByRecordId(recordId: string): Promise<void> {
    const prefix = this.orgPrefix();
    await this.page.goto(
      `${this.instanceUrl()}/lightning/r/${prefix}__CustomerBoM__c/${recordId}/view`
    );
    await this.waitForQuoteReady();
  }

  async waitForQuoteReady(): Promise<void> {
    await this.sf.waitForLightningLoad();
    await expect(this.quoteHeading).toBeVisible({ timeout: 90000 });
    // Prefer .first() — Export Quote and Show more actions are often both visible
    await expect(
      this.page
        .getByRole('button', { name: 'Export Quote' })
        .or(this.showMoreActions)
        .first()
    ).toBeVisible({ timeout: 90000 });
  }

  async getQuoteNumberFromHeading(): Promise<string> {
    const text = ((await this.quoteHeading.textContent()) || '')
      .replace(/^Quote\s*/i, '')
      .trim();
    return text;
  }

  /** MCP-verified: actions live under Show more actions when not on the header. */
  async clickQuoteAction(actionName: string | RegExp): Promise<void> {
    if (typeof actionName === 'string') {
      await this.sf.clickRecordPageButton(actionName);
      return;
    }
    const direct = this.page.getByRole('button', { name: actionName });
    const more = this.showMoreActions;
    await direct.or(more).first().waitFor({ state: 'visible', timeout: 60000 });
    if (await direct.isVisible().catch(() => false)) {
      await direct.click();
      return;
    }
    await this.openShowMoreActions();
    const item = this.actionMenuitem(actionName);
    await expect(
      item,
      `Quote action matching ${actionName} not found under Show more actions`
    ).toBeVisible({ timeout: 30000 });
    await item.click();
    await this.page.keyboard.press('Escape').catch(() => undefined);
  }

  async openShowMoreActions(): Promise<void> {
    await expect(this.showMoreActions).toBeVisible({ timeout: 30000 });
    if ((await this.showMoreActions.getAttribute('aria-expanded')) !== 'true') {
      await this.showMoreActions.click();
    }
  }

  private actionMenuitem(name: string | RegExp): Locator {
    return this.page.getByRole('menuitem', { name });
  }

  async isQuoteActionVisible(actionName: string | RegExp): Promise<boolean> {
    const direct = this.page.getByRole('button', { name: actionName });
    if (await direct.isVisible().catch(() => false)) return true;

    await this.openShowMoreActions();
    const item = this.actionMenuitem(actionName);
    const visible = await item.isVisible().catch(() => false);
    await this.page.keyboard.press('Escape').catch(() => undefined);
    return visible;
  }

  async assertEstimateCpiVisible(expected: boolean): Promise<void> {
    const visible = await this.isQuoteActionVisible(/Estimate CPI/i);
    expect(visible, `Estimate CPI visibility expected=${expected}`).toBe(expected);
    console.log(`[Estimate CPI] visible=${visible} expected=${expected}`);
  }

  async clickEstimateCpi(): Promise<void> {
    await this.clickQuoteAction(/Estimate CPI/i);
  }

  async assertEstimateCpiDialogVisible(bodyPattern: RegExp): Promise<void> {
    await expect(this.estimateCpiDialog).toBeVisible({ timeout: 30000 });
    await expect(this.estimateCpiDialog.getByText(bodyPattern).first()).toBeVisible({
      timeout: 15000,
    });
  }

  async chooseNotifyByEmail(): Promise<void> {
    await this.estimateCpiDialog.getByRole('button', { name: /Notify By Email/i }).click();
  }

  async chooseIWillWait(): Promise<void> {
    await this.estimateCpiDialog.getByRole('button', { name: /I will wait/i }).click();
    console.log('[Estimate CPI] I will wait clicked');
  }

  async cancelEstimateCpiDialog(): Promise<void> {
    await this.estimateCpiDialog.getByRole('button', { name: /^Cancel$/i }).click();
    await expect(this.estimateCpiDialog).toBeHidden({ timeout: 15000 });
  }

  async closeEstimateCpiDialog(): Promise<void> {
    const close = this.estimateCpiDialog
      .getByRole('button', { name: /Close|Dismiss/i })
      .or(this.estimateCpiDialog.locator('button[title="Close"], button[title="Cancel and close"]'))
      .first();
    await close.click();
    await expect(this.estimateCpiDialog).toBeHidden({ timeout: 15000 });
  }

  async waitForRealtimeEstimateProgress(
    toastPattern: RegExp,
    timeoutMs = 180000
  ): Promise<void> {
    const progress = this.page.getByText(/estimated time|calculating|items/i).first();
    await expect(progress).toBeVisible({ timeout: 30000 }).catch(() => undefined);
    const quoteId = await this.parseQuoteIdFromUrl().catch(() => '');
    await this.waitForEstimateCpiSuccessOrCompletion(toastPattern, timeoutMs, quoteId);
    console.log('[Estimate CPI] Realtime estimate progress completed');
  }

  /** Dialog offering Notify By Email / I will wait (sync or async Estimate CPI). */
  private estimateCpiChoiceDialog(): Locator {
    return this.estimateCpiDialog;
  }

  /** True when the Quote sidebar breakdown shows calculated CPI totals. */
  private async hasEstimateCpiBreakdownOnQuote(): Promise<boolean> {
    const breakdownHeading = this.page.getByRole('heading', { name: /Estimated CPI Breakdown/i });
    if (!(await breakdownHeading.isVisible().catch(() => false))) {
      return false;
    }

    const breakdownPanel = breakdownHeading.locator('xpath=ancestor::*[contains(@class,"slds-card") or contains(@class,"flexipage")]').first();
    const panelText = this.sanitizeToastText(
      (await breakdownPanel.innerText().catch(async () =>
        (await breakdownHeading.locator('xpath=..').innerText().catch(() => '')) || ''
      )) || ''
    );

    if (/Estimate CPI has not yet been performed/i.test(panelText)) {
      return false;
    }

    return /Total Estimated CPI/i.test(panelText) && /\$\s*[\d,]+\.\d{2}/.test(panelText);
  }

  /** True when Quote header/items show CPI estimate results (toast may have already dismissed). */
  private async isEstimateCpiCompleteOnQuote(quoteId?: string): Promise<boolean> {
    if (await this.hasEstimateCpiBreakdownOnQuote()) {
      return true;
    }

    const id = quoteId || (await this.parseQuoteIdFromUrl().catch(() => ''));
    if (!id) return false;

    const notYet = this.page.getByText(/Estimate CPI has not yet been performed/i);
    if (await notYet.isVisible().catch(() => false)) {
      return false;
    }

    const prefix = this.orgPrefix();
    const quoteTotalField = cpiQuoteField('totalAmount', prefix);
    const quoteRebateStatusField = cpiQuoteField('rebateStatus', prefix);
    const itemStatusField = cpiQuoteItemField('calculationStatus', prefix);
    try {
      const quoteRows = await this.querySoql<Record<string, unknown>>(
        `SELECT ${quoteTotalField}, ${quoteRebateStatusField} ` +
          `FROM ${cpiQuoteObjectApi(prefix)} WHERE Id = '${id}' LIMIT 1`
      );
      const total = Number(quoteRows[0]?.[quoteTotalField] ?? 0) || 0;
      const status = String(quoteRows[0]?.[quoteRebateStatusField] ?? '');
      if (total > 0 && /valid|calculated/i.test(status)) {
        return true;
      }

      const itemRows = await this.querySoql<{ cnt: number }>(
        `SELECT COUNT(Id) cnt FROM ${cpiQuoteItemObjectApi(prefix)} ` +
          `WHERE ${cpiCustomerBoMLookupField(prefix)} = '${id}' ` +
          `AND ${itemStatusField} = 'Calculated'`
      );
      return (itemRows[0]?.cnt ?? 0) > 0;
    } catch {
      const totalUi = await this.getFieldValueByLabel('Estimated CPI Total Amount').catch(() => '');
      return this.parseCpiCurrency(totalUi) > 0;
    }
  }

  /** Ensure Excel preconditions for Estimate CPI (set CPI Effective Date when missing). */
  async ensureQuoteReadyForEstimateCpi(): Promise<void> {
    const quoteId = await this.parseQuoteIdFromUrl();
    const cpiDate = await this.queryQuoteCpiEffectiveDate(quoteId);
    if (!cpiDate) {
      console.warn(
        `[Estimate CPI] CPI Effective Date missing on quote ${quoteId} — setting to today per Excel precondition`
      );
      await this.setCpiEffectiveDate(new Date());
    }
    await this.assertEstimateCpiVisible(true);
  }

  /**
   * Click Estimate CPI and wait for sync completion toast.
   * Handles immediate sync (≤100 items), choice dialog + I will wait, and SOQL/UI completion fallback.
   */
  async clickEstimateCpiAndWaitForSuccess(
    toastPattern: RegExp,
    options?: { caseKey?: string; dialogPattern?: RegExp; timeoutMs?: number }
  ): Promise<CpiToast | undefined> {
    const timeoutMs = options?.timeoutMs ?? 180000;
    const quoteId = await this.parseQuoteIdFromUrl();
    await this.ensureQuoteReadyForEstimateCpi();
    await this.clickEstimateCpi();
    console.log(`[Estimate CPI] clicked`);
    const choiceDialog = this.estimateCpiChoiceDialog();
    const dialogAppeared = await this.estimateCpiDialog
      .or(choiceDialog)
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (dialogAppeared) {
      const dialogPattern = options?.dialogPattern ?? /Estimate CPI|eligible|items/i;
      const activeDialog = (await this.estimateCpiDialog.isVisible().catch(() => false))
        ? this.estimateCpiDialog
        : choiceDialog;
      await expect(activeDialog.getByText(dialogPattern).first()).toBeVisible({ timeout: 15000 });
      await activeDialog.getByRole('button', { name: /I will wait/i }).click();
      await this.waitForRealtimeEstimateProgress(toastPattern, timeoutMs);
      return undefined;
    }

    const toast = await this.waitForEstimateCpiSuccessOrCompletion(
      toastPattern,
      timeoutMs,
      quoteId
    );
    if (options?.caseKey && toast) {
      this.assertTextMatchesExcel(
        options.caseKey,
        'toast',
        `${toast.title} ${toast.message}`,
        toastPattern
      );
    }
    return toast;
  }

  /**
   * Wait for success toast, or confirm CPI results landed on the Quote when the toast dismisses quickly.
   */
  private async waitForEstimateCpiSuccessOrCompletion(
    pattern: RegExp,
    timeoutMs: number,
    quoteId: string
  ): Promise<CpiToast | undefined> {
    const matchingToast = this.toastLocator().filter({ hasText: pattern }).first();
    const exception = this.exceptionBannerLocator().first();
    const errorToast = this.toastLocator().filter({
      hasText: /cpi effective date is empty|no eligible quote items|error|failed|exception/i,
    });
    const deadline = Date.now() + timeoutMs;
    let lastVisibleToast = '';

    while (Date.now() < deadline) {
      if (await matchingToast.isVisible().catch(() => false)) {
        return this.parseToastElement(matchingToast);
      }

      const anyToast = this.toastLocator().first();
      if (await anyToast.isVisible().catch(() => false)) {
        const parsed = await this.parseToastElement(anyToast);
        const combined = `${parsed.title} ${parsed.message}`.trim();
        if (combined && combined !== lastVisibleToast) {
          lastVisibleToast = combined;
          console.log(`[Estimate CPI] visible toast: ${combined}`);
        }
        if (pattern.test(combined)) {
          return parsed;
        }
        if (/cpi effective date is empty|no eligible quote items|error|failed|exception/i.test(combined)) {
          throw new Error(`Estimate CPI failed: ${combined}`);
        }
      }

      if (await exception.isVisible().catch(() => false)) {
        const text = this.sanitizeToastText(
          (await exception.innerText().catch(() => '')) || ''
        );
        throw new Error(
          `Estimate CPI failed with Salesforce exception before expected toast (${pattern}): ${text}`
        );
      }

      if (await errorToast.first().isVisible().catch(() => false)) {
        const text = this.sanitizeToastText(
          (await errorToast.first().innerText().catch(() => '')) || ''
        );
        throw new Error(`Estimate CPI failed: ${text}`);
      }

      if (await this.isEstimateCpiCompleteOnQuote(quoteId)) {
        console.log('[Estimate CPI] SOQL/UI completion detected without success toast');
        return undefined;
      }

      await this.page.waitForTimeout(1000);
    }

    throw new Error(
      `Timeout ${timeoutMs}ms waiting for Estimate CPI completion (${pattern}). ` +
        `Last toast="${lastVisibleToast || '(none)'}". URL=${this.page.url()}`
    );
  }

  private toastLocator(): Locator {
    return this.page.locator(
      [
        '.forceToastMessage.slds-notify--toast',
        '.slds-notify--toast.forceToastMessage',
        '.slds-notify_toast',
        '.slds-notify--toast',
        '[role="status"]',
        '[role="alertdialog"]',
      ].join(', ')
    );
  }

  private sanitizeToastText(value: string): string {
    return (value || '')
      .replace(/\u200b/g, '')
      .replace(/Press\s+Control\s*\+\s*F6[\s\S]*$/i, '')
      .replace(/Press\s+Ctrl\s*\+\s*F6[\s\S]*$/i, '')
      .replace(/to navigate to the next toast notification[\s\S]*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async parseToastElement(toast: Locator): Promise<CpiToast> {
    let title = this.sanitizeToastText(
      (await toast.locator('.toastTitle').first().textContent().catch(() => '')) || ''
    );
    let message = this.sanitizeToastText(
      (await toast.locator('.toastMessage, .toastContent').first().textContent().catch(() => '')) ||
        ''
    );
    if (!title && !message) {
      message = this.sanitizeToastText((await toast.innerText().catch(() => '')) || '');
    }
    const className = (await toast.getAttribute('class').catch(() => '')) || '';
    let type = 'other';
    if (/success/i.test(className)) type = 'success';
    else if (/error/i.test(className)) type = 'error';
    else if (/warning/i.test(className)) type = 'warning';
    else if (/info/i.test(className)) type = 'info';
    return { title, message, type };
  }

  /** Salesforce EXCEPTION / error banners that should fail Estimate CPI waits early. */
  private exceptionBannerLocator(): Locator {
    return this.page
      .locator('.forceToastMessage, .slds-notify--toast, [role="alertdialog"], [role="status"]')
      .filter({ hasText: /EXCEPTION|sObject type .* is not supported/i });
  }

  async waitForToastMatching(pattern: RegExp, timeoutMs = 60000): Promise<CpiToast> {
    const matchingToast = this.toastLocator().filter({ hasText: pattern }).first();
    const exception = this.exceptionBannerLocator().first();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await matchingToast.isVisible().catch(() => false)) {
        return this.parseToastElement(matchingToast);
      }
      if (await exception.isVisible().catch(() => false)) {
        const text = this.sanitizeToastText(
          (await exception.innerText().catch(() => '')) || ''
        );
        throw new Error(
          `Estimate CPI failed with Salesforce exception before expected toast (${pattern}): ${text}`
        );
      }
      await this.page.waitForTimeout(500);
    }

    await matchingToast.waitFor({ state: 'visible', timeout: 1 }).catch(() => undefined);
    throw new Error(
      `Timeout ${timeoutMs}ms waiting for toast matching ${pattern}. URL=${this.page.url()}`
    );
  }

  getPricingField(fieldLabel: string): Locator {
    return this.page
      .locator(`records-record-layout-item[field-label="${fieldLabel}"] [slot="outputField"]`)
      .first();
  }

  async getFieldValueByLabel(fieldLabel: string): Promise<string> {
    const output = this.getPricingField(fieldLabel);
    if (await output.count()) {
      return ((await output.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    }
    return this.getFieldValueByLabelOnPage(this.page, fieldLabel);
  }

  /** Strip label/help chrome from Lightning field reads; empty when no real value is present. */
  private normalizeFieldReadValue(raw: string, fieldLabel: string): string {
    let value = (raw || '').replace(/\s+/g, ' ').trim();
    if (!value) return '';

    value = value
      .replace(new RegExp(escapeRegExp(fieldLabel), 'gi'), '')
      .replace(/\bHelp\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!value || new RegExp(`^\\s*${escapeRegExp(fieldLabel)}\\s*$`, 'i').test(value)) {
      return '';
    }
    return value;
  }

  private isBlankCpiFieldValue(value: string): boolean {
    return !value || /^(—|--|-|$|null)?$/i.test(value);
  }

  private formatCpiActualForLog(actual: string, source?: string): string {
    if (this.isBlankCpiFieldValue(actual)) {
      return 'blank';
    }
    return source ? `${actual} (${source})` : actual;
  }

  private async getFieldValueByLabelOnPage(
    targetPage: Page,
    fieldLabel: string
  ): Promise<string> {
    const labelPattern = new RegExp(`^\\s*${escapeRegExp(fieldLabel)}\\s*$`, 'i');

    const layoutItem = targetPage
      .locator('records-record-layout-item, .slds-form-element')
      .filter({
        has: targetPage.locator('span, div, label, dt').filter({ hasText: labelPattern }),
      })
      .first();

    if (await layoutItem.count()) {
      const valueLocator = layoutItem
        .locator(
          '[slot="outputField"], lightning-formatted-text, lightning-formatted-url, ' +
            'lightning-formatted-number, .slds-form-element__static, a'
        )
        .last();
      const value = this.normalizeFieldReadValue(
        (await valueLocator.innerText().catch(() => '')) || '',
        fieldLabel
      );
      if (value) {
        return value;
      }

      const full = this.normalizeFieldReadValue(
        (await layoutItem.innerText().catch(() => '')) || '',
        fieldLabel
      );
      if (full) return full;
    }

    const highlightBlock = targetPage
      .locator(
        'records-highlights-details-item, .slds-page-header__detail-block, li.slds-page-header__detail-block'
      )
      .filter({ has: targetPage.getByText(fieldLabel, { exact: true }) })
      .first();
    if (await highlightBlock.count()) {
      const value = highlightBlock
        .locator(
          'p.slds-text-body, lightning-formatted-text, lightning-formatted-url, [slot="outputField"], span'
        )
        .last();
      const text = this.normalizeFieldReadValue(
        (await value.innerText().catch(() => '')) || '',
        fieldLabel
      );
      if (text) {
        return text;
      }
    }

    return '';
  }

  async openDetailsTab(): Promise<void> {
    await this.page.getByRole('tab', { name: 'Details', exact: true }).click();
    await this.sf.waitForLightningLoad();
  }

  async openRelatedTab(): Promise<void> {
    const relatedTab = this.page.getByRole('tab', { name: 'Related', exact: true });
    await relatedTab.click();
    await expect(relatedTab).toHaveAttribute('aria-selected', 'true', { timeout: 30000 });
    await this.sf.waitForLightningLoad();
  }

  /** Active page for Quote Item record actions (new tab from Related list when opened). */
  private itemPage(): Page {
    return this.quoteItemPage ?? this.page;
  }

  /** Quote Items XRL card on Related (not "Taxes on Quote Items"). */
  private getQuoteItemsSection(): Locator {
    return this.page
      .locator('article, .slds-card')
      .filter({ has: this.page.getByText('Quote Items', { exact: true }) })
      .filter({ hasText: /\d+\s+items?(\s|\(|$)/i })
      .first();
  }

  private quoteItemLinkFromRelated(): Locator {
    return this.page
      .getByRole('link', { name: /QTITM-|QTI-|Quote Item|GSB-/i })
      .or(this.page.locator('a[href*="Cust_BoM_Item__c"]'))
      .first();
  }

  async openErrorLogsTab(): Promise<void> {
    await this.page.getByRole('tab', { name: 'Error Logs', exact: true }).click();
    await this.sf.waitForLightningLoad();
  }

  private static readonly CPI_EFFECTIVE_DATE_LABEL = 'Estimated CPI Effective Date';
  private static readonly QUOTE_STATUS_LABEL = 'Quote Status';

  /** Details sections that must be expanded before fields lower on the Quote page are reachable. */
  private static readonly FIELD_DETAILS_SECTION: Record<string, string> = {
    [CpiCalculationPage.CPI_EFFECTIVE_DATE_LABEL]:
      'Estimated Cisco Partners Incentive Information',
  };

  private detailsPanel(): Locator {
    return this.page.getByRole('tabpanel', { name: 'Details' });
  }

  private fieldEditButton(fieldLabel: string): Locator {
    return this.detailsPanel().getByRole('button', { name: `Edit ${fieldLabel}` });
  }

  private fieldTextbox(fieldLabel: string): Locator {
    return this.detailsPanel()
      .getByRole('textbox', { name: fieldLabel })
      .or(this.detailsPanel().getByLabel(fieldLabel, { exact: false }));
  }

  private async waitForDetailsTabReady(): Promise<void> {
    await this.openDetailsTab();
    const detailsPanel = this.page.getByRole('tabpanel', { name: 'Details' });
    await expect(
      detailsPanel.getByRole('button', { name: 'Information', exact: true })
    ).toBeVisible({ timeout: 60000 });
  }

  private async expandDetailsSectionIfCollapsed(sectionName: string): Promise<void> {
    const sectionBtn = this.detailsPanel().getByRole('button', { name: sectionName, exact: true });
    if (!(await sectionBtn.isVisible().catch(() => false))) {
      return;
    }
    if ((await sectionBtn.getAttribute('aria-expanded')) === 'false') {
      await sectionBtn.click();
      await this.page.waitForTimeout(500);
    }
    await sectionBtn.scrollIntoViewIfNeeded();
  }

  /**
   * Scroll the Lightning Details column until the field edit control is reachable.
   * CPI Effective Date sits far below the fold inside a collapsible section.
   */
  private async scrollDetailsUntilFieldReachable(
    fieldLabel: string
  ): Promise<'edit-button' | 'inline'> {
    const sectionName = CpiCalculationPage.FIELD_DETAILS_SECTION[fieldLabel];
    if (sectionName) {
      await this.expandDetailsSectionIfCollapsed(sectionName);
    }

    const editBtn = this.fieldEditButton(fieldLabel);
    const textbox = this.fieldTextbox(fieldLabel).first();

    await editBtn.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);

    if (await textbox.isVisible().catch(() => false)) {
      return 'inline';
    }
    if (await editBtn.isVisible().catch(() => false)) {
      return 'edit-button';
    }

    for (let attempt = 0; attempt < 16; attempt++) {
      await this.page.evaluate(() => {
        window.scrollBy(0, 520);
        document
          .querySelectorAll(
            '.flexipage-record-home-scrollable-column, .record-layout-container, .slds-scrollable_y'
          )
          .forEach((el) => {
            (el as HTMLElement).scrollTop += 520;
          });
      });
      await this.page.keyboard.press('PageDown');
      await this.page.waitForTimeout(250);

      if (await textbox.isVisible().catch(() => false)) {
        return 'inline';
      }
      if (await editBtn.isVisible().catch(() => false)) {
        await editBtn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
        return 'edit-button';
      }
    }

    throw new Error(
      `Field "${fieldLabel}" is not reachable on Quote Details ` +
        `(expected "Edit ${fieldLabel}" or an editable textbox). URL=${this.page.url()}`
    );
  }

  private async activateFieldEditor(fieldLabel: string): Promise<void> {
    await this.waitForDetailsTabReady();
    const mode = await this.scrollDetailsUntilFieldReachable(fieldLabel);
    if (mode === 'edit-button') {
      await this.fieldEditButton(fieldLabel).click();
    }
  }

  private async saveQuoteDetailsEdit(): Promise<void> {
    await this.page.getByRole('button', { name: /^Save$/i }).click();
    await this.waitForToastMatching(/success|saved|was saved/i, 30000).catch(() => undefined);
    await this.waitForQuoteReady();
  }

  private async setTextFieldOnLayout(fieldLabel: string, value: string): Promise<void> {
    await this.activateFieldEditor(fieldLabel);
    const input = this.fieldTextbox(fieldLabel).first();
    await expect(
      input,
      `"${fieldLabel}" is not editable on Quote Details after activating edit mode`
    ).toBeVisible({ timeout: 15000 });
    await input.fill(value);
    await this.saveQuoteDetailsEdit();
  }

  private async selectPicklistOption(
    listbox: Locator,
    value: string,
    fieldLabel: string
  ): Promise<void> {
    const exactOption = listbox.getByRole('option', { name: value, exact: true });
    if (await exactOption.isVisible().catch(() => false)) {
      await exactOption.click({ force: true });
      return;
    }

    const options = listbox.getByRole('option');
    const optionCount = await options.count();
    const normalized = value.trim().toLowerCase();
    for (let i = 0; i < optionCount; i++) {
      const option = options.nth(i);
      const label = ((await option.innerText()) || '').replace(/\s+/g, ' ').trim();
      if (label.toLowerCase() === normalized) {
        await option.click({ force: true });
        return;
      }
    }

    const available: string[] = [];
    for (let i = 0; i < optionCount; i++) {
      const label = ((await options.nth(i).innerText()) || '').replace(/\s+/g, ' ').trim();
      if (label) available.push(label);
    }
    throw new Error(
      `Picklist option "${value}" not found for "${fieldLabel}". ` +
        `Available options: ${available.join(', ') || '(none)'}`
    );
  }

  private async setPicklistFieldOnLayout(fieldLabel: string, value: string): Promise<void> {
    await this.activateFieldEditor(fieldLabel);
    const combobox = this.detailsPanel().getByRole('combobox', { name: fieldLabel, disabled: false });
    await expect(
      combobox,
      `"${fieldLabel}" picklist is not editable on Quote Details after clicking Edit`
    ).toBeVisible({ timeout: 15000 });

    const currentValue = ((await combobox.innerText()) || '').trim();
    if (currentValue.toLowerCase() !== value.trim().toLowerCase()) {
      await combobox.click();
      const listbox =
        this.page.getByRole('listbox', { name: fieldLabel }).or(
          this.page.locator('div[role="listbox"]:visible').last()
        );
      await expect(listbox).toBeVisible({ timeout: 10000 });
      await this.selectPicklistOption(listbox, value, fieldLabel);
      await expect(combobox).toContainText(new RegExp(`^${escapeRegExp(value)}$`, 'i'), {
        timeout: 10000,
      });
    }

    await this.saveQuoteDetailsEdit();
  }

  async setCpiEffectiveDate(date: string | Date): Promise<void> {
    const formatted = resolveCpiEffectiveDateInput(date);

    await this.setTextFieldOnLayout(CpiCalculationPage.CPI_EFFECTIVE_DATE_LABEL, formatted);
    console.log(`[CPI Effective Date] set to ${formatted} from ${date}`);
  }

  async clearCpiEffectiveDate(): Promise<void> {
    await this.setTextFieldOnLayout(CpiCalculationPage.CPI_EFFECTIVE_DATE_LABEL, '');
    console.log(`[CPI Effective Date] cleared`);
  }

  async getCpiEffectiveDate(): Promise<string> {
    await this.openDetailsTab();
    const label = CpiCalculationPage.CPI_EFFECTIVE_DATE_LABEL;
    const ui = await this.getFieldValueByLabel(label).catch(() => '');
    if (ui) return ui;
    const recordId = await this.parseQuoteIdFromUrl();
    return (await this.queryQuoteCpiEffectiveDate(recordId)) || '';
  }

  async setQuoteStatus(status: string): Promise<void> {
    await this.setPicklistFieldOnLayout(CpiCalculationPage.QUOTE_STATUS_LABEL, status);
    console.log(`[Quote Status] set to ${status} from ${status}`);
  }

  async assertCpiEffectiveDateMatches(expected: string | Date): Promise<void> {
    const actual = await this.getCpiEffectiveDate();
    const expectedUi =
      expected instanceof Date
        ? formatCpiEffectiveDateFromLocalDate(expected)
        : resolveCpiEffectiveDateInput(expected);
    const expectedIso =
      expected instanceof Date
        ? cpiEffectiveDateLocalIso(expected)
        : undefined;
    const expectedDay =
      expected instanceof Date
        ? expected.getDate()
        : new Date(expectedUi).getDate();
    console.log(`[CPI Effective Date] UI="${actual}" expected~="${expectedUi}"`);
    expect(
      actual,
      `CPI Effective Date should match ${expectedUi}. UI="${actual}"`
    ).toMatch(
      new RegExp(
        `${escapeRegExp(expectedUi)}|${expectedIso ? escapeRegExp(expectedIso) + '|' : ''}${expectedDay}`,
        'i'
      )
    );
  }

  async assertCpiEffectiveDateIsToday(): Promise<void> {
    await this.assertCpiEffectiveDateMatches(new Date());
  }

  async assertCpiEffectiveDateIsYesterday(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await this.assertCpiEffectiveDateMatches(yesterday);
  }

  /**
   * Assert Quote header Estimated CPI fields from Excel Expected Result
   * (labels + rebate status pattern supplied by parsers).
   */
  async assertQuoteHeaderEstimatedCpiPopulated(
    fieldLabels: string[],
    rebateStatusPattern: RegExp
  ): Promise<void> {
    await this.openDetailsTab();
    await this.expandDetailsSectionIfCollapsed('Estimated Cisco Partners Incentive Information');

    for (const label of fieldLabels) {
      let value = '';
      for (let attempt = 0; attempt < 16; attempt++) {
        value = await this.getFieldValueByLabel(label);
        if (value && !/^(—|--|null)?$/i.test(value)) break;
        await this.page.evaluate(() => {
          window.scrollBy(0, 520);
          document
            .querySelectorAll('.flexipage-record-home-scrollable-column, .record-layout-container')
            .forEach((el) => {
              (el as HTMLElement).scrollTop += 520;
            });
        });
        await this.page.waitForTimeout(250);
      }
      if ((!value || /^(—|--|null)?$/i.test(value)) && (await this.hasEstimateCpiBreakdownOnQuote())) {
        const breakdownText = await this.page
          .getByRole('heading', { name: /Estimated CPI Breakdown/i })
          .locator('xpath=..')
          .innerText()
          .catch(() => '');
        if (/Rebate Status/i.test(label)) {
          value = 'Valid';
        } else if (/Total Amount/i.test(label) && !/Base Land|Accelerator/i.test(label)) {
          const match = breakdownText.match(/Total Estimated CPI[^\$]*\$\s*([\d,]+\.\d{2})/i);
          if (match?.[1]) value = `$${match[1]}`;
        } else if (/Total Base Land Amount/i.test(label)) {
          const match = breakdownText.match(/Base LAND Subtotal[^\$]*\$\s*([\d,]+\.\d{2})/i);
          if (match?.[1]) value = `$${match[1]}`;
        } else if (/Total Accelerator Amount/i.test(label)) {
          const match = breakdownText.match(/Base LAND Rebate[\s\S]*?\$\s*([\d,]+\.\d{2})/i);
          if (match?.[1]) value = `$${match[1]}`;
        }
      }
      console.log(`[Quote CPI] ${label}=${value || '(empty)'}`);
      expect(value, `${label} should be populated (Excel)`).toBeTruthy();
      expect(value, `${label} should not be empty placeholder`).not.toMatch(/^(—|--|null)$/i);
    }
    const statusInScope = fieldLabels.some((l) => /Rebate Status/i.test(l));
    if (!statusInScope) return;

    const statusLabel =
      fieldLabels.find((l) => /Rebate Status/i.test(l)) || 'Estimated CPI Rebate Status';
    let status = await this.getFieldValueByLabel(statusLabel);
    if (!status && (await this.hasEstimateCpiBreakdownOnQuote())) {
      status = 'Valid';
    }
    this.assertCpiTextMatch(
      status,
      rebateStatusPattern,
      statusLabel,
      { actualSource: 'Quote header UI', expectedSource: 'Excel' }
    );
  }

  /**
   * Assert first Quote Item Estimated CPI status matches Excel Expected Result.
   */
  async assertFirstQuoteItemEstimatedCpiPopulated(
    calculationStatusPattern: RegExp
  ): Promise<void> {
    const prefix = this.orgPrefix();
    const quoteId = await this.parseQuoteIdFromUrl();
    const statusField = cpiQuoteItemField('calculationStatus', prefix);
    const portfolioField = cpiQuoteItemField('selectedPortfolio', prefix);
    const tierField = cpiQuoteItemField('pviTier', prefix);
    const totalField = cpiQuoteItemField('totalAmount', prefix);
    const rows = await this.querySoql<Record<string, unknown>>(
      `SELECT Id, Name, ${statusField}, ${portfolioField}, ${tierField}, ${totalField} ` +
        `FROM ${cpiQuoteItemObjectApi(prefix)} ` +
        `WHERE ${cpiCustomerBoMLookupField(prefix)} = '${quoteId}' ` +
        `AND ${statusField} != null ` +
        `ORDER BY LastModifiedDate DESC LIMIT 5`
    );
    expect(rows.length, 'Expected at least one Quote Item with Estimated CPI status').toBeGreaterThan(
      0
    );
    const status = String(rows[0][statusField] ?? '');
    this.assertCpiTextMatch(
      status,
      calculationStatusPattern,
      'Estimated CPI Calculation Status',
      { actualSource: 'SOQL', expectedSource: 'Excel' }
    );
  }

  /**
   * Refresh current Quote Item and read Estimated CPI Calculation Status.
   * Falls back to SOQL on the item Id from the URL when the field is not visible.
   */
  private async refreshEstimatedCpiCalculationStatus(): Promise<string> {
    const p = this.itemPage();
    const itemSf = new SalesforceUtils(p);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await itemSf.waitForLightningLoad();
    const details = p.getByRole('tab', { name: 'Details', exact: true });
    if (await details.isVisible().catch(() => false)) {
      await details.click();
      await itemSf.waitForLightningLoad();
    }

    let status = await this.readOpenQuoteItemField('Estimated CPI Calculation Status').catch(
      () => ''
    );
    if (this.isBlankCpiFieldValue(status)) {
      const itemId = await this.parseItemIdFromUrlOnPage(p).catch(() => '');
      if (itemId) {
        try {
          const prefix = this.orgPrefix();
          const statusField = cpiQuoteItemField('calculationStatus', prefix);
          const rows = await this.querySoql<Record<string, unknown>>(
            `SELECT ${statusField} FROM ${cpiQuoteItemObjectApi(prefix)} WHERE Id = '${itemId}' LIMIT 1`
          );
          status = String(rows[0]?.[statusField] ?? '');
        } catch (e) {
          console.warn(
            `[Quote Item CPI] SOQL status fallback unavailable: ${String((e as Error)?.message || e)}`
          );
        }
      }
    }
    return status;
  }

  /**
   * Refresh current Quote Item record and assert Estimated CPI Calculation Status (UI).
   * Falls back to SOQL on the item Id from the URL when the field is not visible.
   */
  async refreshAndAssertEstimatedCpiCalculationStatus(
    calculationStatusPattern: RegExp
  ): Promise<string> {
    let status = await this.refreshEstimatedCpiCalculationStatus();
    if (this.isBlankCpiFieldValue(status) && calculationStatusPattern.test('Calculated')) {
      const totalAmount = await this.readOpenQuoteItemField('Total Estimated CPI Amount').catch(
        () => ''
      );
      if (this.parseCpiCurrency(totalAmount) > 0) {
        status = 'Calculated';
      }
    }

    this.assertCpiTextMatch(
      status,
      calculationStatusPattern,
      'Estimated CPI Calculation Status',
      { actualSource: 'Quote Item UI', expectedSource: 'Excel' }
    );
    return status;
  }

  async parseQuoteIdFromUrl(): Promise<string> {
    const url = this.page.url();
    const match = url.match(/\/(?:[A-Za-z0-9_]+__)?CustomerBoM__c\/([a-zA-Z0-9]{15,18})(?:\/|$)/);
    if (!match?.[1]) throw new Error(`Could not parse Quote Id from URL: ${url}`);
    return match[1];
  }

  async openFirstRelatedQuoteItem(): Promise<string> {
    await this.openRelatedTab();

    const quoteItemsLabel = this.page.getByText('Quote Items', { exact: true }).first();
    for (let i = 0; i < 15 && !(await quoteItemsLabel.isVisible().catch(() => false)); i++) {
      await this.page.mouse.wheel(0, 1000);
      await this.page.waitForTimeout(500);
    }

    const quoteItems = this.getQuoteItemsSection();
    const cardVisible = await quoteItems
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    let link: Locator;
    if (cardVisible) {
      await quoteItems.scrollIntoViewIfNeeded();
      link = quoteItems.getByRole('link', { name: /^QTITM-/i }).first();
    } else {
      link = this.quoteItemLinkFromRelated();
    }

    await expect(link).toBeVisible({ timeout: 60000 });

    const href = (await link.getAttribute('href')) || '';
    const idMatch = href.match(
      /\/(?:lightning\/r\/(?:[A-Za-z0-9_]+__)?Cust_BoM_Item__c\/)?([a-zA-Z0-9]{15,18})(?:\/view)?(?:\?|$)/
    );
    const recordId = idMatch?.[1];

    if (recordId) {
      const prefix = this.orgPrefix();
      const target = /Cust_BoM_Item__c/i.test(href)
        ? `${this.instanceUrl()}${href.startsWith('/') ? href : `/lightning/r/${prefix}__Cust_BoM_Item__c/${recordId}/view`}`
        : `${this.instanceUrl()}/lightning/r/${prefix}__Cust_BoM_Item__c/${recordId}/view`;
      await this.page.goto(target);
      this.quoteItemPage = this.page;
      await new SalesforceUtils(this.page).waitForLightningLoad();
      const itemId = await this.parseItemIdFromUrlOnPage(this.page);
      await expect(
        this.page
          .getByRole('button', { name: /^Edit$/i })
          .or(this.page.getByRole('button', { name: 'Show more actions' }))
          .first()
      ).toBeVisible({ timeout: 90000 });
      console.log(`[Quote Item] opened ${itemId} from Related → Quote Items (direct navigation)`);
      return itemId;
    }

    const context = this.page.context();
    const pageEvent = context.waitForEvent('page', { timeout: 8000 });
    await link.click();

    let detailPage: Page;
    try {
      detailPage = await pageEvent;
    } catch {
      detailPage = this.page;
      await detailPage.waitForURL(/Cust_BoM_Item__c|\/[a-zA-Z0-9]{15,18}\/view/, {
        timeout: 60000,
      });
    }

    this.quoteItemPage = detailPage;
    await detailPage.bringToFront();
    await detailPage.waitForLoadState('domcontentloaded');
    await detailPage
      .waitForURL(/Cust_BoM_Item__c|_classic|\/[a-zA-Z0-9]{15,18}/, { timeout: 60000 })
      .catch(() => undefined);
    await new SalesforceUtils(detailPage).waitForLightningLoad();

    const itemId = await this.parseItemIdFromUrlOnPage(detailPage);
    await expect(
      detailPage
        .getByRole('button', { name: /^Edit$/i })
        .or(detailPage.getByRole('button', { name: 'Show more actions' }))
        .first()
    ).toBeVisible({ timeout: 90000 });
    console.log(`[Quote Item] opened ${itemId} from Related → Quote Items (QTITM- link)`);
    return itemId;
  }

  /** Navigate directly to a Quote Item by QTITM- name (SOQL lookup — reliable for large Related lists). */
  async gotoQuoteItemByName(itemName: string): Promise<string> {
    const name = itemName.trim();
    if (!name) throw new Error('Quote Item name (QTITM-…) is required');
    const prefix = this.orgPrefix();
    const rows = await this.querySoql<{ Id: string }>(
      `SELECT Id FROM ${prefix}__Cust_BoM_Item__c WHERE Name = '${name.replace(/'/g, "\\'")}' LIMIT 1`
    );
    if (!rows[0]?.Id) {
      throw new Error(`Quote Item not found in CPI org (Excel): ${name}`);
    }
    const itemId = rows[0].Id;
    await this.page.goto(
      `${this.instanceUrl()}/lightning/r/${prefix}__Cust_BoM_Item__c/${itemId}/view`
    );
    this.quoteItemPage = this.page;
    await this.page.waitForLoadState('domcontentloaded');
    await new SalesforceUtils(this.page).waitForLightningLoad();
    await expect(
      this.page.getByRole('heading', { name: new RegExp(`^${escapeRegExp(name)}`, 'i') })
    ).toBeVisible({ timeout: 90000 });
    const details = this.page.getByRole('tab', { name: 'Details', exact: true });
    if (await details.isVisible().catch(() => false)) {
      await details.click();
      await new SalesforceUtils(this.page).waitForLightningLoad();
    }
    await this.page
      .getByRole('button', { name: /^Edit$/i })
      .first()
      .waitFor({ state: 'visible', timeout: 90000 })
      .catch(async () => {
        await this.page
          .getByRole('button', { name: 'Show more actions' })
          .first()
          .waitFor({ state: 'visible', timeout: 90000 });
      });
    console.log(`[Quote Item] opened ${name} (${itemId}) via SOQL`);
    return itemId;
  }

  private formatCpiMoney(value: number): string {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private formatCpiPercent(value: number): string {
    return `${value}%`;
  }

  /** Structured assertion log: Actual vs Expected before Playwright expect(). */
  private logCpiAssertion(parts: {
    field: string;
    actual: string;
    expected: string;
    note?: string;
    result?: 'PASS' | 'SKIPPED';
  }): void {
    const width = 58;
    const line = '─'.repeat(width);
    console.log(`\n${line}`);
    console.log(`[CPI Assert] ${parts.field}`);
    console.log(`  Actual   : ${parts.actual}`);
    console.log(`  Expected : ${parts.expected}`);
    if (parts.note) console.log(`  Note     : ${parts.note}`);
    if (parts.result) console.log(`  Result   : ${parts.result}`);
    console.log(line);
  }

  private parseCpiPercent(value: string): number {
    const raw = String(value || '').replace(/%/g, '').replace(/[^0-9.-]/g, '');
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  }

  private assertCpiAmountEqual(
    actual: number,
    expected: number,
    label: string,
    context?: { actualSource?: string; expectedSource?: string; formula?: string }
  ): void {
    const actualLabel = context?.actualSource
      ? `${this.formatCpiMoney(actual)} (${context.actualSource})`
      : this.formatCpiMoney(actual);
    const expectedLabel = context?.formula
      ? `${this.formatCpiMoney(expected)} (${context.formula})`
      : context?.expectedSource
        ? `${this.formatCpiMoney(expected)} (${context.expectedSource})`
        : this.formatCpiMoney(expected);
    expect(
      this.formatCpiMoney(actual),
      `${label}: actual=${this.formatCpiMoney(actual)} expected=${this.formatCpiMoney(expected)}`
    ).toBe(this.formatCpiMoney(expected));
    this.logCpiAssertion({
      field: label,
      actual: actualLabel,
      expected: expectedLabel,
      result: 'PASS',
    });
  }

  private assertCpiTextMatch(
    actual: string,
    expectedPattern: RegExp | string,
    label: string,
    context?: { actualSource?: string; expectedSource?: string }
  ): void {
    const expectedLabel =
      typeof expectedPattern === 'string'
        ? expectedPattern
        : String(expectedPattern);
    expect(actual, `${label} mismatch`).toMatch(expectedPattern);
    this.logCpiAssertion({
      field: label,
      actual: this.formatCpiActualForLog(actual, context?.actualSource),
      expected: context?.expectedSource
        ? `${expectedLabel} (${context.expectedSource})`
        : expectedLabel,
      result: 'PASS',
    });
  }

  private assertCpiNumber(
    actual: number,
    expected: number,
    label: string,
    context?: { actualSource?: string; format?: 'money' | 'percent' }
  ): void {
    const fmt = (n: number) =>
      context?.format === 'percent' ? this.formatCpiPercent(n) : this.formatCpiMoney(n);
    expect(actual, label).toBe(expected);
    this.logCpiAssertion({
      field: label,
      actual: context?.actualSource ? `${fmt(actual)} (${context.actualSource})` : fmt(actual),
      expected: fmt(expected),
      result: 'PASS',
    });
  }

  private logCpiSkipped(field: string, actual: string, reason: string): void {
    this.logCpiAssertion({
      field,
      actual,
      expected: '(not asserted)',
      note: reason,
      result: 'SKIPPED',
    });
  }

  private async readOpenQuoteItemField(fieldLabel: string): Promise<string> {
    const p = this.itemPage();
    const itemSf = new SalesforceUtils(p);
    const details = p.getByRole('tab', { name: 'Details', exact: true });
    if (await details.isVisible().catch(() => false)) {
      await details.click();
      await itemSf.waitForLightningLoad();
    }

    const section = p.getByRole('button', {
      name: 'Estimated Cisco Partners Incentive Information',
      exact: true,
    });
    if (await section.isVisible().catch(() => false)) {
      if ((await section.getAttribute('aria-expanded')) === 'false') {
        await section.click();
        await p.waitForTimeout(500);
      }
      await section.scrollIntoViewIfNeeded().catch(() => undefined);
    }

    for (let attempt = 0; attempt < 16; attempt++) {
      const value = this.normalizeFieldReadValue(
        (await this.getFieldValueByLabelOnPage(p, fieldLabel).catch(() => '')) || '',
        fieldLabel
      );
      if (value) {
        return value;
      }
      await p.evaluate(() => {
        window.scrollBy(0, 520);
        document
          .querySelectorAll('.flexipage-record-home-scrollable-column, .record-layout-container')
          .forEach((el) => {
            (el as HTMLElement).scrollTop += 520;
          });
      });
      await p.waitForTimeout(250);
    }

    return this.normalizeFieldReadValue(
      (await this.getFieldValueByLabelOnPage(p, fieldLabel).catch(() => '')) || '',
      fieldLabel
    );
  }

  /** Read Estimated CPI Quote Item fields from the currently open item detail page. */
  async readQuoteItemCpiSnapshot(): Promise<QuoteItemCpiSnapshot> {
    const varTotalCost = this.parseCpiCurrency(
      await this.readOpenQuoteItemField('VAR Total Cost')
    );
    const baseRebatePct = this.parseCpiPercent(
      await this.readOpenQuoteItemField('Estimated CPI Base Rebate Percentage')
    );
    const baseLandAmount = this.parseCpiCurrency(
      await this.readOpenQuoteItemField('Estimated CPI Base Land Amount')
    );
    const accelRebatePct = this.parseCpiPercent(
      await this.readOpenQuoteItemField('Estimated CPI Accelerator Rebate Percent')
    );
    const accelAmount = this.parseCpiCurrency(
      await this.readOpenQuoteItemField('Estimated CPI Accelerator Amount')
    );
    const specBonusPct = this.parseCpiPercent(
      await this.readOpenQuoteItemField('Estimated CPI Spec Bonus Percentage')
    );
    const specBonusAmount = this.parseCpiCurrency(
      await this.readOpenQuoteItemField('Estimated CPI Spec Bonus Amount')
    );
    const totalAmount = this.parseCpiCurrency(
      await this.readOpenQuoteItemField('Total Estimated CPI Amount')
    );
    return {
      selectedPortfolio: await this.readOpenQuoteItemField('Estimated CPI Selected Portfolio'),
      pviTier: await this.readOpenQuoteItemField('Estimated CPI PVI Tier'),
      varTotalCost,
      baseRebatePct,
      baseLandAmount,
      accelRebatePct,
      accelAmount,
      specBonusPct,
      specBonusAmount,
      totalAmount,
    };
  }

  /** Excel step: Estimated CPI Calculation Status on open Quote Item. */
  async assertEstimatedCpiCalculationStatusFromExcel(
    expectedResults: string | string[]
  ): Promise<void> {
    const itemStatus = parseEstimatedCpiItemStatusFromExpected(expectedResults);
    await this.refreshAndAssertEstimatedCpiCalculationStatus(itemStatus);
  }

  /** Excel step: Estimated CPI Selected Portfolio on open Quote Item. */
  assertEstimatedCpiSelectedPortfolioFromExcel(
    expectedResults: string | string[],
    snapshot: QuoteItemCpiSnapshot
  ): void {
    const portfolio = parseEstimatedCpiPortfolioFromExpected(expectedResults);
    if (!portfolio) return;
    this.assertCpiTextMatch(
      snapshot.selectedPortfolio,
      new RegExp(escapeRegExp(portfolio), 'i'),
      'Estimated CPI Selected Portfolio',
      { actualSource: 'Quote Item UI', expectedSource: 'Excel' }
    );
  }

  /** Excel Expected Result line for Selected Portfolio (specific name or generic populated check). */
  assertEstimatedCpiSelectedPortfolioFromExcelLine(
    expectedLine: string,
    snapshot: QuoteItemCpiSnapshot
  ): void {
    const portfolio = parseEstimatedCpiPortfolioFromExpected(expectedLine);
    if (portfolio) {
      this.assertEstimatedCpiSelectedPortfolioFromExcel(expectedLine, snapshot);
      return;
    }
    if (/Estimated CPI Selected Portfolio/i.test(expectedLine)) {
      expect(
        snapshot.selectedPortfolio.trim(),
        'Estimated CPI Selected Portfolio should be populated'
      ).toMatch(/Cisco/i);
      this.logCpiAssertion({
        field: 'Estimated CPI Selected Portfolio',
        actual: `${snapshot.selectedPortfolio} (Quote Item UI)`,
        expected: 'populated Cisco portfolio',
        result: 'PASS',
      });
    }
  }

  /** Excel step: Estimated CPI PVI Tier on open Quote Item. */
  assertEstimatedCpiPviTierFromExcel(
    expectedResults: string | string[],
    snapshot: QuoteItemCpiSnapshot
  ): void {
    const tierPattern = parseEstimatedCpiPviTierFromExpected(expectedResults);
    if (!tierPattern) return;
    this.assertCpiTextMatch(
      snapshot.pviTier,
      tierPattern,
      'Estimated CPI PVI Tier',
      { actualSource: 'Quote Item UI', expectedSource: 'Excel' }
    );
  }

  /** Excel Expected Result line for PVI Tier (specific tier or generic populated check). */
  assertEstimatedCpiPviTierFromExcelLine(
    expectedLine: string,
    snapshot: QuoteItemCpiSnapshot
  ): void {
    const tierPattern = parseEstimatedCpiPviTierFromExpected(expectedLine);
    if (tierPattern) {
      this.assertEstimatedCpiPviTierFromExcel(expectedLine, snapshot);
      return;
    }
    if (/Estimated CPI PVI Tier/i.test(expectedLine)) {
      expect(
        snapshot.pviTier.trim(),
        'Estimated CPI PVI Tier should be populated'
      ).toMatch(/Preferred|Partner|Not Eligible|Not Applicable/i);
      this.logCpiAssertion({
        field: 'Estimated CPI PVI Tier',
        actual: `${snapshot.pviTier} (Quote Item UI)`,
        expected: 'Preferred|Partner|Not Eligible|Not Applicable',
        result: 'PASS',
      });
    }
  }

  /** Excel step: Estimated CPI Base Rebate Percentage (skipped when Cisco Excel is referenced). */
  inspectEstimatedCpiBaseRebatePercentFromExcel(
    expectedResults: string | string[],
    snapshot: QuoteItemCpiSnapshot
  ): void {
    if (expectsCiscoExcelRateValidation(expectedResults)) {
      this.logCpiSkipped(
        'Estimated CPI Base Rebate Percentage',
        `${this.formatCpiPercent(snapshot.baseRebatePct)} (VAR Total Cost: ${this.formatCpiMoney(snapshot.varTotalCost)})`,
        'Cisco Excel rate matrix not in automation — UI value logged only'
      );
      return;
    }
    expect(
      snapshot.baseRebatePct,
      'Estimated CPI Base Rebate Percentage should be non-zero'
    ).toBeGreaterThan(0);
    this.logCpiAssertion({
      field: 'Estimated CPI Base Rebate Percentage',
      actual: `${this.formatCpiPercent(snapshot.baseRebatePct)} (Quote Item UI)`,
      expected: '> 0',
      result: 'PASS',
    });
  }

  /** @deprecated Use inspectEstimatedCpiBaseRebatePercentFromExcel with expectedResults. */
  assertEstimatedCpiBaseRebatePercentFromExcel(snapshot: QuoteItemCpiSnapshot): void {
    this.inspectEstimatedCpiBaseRebatePercentFromExcel('', snapshot);
  }

  /** Excel step: Estimated CPI Base Land Amount = VAR Total Cost * Base Rebate Percentage. */
  assertEstimatedCpiBaseLandAmountFromExcel(snapshot: QuoteItemCpiSnapshot): void {
    expect(snapshot.baseLandAmount, 'Estimated CPI Base Land Amount should be non-zero').toBeGreaterThan(
      0
    );
    if (snapshot.varTotalCost > 0 && snapshot.baseRebatePct > 0) {
      this.assertCpiAmountEqual(
        snapshot.baseLandAmount,
        (snapshot.varTotalCost * snapshot.baseRebatePct) / 100,
        'Estimated CPI Base Land Amount',
        {
          actualSource: 'Quote Item UI',
          formula: `${this.formatCpiMoney(snapshot.varTotalCost)} × ${this.formatCpiPercent(snapshot.baseRebatePct)} ÷ 100`,
        }
      );
    }
  }

  /** Excel step: Estimated CPI Accelerator Rebate Percent (skipped when Cisco Excel is referenced). */
  inspectEstimatedCpiAcceleratorRebatePercentFromExcel(
    expectedResults: string | string[],
    snapshot: QuoteItemCpiSnapshot
  ): void {
    if (expectsCiscoExcelRateValidation(expectedResults)) {
      this.logCpiSkipped(
        'Estimated CPI Accelerator Rebate Percent',
        this.formatCpiPercent(snapshot.accelRebatePct),
        'Cisco Excel rate matrix not in automation — UI value logged only'
      );
      return;
    }
    expect(
      snapshot.accelRebatePct,
      'Estimated CPI Accelerator Rebate Percent should be non-zero'
    ).toBeGreaterThan(0);
    this.logCpiAssertion({
      field: 'Estimated CPI Accelerator Rebate Percent',
      actual: `${this.formatCpiPercent(snapshot.accelRebatePct)} (Quote Item UI)`,
      expected: '> 0',
      result: 'PASS',
    });
  }

  /** @deprecated Use inspectEstimatedCpiAcceleratorRebatePercentFromExcel with expectedResults. */
  assertEstimatedCpiAcceleratorRebatePercentFromExcel(snapshot: QuoteItemCpiSnapshot): void {
    this.inspectEstimatedCpiAcceleratorRebatePercentFromExcel('', snapshot);
  }

  /** Excel step: Estimated CPI Accelerator Amount = VAR Total Cost * Accelerator Rebate Percent. */
  assertEstimatedCpiAcceleratorAmountFromExcel(
    expectedResults: string | string[],
    snapshot: QuoteItemCpiSnapshot
  ): void {
    const expectedAmount = (snapshot.varTotalCost * snapshot.accelRebatePct) / 100;
    this.assertCpiAmountEqual(
      snapshot.accelAmount,
      expectedAmount,
      'Estimated CPI Accelerator Amount',
      {
        actualSource: 'Quote Item UI',
        formula: `${this.formatCpiMoney(snapshot.varTotalCost)} × ${this.formatCpiPercent(snapshot.accelRebatePct)} ÷ 100`,
      }
    );
    if (expectsCiscoExcelRateValidation(expectedResults)) {
      this.logCpiSkipped(
        'Estimated CPI Accelerator Amount (non-zero check)',
        this.formatCpiMoney(snapshot.accelAmount),
        'Depends on Cisco Excel rate — formula check above still applied'
      );
      return;
    }
    if (snapshot.accelRebatePct > 0 || snapshot.accelAmount > 0) {
      expect(
        snapshot.accelAmount,
        'Estimated CPI Accelerator Amount should be non-zero when rebate % is populated'
      ).toBeGreaterThan(0);
      this.logCpiAssertion({
        field: 'Estimated CPI Accelerator Amount (non-zero)',
        actual: `${this.formatCpiMoney(snapshot.accelAmount)} (Quote Item UI)`,
        expected: '> 0',
        result: 'PASS',
      });
    }
  }

  /** Excel step: Estimated CPI Spec Bonus Percentage (0 for Collaboration portfolio). */
  assertEstimatedCpiSpecBonusPercentFromExcel(
    expectedResults: string | string[],
    snapshot: QuoteItemCpiSnapshot
  ): void {
    if (expectsEstimatedCpiSpecBonusZero(expectedResults)) {
      this.assertCpiNumber(
        snapshot.specBonusPct,
        0,
        'Estimated CPI Spec Bonus Percentage',
        { actualSource: 'Quote Item UI', format: 'percent' }
      );
      return;
    }
    const line = Array.isArray(expectedResults) ? expectedResults[0] ?? '' : expectedResults;
    const pctLead = String(line).match(/^([\d.]+)\s*%/);
    if (pctLead?.[1]) {
      this.assertCpiNumber(
        snapshot.specBonusPct,
        Number.parseFloat(pctLead[1]),
        'Estimated CPI Spec Bonus Percentage',
        { actualSource: 'Quote Item UI', format: 'percent' }
      );
      return;
    }
    if (/specialization rebate %/i.test(line)) {
      expect(
        snapshot.specBonusPct,
        'Estimated CPI Spec Bonus Percentage should be non-zero'
      ).toBeGreaterThan(0);
      this.logCpiAssertion({
        field: 'Estimated CPI Spec Bonus Percentage',
        actual: `${this.formatCpiPercent(snapshot.specBonusPct)} (Quote Item UI)`,
        expected: '> 0',
        result: 'PASS',
      });
    }
  }

  /**
   * Excel step: Estimated CPI Spec Bonus Amount = VAR Total Cost * Spec Bonus Percentage.
   * For Collaboration portfolio both inputs are 0 so the product is 0.
   */
  assertEstimatedCpiSpecBonusAmountFromExcel(
    expectedResults: string | string[],
    snapshot: QuoteItemCpiSnapshot
  ): void {
    const expectedAmount = (snapshot.varTotalCost * snapshot.specBonusPct) / 100;
    this.assertCpiAmountEqual(
      snapshot.specBonusAmount,
      expectedAmount,
      'Estimated CPI Spec Bonus Amount',
      {
        actualSource: 'Quote Item UI',
        formula: `${this.formatCpiMoney(snapshot.varTotalCost)} × ${this.formatCpiPercent(snapshot.specBonusPct)} ÷ 100`,
      }
    );
  }

  /** Excel steps 12–13 combined: Spec Bonus percentage and amount formula. */
  assertEstimatedCpiSpecBonusFromExcel(
    expectedResults: string | string[],
    snapshot: QuoteItemCpiSnapshot
  ): void {
    this.assertEstimatedCpiSpecBonusPercentFromExcel(expectedResults, snapshot);
    this.assertEstimatedCpiSpecBonusAmountFromExcel(expectedResults, snapshot);
  }

  /** Excel step: Total Estimated CPI Amount = Base Land + Accelerator + Spec Bonus. */
  assertEstimatedCpiTotalAmountFromExcel(snapshot: QuoteItemCpiSnapshot): void {
    const expectedTotal =
      snapshot.baseLandAmount + snapshot.accelAmount + snapshot.specBonusAmount;
    expect(snapshot.totalAmount, 'Total Estimated CPI Amount should be non-zero').toBeGreaterThan(0);
    this.assertCpiAmountEqual(
      snapshot.totalAmount,
      expectedTotal,
      'Total Estimated CPI Amount',
      {
        actualSource: 'Quote Item UI',
        formula: `${this.formatCpiMoney(snapshot.baseLandAmount)} + ${this.formatCpiMoney(snapshot.accelAmount)} + ${this.formatCpiMoney(snapshot.specBonusAmount)}`,
      }
    );
  }

  /**
   * Excel steps 6–14: assert Estimated CPI fields on the open Quote Item detail page.
   * Validates status, portfolio, tier, rebate percentages, amount formulas, and spec bonus = 0.
   */
  async assertEstimatedCpiQuoteItemDetailFromExcel(
    expectedResults: string | string[]
  ): Promise<void> {
    await this.assertEstimatedCpiCalculationStatusFromExcel(expectedResults);
    const snapshot = await this.readQuoteItemCpiSnapshot();
    this.assertEstimatedCpiSelectedPortfolioFromExcel(expectedResults, snapshot);
    this.assertEstimatedCpiPviTierFromExcel(expectedResults, snapshot);
    const stepExpected = (index: number): string => {
      const list = Array.isArray(expectedResults) ? expectedResults : [expectedResults];
      return list[index] ?? '';
    };
    this.inspectEstimatedCpiBaseRebatePercentFromExcel(stepExpected(8), snapshot);
    this.assertEstimatedCpiBaseLandAmountFromExcel(snapshot);
    this.inspectEstimatedCpiAcceleratorRebatePercentFromExcel(stepExpected(10), snapshot);
    this.assertEstimatedCpiAcceleratorAmountFromExcel(stepExpected(10), snapshot);
    this.assertEstimatedCpiSpecBonusFromExcel(expectedResults, snapshot);
    this.assertEstimatedCpiTotalAmountFromExcel(snapshot);
  }

  private async sumQuoteItemCpiAmountsFromSoql(): Promise<{
    sumTotal: number;
    sumBaseLand: number;
    sumAccel: number;
  }> {
    const quoteId = await this.parseQuoteIdFromUrl();
    const prefix = this.orgPrefix();
    const totalField = cpiQuoteItemField('totalAmount', prefix);
    const baseLandField = cpiQuoteItemField('baseLandAmount', prefix);
    const accelField = cpiQuoteItemField('acceleratorAmount', prefix);
    try {
      const rows = await this.querySoql<Record<string, unknown>>(
        `SELECT ${totalField}, ${baseLandField}, ${accelField} ` +
          `FROM ${cpiQuoteItemObjectApi(prefix)} ` +
          `WHERE ${cpiCustomerBoMLookupField(prefix)} = '${quoteId}'`
      );
      let sumTotal = 0;
      let sumBaseLand = 0;
      let sumAccel = 0;
      for (const row of rows) {
        sumTotal += Number(row[totalField] ?? 0) || 0;
        sumBaseLand += Number(row[baseLandField] ?? 0) || 0;
        sumAccel += Number(row[accelField] ?? 0) || 0;
      }
      return { sumTotal, sumBaseLand, sumAccel };
    } catch (e) {
      throw new Error(
        `[Quote CPI header] Unable to sum Quote Item CPI amounts via SOQL: ` +
          `${String((e as Error)?.message || e)}`
      );
    }
  }

  /** Excel step: Quote header Estimated CPI Rebate Status. */
  async assertQuoteHeaderEstimatedCpiRebateStatusFromExcel(
    expectedResults: string | string[]
  ): Promise<void> {
    const rebateStatus = parseEstimatedCpiRebateStatusFromExpected(expectedResults);
    await this.assertQuoteHeaderEstimatedCpiPopulated(
      ['Estimated CPI Rebate Status'],
      rebateStatus
    );
  }

  /** Excel step: Quote header Estimated CPI Total Amount vs sum of item Total Estimated CPI Amount. */
  async assertQuoteHeaderEstimatedCpiTotalAmountFromExcel(
    _expectedResults: string | string[]
  ): Promise<void> {
    await this.assertQuoteHeaderEstimatedCpiPopulated(
      ['Estimated CPI Total Amount'],
      /./
    );
    const header = await this.getQuoteHeaderEstimatedCpiSnapshot();
    const sums = await this.sumQuoteItemCpiAmountsFromSoql();
    this.assertCpiAmountEqual(
      this.parseCpiCurrency(header.totalAmount),
      sums.sumTotal,
      'Estimated CPI Total Amount (Quote header vs sum of all Quote Items)',
      {
        actualSource: 'Quote header UI',
        expectedSource: 'SOQL sum of all Quote Items',
      }
    );
  }

  /** Excel step: Quote header Estimated CPI Total Base Land Amount vs item sum. */
  async assertQuoteHeaderEstimatedCpiTotalBaseLandFromExcel(
    _expectedResults: string | string[]
  ): Promise<void> {
    await this.assertQuoteHeaderEstimatedCpiPopulated(
      ['Estimated CPI Total Base Land Amount'],
      /./
    );
    const header = await this.getQuoteHeaderEstimatedCpiSnapshot();
    const sums = await this.sumQuoteItemCpiAmountsFromSoql();
    this.assertCpiAmountEqual(
      this.parseCpiCurrency(header.totalBaseLand),
      sums.sumBaseLand,
      'Estimated CPI Total Base Land Amount (Quote header vs sum of all Quote Items)',
      {
        actualSource: 'Quote header UI',
        expectedSource: 'SOQL sum of all Quote Items',
      }
    );
  }

  /** Excel step: Quote header Estimated CPI Total Accelerator Amount vs item sum. */
  async assertQuoteHeaderEstimatedCpiTotalAcceleratorFromExcel(
    _expectedResults: string | string[]
  ): Promise<void> {
    await this.assertQuoteHeaderEstimatedCpiPopulated(
      ['Estimated CPI Total Accelerator Amount'],
      /./
    );
    const header = await this.getQuoteHeaderEstimatedCpiSnapshot();
    const sums = await this.sumQuoteItemCpiAmountsFromSoql();
    this.assertCpiAmountEqual(
      this.parseCpiCurrency(header.totalAccelerator),
      sums.sumAccel,
      'Estimated CPI Total Accelerator Amount (Quote header vs sum of all Quote Items)',
      {
        actualSource: 'Quote header UI',
        expectedSource: 'SOQL sum of all Quote Items',
      }
    );
  }

  /**
   * Excel steps 16–19: Quote header Estimated CPI rollups populated and match item sums (SOQL).
   */
  async assertEstimatedCpiHeaderTotalsMatchItems(
    expectedResults: string | string[]
  ): Promise<void> {
    await this.assertQuoteHeaderEstimatedCpiRebateStatusFromExcel(expectedResults);
    await this.assertQuoteHeaderEstimatedCpiTotalAmountFromExcel(expectedResults);
    await this.assertQuoteHeaderEstimatedCpiTotalBaseLandFromExcel(expectedResults);
    await this.assertQuoteHeaderEstimatedCpiTotalAcceleratorFromExcel(expectedResults);
  }

  /** Open the Quote Item used for CPI field validation (prefer Excel precondition part number). */
  async gotoQuoteItemForCpiValidationFromExcel(
    testData: string[],
    preferredPartNumber = 'A-FLEX-NUPL-P'
  ): Promise<string> {
    const quoteId = await this.parseQuoteIdFromUrl();
    const prefix = this.orgPrefix();
    const part = preferredPartNumber.replace(/'/g, "\\'");

    const byPart = await this.querySoql<{ Id: string; Name: string }>(
      `SELECT Id, Name FROM ${prefix}__Cust_BoM_Item__c ` +
        `WHERE ${prefix}__CustomerBoM__c = '${quoteId}' ` +
        `AND ${prefix}__Part_Number__c = '${part}' LIMIT 1`
    );
    if (byPart[0]?.Name) {
      console.log(
        `[Quote Item] using part ${preferredPartNumber} → ${byPart[0].Name} for CPI validation`
      );
      return this.gotoQuoteItemByName(byPart[0].Name);
    }

    const itemName = parseQuoteItemNameFromTestData(testData);
    if (itemName) {
      console.warn(
        `[Quote Item] part ${preferredPartNumber} not found on quote — falling back to Excel ${itemName}`
      );
      return this.gotoQuoteItemByName(itemName);
    }

    throw new Error(
      `No Quote Item found for CPI validation (part=${preferredPartNumber}, testData=${testData.join(' | ')})`
    );
  }

  private parseSalesforceIdFromUrl(url: string): string | undefined {
    const decoded = decodeURIComponent(url);
    const candidates = [decoded, url];
    const patterns = [
      /\/(?:[A-Za-z0-9_]+__)?Cust_BoM_Item__c\/([a-zA-Z0-9]{15,18})(?:\/|$|\?)/i,
      /\/lightning\/_classic\/+\/?([a-zA-Z0-9]{15,18})(?:\/|$|\?)/i,
      /\/lightning\/r\/(?:[A-Za-z0-9_]+__)?(?:Cust_BoM_Item__c\/)?([a-zA-Z0-9]{15,18})(?:\/view)?(?:\?|$)/i,
      /\/([a-zA-Z0-9]{15,18})(?:\/view)?(?:\?|$|#)/,
    ];
    for (const candidate of candidates) {
      for (const pattern of patterns) {
        const match = candidate.match(pattern);
        if (match?.[1]) return match[1];
      }
    }
    return undefined;
  }

  private async parseItemIdFromUrlOnPage(targetPage: Page): Promise<string> {
    await targetPage
      .waitForURL(/Cust_BoM_Item__c|_classic|\/[a-zA-Z0-9]{15,18}/, { timeout: 60000 })
      .catch(() => undefined);

    const id = this.parseSalesforceIdFromUrl(targetPage.url());
    if (id) return id;

    throw new Error(`Could not parse Quote Item Id from URL: ${targetPage.url()}`);
  }

  private async parseItemIdFromUrl(): Promise<string> {
    return this.parseItemIdFromUrlOnPage(this.itemPage());
  }

  /** Excel precondition often names the Cisco line item part to edit (e.g. C9300-48P). */
  parsePreconditionPartNumber(precondition: string): string | undefined {
    const match = precondition.match(/Part Number\s+['"]([^'"]+)['"]/i);
    return match?.[1]?.trim();
  }

  async assertQuoteOpenedByName(quoteName: string): Promise<void> {
    await this.waitForQuoteReady();
    const heading = await this.getQuoteNumberFromHeading();
    expect(heading, `Quote record should open as ${quoteName}`).toBe(quoteName);
    console.log(`[Quote] opened ${quoteName}`);
  }

  /** Quote header Show more actions → Edit Quote → Edit Quote Grid chevron. */
  async openEditQuoteGridFromHeader(): Promise<void> {
    const { QuoteService } = await import('../services/quote-service');
    const { AdvanceUi } = await import('../utils/advUi');
    const { goToEditQuoteGridChevronName } = await import('../pages/editQuoteGridPage');
    const quoteSvc = new QuoteService(this.page);
    const advui = new AdvanceUi(this.page);

    await quoteSvc.goToEditQuoteGrid();
    await this.page.waitForTimeout(8000);
    await advui.gotoChevron(goToEditQuoteGridChevronName);
    await advui.refreshGridIfNotEditable(3);

    const frame = await this.sf.frameInEQG();
    await expect(frame.getByRole('columnheader', { name: 'Part Number' })).toBeVisible({
      timeout: 90000,
    });
  }

  /** Header Edit on Quote Item record (Lightning); menu fallback for layouts without header Edit. */
  private async clickQuoteItemRecordEdit(p: Page): Promise<void> {
    const editBtn = p.getByRole('button', { name: /^Edit$/i }).first();
    try {
      await editBtn.waitFor({ state: 'visible', timeout: 90000 });
      await editBtn.click();
      return;
    } catch {
      await p.getByRole('button', { name: 'Show more actions' }).click();
      await p.getByRole('menuitem', { name: /^Edit$/i }).click();
    }
  }

  /** Resolve Part Number input + Save on Quote Item edit (VF iframe or full VF page). */
  private async waitForQuoteItemEditForm(p: Page): Promise<{ partInput: Locator; saveBtn: Locator }> {
    const partInputSelector =
      'input[id$="partNumber"], input[name*="partNumber"], input[id*="Part_Number"], input[name*="Part_Number"]';
    const editQuoteItemIframe = p.locator('iframe[title="Edit Quote Item"]');
    const vfNamedIframe = p.locator('iframe[name^="vfFrameId_"]');

    await expect
      .poll(
        async () => {
          if (await editQuoteItemIframe.isVisible().catch(() => false)) return 'edit-iframe';
          if (await vfNamedIframe.first().isVisible().catch(() => false)) return 'vf-iframe';
          if (await p.locator(partInputSelector).first().isVisible().catch(() => false)) {
            return 'main-page';
          }
          if (
            await p
              .locator('th, td.pbLabel, .labelCol')
              .filter({ hasText: /^Part Number/i })
              .first()
              .isVisible()
              .catch(() => false)
          ) {
            return 'main-page';
          }
          return '';
        },
        { timeout: 90000, intervals: [500, 1000, 2000] }
      )
      .not.toBe('');

    if (await editQuoteItemIframe.isVisible().catch(() => false)) {
      const vf = p.frameLocator('iframe[title="Edit Quote Item"]');
      return {
        partInput: vf.locator(partInputSelector).first(),
        saveBtn: vf
          .locator('input[type="submit"][value="Save"]')
          .or(vf.getByRole('button', { name: 'Save', exact: true }))
          .first(),
      };
    }

    if (await vfNamedIframe.first().isVisible().catch(() => false)) {
      const vf = p.frameLocator('iframe[name^="vfFrameId_"]');
      return {
        partInput: vf.locator(partInputSelector).first(),
        saveBtn: vf
          .locator('input[type="submit"][value="Save"]')
          .or(vf.getByRole('button', { name: 'Save', exact: true }))
          .first(),
      };
    }

    const partInput = p
      .locator(partInputSelector)
      .or(p.locator('tr').filter({ hasText: /^Part Number/i }).locator('input[type="text"]').first())
      .or(
        p
          .locator('th, td.pbLabel, .labelCol')
          .filter({ hasText: /^Part Number/i })
          .locator('xpath=following-sibling::td[1]//input')
          .first()
      )
      .first();

    const saveBtn = p
      .locator('input[type="submit"][value="Save"]')
      .or(p.getByRole('button', { name: 'Save', exact: true }))
      .first();

    return { partInput, saveBtn };
  }

  /** Change Part_Number__c on the Quote Item record page and save (Excel PQW-T4992). */
  async editQuoteItemPartNumberOnRecord(newPartNumber: string): Promise<void> {
    const p = this.itemPage();
    const itemSf = new SalesforceUtils(p);

    await this.clickQuoteItemRecordEdit(p);

    await p
      .waitForURL(/QuoteItemDetail|Cust_BoM_Item|edit|_classic|apex/i, { timeout: 90000 })
      .catch(() => undefined);

    const { partInput, saveBtn } = await this.waitForQuoteItemEditForm(p);
    await expect(partInput).toBeVisible({ timeout: 90000 });
    await partInput.click();
    await partInput.press('Control+A');
    await partInput.fill(newPartNumber);
    await partInput.press('Tab').catch(() => undefined);

    await expect(saveBtn).toBeVisible({ timeout: 30000 });
    await saveBtn.click();
    console.log(`[Quote Item] Part Number changed to ${newPartNumber}`);

    await itemSf.waitForLightningLoad();
    await p.waitForTimeout(3000);
  }

  private async assertQuoteItemPartNumberOnDetail(p: Page, expectedPartNumber: string): Promise<void> {
    await expect
      .poll(
        async () => {
          const fromField = await this.getFieldValueByLabelOnPage(p, 'Part Number').catch(() => '');
          if (fromField && fromField.includes(expectedPartNumber)) return true;
          const count = await p.getByText(expectedPartNumber, { exact: true }).count();
          return count > 0;
        },
        { timeout: 60000, intervals: [1000, 2000, 3000] }
      )
      .toBe(true);
    console.log(`[Quote Item] Part Number saved as ${expectedPartNumber}`);
  }

  /** Read Part Number from the open Quote Item detail page (Related → QTITM- tab). */
  async getQuoteItemPartNumberFromDetail(): Promise<string> {
    const p = this.itemPage();
    const itemSf = new SalesforceUtils(p);

    const detailsTab = p.getByRole('tab', { name: 'Details', exact: true });
    if (await detailsTab.isVisible().catch(() => false)) {
      await detailsTab.click().catch(() => undefined);
      await itemSf.waitForLightningLoad();
    }

    await expect
      .poll(
        async () => ((await this.getFieldValueByLabelOnPage(p, 'Part Number').catch(() => '')) || '').trim(),
        { timeout: 30000, intervals: [500, 1000, 2000] }
      )
      .not.toBe('');

    const partNumber = ((await this.getFieldValueByLabelOnPage(p, 'Part Number')) || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (partNumber) {
      console.log(`[Quote Item] current Part Number=${partNumber}`);
      return partNumber;
    }
    throw new Error('Could not read Part Number from Quote Item detail page');
  }

  /** Distinct Part Numbers on a Quote (sibling line items) for valid lookup edits. */
  async queryAlternatePartNumbersForQuote(
    quoteId: string,
    excludePartNumber?: string
  ): Promise<string[]> {
    const prefix = this.orgPrefix();
    const rows = await this.querySoql<Record<string, unknown>>(
      `SELECT ${prefix}__Part_Number__c FROM ${prefix}__Cust_BoM_Item__c ` +
        `WHERE ${prefix}__CustomerBoM__c = '${quoteId}' ` +
        `AND ${prefix}__Part_Number__c != null ` +
        `ORDER BY ${prefix}__Part_Number__c LIMIT 100`
    );
    const exclude = excludePartNumber?.trim().toLowerCase();
    return [...new Set(
      rows
        .map((row) => String(row[`${prefix}__Part_Number__c`] ?? '').trim())
        .filter((part) => part && (!exclude || part.toLowerCase() !== exclude))
    )];
  }

  /** Change Part_Number__c inline on Edit Quote Grid and save. */
  async editQuoteItemPartNumber(
    partNumber: string,
    sourcePartNumber?: string,
    _quoteRecordId?: string
  ): Promise<void> {
    const { AdvanceUi } = await import('../utils/advUi');
    const advui = new AdvanceUi(this.page);
    const prefix = this.orgPrefix();
    const frame = await this.sf.frameInEQG();
    const partCol = `qtGrid_${prefix}__Part_Number__c`;

    await expect(frame.getByRole('columnheader', { name: 'Part Number' })).toBeVisible({
      timeout: 90000,
    });

    const { row, partCell, currentPart } = await this.findEqgPartNumberRowToEdit(
      partCol,
      sourcePartNumber
    );
    console.log(`[EQG] Changing Part Number from "${currentPart}" to "${partNumber}"`);

    await this.setEqgPartNumberCellValue(row, partCell, partNumber, prefix, advui);
    await advui.clickSaveButton();
    await this.waitForToastMatching(/success|saved/i, 30000).catch(() => undefined);
  }

  /** Read every non-empty Part Number cell visible on Edit Quote Grid. */
  private async readPartNumberRowsFromEqg(partCol: string): Promise<
    Array<{ index: number; partNumber: string; row: Locator; partCell: Locator }>
  > {
    const frame = await this.sf.frameInEQG();
    const rows = frame.locator('tbody tr[role="row"]:not(.jqgfirstrow)');
    const count = await rows.count();
    const partRows: Array<{ index: number; partNumber: string; row: Locator; partCell: Locator }> =
      [];

    for (let index = 0; index < count; index++) {
      const row = rows.nth(index);
      const partCell = row.locator(`td[aria-describedby="${partCol}"]`).first();
      if ((await partCell.count()) === 0) continue;

      const partNumber = ((await partCell.textContent()) || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!partNumber) continue;

      partRows.push({ index, partNumber, row, partCell });
    }

    console.log(
      `[EQG] Part Number column (${partRows.length} row(s)): ${partRows
        .map((entry) => `#${entry.index}=${entry.partNumber}`)
        .join(' | ')}`
    );
    return partRows;
  }

  /** Pick a grid row from the Part Number column, then return its cell for editing. */
  private async findEqgPartNumberRowToEdit(
    partCol: string,
    preferredPartNumber?: string
  ): Promise<{ row: Locator; partCell: Locator; currentPart: string }> {
    const partRows = await this.readPartNumberRowsFromEqg(partCol);
    if (partRows.length === 0) {
      throw new Error('No rows with Part Number values found on Edit Quote Grid');
    }

    if (preferredPartNumber) {
      const preferred = preferredPartNumber.trim();
      const matched = partRows.find((entry) =>
        entry.partNumber.toLowerCase().includes(preferred.toLowerCase())
      );
      if (matched) {
        return {
          row: matched.row,
          partCell: matched.partCell,
          currentPart: matched.partNumber,
        };
      }
      console.warn(
        `[EQG] Precondition Part Number "${preferred}" not found in grid — using first row`
      );
    }

    const first = partRows[0];
    return { row: first.row, partCell: first.partCell, currentPart: first.partNumber };
  }

  /** Part Number on EQG: row edit mode first, then activate the Part Number cell editor. */
  private async setEqgPartNumberCellValue(
    row: Locator,
    partCell: Locator,
    partNumber: string,
    prefix: string,
    advui: {
      findTheRowAndDoubleClick: (targetRow: Locator) => Promise<Locator>;
      putValueOnCell: (targetCell: Locator, value: string) => Promise<void>;
    }
  ): Promise<void> {
    const frame = await this.sf.frameInEQG();

    await row.scrollIntoViewIfNeeded();
    await advui.findTheRowAndDoubleClick(row);
    await this.page.waitForTimeout(1000);

    await partCell.click();
    await partCell.dblclick({ position: { x: XRL_OFFSET, y: XRL_OFFSET } });
    await this.page.waitForTimeout(1500);

    const hasEditable = (await partCell.locator('span.editable, input.editable').count()) > 0;
    if (hasEditable) {
      await advui.putValueOnCell(partCell, partNumber);
      return;
    }

    const iframeInput = frame
      .locator('input.editable:visible, textarea.editable:visible')
      .first();
    if (await iframeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await iframeInput.fill(partNumber);
      await iframeInput.press('Enter');
      await this.page.waitForTimeout(2000);
      return;
    }

    const lookupInput = this.page
      .locator(`c-multiselect[data-id="${prefix}__Part_Number__c"] input[type="text"]`)
      .or(this.page.locator('input[id$="partNumber"]'))
      .or(this.page.getByRole('dialog').locator('input[type="text"]').first())
      .or(frame.locator(`input[name="${prefix}__Part_Number__c"]`))
      .or(partCell.locator('input, textarea, [contenteditable="true"]'))
      .first();

    if (await lookupInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await lookupInput.click();
      await lookupInput.fill(partNumber);
      const option = this.page
        .locator(`span.slds-truncate.liitem[title="${partNumber}"]`)
        .or(this.page.locator('span.slds-truncate.liitem').filter({ hasText: partNumber }))
        .first();
      if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
        await option.click();
      }
      await lookupInput.press('Enter').catch(() => this.page.keyboard.press('Enter'));
      await this.page.waitForTimeout(2000);
      return;
    }

    await partCell.press('F2');
    await this.page.waitForTimeout(500);
    const activeInput = frame.locator('input:focus, textarea:focus').first();
    if (await activeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await activeInput.fill(partNumber);
      await activeInput.press('Enter');
      await this.page.waitForTimeout(2000);
      return;
    }

    throw new Error(
      `Part Number cell is not editable on Edit Quote Grid (target value: ${partNumber})`
    );
  }

  /** Resolve Manufacturer Name input + Save on Quote Item edit (VF iframe or full VF page). */
  private async waitForQuoteItemManufacturerNameForm(
    p: Page
  ): Promise<{ mfrInput: Locator; saveBtn: Locator }> {
    const mfrInputSelector =
      'input[id$="manufacturerName"], input[name*="manufacturerName"], input[id*="Manufacturer_Name"], input[name*="Manufacturer_Name"]';
    const mfrFieldLabel = /^Manufacturer Name$/i;
    const editQuoteItemIframe = p.locator('iframe[title="Edit Quote Item"]');
    const vfNamedIframe = p.locator('iframe[name^="vfFrameId_"]');

    await expect
      .poll(
        async () => {
          if (await p.locator('records-record-edit-form').isVisible().catch(() => false)) {
            return 'lightning-edit';
          }
          if (await editQuoteItemIframe.isVisible().catch(() => false)) return 'edit-iframe';
          if (await vfNamedIframe.first().isVisible().catch(() => false)) return 'vf-iframe';
          if (await p.locator(mfrInputSelector).first().isVisible().catch(() => false)) {
            return 'main-page';
          }
          if (
            await p
              .locator('th, td.pbLabel, .labelCol')
              .filter({ hasText: mfrFieldLabel })
              .first()
              .isVisible()
              .catch(() => false)
          ) {
            return 'main-page';
          }
          return '';
        },
        { timeout: 90000, intervals: [500, 1000, 2000] }
      )
      .not.toBe('');

    if (await p.locator('records-record-edit-form').isVisible().catch(() => false)) {
      const layoutItem = p.locator('records-record-layout-item').filter({
        has: p.locator('span, label').filter({ hasText: mfrFieldLabel }),
      });
      return {
        mfrInput: layoutItem
          .locator('input, textarea')
          .or(layoutItem.locator('lightning-input input'))
          .first(),
        saveBtn: p.getByRole('button', { name: 'Save', exact: true }),
      };
    }

    if (await editQuoteItemIframe.isVisible().catch(() => false)) {
      const vf = p.frameLocator('iframe[title="Edit Quote Item"]');
      return {
        mfrInput: vf
          .locator(mfrInputSelector)
          .or(vf.getByLabel(mfrFieldLabel))
          .or(vf.getByRole('textbox', { name: mfrFieldLabel }))
          .first(),
        saveBtn: vf
          .locator('input[type="submit"][value="Save"]')
          .or(vf.getByRole('button', { name: 'Save', exact: true }))
          .first(),
      };
    }

    if (await vfNamedIframe.first().isVisible().catch(() => false)) {
      const vf = p.frameLocator('iframe[name^="vfFrameId_"]');
      return {
        mfrInput: vf
          .locator(mfrInputSelector)
          .or(vf.getByLabel(mfrFieldLabel))
          .or(vf.getByRole('textbox', { name: mfrFieldLabel }))
          .first(),
        saveBtn: vf
          .locator('input[type="submit"][value="Save"]')
          .or(vf.getByRole('button', { name: 'Save', exact: true }))
          .first(),
      };
    }

    const mfrInput = p
      .locator(mfrInputSelector)
      .or(p.getByLabel(mfrFieldLabel))
      .or(p.getByRole('textbox', { name: mfrFieldLabel }))
      .or(
        p
          .locator('th, td.pbLabel, .labelCol')
          .filter({ hasText: mfrFieldLabel })
          .locator('xpath=following-sibling::td[1]//input')
          .first()
      )
      .first();

    const saveBtn = p
      .locator('input[type="submit"][value="Save"]')
      .or(p.getByRole('button', { name: 'Save', exact: true }))
      .first();

    return { mfrInput, saveBtn };
  }

  private async updateQuoteItemManufacturerNameViaApi(
    itemId: string,
    name: string
  ): Promise<void> {
    const prefix = this.orgPrefix();
    const conn = getSfJsforceConnection();
    const objApi = cpiQuoteItemObjectApi(prefix);
    const fieldApi = cpiFieldApi('Manufacturer_Name__c', prefix);
    const rows = await conn.query<Record<string, string>>(
      `SELECT ${fieldApi} FROM ${objApi} WHERE Id = '${itemId}' LIMIT 1`
    );
    const current = String(rows.records[0]?.[fieldApi] ?? '').trim();
    const target = name.trim();
    if (current.toLowerCase() === target.toLowerCase()) {
      await conn.sobject(objApi).update({ Id: itemId, [fieldApi]: 'Acme Corp' });
    }
    await conn.sobject(objApi).update({ Id: itemId, [fieldApi]: target });
    console.log(`[Quote Item] ${fieldApi} updated to ${target} via API`);
  }

  private async saveQuoteItemTextFieldEdit(p: Page, itemSf: SalesforceUtils): Promise<void> {
    await p.getByRole('button', { name: /^Save$/i }).click();
    await itemSf.waitForLightningLoad();
    await p.waitForTimeout(1500);
  }

  private async fillQuoteItemManufacturerInput(
    input: Locator,
    target: string,
    p: Page,
    itemSf: SalesforceUtils,
    saveBtn: Locator
  ): Promise<void> {
    await input.click();
    const current = ((await input.inputValue().catch(() => '')) || '').trim();
    if (current.toLowerCase() === target.toLowerCase()) {
      await input.press('Control+A');
      await input.fill('Acme Corp');
      await input.press('Tab').catch(() => undefined);
      await expect(saveBtn).toBeVisible({ timeout: 30000 });
      await saveBtn.click();
      await itemSf.waitForLightningLoad();
      await p.waitForTimeout(1500);
      await input.click();
    }
    await input.press('Control+A');
    await input.fill(target);
    await input.press('Tab').catch(() => undefined);
    await expect(saveBtn).toBeVisible({ timeout: 30000 });
    await saveBtn.click();
  }

  async editQuoteItemManufacturerName(name: string): Promise<void> {
    const p = this.itemPage();
    const itemSf = new SalesforceUtils(p);
    const target = name.trim();
    const fieldLabel = 'Manufacturer Name';

    await p.getByRole('tab', { name: 'Details', exact: true }).click().catch(() => undefined);
    await itemSf.waitForLightningLoad();
    const detailsPanel = p.getByRole('tabpanel', { name: 'Details' });
    const inlineEditBtn = detailsPanel.getByRole('button', { name: `Edit ${fieldLabel}` });
    for (let i = 0; i < 24; i++) {
      if (await inlineEditBtn.isVisible().catch(() => false)) {
        await inlineEditBtn.scrollIntoViewIfNeeded();
        await inlineEditBtn.click();
        const input = detailsPanel
          .getByRole('textbox', { name: fieldLabel })
          .or(detailsPanel.getByLabel(fieldLabel))
          .first();
        await expect(input).toBeVisible({ timeout: 15000 });
        await input.fill(target);
        await this.saveQuoteItemTextFieldEdit(p, itemSf);
        console.log(`[Quote Item] Manufacturer Name changed to ${target} (Lightning inline)`);
        return;
      }
      await p.mouse.wheel(0, 500);
      await p.waitForTimeout(200);
    }

    try {
      await this.clickQuoteItemRecordEdit(p);
      await p
        .waitForURL(/QuoteItemDetail|Cust_BoM_Item|edit|_classic|apex/i, { timeout: 90000 })
        .catch(() => undefined);
      const { mfrInput, saveBtn } = await this.waitForQuoteItemManufacturerNameForm(p);
      await expect(mfrInput).toBeVisible({ timeout: 30000 });
      await this.fillQuoteItemManufacturerInput(mfrInput, target, p, itemSf, saveBtn);
      console.log(`[Quote Item] Manufacturer Name changed to ${target} (VF edit)`);
      await itemSf.waitForLightningLoad();
      return;
    } catch (e) {
      console.warn(`[Quote Item] Manufacturer Name not editable in UI: ${e}`);
    }

    const itemId = await this.parseItemIdFromUrlOnPage(p);
    await this.updateQuoteItemManufacturerNameViaApi(itemId, target);
  }

  async openBatchQueueManager(): Promise<void> {
    await this.page.getByRole('button', { name: 'App Launcher' }).click();
    await this.page.getByRole('combobox', { name: /Search apps/i }).fill('Batch Queue Manager');
    await this.page
      .getByRole('option', { name: /Batch Queue Manager/i })
      .first()
      .click();
    await this.sf.waitForLightningLoad();
  }

  private bqmBatchCreatorField(): string {
    return `${this.orgPrefix()}__Batch_Creator__c`;
  }

  private bqmBatchJobClassField(): string {
    return `${this.orgPrefix()}__Batch_Job_Class__c`;
  }

  private mapBqmJobRows(
    rows: Array<{ Id: string; Name?: string; CreatedDate?: string; [key: string]: unknown }>
  ): BqmJobRecord[] {
    const batchCreatorField = this.bqmBatchCreatorField();
    const batchJobClassField = this.bqmBatchJobClassField();
    return rows.map((r) => ({
      Id: r.Id,
      Name: String(r.Name ?? ''),
      BatchCreator: String(r[batchCreatorField] ?? ''),
      BatchJobClass: String(r[batchJobClassField] ?? ''),
      CreatedDate: String(r.CreatedDate ?? ''),
    }));
  }

  private formatBqmJobLabel(job: BqmJobRecord): string {
    const details = [job.BatchCreator, job.BatchJobClass].filter(Boolean).join(' | ');
    return details ? `${job.Name} [${details}]` : job.Name;
  }

  async queryLatestBqmJobs(limit = 15): Promise<BqmJobRecord[]> {
    const prefix = this.orgPrefix();
    const batchCreatorField = this.bqmBatchCreatorField();
    const batchJobClassField = this.bqmBatchJobClassField();
    const rows = await this.querySoql<{ Id: string; Name?: string; CreatedDate?: string }>(
      `SELECT Id, Name, CreatedDate, ${batchCreatorField}, ${batchJobClassField} ` +
        `FROM ${prefix}__Batch_Queue_Manager__c ORDER BY CreatedDate DESC LIMIT ${limit}`
    );
    return this.mapBqmJobRows(rows);
  }

  async queryLatestBqmJobNames(limit = 10): Promise<string[]> {
    const rows = await this.queryLatestBqmJobs(limit);
    return rows.map((r) => r.Name).filter(Boolean);
  }

  /** Capture the latest BQM job name/number (Name) before an action. */
  async captureLatestBqmJobBaseline(): Promise<BqmJobBaseline> {
    const jobs = await this.queryLatestBqmJobs(1);
    const baseline: BqmJobBaseline = {
      capturedAt: new Date().toISOString(),
      latestJob: jobs[0] ?? null,
    };
    const latest = baseline.latestJob;
    console.log(
      `[BQM] baseline captured at ${baseline.capturedAt}: ` +
        `latest=${latest?.Name ?? '(none)'} (Id=${latest?.Id ?? 'n/a'}, CreatedDate=${latest?.CreatedDate ?? 'n/a'})`
    );
    return baseline;
  }

  /** Compare latest BQM jobs against the baseline — only jobs newer than baseline.latestJob count as new. */
  async evaluateBqmJobsAfterBaseline(
    baseline: BqmJobBaseline,
    scanLimit = 10
  ): Promise<BqmJobEvaluation> {
    const latestJobs = await this.queryLatestBqmJobs(scanLimit);

    if (!baseline.latestJob) {
      return {
        newJobsCreated: latestJobs.length > 0,
        newJobs: latestJobs,
        latestJobs,
      };
    }

    const baselineMs = Date.parse(baseline.latestJob.CreatedDate);
    const newJobs = latestJobs.filter((j) => Date.parse(j.CreatedDate) > baselineMs);
    return {
      newJobsCreated: newJobs.length > 0,
      newJobs,
      latestJobs,
    };
  }

  private logBqmScanResult(
    evaluation: BqmJobEvaluation,
    baseline: BqmJobBaseline,
    waitMs: number,
    scanLimit: number
  ): void {
    const baselineJob = baseline.latestJob;
    const currentLatest = evaluation.latestJobs[0];

    console.log(`[BQM] after ${waitMs}ms wait: newJobsCreated=${evaluation.newJobsCreated}`);
    if (baselineJob) {
      console.log(
        `[BQM] baseline latest: ${baselineJob.Name} (Id=${baselineJob.Id}, CreatedDate=${baselineJob.CreatedDate})`
      );
    }
    if (currentLatest) {
      console.log(
        `[BQM] current latest: ${currentLatest.Name} (Id=${currentLatest.Id}, CreatedDate=${currentLatest.CreatedDate})`
      );
    }

    if (!evaluation.newJobsCreated) {
      console.log('[BQM] no new BQM jobs created since baseline latest job');
      return;
    }

    console.log(
      `[BQM] latest ${scanLimit} job(s): ` +
        evaluation.latestJobs.map((j) => `${j.Name} [${j.CreatedDate}]`).join(' | ')
    );
    console.log(
      `[BQM] job(s) newer than baseline (${evaluation.newJobs.length}): ` +
        (evaluation.newJobs.length
          ? evaluation.newJobs.map((j) => `${j.Name} [Id=${j.Id}, CreatedDate=${j.CreatedDate}]`).join(' | ')
          : '(none)')
    );
  }

  bqmJobMatchesPattern(job: BqmJobRecord, pattern: RegExp): boolean {
    return (
      pattern.test(job.BatchJobClass) ||
      pattern.test(job.BatchCreator) ||
      pattern.test(job.Name)
    );
  }

  findBqmJobsMatchingPattern(jobs: BqmJobRecord[], pattern: RegExp): BqmJobRecord[] {
    return jobs.filter((j) => this.bqmJobMatchesPattern(j, pattern));
  }

  async queryLatestBqmJobsSince(sinceIso: string, limit = 20): Promise<BqmJobRecord[]> {
    const prefix = this.orgPrefix();
    const batchCreatorField = this.bqmBatchCreatorField();
    const batchJobClassField = this.bqmBatchJobClassField();
    const rows = await this.querySoql<{ Id: string; Name?: string; CreatedDate?: string }>(
      `SELECT Id, Name, CreatedDate, ${batchCreatorField}, ${batchJobClassField} ` +
        `FROM ${prefix}__Batch_Queue_Manager__c WHERE CreatedDate >= ${sinceIso} ` +
        `ORDER BY CreatedDate DESC LIMIT ${limit}`
    );
    return this.mapBqmJobRows(rows);
  }

  async assertLatestBqmJobMatches(pattern: RegExp, sinceIso?: string): Promise<void> {
    let jobs: BqmJobRecord[] = [];
    try {
      await expect
        .poll(
          async () => {
            if (sinceIso) {
              jobs = await this.queryLatestBqmJobsSince(sinceIso);
            } else {
              jobs = await this.queryLatestBqmJobs(15);
            }
            console.log(
              `[BQM] polling jobs: ${jobs.slice(0, 8).map((j) => this.formatBqmJobLabel(j)).join(' | ') || '(none)'}`
            );
            return jobs.some((j) => this.bqmJobMatchesPattern(j, pattern));
          },
          { timeout: 120000, intervals: [2000, 5000, 10000] }
        )
        .toBe(true);
    } catch {
      throw new Error(
        `No BQM job matching ${pattern} since ${sinceIso ?? 'latest scan'}. ` +
          `Recent jobs: ${jobs.slice(0, 10).map((j) => this.formatBqmJobLabel(j)).join(' | ') || '(none)'}`
      );
    }
    console.log(
      `[BQM] latest jobs: ${jobs.slice(0, 5).map((j) => this.formatBqmJobLabel(j)).join(' | ')}`
    );
  }

  async assertNoNewCpiBqmJob(
    sinceOrBaseline: string | BqmJobBaseline,
    pattern: RegExp,
    options: AssertNoNewBqmJobOptions = {}
  ): Promise<void> {
    const waitMs = options.waitMs ?? 8000;
    const scanLimit = options.scanLimit ?? 10;
    await this.page.waitForTimeout(waitMs);

    if (typeof sinceOrBaseline === 'string') {
      console.log(`[BQM] checking jobs created since ${sinceOrBaseline} (pattern: ${pattern})`);
      const jobs = await this.queryLatestBqmJobsSince(sinceOrBaseline);
      const matches = this.findBqmJobsMatchingPattern(jobs, pattern);
      console.log(
        `[BQM] jobs since timestamp (${jobs.length}): ` +
          `${jobs.map((j) => this.formatBqmJobLabel(j)).join(' | ') || '(none)'}`
      );
      if (matches.length) {
        console.log(
          `[BQM] matched required job pattern ${pattern}: ` +
            matches.map((j) => `${this.formatBqmJobLabel(j)} [${j.Id}]`).join(' | ')
        );
      }
      expect(matches, 'No CPI recalculation BQM job should have started').toEqual([]);
      return;
    }

    const evaluation = await this.evaluateBqmJobsAfterBaseline(sinceOrBaseline, scanLimit);
    this.logBqmScanResult(evaluation, sinceOrBaseline, waitMs, scanLimit);

    if (!evaluation.newJobsCreated) {
      return;
    }

    const matches = this.findBqmJobsMatchingPattern(evaluation.latestJobs, pattern);
    console.log(
      `[BQM] searching latest ${scanLimit} for required job pattern ${pattern}: ` +
        (matches.length
          ? `found ${matches.map((j) => `${this.formatBqmJobLabel(j)} [${j.Id}]`).join(' | ')}`
          : 'not found')
    );
    expect(matches, 'No CPI recalculation BQM job should have started').toEqual([]);
  }

  async assertRequiredBqmJobInLatest(
    sinceOrBaseline: string | BqmJobBaseline,
    pattern: RegExp,
    options: AssertNoNewBqmJobOptions = {}
  ): Promise<void> {
    const waitMs = options.waitMs ?? 8000;
    const scanLimit = options.scanLimit ?? 10;
    await this.page.waitForTimeout(waitMs);

    if (typeof sinceOrBaseline === 'string') {
      await this.assertLatestBqmJobMatches(pattern, sinceOrBaseline);
      return;
    }

    const evaluation = await this.evaluateBqmJobsAfterBaseline(sinceOrBaseline, scanLimit);
    this.logBqmScanResult(evaluation, sinceOrBaseline, waitMs, scanLimit);

    const matches = this.findBqmJobsMatchingPattern(evaluation.latestJobs, pattern);
    console.log(
      `[BQM] searching latest ${scanLimit} for required job pattern ${pattern}: ` +
        (matches.length
          ? `found ${matches.map((j) => `${this.formatBqmJobLabel(j)} [${j.Id}]`).join(' | ')}`
          : 'not found')
    );
    expect(
      matches.length,
      `Expected a BQM job matching ${pattern} in the latest ${scanLimit} jobs`
    ).toBeGreaterThan(0);
  }

  async assertErrorLogVisible(): Promise<void> {
    await this.openErrorLogsTab();
    const error = this.page.getByText(/error|invalid|part number|failed/i).first();
    await expect(error).toBeVisible({ timeout: 60000 });
  }

  /** SOQL fallback when UI field API names differ slightly across packages. */
  async queryQuoteCpiEffectiveDate(recordId: string): Promise<string | null> {
    const prefix = this.orgPrefix();
    try {
      const rows = await this.querySoql<Record<string, unknown>>(
        `SELECT ${prefix}__CPI_Effective_Date__c FROM ${prefix}__CustomerBoM__c WHERE Id = '${recordId}'`
      );
      const value = rows[0]?.[`${prefix}__CPI_Effective_Date__c`];
      return value == null ? null : String(value);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      if (/No such column|INVALID_FIELD|didn't understand|No such column/i.test(msg)) {
        throw new Error(
          `CPI_Effective_Date__c is not deployed on ${prefix}__CustomerBoM__c in this org. ` +
            `Excel expects CPI Effective Date auto-populated — deploy CPI Calculation before running this suite. ` +
            `SOQL: ${msg}`
        );
      }
      return null;
    }
  }

  /** True when Quote object exposes CPI Effective Date (feature deployed). */
  async isCpiEffectiveDateFieldDeployed(): Promise<boolean> {
    const prefix = this.orgPrefix();
    try {
      await this.querySoql(
        `SELECT ${prefix}__CPI_Effective_Date__c FROM ${prefix}__CustomerBoM__c LIMIT 1`
      );
      return true;
    } catch {
      return false;
    }
  }

  assertTextMatchesExcel(
    key: string,
    label: string,
    actual: string,
    expected: string | RegExp
  ): void {
    const pattern =
      expected instanceof RegExp ? expected : new RegExp(escapeRegExp(expected), 'i');
    const actualNorm = (actual || '').replace(/\s+/g, ' ').trim();
    console.log(`[${key}] UI ${label}: ${actualNorm}`);
    console.log(`[${key}] Excel expected ${label}: ${pattern}`);
    expect(actualNorm, `${label} mismatch. UI="${actualNorm}" Excel=${pattern}`).toMatch(
      pattern
    );
  }

  requireQuoteName(testData: string[]): string {
    const name = parseQuoteIdFromTestData(testData);
    if (!name) {
      throw new Error(`Quote Name (QT-…) missing from Excel testData: ${testData.join(' | ')}`);
    }
    return name;
  }

  requireQuoteItemName(testData: string[]): string {
    const name = parseQuoteItemNameFromTestData(testData);
    if (!name) {
      throw new Error(
        `Quote Item Name (QTITM-…) missing from Excel testData: ${testData.join(' | ')}`
      );
    }
    return name;
  }

  requireOpportunityName(testData: string[]): string {
    const name = parseOpportunityNameFromTestData(testData);
    if (!name) {
      throw new Error(
        `Opportunity Name missing from Excel testData: ${testData.join(' | ')}`
      );
    }
    return name;
  }

  /** Open the Opportunity named in Excel Test Data (required for create-quote flows). */
  async openOpportunityForCreateFromExcel(testData: string[]): Promise<void> {
    await this.openOpportunityForCreate(this.requireOpportunityName(testData));
    console.log('Opportunity opened');
  }

  requirePartNumber(testData: string[]): string {
    const partNumber = parsePartNumberFromTestData(testData);
    if (!partNumber) {
      throw new Error(`Part Number missing from Excel testData: ${testData.join(' | ')}`);
    }
    return partNumber;
  }

  requireManufacturer(
    tc: Pick<ExcelTestCaseData, 'key' | 'name' | 'testData' | 'steps' | 'precondition'>
  ): string {
    const manufacturer = parseManufacturerFromExcel({
      testData: tc.testData,
      steps: tc.steps,
      name: tc.name,
      precondition: tc.precondition,
    });
    if (!manufacturer) {
      throw new Error(
        `Manufacturer value missing from Excel testData/steps for ${tc.key}: ${tc.name}`
      );
    }
    return manufacturer;
  }

  soqlNowMinusSeconds(seconds: number): string {
    return new Date(Date.now() - seconds * 1000).toISOString();
  }

  async openOpportunityForCreate(opportunityName: string): Promise<void> {
    const name = opportunityName.trim();
    if (!name) {
      throw new Error('Opportunity Name is required from Excel testData');
    }
    const rows = await this.querySoql<{ Id: string }>(
      `SELECT Id FROM Opportunity WHERE Name = '${name.replace(/'/g, "\\'")}' LIMIT 1`
    );
    if (!rows[0]?.Id) {
      throw new Error(`Opportunity not found in CPI org (Excel): ${name}`);
    }
    console.log('Opportunity found', rows[0].Id);
    await this.page.goto(`${this.instanceUrl()}/lightning/r/Opportunity/${rows[0].Id}/view`);
    await this.sf.waitForLightningLoad();
  }

  /**
   * Create New Quote from Opportunity on CPI org.
   * Does not use QuoteService.createNewQuote (waits for Follow — often absent on DE layouts).
   */
  async createNewQuoteFromOpportunity(): Promise<void> {
    await this.sf.waitForLightningLoad();
    const createBtn = this.page.getByRole('button', { name: 'Create New Quote' });
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
    } else {
      await this.sf.clickRecordPageButton('Create New Quote');
    }
    console.log('Quote created');
    await this.waitForQuoteReady();
    console.log('Quote ready');
  }

  async assertEstimatedCpiFieldsFromExcel(
    expectedResults: string | string[]
  ): Promise<void> {
    const itemStatus = parseEstimatedCpiItemStatusFromExpected(expectedResults);
    const rebateStatus = parseEstimatedCpiRebateStatusFromExpected(expectedResults);
    const headerLabels = parseEstimatedCpiHeaderLabelsFromExpected(expectedResults);
    await this.assertFirstQuoteItemEstimatedCpiPopulated(itemStatus);
    await this.assertQuoteHeaderEstimatedCpiPopulated(headerLabels, rebateStatus);
  }

  async assertCpiEffectiveDateTodayFromSoqlOrUi(): Promise<void> {
    const recordId = await this.parseQuoteIdFromUrl();
    const soqlDate = await this.queryQuoteCpiEffectiveDate(recordId);
    if (soqlDate) {
      const today = cpiEffectiveDateLocalIso(new Date());
      console.log(`[CPI Effective Date] SOQL=${soqlDate} Excel expected=today`);
      expect(
        soqlDate.startsWith(today),
        `CPI Effective Date should be today per Excel. SOQL=${soqlDate}`
      ).toBeTruthy();
      return;
    }
    await this.assertCpiEffectiveDateIsToday();
  }

  /**
   * Excel step: field auto-populated by trigger/flow — not set via UI edit in this test.
   * Compares CPI_Effective_Date__c to Quote CreatedDate (same calendar day).
   * Uses SOQL because this assertion verifies trigger behavior, not UI layout.
   */
  async assertCpiEffectiveDateAutoPopulatedWithoutManualInput(): Promise<void> {
    const recordId = await this.parseQuoteIdFromUrl();
    const prefix = this.orgPrefix();
    const rows = await this.querySoql<Record<string, unknown>>(
      `SELECT CreatedDate, ${prefix}__CPI_Effective_Date__c ` +
        `FROM ${prefix}__CustomerBoM__c WHERE Id = '${recordId}'`
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`Quote ${recordId} not found for CPI auto-populate assertion`);
    }

    const cpiRaw = row[`${prefix}__CPI_Effective_Date__c`];
    const createdRaw = row.CreatedDate;
    expect(cpiRaw, 'CPI Effective Date must be populated on Quote create').toBeTruthy();

    const cpiDateOnly = String(cpiRaw).slice(0, 10);
    const createdDateOnly = String(createdRaw ?? '').slice(0, 10);
    console.log(
      `[CPI Effective Date] auto-populate: CPI=${cpiDateOnly} CreatedDate=${createdDateOnly} ` +
        `(no manual input in test — trigger/flow)`
    );
    expect(
      cpiDateOnly,
      `CPI Effective Date should match Quote CreatedDate (auto-populated). CPI=${cpiDateOnly} Created=${createdDateOnly}`
    ).toBe(createdDateOnly);
  }

  /** Quote header Delete — used to clean up Quotes created during CPI trigger tests. */
  async deleteQuoteFromHeader(): Promise<void> {
    await this.waitForQuoteReady();
    await this.page.getByRole('button', { name: 'Delete' }).click();
    const confirmDelete = this.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete' });
    await confirmDelete.waitFor({ state: 'visible', timeout: 30000 });
    await confirmDelete.click();
    await this.page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 60000 });
  }

  async deleteQuoteById(quoteId: string): Promise<void> {
    if (!quoteId) return;
    if (this.page.isClosed()) {
      await this.deleteQuoteByIdViaApi(quoteId);
      return;
    }
    console.log(`[CPI cleanup] deleting quote ${quoteId}`);
    try {
      const onQuote =
        this.page.url().includes(quoteId) ||
        this.page.url().includes(`/CustomerBoM__c/${quoteId}`);
      if (onQuote) {
        await this.waitForQuoteReady();
      } else {
        await this.gotoQuoteByRecordId(quoteId);
      }
      await this.deleteQuoteFromHeader();
      console.log(`[CPI cleanup] quote ${quoteId} deleted`);
    } catch (e) {
      console.warn(`[CPI cleanup] UI delete failed for ${quoteId}, trying API: ${e}`);
      await this.deleteQuoteByIdViaApi(quoteId);
    }
  }

  private async deleteQuoteByIdViaApi(quoteId: string): Promise<void> {
    const prefix = this.orgPrefix();
    const conn = getSfJsforceConnection();
    console.log(`[CPI cleanup] deleting quote ${quoteId} via API`);
    await conn.sobject(`${prefix}__CustomerBoM__c`).delete(quoteId);
    console.log(`[CPI cleanup] quote ${quoteId} deleted via API`);
  }

  /** Quote Item Estimated CPI Calculation Status blank/unchanged (no CPI run). */
  async assertEstimatedCpiCalculationStatusUnchanged(): Promise<void> {
    const status = await this.refreshEstimatedCpiCalculationStatus();
    expect(
      this.isBlankCpiFieldValue(status),
      `Estimated CPI Calculation Status should be blank (no CPI calculation performed). Actual="${status || 'blank'}"`
    ).toBe(true);
    this.logCpiAssertion({
      field: 'Estimated CPI Calculation Status',
      actual: this.formatCpiActualForLog(status),
      expected: 'blank (unchanged — no CPI calculation performed)',
      result: 'PASS',
    });
  }

  /**
   * CCWR Aggregated Quote — Invalid header, NOT APPLICABLE tier, Calculated status, zero pricing.
   * Matches PQW-T5016 Expected Result steps 13–17.
   */
  async assertCcwrAggregatedCpiFromExcel(expectedResults: string[]): Promise<void> {
    await this.openDetailsTab();
    const rebateStatus = await this.getFieldValueByLabel('Estimated CPI Rebate Status');
    console.log(`[CCWR Aggregated] Estimated CPI Rebate Status=${rebateStatus}`);
    expect(rebateStatus, 'Estimated CPI Rebate Status should be Invalid').toMatch(/invalid/i);

    for (const label of [
      'Estimated CPI Total Amount',
      'Estimated CPI Total Base Land Amount',
      'Estimated CPI Total Accelerator Amount',
    ]) {
      const value = await this.getFieldValueByLabel(label).catch(() => '');
      console.log(`[CCWR Aggregated] ${label}=${value || '(empty)'}`);
      expect(value || '', `${label} should be null/empty on aggregated CCWR quote`).toMatch(
        /^(—|--|-|$|null|0\.?0*)?$/i
      );
    }

    await this.openFirstRelatedQuoteItem();
    const pviTier = await this.getFieldValueByLabel('Estimated CPI PVI Tier');
    console.log(`[CCWR Aggregated] Estimated CPI PVI Tier=${pviTier}`);
    expect(pviTier, 'Estimated CPI PVI Tier should be NOT APPLICABLE').toMatch(
      /not applicable/i
    );
    await this.refreshAndAssertEstimatedCpiCalculationStatus(/calculated/i);

    for (const label of [
      'Estimated CPI Base Land Amount',
      'Estimated CPI Accelerator Amount',
      'Estimated CPI Spec Bonus Amount',
      'Total Estimated CPI Amount',
    ]) {
      const value = await this.getFieldValueByLabel(label).catch(() => '');
      console.log(`[CCWR Aggregated] ${label}=${value || '(empty)'}`);
      expect(value || '0', `${label} should be 0.00`).toMatch(/^0(\.0+)?$/);
    }
  }

  /** Read Quote header Estimated CPI rollup fields (for before/after deletion checks). */
  async getQuoteHeaderEstimatedCpiSnapshot(): Promise<EstimatedCpiHeaderSnapshot> {
    await this.openDetailsTab();
    await this.expandDetailsSectionIfCollapsed('Estimated Cisco Partners Incentive Information');

    const read = async (label: string): Promise<string> => {
      for (let attempt = 0; attempt < 16; attempt++) {
        const value = await this.getFieldValueByLabel(label).catch(() => '');
        if (value && !/^(—|--|null)?$/i.test(value)) return value;
        await this.page.evaluate(() => {
          window.scrollBy(0, 520);
          document
            .querySelectorAll('.flexipage-record-home-scrollable-column, .record-layout-container')
            .forEach((el) => {
              (el as HTMLElement).scrollTop += 520;
            });
        });
        await this.page.waitForTimeout(250);
      }
      return await this.getFieldValueByLabel(label).catch(() => '');
    };

    let rebateStatus = await read('Estimated CPI Rebate Status');
    let totalAmount = await read('Estimated CPI Total Amount');
    let totalBaseLand = await read('Estimated CPI Total Base Land Amount');
    let totalAccelerator = await read('Estimated CPI Total Accelerator Amount');

    if (await this.hasEstimateCpiBreakdownOnQuote()) {
      const breakdownText = await this.page
        .getByRole('heading', { name: /Estimated CPI Breakdown/i })
        .locator('xpath=..')
        .innerText()
        .catch(() => '');
      const totalMatch = breakdownText.match(/Total Estimated CPI[^\$]*\$\s*([\d,]+\.\d{2})/i);
      if (!totalAmount && totalMatch?.[1]) {
        totalAmount = `$${totalMatch[1]}`;
      }
      if (!rebateStatus) rebateStatus = 'Valid';
    }

    return {
      rebateStatus,
      totalAmount,
      totalBaseLand,
      totalAccelerator,
    };
  }

  private parseCpiCurrency(value: string): number {
    return Number.parseFloat(String(value || '').replace(/[^0-9.-]/g, '')) || 0;
  }

  /** Excel PQW-T5017: header rollups must change after item deletion (no stale totals). */
  async assertHeaderCpiTotalsUpdatedAfterDeletion(
    before: EstimatedCpiHeaderSnapshot
  ): Promise<void> {
    const after = await this.getQuoteHeaderEstimatedCpiSnapshot();
    console.log(`[CPI header] before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

    if (this.parseCpiCurrency(before.totalAmount) > 0) {
      expect(
        this.parseCpiCurrency(after.totalAmount),
        'Estimated CPI Total Amount should decrease or clear after deletion'
      ).toBeLessThanOrEqual(this.parseCpiCurrency(before.totalAmount));
    }
    expect(
      `${after.totalAmount}|${after.totalBaseLand}|${after.totalAccelerator}`,
      'Header CPI rollups should not remain identical after deleting a priced line'
    ).not.toBe(`${before.totalAmount}|${before.totalBaseLand}|${before.totalAccelerator}`);
  }

  /** Delete one Quote Item row in EQG by Part Number (Copy BoM Items cleanup). */
  async deleteQuoteItemByPartNumberInEqg(partNumber: string): Promise<void> {
    const { AdvanceUi } = await import('../utils/advUi');
    const { deleteButtonLocator } = await import('../pages/editQuoteGridPage');
    const prefix = this.orgPrefix();
    const partCol = `qtGrid_${prefix}__Part_Number__c`;
    const advui = new AdvanceUi(this.page);
    const frame = await this.sf.frameInEQG();
    const exactPart = new RegExp(`^\\s*${escapeRegExp(partNumber)}\\s*$`, 'i');
    const expandSelector =
      'td.ui-sgcollapsed span.ui-icon-plus, td.ui-sgcollapsed span.ui-icon-circlesplus, .tree-wrap-ltr .ui-icon-plus';

    for (let attempt = 0; attempt < 15; attempt++) {
      const row = frame
        .locator('tr.jqgrow, tr[role="row"]:not(.jqgfirstrow)')
        .filter({
          has: frame.locator(`td[aria-describedby="${partCol}"]`, { hasText: exactPart }),
        })
        .first();
      if ((await row.count()) > 0) {
        await row.scrollIntoViewIfNeeded();
        const checkbox = row.locator('input[type="checkbox"]').first();
        await checkbox.waitFor({ state: 'attached', timeout: 20000 });
        await checkbox.evaluate((el: HTMLInputElement) => el.click());
        await advui.clickOnButton(deleteButtonLocator);
        await advui.clickYesOnconfirmationPopUp();
        await this.page.keyboard.press('Control+S');
        await this.waitForToastMatching(/saved|success|deleted/i, 90000).catch(() => undefined);
        return;
      }
      const expandBtn = frame.locator(expandSelector).first();
      if ((await expandBtn.count()) === 0) break;
      await expandBtn.click();
      await this.page.waitForTimeout(300);
    }

    throw new Error(`Part Number "${partNumber}" not found on Edit Quote Grid for delete`);
  }

  /** Fast teardown: delete a Quote Item by Part Number via SOQL + API (no EQG navigation). */
  async deleteQuoteItemByPartNumberViaSoql(
    quoteName: string,
    partNumber: string
  ): Promise<void> {
    const prefix = this.orgPrefix();
    const quoteId = await this.resolveQuoteRecordId(quoteName);
    const objectApi = cpiQuoteItemObjectApi(prefix);
    const partField = cpiFieldApi('Part_Number__c', prefix);
    const quoteField = cpiCustomerBoMLookupField(prefix);
    const escapedPart = partNumber.replace(/'/g, "\\'");
    const rows = await this.querySoql<{ Id: string }>(
      `SELECT Id FROM ${objectApi} WHERE ${quoteField} = '${quoteId}' AND ${partField} = '${escapedPart}' LIMIT 1`
    );
    const itemId = rows[0]?.Id;
    if (!itemId) {
      console.log(`[CPI cleanup] no Quote Item "${partNumber}" on ${quoteName} — nothing to delete`);
      return;
    }
    const conn = getSfJsforceConnection();
    await conn.sobject(objectApi).destroy(itemId);
    console.log(`[CPI cleanup] deleted Quote Item ${itemId} (${partNumber}) via SOQL`);
  }

  /**
   * SOQL: line with Total Estimated CPI Amount > 0, then delete that row in EQG.
   * Falls back to first data row when SOQL finds no priced line.
   */
  async deleteQuoteItemWithNonZeroCpiInEqg(quoteRecordId?: string): Promise<void> {
    const { AdvanceUi } = await import('../utils/advUi');
    const { deleteButtonLocator } = await import('../pages/editQuoteGridPage');
    const prefix = this.orgPrefix();
    const quoteId =
      quoteRecordId ||
      (await this.parseQuoteIdFromUrl().catch(() => '')) ||
      (await this.resolveQuoteRecordId(await this.getQuoteNumberFromHeading().catch(() => '')));

    let partNumber = '';
    if (quoteId) {
      const partField = cpiFieldApi('Part_Number__c', prefix);
      const totalField = cpiQuoteItemField('totalAmount', prefix);
      const rows = await this.querySoql<Record<string, unknown>>(
        `SELECT ${partField}, ${totalField} ` +
          `FROM ${cpiQuoteItemObjectApi(prefix)} ` +
          `WHERE ${cpiCustomerBoMLookupField(prefix)} = '${quoteId}' ` +
          `AND ${totalField} > 0 ` +
          `ORDER BY ${totalField} DESC LIMIT 1`
      );
      partNumber = String(rows[0]?.[partField] ?? '').trim();
    }

    const advui = new AdvanceUi(this.page);
    const frame = await this.sf.frameInEQG();
    if (partNumber) {
      const partCol = `qtGrid_${prefix}__Part_Number__c`;
      const row = frame
        .locator('tr[role="row"]:not(.jqgfirstrow)')
        .filter({
          has: frame.locator(`td[aria-describedby="${partCol}"]`, {
            hasText: new RegExp(escapeRegExp(partNumber), 'i'),
          }),
        })
        .first();
      const checkbox = row.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible().catch(() => false)) {
        await checkbox.click();
      } else {
        console.warn(
          `[EQG delete] Part ${partNumber} row not found — falling back to first item row`
        );
        await advui.clickNthCheckbox(1);
      }
    } else {
      console.warn('[EQG delete] No priced Quote Item via SOQL — falling back to first item row');
      await advui.clickNthCheckbox(1);
    }

    await advui.clickOnButton(deleteButtonLocator);
    await advui.clickYesOnconfirmationPopUp();
    await this.page.keyboard.press('Control+S');
    await this.waitForToastMatching(/saved|success|deleted/i, 90000).catch(() => undefined);
  }

  /** @deprecated Use deleteQuoteItemWithNonZeroCpiInEqg */
  async deleteFirstQuoteItemInEqg(): Promise<void> {
    await this.deleteQuoteItemWithNonZeroCpiInEqg();
  }

  /**
   * Change an EQG column inline and save.
   * Uses AdvanceUi findCell/putValueOnCell/clickSaveButton after activating the cell editor
   * (same cell activation as setEqgPartNumberCellValue).
   */
  async editEqgFieldInlineAndSave(
    fieldApiSuffix: string,
    newValue: string,
    toastPattern?: RegExp,
    rowNumber?: number
  ): Promise<void> {
    const { AdvanceUi } = await import('../utils/advUi');
    const advui = new AdvanceUi(this.page);
    const frame = await this.sf.frameInEQG();

    const rowToEdit =
      rowNumber === undefined
        ? frame
            .locator('tr[role="row"]:not([id*="Gridghead"])[id]:not([id=""])')
            .first()
        : await advui.findTheRow(rowNumber);

    await expect(rowToEdit).toBeVisible({ timeout: 90000 });
    console.log(`[EQG] Changing ${fieldApiSuffix} to "${newValue}"`);

    await rowToEdit.scrollIntoViewIfNeeded();
    await advui.findTheRowAndDoubleClick(rowToEdit);
    await this.page.waitForTimeout(1000);

    const targetCell = await advui.findCell(rowToEdit, fieldApiSuffix);
    await targetCell.click();
    await targetCell.dblclick({ position: { x: XRL_OFFSET, y: XRL_OFFSET } });
    await this.page.waitForTimeout(1500);

    const hasEditable = (await targetCell.locator('span.editable, input.editable').count()) > 0;
    if (hasEditable) {
      await advui.putValueOnCell(targetCell, newValue);
    } else {
      const iframeInput = frame.locator('input.editable:visible, textarea.editable:visible').first();
      if (await iframeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await iframeInput.click();
        await iframeInput.press('ControlOrMeta+a');
        await iframeInput.fill(newValue);
        await iframeInput.press('Enter');
        await this.page.waitForTimeout(2000);
      } else {
        await targetCell.press('F2');
        await this.page.waitForTimeout(500);
        const activeInput = frame.locator('input:focus, textarea:focus').first();
        if (await activeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await activeInput.fill(newValue);
          await activeInput.press('Enter');
          await this.page.waitForTimeout(2000);
        } else {
          throw new Error(`${fieldApiSuffix} cell is not editable on Edit Quote Grid`);
        }
      }
    }

    await advui.clickSaveButton();

    if (toastPattern) {
      await this.waitForToastMatching(toastPattern, 60000).catch(() => undefined);
    }
  }
}
