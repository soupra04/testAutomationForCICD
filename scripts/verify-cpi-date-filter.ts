import 'dotenv/config';
import { chromium } from '@playwright/test';
import { hydrateSfVarsIntoProcessEnv } from '../utils/envConfig';
import { CpiRecalculationPage } from '../pages/cpiRecalculationPage';

async function main() {
  hydrateSfVarsIntoProcessEnv();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: 'state.chromium.json',
    viewport: { width: 1800, height: 1080 },
  });
  const page = await context.newPage();
  const recalc = new CpiRecalculationPage(page);

  try {
    await recalc.gotoSearchQuotesTab();
    await recalc.openRemainingFiltersPopup();
    await recalc.setCpiEffectiveDateFrom('1/1/2026 0:00');
    await recalc.setCpiEffectiveDateTo('2026-03-31 00:00:00');

    const prefix = process.env.SF_ORG_PREFIX!;
    const dialog = page.getByRole('dialog').filter({
      has: page.locator(`c-multiselect[data-id="${prefix}__CPI_Rebate_Status__c"]`),
    });

    const readSection = async (dataId: string) =>
      ((await dialog
        .locator(`c-multiselect[data-id="${dataId}"]`)
        .first()
        .locator('xpath=ancestor::lightning-layout-item[1]')
        .innerText()) || ''
      ).replace(/\s+/g, ' ').trim();

    const fromText = await readSection(`${prefix}__CPI_Effective_Date__c`);
    const toText = await readSection(`${prefix}__CPI_Effective_Date__cTo`);

    console.log(JSON.stringify({ ok: true, fromText, toText }, null, 2));
    await page.screenshot({ path: 'test-results/verify-cpi-date-filter.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
