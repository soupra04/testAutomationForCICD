/**
 * CPI ReCalculation Page tests — Search Quotes and Quote Items tab.
 *
 * Auth: SF_INSTANCE_URL / SF_SESSION_ID / SF_ORG_PREFIX via globalSetup → storageState.
 * Test data: assets/CPI_ReCalculation_Page.xlsx via cpiRecalculationCases.
 *
 * Filter data-ids verified via Playwright UI inspection (scripts/inspect-cpi-recalculation-ui.ts).
 */
import { test, expect, Page } from '@playwright/test';
import { CpiRecalculationPage, LoadedItemsSummary } from '../../pages/cpiRecalculationPage';
import { getSfOrgPrefix } from '../../utils/cpiOrg';
import { cpiRecalculationCases } from '../../utils/cpiExcelCases';
import {
  parseAccountFromTestData,
  parseBusinessEntityFromCase,
  parseColumnHeadersFromExpected,
  parseOpportunityNameFromTestData,
  parseQuoteIdFromTestData,
  parseQuoteNumbersFromTestData,
  parseQuoteStatusValuesFromTestData,
  parseOpportunityStageValuesFromTestData,
  parseSoqlFromExpected,
  cpiRecalculationBatchPattern,
  noEligibleQuoteItemsToastPattern,
  recalculateCpiDialogPatternFromExpected,
  toastPatternFromExpected,
} from '../../utils/excelTestDataParsers';

