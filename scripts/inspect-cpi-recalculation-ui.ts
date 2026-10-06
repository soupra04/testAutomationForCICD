import 'dotenv/config';
import { chromium } from '@playwright/test';
import { hydrateSfVarsIntoProcessEnv } from '../utils/envConfig';

async function main() {
  hydrateSfVarsIntoProcessEnv();
  const prefix = process.env.SF_ORG_PREFIX!;
  const instance = process.env.SF_INSTANCE_URL!.replace('.my.salesforce.com', '.lightning.force.com');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: 'state.chromium.json',
    viewport: { width: 1800, height: 1080 },
  });
  const page = await context.newPage();

  try {
    await page.goto(`${instance}/lightning/n/${prefix}__Search_Quotes_and_Quote_Items`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    const { XRLUtils } = await import('../utils/xrlUtils');
    const xrl = new XRLUtils(page);
    const priceFilter = xrl.getFilter(`${prefix}__New_Total_Customer_Extended_Price__c`);
    await priceFilter.waitFor({ state: 'visible', timeout: 120000 });
    await page.waitForTimeout(3000);

    const base = await page.evaluate(() => {
      const multiselects = Array.from(document.querySelectorAll('c-multiselect[data-id]')).map((el) => {
        const section = el.closest('lightning-layout-item');
        return {
          dataId: el.getAttribute('data-id'),
          sectionText: (section?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        };
      });
      const gridButtons = [
        ...new Set(
          Array.from(document.querySelectorAll('lightning-button[data-id], lightning-button-icon[data-id]')).map(
            (el) => el.getAttribute('data-id')
          )
        ),
      ];
      const visibleButtons = [
        ...new Set(
          Array.from(document.querySelectorAll('button'))
            .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
            .filter((t) => t && /Apply|Recalculate|Load|Reset|Save|Select|Notify|wait/i.test(t))
        ),
      ];
      const headers = Array.from(document.querySelectorAll('table thead th'))
        .map((th) => th.getAttribute('aria-label') || th.textContent?.trim())
        .filter(Boolean);
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
        .slice(0, 10)
        .map((c) => ({
          name: (c as HTMLInputElement).name,
          ariaLabel: c.getAttribute('aria-label'),
          title: c.getAttribute('title'),
          className: c.className,
        }));
      return { url: location.href, title: document.title, multiselects, gridButtons, visibleButtons, headers, checkboxes };
    });

    const panel = page.getByRole('tabpanel', { name: 'Search Quotes' });
    const panelMultiselects = await panel.locator('c-multiselect[data-id]').evaluateAll((els) =>
      els.map((el) => ({
        dataId: el.getAttribute('data-id'),
        sectionText: (el.closest('lightning-layout-item')?.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120),
      }))
    );

    const ssFilterIcon = page.locator("lightning-button-icon[data-id='ssFilter:dialog']");
    const ssFilterCount = await ssFilterIcon.count();
    if (ssFilterCount > 0) {
      await ssFilterIcon.last().click();
      await page.waitForTimeout(2500);
    }

    const dialogMultiselects = await page.locator('[role="dialog"] c-multiselect[data-id]').evaluateAll((els) =>
      els.map((el) => ({
        dataId: el.getAttribute('data-id'),
        sectionText: (el.closest('lightning-layout-item')?.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120),
      }))
    );

    const gridDataIds = await page.locator('lightning-button-icon[data-id], lightning-button[data-id]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-id')).filter(Boolean)
    );

    const playwrightLocators = {
      apply: await page.getByRole('button', { name: 'Apply', exact: true }).isVisible().catch(() => false),
      addFilters: await page.locator('div[title="Add remaining filters."]').isVisible().catch(() => false),
      recalculate: await page
        .getByRole('button', { name: /Recalculate CPI on Selected Quote/i })
        .isVisible()
        .catch(() => false),
      searchQuotesPanel: await page
        .getByRole('tabpanel', { name: 'Search Quotes' })
        .isVisible()
        .catch(() => false),
    };

    console.log('=== BASE PAGE ===');
    console.log(
      JSON.stringify(
        {
          ...base,
          panelMultiselects,
          dialogMultiselects,
          gridDataIds: [...new Set(gridDataIds)],
          playwrightLocators,
        },
        null,
        2
      )
    );

    if (dialogMultiselects.length) {
      await page.keyboard.press('Escape').catch(() => undefined);
    }

    const addFilters = page.locator('div[title="Add remaining filters."]');
    if (await addFilters.isVisible().catch(() => false)) {
      await addFilters.click();
      await page.waitForTimeout(2500);
      const dialog = await page.evaluate(() => {
        const root = document.querySelector('[role="dialog"]');
        if (!root) return { open: false };
        return {
          open: true,
          multiselects: Array.from(root.querySelectorAll('c-multiselect[data-id]')).map((el) => {
            const section = el.closest('lightning-layout-item');
            return {
              dataId: el.getAttribute('data-id'),
              sectionText: (section?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
            };
          }),
        };
      });
      console.log('=== REMAINING FILTERS DIALOG ===');
      console.log(JSON.stringify(dialog, null, 2));
      await page.keyboard.press('Escape').catch(() => undefined);
    }

    const applyBtn = page.getByRole('button', { name: 'Apply', exact: true });
    if (await applyBtn.isVisible().catch(() => false)) {
      await applyBtn.click();
      await page.waitForTimeout(8000);
      const afterApply = await page.evaluate(() => {
        const loaded =
          Array.from(document.querySelectorAll('c-data-table *'))
            .map((el) => el.textContent?.trim() ?? '')
            .find((t) => /Loaded|Showing|out of/i.test(t)) ?? '';
        const recalcBtn = Array.from(document.querySelectorAll('button'))
          .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
          .find((t) => /Recalculate CPI/i.test(t));
        return { loaded, recalcBtn };
      });
      console.log('=== AFTER APPLY ===');
      console.log(JSON.stringify(afterApply, null, 2));
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
