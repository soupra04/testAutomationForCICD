/**
 * CPI Configuration Page tests.
 *
 * Auth: same as the rest of the suite — SF_INSTANCE_URL / SF_SESSION_ID /
 * SF_ORG_PREFIX via globalSetup → state.chromium.json (Playwright storageState).
 *
 * Test data / assertions loaded from assets/CPI_CONFIGURATION_PAGE.xlsx
 * via utils/cpiExcelCases (no hardcoded BE / PVI / toast / error copy).
 *
 * Pattern: assert only Excel expected textContent → print UI actual →
 * compare → PASS/FAIL.
 */
import { test, expect, Page } from '@playwright/test';
import { CpiCalculationPage } from '../../pages/cpiCalculationPage';
import { CpiConfigurationPage } from '../../pages/cpiConfigurationPage';
import { QuotePage } from '../../pages/quotePage';
import {
  cpiConfigCases,
  cpiConfigTierCases,
} from '../../utils/cpiExcelCases';
import {
  escapeRegExp,
  inlineErrorPatternFromExpected,
  normalizePviDisplay,
  parseAllApplicablePviValues,
  parseApplicablePvi,
  parseBusinessEntityFromCase,
  parseEffectiveStartDate,
  parseEstimatedCpiItemStatusFromExpected,
  parseListPriceFromTestData,
  parsePartNumberFromTestData,
  parsePortfolioFromCase,
  parsePviFromTo,
  parseQuoteIdFromTestData,
  parseTierFromExpected,
  requirePortfolioFromCase,
  toastPatternFromExpected,
} from '../../utils/excelTestDataParsers';

/** Print UI textContent vs Excel expected; pass/fail with clear console messages. */
function assertTextMatchesExcel(
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
  if (pattern.test(actualNorm)) {
    console.log(`[${key}] PASS: ${label} matches Excel expected`);
  } else {
    console.log(`[${key}] FAIL: ${label} does not match Excel expected`);
  }
  expect(actualNorm, `${label} mismatch. UI="${actualNorm}" Excel=${pattern}`).toMatch(pattern);
}

