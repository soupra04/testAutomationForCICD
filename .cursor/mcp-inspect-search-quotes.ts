/**
 * Playwright MCP locator inspection for CPI ReCalculation / Search Quotes.
 * Uses storageState from disk — no credentials in MCP arguments.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

export default async () => {
  const root = path.resolve(__dirname, '..');
  const storageState = path.join(root, 'state.chromium.json');
  if (!fs.existsSync(storageState)) {
    throw new Error('state.chromium.json missing — run globalSetup first');
  }

  // Load .env without dotenv package
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }

  const prefix = process.env.SF_ORG_PREFIX || 'StrataVAR';
  const instance = (process.env.SF_INSTANCE_URL || '').replace('.my.salesforce.com', '.lightning.force.com');
  const url = `${instance}/lightning/n/${prefix}__Search_Quotes_and_Quote_Items`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1800, height: 1080 },
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(12000);

    const panel = page.getByRole('tabpanel', { name: 'Search Quotes' });
    await panel.waitFor({ state: 'visible', timeout: 90000 }).catch(() => undefined);

    const domInfo = await page.evaluate(() => {
      const multiselects = Array.from(document.querySelectorAll('c-multiselect[data-id]')).map((el) => {
        const section = el.closest('lightning-layout-item');
        const text = (section?.textContent || '').replace(/\s+/g, ' ').trim();
        return { dataId: el.getAttribute('data-id'), sectionText: text.slice(0, 100) };
      });

      const gridButtons = Array.from(
        document.querySelectorAll('lightning-button[data-id], lightning-button-icon[data-id]')
      ).map((el) => el.getAttribute('data-id'));

      const visibleButtons = Array.from(document.querySelectorAll('button'))
        .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && /Apply|Recalculate|Load|Reset|Save|Yes|Cancel|Notify|wait/i.test(t));

      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
        .slice(0, 8)
        .map((c) => ({
          name: (c as HTMLInputElement).name,
          ariaLabel: c.getAttribute('aria-label'),
          title: c.getAttribute('title'),
          className: c.className,
        }));

      const headers = Array.from(document.querySelectorAll('table thead th'))
        .map((th) => th.getAttribute('aria-label') || th.textContent?.trim())
        .filter(Boolean);

      return {
        url: location.href,
        title: document.title,
        multiselects,
        gridButtons: [...new Set(gridButtons)],
        visibleButtons: [...new Set(visibleButtons)],
        checkboxes,
        headers: headers.slice(0, 25),
      };
    });

    // Try opening remaining filters popup
    const addFilters = page.locator('div[title="Add remaining filters."]');
    if (await addFilters.isVisible().catch(() => false)) {
      await addFilters.click();
      await page.waitForTimeout(2000);
      const dialogInfo = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return { open: false };
        const multiselects = Array.from(dialog.querySelectorAll('c-multiselect[data-id]')).map((el) => {
          const section = el.closest('lightning-layout-item');
          return {
            dataId: el.getAttribute('data-id'),
            sectionText: (section?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
          };
        });
        return { open: true, multiselects };
      });
      (domInfo as Record<string, unknown>).remainingFiltersDialog = dialogInfo;
      await page.keyboard.press('Escape').catch(() => undefined);
    }

    return domInfo;
  } finally {
    await browser.close();
  }
};