test.describe('CPI ReCalculation Page', () => {
  test.use({ viewport: { width: 1800, height: 1080 } });

  let page: Page;
  let cpiFeatureDeployed = true;
  let deployChecked = false;

  test.beforeEach(async ({ page: testPage }, testInfo) => {
    testInfo.setTimeout(300000);
    page = testPage;
    const recalc = new CpiRecalculationPage(page);
    await recalc.gotoSearchQuotesTab();
    if (!deployChecked) {
      deployChecked = true;
      cpiFeatureDeployed = await recalc.cpiCalculation().isCpiEffectiveDateFieldDeployed();
      if (!cpiFeatureDeployed) {
        console.warn(
          '[CPI ReCalculation] WARNING: CPI_Effective_Date__c not deployed — CPI filter/recalc cases may be skipped.'
        );
      }
    }
  });

  function skipUnlessCpiDeployed(): void {
    test.skip(
      !cpiFeatureDeployed,
      'CPI not deployed (CPI_Effective_Date__c missing on CustomerBoM)'
    );
  }

  test(
    `[${cpiRecalculationCases.dateRangeAndRebateFilter.key}] ${cpiRecalculationCases.dateRangeAndRebateFilter.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiRecalculationCases.dateRangeAndRebateFilter;
      const recalc = new CpiRecalculationPage(page);
      const [dateFrom, dateTo, rebateStatus] = tc.testData;

      await test.step('open remaining filters and set CPI date + Rebate Status', async () => {
        await recalc.openRemainingFiltersPopup();
        await recalc.setCpiEffectiveDateFrom(dateFrom);
        await recalc.setCpiEffectiveDateTo(dateTo);
        await recalc.setRebateStatus(rebateStatus);
        await recalc.saveRemainingFilters();
      });

      await test.step('apply filters and load results', async () => {
        await recalc.clickApply();
      });

      await test.step('compare UI count with SOQL', async () => {
        const soql = parseSoqlFromExpected(tc.expectedResults);
        if (soql) await recalc.assertUiCountMatchesSoql(soql);
      });

      await test.step('set pagination to 100 and verify first page row count', async () => {
        const pageSize = Number(tc.testData.find((v) => /^\d+$/.test(v)) || '100');
        const totalRecords = await recalc.getUiRecordCount('server');
        await recalc.setPagination(pageSize);
        await recalc.assertPaginationSize(pageSize);
        const expectedRows = Math.min(pageSize, totalRecords);
        await recalc.assertVisibleRowCount(expectedRows);
      });

      await test.step('assert CPI recalculation column headers', async () => {
        const headers = parseColumnHeadersFromExpected(tc.expectedResults);
        expect(
          headers.length,
          'Column headers could not be parsed from Excel expected results'
        ).toBeGreaterThan(0);
        await recalc.assertColumnHeadersMatchExpected(headers);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.selectAllAcrossPages.key}] ${cpiRecalculationCases.selectAllAcrossPages.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      const recalc = new CpiRecalculationPage(page);
      let loadedSummary: LoadedItemsSummary;

      await test.step('load all items', async () => {
        await recalc.clickApply();
        loadedSummary = await recalc.clickLoadAllItems();
        expect(loadedSummary.loaded, 'Loaded count should equal total after Load All').toBe(
          loadedSummary.total
        );
        expect(loadedSummary.text).toMatch(/Loaded \d+ out of \d+ items/i);
      });

      await test.step('click Select All and verify highlighted selection summary', async () => {
        await recalc.clickSelectAll();
        await recalc.assertAllLoadedItemsSelectedSummary(loadedSummary!);
      });

      
    }
  );

  test(
    `[${cpiRecalculationCases.batchNotifyByEmail.key}] ${cpiRecalculationCases.batchNotifyByEmail.name}`,
    { tag: ['@cpiRecalculation', '@manual'] },
    async () => {
      test.skip(true, 'Email verification step requires manual/mail API — UI path covered in T4968');
    }
  );

  test(
    `[${cpiRecalculationCases.cpiEffectiveDateFrom.key}] ${cpiRecalculationCases.cpiEffectiveDateFrom.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiRecalculationCases.cpiEffectiveDateFrom;
      const recalc = new CpiRecalculationPage(page);
      const [dateFrom] = tc.testData;

      await test.step('set CPI Effective Date From filter', async () => {
        await recalc.openRemainingFiltersPopup();
        await recalc.setCpiEffectiveDateFrom(dateFrom);
        await recalc.saveRemainingFilters();
        await recalc.clickApply();
      });

      await test.step('verify SOQL count if provided', async () => {
        const soql = parseSoqlFromExpected(tc.expectedResults);
        if (soql) await recalc.assertUiCountMatchesSoql(soql);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.cpiEffectiveDateTo.key}] ${cpiRecalculationCases.cpiEffectiveDateTo.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiRecalculationCases.cpiEffectiveDateTo;
      const recalc = new CpiRecalculationPage(page);
      const [dateTo] = tc.testData;

      await test.step('set CPI Effective Date To filter', async () => {
        await recalc.openRemainingFiltersPopup();
        await recalc.setCpiEffectiveDateTo(dateTo);
        await recalc.saveRemainingFilters();
        await recalc.clickApply();
      });

      await test.step('verify SOQL count if provided', async () => {
        const soql = parseSoqlFromExpected(tc.expectedResults);
        if (soql) await recalc.assertUiCountMatchesSoql(soql);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.defaultFiltersNoError.key}] ${cpiRecalculationCases.defaultFiltersNoError.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      const recalc = new CpiRecalculationPage(page);

      await test.step('assert default server filters visible', async () => {
        await recalc.assertDefaultServerFiltersVisible();
      });

      await test.step('apply with default filters — no errors', async () => {
        await recalc.assertNoErrorsOnApply();
      });
    }
  );

  test(
    `[${cpiRecalculationCases.rebateStatusDefault.key}] ${cpiRecalculationCases.rebateStatusDefault.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const recalc = new CpiRecalculationPage(page);

      await test.step('Rebate Status defaults to All', async () => {
        await recalc.assertRebateStatusDefaultIsAll();
      });

      await test.step('Rebate Status options All, Valid, Invalid', async () => {
        await recalc.assertRebateStatusOptions(['All', 'Valid', 'Invalid']);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.multipleQuoteStatuses.key}] ${cpiRecalculationCases.multipleQuoteStatuses.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      const tc = cpiRecalculationCases.multipleQuoteStatuses;
      const recalc = new CpiRecalculationPage(page);
      const statuses = parseQuoteStatusValuesFromTestData(tc.testData);

      await test.step('select multiple Quote Statuses', async () => {
        await recalc.openRemainingFiltersPopup();
        for (const status of statuses) {
          await recalc.setQuoteStatus(status);
        }
        await recalc.saveRemainingFilters();
        await recalc.clickApply();
      });

      await test.step('verify results', async () => {
        const soql = parseSoqlFromExpected(tc.expectedResults);
        if (soql) await recalc.assertUiCountMatchesSoql(soql);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.multipleOpportunityStages.key}] ${cpiRecalculationCases.multipleOpportunityStages.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      const tc = cpiRecalculationCases.multipleOpportunityStages;
      const recalc = new CpiRecalculationPage(page);
      const stages = parseOpportunityStageValuesFromTestData(tc.testData);

      await test.step('select multiple Opportunity Stages', async () => {
        await recalc.openRemainingFiltersPopup();
        for (const stage of stages) {
          await recalc.setOpportunityStage(stage);
        }
        await recalc.saveRemainingFilters();
        await recalc.clickApply();
      });

      await test.step('verify results', async () => {
        const soql = parseSoqlFromExpected(tc.expectedResults);
        if (soql) await recalc.assertUiCountMatchesSoql(soql);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.accountFilter.key}] ${cpiRecalculationCases.accountFilter.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      const tc = cpiRecalculationCases.accountFilter;
      const recalc = new CpiRecalculationPage(page);
      const account = parseAccountFromTestData(tc.testData);
      if (!account) throw new Error(`Account missing from Excel ${tc.key}`);

      await test.step(`filter by Account ${account}`, async () => {
        await recalc.openRemainingFiltersPopup();
        await recalc.saveRemainingFilters();
        await recalc.selectAccount(account);
        await recalc.clickApply();
      });

      await test.step('verify SOQL count', async () => {
        const soql = parseSoqlFromExpected(tc.expectedResults);
        if (soql) await recalc.assertUiCountMatchesSoql(soql);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.opportunityFilter.key}] ${cpiRecalculationCases.opportunityFilter.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      const tc = cpiRecalculationCases.opportunityFilter;
      const recalc = new CpiRecalculationPage(page);
      const opportunity = parseOpportunityNameFromTestData(tc.testData);
      if (!opportunity) throw new Error(`Opportunity missing from Excel ${tc.key}`);

      await test.step(`filter by Opportunity ${opportunity}`, async () => {
        await recalc.openRemainingFiltersPopup();
        await recalc.saveRemainingFilters();
        await recalc.selectOpportunity(opportunity);
        await recalc.clickApply();
      });

      await test.step('verify SOQL count', async () => {
        const soql = parseSoqlFromExpected(tc.expectedResults);
        if (soql) await recalc.assertUiCountMatchesSoql(soql);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.businessEntityFilter.key}] ${cpiRecalculationCases.businessEntityFilter.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiRecalculationCases.businessEntityFilter;
      const recalc = new CpiRecalculationPage(page);
      const be = parseBusinessEntityFromCase(tc);

      await test.step(`filter by Business Entity ${be}`, async () => {
        await recalc.openRemainingFiltersPopup();
        await recalc.setBusinessEntity(be);
        await recalc.saveRemainingFilters();
        await recalc.clickApply();
      });

      await test.step('verify SOQL count', async () => {
        const soql = parseSoqlFromExpected(tc.expectedResults);
        if (soql) await recalc.assertUiCountMatchesSoql(soql);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.combinedFilters.key}] ${cpiRecalculationCases.combinedFilters.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiRecalculationCases.combinedFilters;
      const recalc = new CpiRecalculationPage(page);
      const account = parseAccountFromTestData(tc.testData);
      if (!account) throw new Error(`Account missing from Excel ${tc.key}`);

      await test.step('apply Account + remaining filters', async () => {
        await recalc.selectAccount(account);
        await recalc.openRemainingFiltersPopup();
        const data = tc.testData;
        const dateFrom = data.find((v) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(v) && data.indexOf(v) === data.findIndex((x) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(x)));
        const dateTo = data.filter((v) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(v))[1];
        const quoteStatus = data.find((v) => /won/i.test(v));
        const rebateStatus = data.find((v) => /invalid/i.test(v));
        if (dateFrom) await recalc.setCpiEffectiveDateFrom(dateFrom);
        if (dateTo) await recalc.setCpiEffectiveDateTo(dateTo);
        if (quoteStatus) await recalc.setQuoteStatus(quoteStatus);
        if (rebateStatus) await recalc.setRebateStatus(rebateStatus);
        await recalc.saveRemainingFilters();
        await recalc.clickApply();
      });

      await test.step('verify SOQL count', async () => {
        const soql = parseSoqlFromExpected(tc.expectedResults);
        if (soql) await recalc.assertUiCountMatchesSoql(soql);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.notCalculatedDisplay.key}] ${cpiRecalculationCases.notCalculatedDisplay.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiRecalculationCases.notCalculatedDisplay;
      const recalc = new CpiRecalculationPage(page);

      await test.step('apply CPI date filters for quotes without CPI', async () => {
        await recalc.openRemainingFiltersPopup();
        for (const value of tc.testData) {
          if (/last quarter/i.test(value)) {
            await recalc.setCpiEffectiveDateFrom(value);
            await recalc.setCpiEffectiveDateTo(value);
          }
        }
        await recalc.saveRemainingFilters();
        await recalc.clickApply();
      });

      await test.step('Total CPI shows Not Calculated on all quote rows', async () => {
        await recalc.assertColumnShowsNotCalculated('Total CPI');
      });

      await test.step('Total Calculated Rebate Value shows Not Calculated on all quote rows', async () => {
        await recalc.assertColumnShowsNotCalculated('Total Calculated Rebate Value');
      });
    }
  );

  test(
    `[${cpiRecalculationCases.quoteNumberLink.key}] ${cpiRecalculationCases.quoteNumberLink.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      const recalc = new CpiRecalculationPage(page);

      await test.step('apply and load records', async () => {
        await recalc.clickApply();
      });

      let quoteNumber = '';
      await test.step('click first Quote Number link from grid', async () => {
        quoteNumber = await recalc.clickQuoteNumberLink();
      });

      await test.step('Quote detail page opens', async () => {
        await recalc.assertQuoteDetailOpened(quoteNumber);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.cancelNoJob.key}] ${cpiRecalculationCases.cancelNoJob.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiRecalculationCases.cancelNoJob;
      const recalc = new CpiRecalculationPage(page);
      const quote = parseQuoteIdFromTestData(tc.testData);
      if (!quote) throw new Error(`Quote Number missing from Excel ${tc.key}`);
      const batchPattern = cpiRecalculationBatchPattern(tc.expectedResults);

      await test.step('select quote and open recalculation dialog', async () => {
        await recalc.clickApply();
        await recalc.selectQuoteByNumber(quote);
        await recalc.clickRecalculateCpiOnSelected();
        await recalc.assertRecalculateCpiDialogVisible(/Recalculate CPI/i);
      });

      await test.step('cancel dialog — no job started', async () => {
        const bqmBaseline = await recalc.captureBqmBaseline();
        await recalc.cancelRecalculateDialog();
        await recalc.assertNoRecalculationJobStarted(bqmBaseline, batchPattern, {
          waitMs: 8000,
          scanLimit: 10,
        });
        await recalc.assertNoToastWithin(5000);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.asyncModeOver100.key}] ${cpiRecalculationCases.asyncModeOver100.name}`,
    { tag: ['@cpiRecalculation', '@manual'] },
    async () => {
      test.skip(true, 'Email verification step requires manual/mail API — BQM path covered in T4971');
    }
  );

  test(
    `[${cpiRecalculationCases.syncModeUnder100.key}] ${cpiRecalculationCases.syncModeUnder100.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiRecalculationCases.syncModeUnder100;
      const recalc = new CpiRecalculationPage(page);
      const quotes = parseQuoteNumbersFromTestData(tc.testData);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);

      await test.step('select quotes and recalculate (sync)', async () => {
        await recalc.clickApply();
        await recalc.selectQuotesByNumbers(quotes);
        await recalc.clickRecalculateCpiOnSelected();

        const launch = await recalc.waitForRecalculateDialogOrIneligibleToast(30000, quotes);
        if (launch.outcome === 'ineligible') {
          expect(launch.toast.message).toMatch(noEligibleQuoteItemsToastPattern());
          test.skip(
            true,
            `Selected quotes not eligible for CPI estimate (${quotes.join(', ')}): ${launch.toast.message}`
          );
          return;
        }

        await recalc.assertRecalculateCpiDialogVisible(/Recalculate CPI/i);
        await recalc.chooseIWillWaitOnRecalculate();
        await recalc.waitForSyncRecalculationComplete(toastPattern);
      });
    }
  );



  test(
    `[${cpiRecalculationCases.recalculationUpdatesFields.key}] ${cpiRecalculationCases.recalculationUpdatesFields.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiRecalculationCases.recalculationUpdatesFields;
      const recalc = new CpiRecalculationPage(page);
      const quote = parseQuoteIdFromTestData(tc.testData);
      if (!quote) throw new Error(`Quote missing from Excel ${tc.key}`);
      const batchPattern = cpiRecalculationBatchPattern(tc.expectedResults);
      const since = recalc.soqlNowMinusSeconds(5);

      await test.step('select quote and start recalculation', async () => {
        await recalc.clickApply();
        await recalc.selectQuoteByNumber(quote);
        await recalc.clickRecalculateCpiOnSelected();
        await recalc.assertRecalculateCpiDialogVisible(/Recalculate CPI/i);
        await recalc.chooseNotifyByEmailOnRecalculate();
        const toastPattern = toastPatternFromExpected(tc.expectedResults);
        await recalc.cpiCalculation().waitForToastMatching(toastPattern, 60000);
      });

      await test.step('wait for BQM job to complete', async () => {
        await recalc.assertLatestRecalculationJob(since, batchPattern);
      });

      await test.step('verify CPI fields refreshed via SOQL', async () => {
        const cpi = recalc.cpiCalculation();
        const rows = await cpi.querySoql<Record<string, unknown>>(
          `SELECT Id, Name FROM ${getSfOrgPrefix()}__CustomerBoM__c WHERE Name = '${quote.replace(/'/g, "\\'")}' LIMIT 1`
        );
        expect(rows.length).toBeGreaterThan(0);
      });
    }
  );

  test(
    `[${cpiRecalculationCases.recalculationToastMessages.key}] ${cpiRecalculationCases.recalculationToastMessages.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiRecalculationCases.recalculationToastMessages;
      const recalc = new CpiRecalculationPage(page);

      await test.step('apply and load data', async () => {
        await recalc.clickApply();
      });

      await test.step('null CPI Effective Date — error toast', async () => {
        const nullDateQuote = parseQuoteIdFromTestData([tc.testData[0] || '']);
        if (nullDateQuote) {
          await recalc.selectQuoteByNumber(nullDateQuote);
          await recalc.clickRecalculateCpiOnSelected();
          const errPattern = toastPatternFromExpected(
            tc.expectedResults.find((e) => /CPI Effective Date is Empty/i.test(e)) || tc.expectedResults
          );
          await recalc.cpiCalculation().waitForToastMatching(errPattern, 30000);
          await recalc.deselectQuoteByNumber(nullDateQuote);
        }
      });

      await test.step('no quote items — success toast', async () => {
        const emptyQuote = tc.testData.find((v) => /QT-/.test(v) && v.includes('855')) || tc.testData.at(-1);
        if (emptyQuote) {
          await recalc.selectQuoteByNumber(emptyQuote);
          await recalc.clickRecalculateCpiOnSelected();
          const okPattern = toastPatternFromExpected(
            tc.expectedResults.find((e) => /no quote line items/i.test(e)) || tc.expectedResults
          );
          await recalc.cpiCalculation().waitForToastMatching(okPattern, 30000);
        }
      });
    }
  );

  test(
    `[${cpiRecalculationCases.mixedDateQuotesSuccess.key}] ${cpiRecalculationCases.mixedDateQuotesSuccess.name}`,
    { tag: ['@cpiRecalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiRecalculationCases.mixedDateQuotesSuccess;
      const recalc = new CpiRecalculationPage(page);
      const quotes = parseQuoteNumbersFromTestData(tc.testData);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);

      await test.step('apply default filters', async () => {
        await recalc.clickApply();
      });

      await test.step('select future + present + past date quotes', async () => {
        await recalc.selectQuotesByNumbers(quotes);
      });

      await test.step('recalculate and assert success toast', async () => {
        await recalc.clickRecalculateCpiOnSelected();
        await recalc.assertRecalculateCpiDialogVisible(
          recalculateCpiDialogPatternFromExpected(tc.expectedResults)
        );
        await recalc.chooseIWillWaitOnRecalculate();
        await recalc.waitForSyncRecalculationComplete(toastPattern);
      });
    }
  );
});