test.describe('CPI Configuration Page', () => {
  test.use({ viewport: { width: 1800, height: 1080 } });

  let page: Page;

  test.beforeEach(async ({ page: testPage }, testInfo) => {
    testInfo.setTimeout(180000);
    page = testPage;
    const configPage = new CpiConfigurationPage(page);
    await configPage.gotoCpiConfigurationTab();
  });

  test(
    `[${cpiConfigCases.beDropdown.key}] ${cpiConfigCases.beDropdown.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.beDropdown;
      const be = parseBusinessEntityFromCase(tc);
      const exact = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
      const uniqueValues = (values: string[]) =>
        [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))];

      await test.step(tc.expectedResults[0] || 'compare BE dropdown with SOQL', async () => {
        const uiOptions = await configPage.getBusinessEntityOptions();
        const soqlNames = await configPage.queryBusinessEntityNames();
        const uiCount = uniqueValues(uiOptions).length;
        const consoleCount = uniqueValues(soqlNames).length;

        console.log(`[${tc.key}] UI BE (${uiCount}): ${uiOptions.join(' | ')}`);
        console.log(`[${tc.key}] BE from Console (${consoleCount}): ${soqlNames.join(' | ')}`);

        if (uiCount === consoleCount) {
          console.log(
            `[${tc.key}] PASS: BE count matches. UI=${uiCount}, Console=${consoleCount}`
          );
        } else {
          console.log(
            `[${tc.key}] FAIL: BE count mismatch. UI=${uiCount}, Console=${consoleCount}`
          );
        }
        expect(
          uiCount,
          `BE count mismatch. UI=${uiCount} [${uiOptions.join(' | ')}] Console=${consoleCount} [${soqlNames.join(' | ')}]`
        ).toBe(consoleCount);

        const unknownInUi = uiOptions.filter((opt) => !soqlNames.some((n) => exact(n, opt)));
        expect(
          unknownInUi,
          `UI BE options not found via Console. UI=[${uiOptions.join(' | ')}] Console=[${soqlNames.join(' | ')}]`
        ).toEqual([]);
      });

      await test.step(tc.expectedResults[1] || `select BE ${be} and compare portfolios with SOQL`, async () => {
        await configPage.selectBusinessEntity(be);
        const uiPortfolios = (await configPage.getPviGridRows()).map((r) => r.portfolio);
        const soqlPortfolios = (await configPage.queryActivePvisForBusinessEntity(be)).map(
          (r) => r.portfolio
        );
        const uiCount = uniqueValues(uiPortfolios).length;
        const consoleCount = uniqueValues(soqlPortfolios).length;

        console.log(`[${tc.key}] Selected BE: ${be}`);
        console.log(`[${tc.key}] UI Portfolio (${uiCount}): ${uiPortfolios.join(' | ')}`);
        console.log(
          `[${tc.key}] Portfolio from Console (${consoleCount}): ${soqlPortfolios.join(' | ')}`
        );

        if (uiCount === consoleCount) {
          console.log(
            `[${tc.key}] PASS: Portfolio count matches for BE "${be}". UI=${uiCount}, Console=${consoleCount}`
          );
        } else {
          console.log(
            `[${tc.key}] FAIL: Portfolio count mismatch for BE "${be}". UI=${uiCount}, Console=${consoleCount}`
          );
        }
        expect(
          uiCount,
          `Portfolio count mismatch for BE "${be}". UI=${uiCount} [${uiPortfolios.join(' | ')}] Console=${consoleCount} [${soqlPortfolios.join(' | ')}]`
        ).toBe(consoleCount);

        const missingInUi = soqlPortfolios.filter(
          (p) => !uiPortfolios.some((u) => exact(u, p))
        );
        expect(
          missingInUi,
          `Console portfolios missing in UI for BE "${be}". UI=[${uiPortfolios.join(' | ')}] Console=[${soqlPortfolios.join(' | ')}]`
        ).toEqual([]);
      });
    }
  );

  for (const tc of cpiConfigTierCases) {
    const pvi = parseApplicablePvi(tc.testData);
    const tier = parseTierFromExpected(tc.expectedResults);
    const toastPattern = toastPatternFromExpected(tc.expectedResults);

    test(`[${tc.key}] ${tc.name} (PVI=${pvi})`, { tag: ['@cpiConfiguration'] }, async () => {
      const configPage = new CpiConfigurationPage(page);
      const be = parseBusinessEntityFromCase(tc);
      await configPage.selectBusinessEntity(be);
      const portfolioName = parsePortfolioFromCase(tc);
      const portfolio = await configPage.findPortfolioRowName(
        portfolioName ? new RegExp(portfolioName, 'i') : undefined
      );

      await test.step(`edit Applicable PVI to ${pvi}`, async () => {
        await configPage.editApplicablePviForPortfolio(portfolio, pvi);
        await configPage.clickSaveIcon();
      });

      await test.step(tc.expectedResults[0] || 'assert toast and tier text from Excel', async () => {
        const toast = await configPage.waitForToastMatching(toastPattern);
        const toastText = `${toast.title} ${toast.message}`.replace(/\s+/g, ' ').trim();
        assertTextMatchesExcel(tc.key, 'toast', toastText, toastPattern);

        const uiTier = await configPage.getTierForPortfolio(portfolio);
        assertTextMatchesExcel(tc.key, 'tier', uiTier, tier);
      });
    });
  }

  test(
    `[${cpiConfigCases.pviBelowMin.key}] ${cpiConfigCases.pviBelowMin.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.pviBelowMin;
      const pvi = parseApplicablePvi(tc.testData);
      const errorPattern = inlineErrorPatternFromExpected(tc.expectedResults);

      await configPage.selectBusinessEntity(parseBusinessEntityFromCase(tc));
      const portfolio = await configPage.findPortfolioRowName();

      await test.step(tc.expectedResults[0] || 'assert inline validation error', async () => {
        await configPage.editApplicablePviForPortfolio(portfolio, pvi);
        await configPage.clickSaveIcon();
        const uiError = await configPage.readInlineErrorText(errorPattern);
        assertTextMatchesExcel(tc.key, 'inline error', uiError, errorPattern);
      });
    }
  );

  test(
    `[${cpiConfigCases.pviAboveMax.key}] ${cpiConfigCases.pviAboveMax.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.pviAboveMax;
      const pvi = parseApplicablePvi(tc.testData);
      const errorPattern = inlineErrorPatternFromExpected(tc.expectedResults);

      await configPage.selectBusinessEntity(parseBusinessEntityFromCase(tc));
      const portfolio = await configPage.findPortfolioRowName();

      await test.step(tc.expectedResults[0] || 'assert inline validation error', async () => {
        await configPage.editApplicablePviForPortfolio(portfolio, pvi);
        await configPage.clickSaveIcon();
        const uiError = await configPage.readInlineErrorText(errorPattern);
        assertTextMatchesExcel(tc.key, 'inline error', uiError, errorPattern);
      });
    }
  );

  test(
    `[${cpiConfigCases.pviAcceptMin.key}] ${cpiConfigCases.pviAcceptMin.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.pviAcceptMin;
      const pvi = parseApplicablePvi(tc.testData);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);

      await configPage.selectBusinessEntity(parseBusinessEntityFromCase(tc));
      const portfolio = await configPage.findPortfolioRowName();

      await test.step(tc.expectedResults[0] || 'assert success toast', async () => {
        await configPage.editApplicablePviForPortfolio(portfolio, pvi);
        await configPage.clickSaveIcon();
        const toast = await configPage.waitForToastMatching(toastPattern);
        const toastText = `${toast.title} ${toast.message}`.replace(/\s+/g, ' ').trim();
        assertTextMatchesExcel(tc.key, 'toast', toastText, toastPattern);
      });
    }
  );

  test(
    `[${cpiConfigCases.pviAcceptMax.key}] ${cpiConfigCases.pviAcceptMax.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.pviAcceptMax;
      const pvi = parseApplicablePvi(tc.testData);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);

      await configPage.selectBusinessEntity(parseBusinessEntityFromCase(tc));
      const portfolio = await configPage.findPortfolioRowName();

      await test.step(tc.expectedResults[0] || 'assert success toast', async () => {
        await configPage.editApplicablePviForPortfolio(portfolio, pvi);
        await configPage.clickSaveIcon();
        const toast = await configPage.waitForToastMatching(toastPattern);
        const toastText = `${toast.title} ${toast.message}`.replace(/\s+/g, ' ').trim();
        assertTextMatchesExcel(tc.key, 'toast', toastText, toastPattern);
      });
    }
  );

  test(
    `[${cpiConfigCases.decimalPlaces.key}] ${cpiConfigCases.decimalPlaces.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.decimalPlaces;
      const [gridPvi, dialogPvi] = parseAllApplicablePviValues(tc.testData);
      const gridError = inlineErrorPatternFromExpected(tc.expectedResults[0] || tc.expectedResults);
      const dialogError = inlineErrorPatternFromExpected(
        tc.expectedResults[1] || tc.expectedResults[0] || tc.expectedResults
      );

      await configPage.selectBusinessEntity(parseBusinessEntityFromCase(tc));
      const portfolio = await configPage.findPortfolioRowName();

      await test.step(tc.expectedResults[0] || 'grid rejects more than 2 decimal places', async () => {
        await configPage.editApplicablePviForPortfolio(portfolio, gridPvi);
        const uiError = await configPage.readInlineErrorText(gridError);
        assertTextMatchesExcel(tc.key, 'grid error', uiError, gridError);
      });

      await test.step(
        tc.expectedResults[1] || 'Add or update PVI dialog rejects more than 2 decimal places',
        async () => {
          await configPage.fillAddOrUpdatePvi({
            portfolio,
            applicablePvi: dialogPvi,
          });
          const uiError = await configPage.readInlineErrorText(dialogError);
          assertTextMatchesExcel(tc.key, 'dialog error', uiError, dialogError);
          await configPage.cancelAddOrUpdatePviDialog();
        }
      );
    }
  );

  test(
    `[${cpiConfigCases.duplicatePortfolio.key}] ${cpiConfigCases.duplicatePortfolio.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.duplicatePortfolio;
      const portfolio = requirePortfolioFromCase(tc);
      const pvi = parseApplicablePvi(tc.testData);
      const startDate = parseEffectiveStartDate(tc.testData);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);

      await configPage.selectBusinessEntity(parseBusinessEntityFromCase(tc));

      await test.step(tc.expectedResults[0] || 'assert duplicate portfolio toast', async () => {
        await configPage.fillAddOrUpdatePvi({
          portfolio,
          applicablePvi: pvi,
          effectiveStartDate: startDate,
        });
        await configPage.saveAddOrUpdatePviDialog();
        const toast = await configPage.waitForToastMatching(toastPattern);
        const toastText = `${toast.title} ${toast.message}`.replace(/\s+/g, ' ').trim();
        assertTextMatchesExcel(tc.key, 'toast', toastText, toastPattern);
      });
    }
  );

  test(
    `[${cpiConfigCases.specializations.key}] ${cpiConfigCases.specializations.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.specializations;
      const toastPattern = toastPatternFromExpected(tc.expectedResults);

      await configPage.selectBusinessEntity(parseBusinessEntityFromCase(tc));
      const labels = await configPage.getSpecializationLabels();
      console.log(`[${tc.key}] UI specialization labels: ${labels.join(' | ')}`);
      expect(
        labels.length,
        tc.expectedResults[0] || 'specialization labels present'
      ).toBeGreaterThanOrEqual(2);

      await test.step(tc.expectedResults[0] || 'assert specialization labels and toast', async () => {
        await configPage.assertSpecializationLabels(labels.slice(0, 2));

        // Start from OFF so the next ON click always produces the Excel toast.
        await configPage.setSpecialization(labels[0], false);

        // Wait for toast concurrently with enable — toast auto-dismisses quickly.
        const [toast, enabled] = await Promise.all([
          configPage.waitForToastMatching(toastPattern),
          configPage.setSpecialization(labels[0], true),
        ]);
        expect(enabled, `Failed to enable specialization "${labels[0]}"`).toBeTruthy();
        const toastText = `${toast.title} ${toast.message}`.replace(/\s+/g, ' ').trim();
        assertTextMatchesExcel(tc.key, 'toast', toastText, toastPattern);

        if (labels[1]) {
          await configPage.setSpecialization(labels[1], false);
        }
      });

      await test.step(tc.expectedResults[1] || 'refresh and assert toggle persists', async () => {
        await configPage.refreshPage();
        await configPage.selectBusinessEntity(parseBusinessEntityFromCase(tc));
        await configPage.assertSpecializationEnabled(labels[0], true);
        console.log(`[${tc.key}] UI specialization "${labels[0]}": enabled`);
        console.log(`[${tc.key}] Excel expected: The toggle will still be active`);
        console.log(`[${tc.key}] PASS: specialization toggle remains active`);
      });
    }
  );

  test(
    `[${cpiConfigCases.autoRebateOff.key}] ${cpiConfigCases.autoRebateOff.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      test.setTimeout(300000);
      const configPage = new CpiConfigurationPage(page);
      const quotePage = new QuotePage(page);
      const cpiQuote = new CpiCalculationPage(page);
      const tc = cpiConfigCases.autoRebateOff;
      const be = parseBusinessEntityFromCase(tc);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);
      const quoteName = parseQuoteIdFromTestData(tc.testData);
      const partNumber = parsePartNumberFromTestData(tc.testData);
      const listPrice = parseListPriceFromTestData(tc.testData);
      const statusPattern = parseEstimatedCpiItemStatusFromExpected(tc.expectedResults);

      if (!quoteName) {
        throw new Error(`[${tc.key}] Quote Name (QT-…) missing from Excel testData`);
      }
      if (!partNumber) {
        throw new Error(`[${tc.key}] Part Number missing from Excel testData`);
      }
      if (!listPrice) {
        throw new Error(`[${tc.key}] List Price missing from Excel testData`);
      }

      try {
        await configPage.selectBusinessEntity(be);

        await test.step(tc.expectedResults[0] || 'uncheck Automatic Rebate and assert toast', async () => {
          let changed = await configPage.setAutomaticRebateCalculation(false);
          if (!changed) {
            await configPage.setAutomaticRebateCalculation(true);
            changed = await configPage.setAutomaticRebateCalculation(false);
          }
          expect(changed, 'switch should change to OFF').toBeTruthy();
          const toast = await configPage.waitForToastMatching(toastPattern);
          const toastText = `${toast.title} ${toast.message}`.replace(/\s+/g, ' ').trim();
          assertTextMatchesExcel(tc.key, 'toast', toastText, toastPattern);
        });

        await test.step(tc.expectedResults[1] || `open quote ${quoteName}`, async () => {
          await cpiQuote.gotoQuoteByName(quoteName);
          await quotePage.waitForQuoteDetailsPage();
          console.log(`[${tc.key}] Quote opened: ${quoteName}`);
        });

        await test.step(tc.steps[2] || 'create Quote Item from Related', async () => {
          const itemId = await quotePage.createQuoteItemFromRelated({
            partNumber,
            listPrice,
          });
          console.log(
            `[${tc.key}] Quote Item created part=${partNumber} listPrice=${listPrice} id=${itemId || '(url pending)'}`
          );
        });

        await test.step(tc.expectedResults[6] || 'assert Estimated CPI Calculation Status', async () => {
          const status = await cpiQuote.refreshAndAssertEstimatedCpiCalculationStatus(statusPattern);
          assertTextMatchesExcel(tc.key, 'Estimated CPI Calculation Status', status, statusPattern);
        });
      } finally {
        // Restore Automatic Rebate so later CPI cases are not left with the toggle OFF.
        try {
          await configPage.gotoCpiConfigurationTab();
          await configPage.selectBusinessEntity(be);
          await configPage.setAutomaticRebateCalculation(true);
          console.log(`[${tc.key}] Restored Automatic Rebate Calculation: ON`);
        } catch (e) {
          console.warn(
            `[${tc.key}] Could not restore Automatic Rebate Calculation: ${String((e as Error)?.message || e)}`
          );
        }
      }
    }
  );

  test(
    `[${cpiConfigCases.autoRebateOn.key}] ${cpiConfigCases.autoRebateOn.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.autoRebateOn;
      const be = parseBusinessEntityFromCase(tc);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);

      await configPage.selectBusinessEntity(be);

      await test.step(tc.expectedResults[0] || 'check Automatic Rebate and assert toast', async () => {
        let changed = await configPage.setAutomaticRebateCalculation(true);
        if (!changed) {
          await configPage.setAutomaticRebateCalculation(false);
          changed = await configPage.setAutomaticRebateCalculation(true);
        }
        expect(changed, 'switch should change to ON').toBeTruthy();
        const toast = await configPage.waitForToastMatching(toastPattern);
        const toastText = `${toast.title} ${toast.message}`.replace(/\s+/g, ' ').trim();
        assertTextMatchesExcel(tc.key, 'toast', toastText, toastPattern);
      });

      await test.step('assert switch remains ON', async () => {
        await configPage.assertAutomaticRebateCalculation(true);
        console.log(`[${tc.key}] UI Automatic Rebate Calculation: ON`);
        console.log(`[${tc.key}] PASS: switch remains ON`);
      });
    }
  );

  test(
    `[${cpiConfigCases.pviZeroNoRebate.key}] ${cpiConfigCases.pviZeroNoRebate.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.pviZeroNoRebate;
      const pvi = parseApplicablePvi(tc.testData);
      const portfolioName = requirePortfolioFromCase(tc);
      const startDate = parseEffectiveStartDate(tc.testData);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);

      await configPage.selectBusinessEntity(parseBusinessEntityFromCase(tc));

      await test.step(tc.expectedResults[0] || 'save PVI and assert success toast', async () => {
        const rows = await configPage.getPviGridRows();
        const existing = rows.find((r) => new RegExp(portfolioName, 'i').test(r.portfolio));
        if (existing) {
          await configPage.editApplicablePviForPortfolio(existing.portfolio, pvi);
          await configPage.clickSaveIcon();
        } else {
          await configPage.fillAddOrUpdatePvi({
            portfolio: portfolioName,
            applicablePvi: pvi,
            effectiveStartDate: startDate,
          });
          await configPage.saveAddOrUpdatePviDialog();
        }
        const toast = await configPage.waitForToastMatching(toastPattern);
        const toastText = `${toast.title} ${toast.message}`.replace(/\s+/g, ' ').trim();
        assertTextMatchesExcel(tc.key, 'toast', toastText, toastPattern);
      });
    }
  );

  test(
    `[${cpiConfigCases.markInvalidOnChange.key}] ${cpiConfigCases.markInvalidOnChange.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.markInvalidOnChange;
      const { from, to } = parsePviFromTo(tc.testData);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);

      await configPage.selectBusinessEntity(parseBusinessEntityFromCase(tc));

      await test.step('ensure Mark Existing Rebates as Invalid is ON', async () => {
        await configPage.setMarkExistingRebatesInvalid(true);
      });

      await test.step(tc.expectedResults[1] || 'change PVI and assert success toast', async () => {
        const portfolioName = requirePortfolioFromCase(tc);
        const portfolio = await configPage.findPortfolioRowName(new RegExp(portfolioName, 'i'));
        const rows = await configPage.getPviGridRows();
        const current = rows.find((r) => r.portfolio === portfolio)?.applicablePvi || '';
        const rawNext = normalizePviDisplay(current) === normalizePviDisplay(to) ? from : to;
        const next = configPage.formatPviForMarkInvalidSave(rawNext);
        console.log(`[${tc.key}] UI current PVI: ${current}; next PVI: ${next}`);
        await configPage.editApplicablePviForPortfolio(portfolio, next);
        await configPage.clickSaveIcon();
        const toast = await configPage.waitForToastMatching(toastPattern);
        const toastText = `${toast.title} ${toast.message}`.replace(/\s+/g, ' ').trim();
        assertTextMatchesExcel(tc.key, 'toast', toastText, toastPattern);
      });
    }
  );

  test(
    `[${cpiConfigCases.wonQuotesSkipped.key}] ${cpiConfigCases.wonQuotesSkipped.name}`,
    { tag: ['@cpiConfiguration'] },
    async () => {
      const configPage = new CpiConfigurationPage(page);
      const tc = cpiConfigCases.wonQuotesSkipped;
      const { from, to } = parsePviFromTo(tc.testData);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);

      await configPage.selectBusinessEntity(parseBusinessEntityFromCase(tc));

      await test.step('ensure Mark Existing Rebates as Invalid is ON', async () => {
        await configPage.setMarkExistingRebatesInvalid(true);
      });

      await test.step(tc.expectedResults[1] || 'change PVI and assert success toast', async () => {
        const portfolioName = requirePortfolioFromCase(tc);
        const portfolio = await configPage.findPortfolioRowName(new RegExp(portfolioName, 'i'));
        const rows = await configPage.getPviGridRows();
        const current = rows.find((r) => r.portfolio === portfolio)?.applicablePvi || '';
        const rawNext = normalizePviDisplay(current) === normalizePviDisplay(to) ? from : to;
        const next = configPage.formatPviForMarkInvalidSave(rawNext);
        console.log(`[${tc.key}] UI current PVI: ${current}; next PVI: ${next}`);
        await configPage.editApplicablePviForPortfolio(portfolio, next);
        await configPage.clickSaveIcon();
        const toast = await configPage.waitForToastMatching(toastPattern);
        const toastText = `${toast.title} ${toast.message}`.replace(/\s+/g, ' ').trim();
        assertTextMatchesExcel(tc.key, 'toast', toastText, toastPattern);
      });
    }
  );
});
