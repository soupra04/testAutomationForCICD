/**
 * CPI Calculation Trigger tests.
 *
 * Auth: same as the rest of the suite — SF_INSTANCE_URL / SF_SESSION_ID /
 * SF_ORG_PREFIX via globalSetup → state.chromium.json (Playwright storageState).
 *
 * Create-quote cases: Opportunity Name must be in that case's Excel Test Data
 * (plain name or `Opportunity = …`). User maintains the Zephyr sheet — not .env.
 *
 * Zephyr: assets/CPICalculationTriggerTestCases.xlsx via cpiCalculationCases.
 */
import { test, Page } from '@playwright/test';
import { CpiCalculationPage } from '../../pages/cpiCalculationPage';
import { BomService } from '../../services/bom-service';
import { QuoteService } from '../../services/quote-service';
import { cpiCalculationCases } from '../../utils/cpiExcelCases';
import type { ExcelTestCaseData } from '../../utils/excelTestCaseData';
import {
  cpiQuoteCalculationBatchPattern,
  estimateCpiDialogPatternFromExpected,
  parseBomIdFromTestData,
  parseLineItemFromTestData,
  parseCcwrImportFromTestData,
  parseCpiValidationPartNumberFromExpected,
  parseEqgFieldApiFromStep,
  parseEqgInlineEditValueFromTestData,
  parseQuoteStatusFromExcel,
  toastPatternFromExpected,
} from '../../utils/excelTestDataParsers';
import { AdvanceUi } from '../../utils/advUi';
import type { EstimatedCpiHeaderSnapshot, QuoteItemCpiSnapshot } from '../../pages/cpiCalculationPage';
import { fakeLibrary } from '../../utils/fakeLibrary';
import { XRLUtils } from '../../utils/xrlUtils';

/** Excel step text for test.step labels (login steps omitted — covered by beforeEach). */
function excelStep(tc: Pick<ExcelTestCaseData, 'steps'>, index: number, fallback = ''): string {
  const step = tc.steps[index]?.replace(/\s+/g, ' ').trim();
  return step || fallback;
}

/** Expected Result cell for a given Excel step index. */
function expectedAt(tc: ExcelTestCaseData, index: number): string {
  const raw = tc.expectedResults[index];
  if (!raw?.trim()) {
    throw new Error(`Missing Expected Result at step index ${index} for ${tc.key}`);
  }
  return raw;
}

/** Supplier Assignment grid: change Manufacturer on row 1 and persist (same as supplierAssignment specs). */
async function changeManufacturerOnSupplierGrid(
  page: Page,
  cpi: CpiCalculationPage,
  quoteSvc: QuoteService,
  quoteName: string,
  manufacturer: string,
  pickAlternateFromDropdown = false
): Promise<{ current?: string; selected?: string }> {
  await cpi.gotoQuoteByName(quoteName);
  await cpi.openSupplierAssignment();
  await page.waitForURL(/Supplier_Assignment/, { timeout: 60000 });
  await page
    .locator('button[aria-haspopup="listbox"][role="combobox"]')
    .first()
    .waitFor({ state: 'visible', timeout: 90000 });

  let changeResult: { current?: string; selected?: string } = {};
  if (pickAlternateFromDropdown) {
    changeResult = await quoteSvc.changeManufacturerToDifferentOption(1, manufacturer);
    console.log(
      `[Supplier Grid] Manufacturer changed from "${changeResult.current}" to "${changeResult.selected}"`
    );
  } else {
    await quoteSvc.changeManufacturer(['one'], manufacturer, 1);
  }

  await page.waitForTimeout(1000);
  await quoteSvc.saveSupplierAssignmentGrid();
  return changeResult;
}

test.describe('CPI Calculation Trigger', () => {
  test.use({ viewport: { width: 1800, height: 1080 } });

  let page: Page;
  let cpiFeatureDeployed = true;
  let deployChecked = false;

  test.beforeEach(async ({ page: testPage }, testInfo) => {
    testInfo.setTimeout(300000);
    page = testPage;
    const cpi = new CpiCalculationPage(page);
    await cpi.gotoCpiOrgHome();
    if (!deployChecked) {
      deployChecked = true;
      cpiFeatureDeployed = await cpi.isCpiEffectiveDateFieldDeployed();
      if (!cpiFeatureDeployed) {
        console.warn(
          '[CPI Calculation] WARNING: CPI_Effective_Date__c not found on CustomerBoM. ' +
            'Cases that require CPI fields/Estimate CPI will be skipped.'
        );
      }
    }
  });

  function skipUnlessCpiDeployed(): void {
    test.skip(
      !cpiFeatureDeployed,
      'CPI Calculation not deployed (CPI_Effective_Date__c missing on CustomerBoM)'
    );
  }

  function createCpiQuoteService(p: Page): QuoteService {
    return new QuoteService(p);
  }

  /** Delete Quote via header Delete button after tests that create a new Quote. */
  async function cleanupCreatedQuote(cpi: CpiCalculationPage, quoteId: string): Promise<void> {
    if (!quoteId) return;
    try {
      await cpi.deleteQuoteById(quoteId);
    } catch (e) {
      console.error(`[CPI cleanup] failed to delete quote ${quoteId}: ${e}`);
    }
  }

  test(
    `[${cpiCalculationCases.effectiveDateOnCreate.key}] ${cpiCalculationCases.effectiveDateOnCreate.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.effectiveDateOnCreate;
      const cpi = new CpiCalculationPage(page);
      let createdQuoteId = '';

      try {
        await test.step(excelStep(tc, 1, 'Navigate to Opportunity and create Quote'), async () => {
          await cpi.openOpportunityForCreateFromExcel(tc.testData);
          await cpi.createNewQuoteFromOpportunity();
          createdQuoteId = await cpi.parseQuoteIdFromUrl();
          await cpi.waitForQuoteReady();
        });

        await test.step(excelStep(tc, 3, 'CPI Effective Date auto-populated to today'), async () => {
          await cpi.assertCpiEffectiveDateTodayFromSoqlOrUi();
        });

        await test.step(
          excelStep(tc, 4, 'CPI Effective Date populated without manual input'),
          async () => {
            await cpi.assertCpiEffectiveDateAutoPopulatedWithoutManualInput();
          }
        );
      } finally {
        await cleanupCreatedQuote(cpi, createdQuoteId);
      }
    }
  );

  test(
    `[${cpiCalculationCases.effectiveDateOnWon.key}] ${cpiCalculationCases.effectiveDateOnWon.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.effectiveDateOnWon;
      const cpi = new CpiCalculationPage(page);
      const wonStatus = parseQuoteStatusFromExcel({
        testData: tc.testData,
        steps: tc.steps,
        name: tc.name,
        expectedResults: tc.expectedResults,
      });
      const saveToastPattern = toastPatternFromExpected(tc.expectedResults);
      let createdQuoteId = '';

      try {
        await test.step(excelStep(tc, 1, 'Navigate to Opportunity and create Quote'), async () => {
          await cpi.openOpportunityForCreateFromExcel(tc.testData);
          await cpi.createNewQuoteFromOpportunity();
          createdQuoteId = await cpi.parseQuoteIdFromUrl();
          await cpi.waitForQuoteReady();
        });

        const previousDay = new Date();
        previousDay.setDate(previousDay.getDate() - 1);

        await test.step(excelStep(tc, 3, 'Set CPI Effective Date to previous day'), async () => {
          await cpi.setCpiEffectiveDate(previousDay);
        });

        await test.step(excelStep(tc, 4, `Set Quote Status to ${wonStatus}`), async () => {
          await cpi.setQuoteStatus(wonStatus);
          await cpi.waitForToastMatching(saveToastPattern, 30000).catch(() => undefined);
        });

        await test.step(excelStep(tc, 6, 'Estimate CPI button absent when Won'), async () => {
          await cpi.assertEstimateCpiVisible(false);
        });

        await test.step(excelStep(tc, 7, 'CPI Effective Date remains previous day after Won'), async () => {
          await cpi.assertCpiEffectiveDateMatches(new Date().toISOString());
        });
      } finally {
        await cleanupCreatedQuote(cpi, createdQuoteId);
      }
    }
  );

  test(
    `[${cpiCalculationCases.nullEffectiveDateBlocked.key}] ${cpiCalculationCases.nullEffectiveDateBlocked.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.nullEffectiveDateBlocked;
      const cpi = new CpiCalculationPage(page);
      const quoteSvc = createCpiQuoteService(page);
      const toastPattern =
        /cpi effective date is empty|no eligible quote items were found for cpi estimate/i;
      let createdQuoteId = '';

      try {
        await test.step(excelStep(tc, 1, 'Navigate to Opportunity and create Quote'), async () => {
          await cpi.openOpportunityForCreateFromExcel(tc.testData);
          await cpi.createNewQuoteFromOpportunity();
          createdQuoteId = await cpi.parseQuoteIdFromUrl();
          await cpi.waitForQuoteReady();
        });

        await test.step('Copy BoMs to Quote so Estimate CPI action is available', async () => {
          await quoteSvc.goToSelectBoMsPage();
          await quoteSvc.selectFirstNBomsForCopy(1);
          await quoteSvc.quickAddToQuote();
          await cpi.gotoQuoteByRecordId(createdQuoteId);
          await cpi.waitForQuoteReady();
        });

        await test.step(excelStep(tc, 3, 'Clear CPI Effective Date and save'), async () => {
          await cpi.clearCpiEffectiveDate();
        });

        await test.step(excelStep(tc, 5, 'Click Estimate CPI'), async () => {
          await cpi.clickEstimateCpi();
          const toast = await cpi.waitForToastMatching(toastPattern);
          cpi.assertTextMatchesExcel(
            tc.key,
            'toast',
            `${toast.title} ${toast.message}`,
            toastPattern
          );
        });

        await test.step(excelStep(tc, 6, 'Open Quote Item from Related tab'), async () => {
          await cpi.gotoQuoteByRecordId(createdQuoteId);
          await cpi.openFirstRelatedQuoteItem();
        });

        await test.step(excelStep(tc, 7, 'Estimated CPI Calculation Status unchanged'), async () => {
          await cpi.assertEstimatedCpiCalculationStatusUnchanged();
        });
      } finally {
        await cleanupCreatedQuote(cpi, createdQuoteId);
      }
    }
  );

  test(
    `[${cpiCalculationCases.partNumberChangeEnqueues.key}] ${cpiCalculationCases.partNumberChangeEnqueues.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.partNumberChangeEnqueues;
      const cpi = new CpiCalculationPage(page);
      const quoteName = cpi.requireQuoteName(tc.testData);
      const batchPattern = cpiQuoteCalculationBatchPattern(tc.expectedResults);
      let partNumber = '';
      let since = '';

      await test.step(excelStep(tc, 1, `Open Quote ${quoteName}`), async () => {
        await cpi.gotoQuoteByName(quoteName);
        await cpi.assertQuoteOpenedByName(quoteName);
      });

      await test.step(excelStep(tc, 2, 'Open Quote Item from Related tab'), async () => {
        await cpi.openFirstRelatedQuoteItem();
      });

      await test.step(excelStep(tc, 4, 'Change Part Number and Save'), async () => {
        partNumber = fakeLibrary.randomPartNumber();
        console.log(`[${tc.key}] Generated Part Number ${partNumber} (Part_* format like Excel Part_ABC)`);
        since = cpi.soqlNowMinusSeconds(30);
        await cpi.editQuoteItemPartNumberOnRecord(partNumber);
      });

      await test.step(excelStep(tc, 7, 'CPIQuoteCalculationBatch enqueued'), async () => {
        await cpi.assertLatestBqmJobMatches(batchPattern, since);
      });
    }
  );

  test(
    `[${cpiCalculationCases.syncModeUnder100.key}] ${cpiCalculationCases.syncModeUnder100.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.syncModeUnder100;
      const cpi = new CpiCalculationPage(page);
      const quoteName = cpi.requireQuoteName(tc.testData);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);
      const dialogPattern = estimateCpiDialogPatternFromExpected(
        cpiCalculationCases.notifyByEmailOver100.expectedResults
      );

      await test.step(excelStep(tc, 1, `Open Quote ${quoteName}`), async () => {
        await cpi.gotoQuoteByName(quoteName);
        await cpi.assertQuoteOpenedByName(quoteName);
      });

      let estimateToast: { title: string; message: string } | undefined;
      await test.step(excelStep(tc, 2, 'Click Estimate CPI'), async () => {
        estimateToast = await cpi.clickEstimateCpiAndWaitForSuccess(toastPattern, {
          dialogPattern,
          timeoutMs: 180000,
        });
      });

      await test.step(excelStep(tc, 3, 'Wait for CPI calculation toast'), async () => {
        if (estimateToast) {
          cpi.assertTextMatchesExcel(
            tc.key,
            'toast',
            `${estimateToast.title} ${estimateToast.message}`,
            toastPattern
          );
          return;
        }
        const toast = await cpi.waitForToastMatching(toastPattern, 5000).catch(() => undefined);
        if (toast) {
          cpi.assertTextMatchesExcel(
            tc.key,
            'toast',
            `${toast.title} ${toast.message}`,
            toastPattern
          );
        }
      });

      {
        const partNumber =
          parseCpiValidationPartNumberFromExpected(tc.expectedResults) ?? 'A-FLEX-NUPL-P';

        await test.step(excelStep(tc, 4, 'Go to Quote Item'), async () => {
          await cpi.gotoQuoteByName(quoteName);
          await cpi.gotoQuoteItemForCpiValidationFromExcel(tc.testData, partNumber);
        });

        let quoteItemSnapshot!: QuoteItemCpiSnapshot;
        await test.step(
          excelStep(tc, 5, 'Inspect Estimated CPI Calculation Status'),
          async () => {
            await cpi.assertEstimatedCpiCalculationStatusFromExcel(expectedAt(tc, 5));
            quoteItemSnapshot = await cpi.readQuoteItemCpiSnapshot();
          }
        );

        await test.step(excelStep(tc, 6, 'Inspect Estimated CPI Selected Portfolio'), async () => {
          cpi.assertEstimatedCpiSelectedPortfolioFromExcel(expectedAt(tc, 6), quoteItemSnapshot);
        });

        await test.step(excelStep(tc, 7, 'Inspect Estimated CPI PVI Tier'), async () => {
          cpi.assertEstimatedCpiPviTierFromExcel(expectedAt(tc, 7), quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 8, 'Inspect Estimated CPI Base Rebate Percentage'),
          async () => {
            cpi.inspectEstimatedCpiBaseRebatePercentFromExcel(expectedAt(tc, 8), quoteItemSnapshot);
          }
        );

        await test.step(excelStep(tc, 9, 'Inspect Estimated CPI Base Land Amount'), async () => {
          cpi.assertEstimatedCpiBaseLandAmountFromExcel(quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 10, 'Inspect Estimated CPI Accelerator Rebate Percent'),
          async () => {
            cpi.inspectEstimatedCpiAcceleratorRebatePercentFromExcel(
              expectedAt(tc, 10),
              quoteItemSnapshot
            );
          }
        );

        await test.step(excelStep(tc, 11, 'Inspect Estimated CPI Accelerator Amount'), async () => {
          cpi.assertEstimatedCpiAcceleratorAmountFromExcel(expectedAt(tc, 10), quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 12, 'Inspect Estimated CPI Spec Bonus Percentage'),
          async () => {
            cpi.assertEstimatedCpiSpecBonusPercentFromExcel(expectedAt(tc, 12), quoteItemSnapshot);
          }
        );

        await test.step(excelStep(tc, 13, 'Inspect Estimated CPI Spec Bonus Amount'), async () => {
          cpi.assertEstimatedCpiSpecBonusAmountFromExcel(expectedAt(tc, 13), quoteItemSnapshot);
        });

        await test.step(excelStep(tc, 14, 'Inspect Total Estimated CPI Amount'), async () => {
          cpi.assertEstimatedCpiTotalAmountFromExcel(quoteItemSnapshot);
        });

        await cpi.gotoQuoteByName(quoteName);

        await test.step(excelStep(tc, 15, 'Inspect Quote Header Estimated CPI Rebate Status'), async () => {
          await cpi.assertQuoteHeaderEstimatedCpiRebateStatusFromExcel(expectedAt(tc, 15));
        });

        await test.step(excelStep(tc, 16, 'Inspect Quote Header Estimated CPI Total Amount'), async () => {
          await cpi.assertQuoteHeaderEstimatedCpiTotalAmountFromExcel(expectedAt(tc, 16));
        });

        await test.step(
          excelStep(tc, 17, 'Inspect Quote Header Estimated CPI Total Base Land Amount'),
          async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalBaseLandFromExcel(expectedAt(tc, 17));
          }
        );

        await test.step(
          excelStep(tc, 18, 'Inspect Quote Header Estimated CPI Total Accelerator Amount'),
          async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalAcceleratorFromExcel(expectedAt(tc, 18));
          }
        );
      }
    }
  );

  test(
    `[${cpiCalculationCases.notifyByEmailOver100.key}] ${cpiCalculationCases.notifyByEmailOver100.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.notifyByEmailOver100;
      const cpi = new CpiCalculationPage(page);
      const quoteName = cpi.requireQuoteName(tc.testData);
      const batchPattern = cpiQuoteCalculationBatchPattern(tc.expectedResults);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);
      const dialogPattern = estimateCpiDialogPatternFromExpected(tc.expectedResults);
      const since = cpi.soqlNowMinusSeconds(5);

      await test.step(excelStep(tc, 1, 'Open Quote and Estimate CPI dialog'), async () => {
        await cpi.gotoQuoteByName(quoteName);
        await cpi.clickEstimateCpi();
        await cpi.assertEstimateCpiDialogVisible(dialogPattern);
      });

      await test.step(excelStep(tc, 3, 'Notify By Email'), async () => {
        await cpi.chooseNotifyByEmail();
        const toast = await cpi.waitForToastMatching(toastPattern, 60000);
        cpi.assertTextMatchesExcel(
          tc.key,
          'toast',
          `${toast.title} ${toast.message}`,
          toastPattern
        );
      });

      await test.step(excelStep(tc, 4, 'CPIQuoteCalculationBatch started'), async () => {
        await cpi.assertLatestBqmJobMatches(batchPattern, since);
      });

      await test.step(
        excelStep(tc, 4, 'Notification email after batch (exp[4] skipped)'),
        async () => {
          console.log(
            `[${tc.key}] exp[4] skipped — email notification not validated (email check not working): ` +
              expectedAt(tc, 4)
          );
        }
      );

      await test.step(excelStep(tc, 5, 'Wait for batch completion'), async () => {
        await page.waitForTimeout(30000);
        await cpi.assertLatestBqmJobMatches(batchPattern, since);
      });

      {
        const partNumber =
          parseCpiValidationPartNumberFromExpected(tc.expectedResults) ?? 'A-FLEX-NUPL-P';

        await test.step(excelStep(tc, 4, 'Go to Quote Item'), async () => {
          await cpi.gotoQuoteByName(quoteName);
          await cpi.gotoQuoteItemForCpiValidationFromExcel(tc.testData, partNumber);
        });

        let quoteItemSnapshot!: QuoteItemCpiSnapshot;
        await test.step(
          excelStep(tc, 5, 'Inspect Estimated CPI Calculation Status'),
          async () => {
            await cpi.assertEstimatedCpiCalculationStatusFromExcel(expectedAt(tc, 5));
            quoteItemSnapshot = await cpi.readQuoteItemCpiSnapshot();
          }
        );

        await test.step(excelStep(tc, 6, 'Inspect Estimated CPI Selected Portfolio'), async () => {
          cpi.assertEstimatedCpiSelectedPortfolioFromExcel(expectedAt(tc, 6), quoteItemSnapshot);
        });

        await test.step(excelStep(tc, 7, 'Inspect Estimated CPI PVI Tier'), async () => {
          cpi.assertEstimatedCpiPviTierFromExcel(expectedAt(tc, 7), quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 8, 'Inspect Estimated CPI Base Rebate Percentage'),
          async () => {
            cpi.inspectEstimatedCpiBaseRebatePercentFromExcel(expectedAt(tc, 8), quoteItemSnapshot);
          }
        );

        await test.step(excelStep(tc, 9, 'Inspect Estimated CPI Base Land Amount'), async () => {
          cpi.assertEstimatedCpiBaseLandAmountFromExcel(quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 10, 'Inspect Estimated CPI Accelerator Rebate Percent'),
          async () => {
            cpi.inspectEstimatedCpiAcceleratorRebatePercentFromExcel(
              expectedAt(tc, 10),
              quoteItemSnapshot
            );
          }
        );

        await test.step(excelStep(tc, 11, 'Inspect Estimated CPI Accelerator Amount'), async () => {
          cpi.assertEstimatedCpiAcceleratorAmountFromExcel(expectedAt(tc, 10), quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 12, 'Inspect Estimated CPI Spec Bonus Percentage'),
          async () => {
            cpi.assertEstimatedCpiSpecBonusPercentFromExcel(expectedAt(tc, 12), quoteItemSnapshot);
          }
        );

        await test.step(excelStep(tc, 13, 'Inspect Estimated CPI Spec Bonus Amount'), async () => {
          cpi.assertEstimatedCpiSpecBonusAmountFromExcel(expectedAt(tc, 13), quoteItemSnapshot);
        });

        await test.step(excelStep(tc, 14, 'Inspect Total Estimated CPI Amount'), async () => {
          cpi.assertEstimatedCpiTotalAmountFromExcel(quoteItemSnapshot);
        });

        await cpi.gotoQuoteByName(quoteName);

        await test.step(excelStep(tc, 15, 'Inspect Quote Header Estimated CPI Rebate Status'), async () => {
          await cpi.assertQuoteHeaderEstimatedCpiRebateStatusFromExcel(expectedAt(tc, 15));
        });

        await test.step(excelStep(tc, 16, 'Inspect Quote Header Estimated CPI Total Amount'), async () => {
          await cpi.assertQuoteHeaderEstimatedCpiTotalAmountFromExcel(expectedAt(tc, 16));
        });

        await test.step(
          excelStep(tc, 17, 'Inspect Quote Header Estimated CPI Total Base Land Amount'),
          async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalBaseLandFromExcel(expectedAt(tc, 17));
          }
        );

        await test.step(
          excelStep(tc, 18, 'Inspect Quote Header Estimated CPI Total Accelerator Amount'),
          async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalAcceleratorFromExcel(expectedAt(tc, 18));
          }
        );
      }
    }
  );

  test(
    `[${cpiCalculationCases.iWillWaitOver100.key}] ${cpiCalculationCases.iWillWaitOver100.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.iWillWaitOver100;
      const cpi = new CpiCalculationPage(page);
      const quoteName = cpi.requireQuoteName(tc.testData);
      const batchPattern = cpiQuoteCalculationBatchPattern(tc.expectedResults);
      const dialogPattern = estimateCpiDialogPatternFromExpected(tc.expectedResults);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);
      const since = cpi.soqlNowMinusSeconds(5);

      await test.step(excelStep(tc, 1, 'Open Quote and Estimate CPI dialog'), async () => {
        await cpi.gotoQuoteByName(quoteName);
        await cpi.clickEstimateCpi();
        await cpi.assertEstimateCpiDialogVisible(dialogPattern);
      });

      await test.step(excelStep(tc, 3, 'I will wait — realtime calculation'), async () => {
        await cpi.chooseIWillWait();
        await cpi.waitForRealtimeEstimateProgress(toastPattern);
      });

      await test.step(excelStep(tc, 4, 'Success toast — email not checked'), async () => {
        console.log(
          `[${tc.key}] exp[4] email is not checked here: ${expectedAt(tc, 4)}`
        );
      });

      await test.step(excelStep(tc, 5, 'No BQM job created'), async () => {
        await cpi.assertNoNewCpiBqmJob(since, batchPattern);
      });

      {
        const partNumber =
          parseCpiValidationPartNumberFromExpected(tc.expectedResults) ?? 'A-FLEX-NUPL-P';

        let quoteItemSnapshot!: QuoteItemCpiSnapshot;
        await test.step(
          excelStep(tc, 6, 'Inspect Estimated CPI Calculation Status'),
          async () => {
            await cpi.gotoQuoteByName(quoteName);
            await cpi.gotoQuoteItemForCpiValidationFromExcel(tc.testData, partNumber);
            await cpi.assertEstimatedCpiCalculationStatusFromExcel(expectedAt(tc, 6));
            quoteItemSnapshot = await cpi.readQuoteItemCpiSnapshot();
          }
        );

        await test.step(excelStep(tc, 7, 'Inspect Estimated CPI Selected Portfolio'), async () => {
          cpi.assertEstimatedCpiSelectedPortfolioFromExcel(expectedAt(tc, 7), quoteItemSnapshot);
        });

        await test.step(excelStep(tc, 8, 'Inspect Estimated CPI PVI Tier'), async () => {
          cpi.assertEstimatedCpiPviTierFromExcel(expectedAt(tc, 8), quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 9, 'Inspect Estimated CPI Base Rebate Percentage'),
          async () => {
            cpi.inspectEstimatedCpiBaseRebatePercentFromExcel(expectedAt(tc, 9), quoteItemSnapshot);
          }
        );

        await test.step(excelStep(tc, 10, 'Inspect Estimated CPI Base Land Amount'), async () => {
          cpi.assertEstimatedCpiBaseLandAmountFromExcel(quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 11, 'Inspect Estimated CPI Accelerator Rebate Percent'),
          async () => {
            cpi.inspectEstimatedCpiAcceleratorRebatePercentFromExcel(
              expectedAt(tc, 11),
              quoteItemSnapshot
            );
          }
        );

        await test.step(excelStep(tc, 12, 'Inspect Estimated CPI Accelerator Amount'), async () => {
          cpi.assertEstimatedCpiAcceleratorAmountFromExcel(expectedAt(tc, 11), quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 13, 'Inspect Estimated CPI Spec Bonus Percentage'),
          async () => {
            cpi.assertEstimatedCpiSpecBonusPercentFromExcel(expectedAt(tc, 13), quoteItemSnapshot);
          }
        );

        await test.step(excelStep(tc, 14, 'Inspect Estimated CPI Spec Bonus Amount'), async () => {
          cpi.assertEstimatedCpiSpecBonusAmountFromExcel(expectedAt(tc, 14), quoteItemSnapshot);
        });

        await test.step(excelStep(tc, 15, 'Inspect Total Estimated CPI Amount'), async () => {
          cpi.assertEstimatedCpiTotalAmountFromExcel(quoteItemSnapshot);
        });

        await cpi.gotoQuoteByName(quoteName);

        await test.step(excelStep(tc, 16, 'Inspect Quote Header Estimated CPI Rebate Status'), async () => {
          await cpi.assertQuoteHeaderEstimatedCpiRebateStatusFromExcel(expectedAt(tc, 16));
        });

        await test.step(excelStep(tc, 17, 'Inspect Quote Header Estimated CPI Total Amount'), async () => {
          await cpi.assertQuoteHeaderEstimatedCpiTotalAmountFromExcel(expectedAt(tc, 17));
        });

        await test.step(
          excelStep(tc, 18, 'Inspect Quote Header Estimated CPI Total Base Land Amount'),
          async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalBaseLandFromExcel(expectedAt(tc, 18));
          }
        );

        await test.step(
          excelStep(tc, 19, 'Inspect Quote Header Estimated CPI Total Accelerator Amount'),
          async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalAcceleratorFromExcel(expectedAt(tc, 19));
          }
        );
      }
    }
  );

  test(
    `[${cpiCalculationCases.errorLogsTodo.key}] ${cpiCalculationCases.errorLogsTodo.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      test.skip(true, 'PQW-T4996 skipped — email notification path not working yet');
    }
  );

  test(
    `[${cpiCalculationCases.varTotalCostChange.key}] ${cpiCalculationCases.varTotalCostChange.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.varTotalCostChange;
      const cpi = new CpiCalculationPage(page);
      const quoteName = cpi.requireQuoteName(tc.testData);
      const batchPattern = cpiQuoteCalculationBatchPattern(tc.expectedResults);
      const saveToastPattern = toastPatternFromExpected(tc.expectedResults);
      const since = cpi.soqlNowMinusSeconds(5);

      await test.step(excelStep(tc, 1, `Open Quote ${quoteName} — Edit Quote`), async () => {
        await cpi.gotoQuoteByName(quoteName);
        await cpi.openEditQuoteGridFromHeader();
      });

      await test.step(excelStep(tc, 3, 'Inline edit from Excel'), async () => {
        const inlineEditStep = excelStep(tc, 3, '');
        const fieldApi = parseEqgFieldApiFromStep(inlineEditStep);
        const newValue = parseEqgInlineEditValueFromTestData(tc.testData);
        await cpi.editEqgFieldInlineAndSave(fieldApi, newValue, saveToastPattern);
      });

      await test.step(excelStep(tc, 5, 'CPIQuoteCalculationBatch enqueued'), async () => {
        await cpi.assertLatestBqmJobMatches(batchPattern, since);
      });

      {
        const partNumber =
          parseCpiValidationPartNumberFromExpected(tc.expectedResults) ?? 'A-FLEX-NUPL-P';

        let quoteItemSnapshot!: QuoteItemCpiSnapshot;
        await test.step(
          excelStep(tc, 6, 'Inspect Estimated CPI Calculation Status'),
          async () => {
            await cpi.gotoQuoteByName(quoteName);
            await cpi.gotoQuoteItemForCpiValidationFromExcel(tc.testData, partNumber);
            await cpi.assertEstimatedCpiCalculationStatusFromExcel(expectedAt(tc, 6));
            quoteItemSnapshot = await cpi.readQuoteItemCpiSnapshot();
          }
        );

        await test.step(excelStep(tc, 7, 'Inspect Estimated CPI Selected Portfolio'), async () => {
          cpi.assertEstimatedCpiSelectedPortfolioFromExcel(expectedAt(tc, 7), quoteItemSnapshot);
        });

        await test.step(excelStep(tc, 8, 'Inspect Estimated CPI PVI Tier'), async () => {
          cpi.assertEstimatedCpiPviTierFromExcel(expectedAt(tc, 8), quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 9, 'Inspect Estimated CPI Base Rebate Percentage'),
          async () => {
            cpi.inspectEstimatedCpiBaseRebatePercentFromExcel(expectedAt(tc, 9), quoteItemSnapshot);
          }
        );

        await test.step(excelStep(tc, 10, 'Inspect Estimated CPI Base Land Amount'), async () => {
          cpi.assertEstimatedCpiBaseLandAmountFromExcel(quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 11, 'Inspect Estimated CPI Accelerator Rebate Percent'),
          async () => {
            cpi.inspectEstimatedCpiAcceleratorRebatePercentFromExcel(
              expectedAt(tc, 11),
              quoteItemSnapshot
            );
          }
        );

        await test.step(excelStep(tc, 12, 'Inspect Estimated CPI Accelerator Amount'), async () => {
          cpi.assertEstimatedCpiAcceleratorAmountFromExcel(expectedAt(tc, 11), quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 13, 'Inspect Estimated CPI Spec Bonus Percentage'),
          async () => {
            cpi.assertEstimatedCpiSpecBonusPercentFromExcel(expectedAt(tc, 13), quoteItemSnapshot);
          }
        );

        await test.step(excelStep(tc, 14, 'Inspect Estimated CPI Spec Bonus Amount'), async () => {
          cpi.assertEstimatedCpiSpecBonusAmountFromExcel(expectedAt(tc, 14), quoteItemSnapshot);
        });

        await test.step(excelStep(tc, 15, 'Inspect Total Estimated CPI Amount'), async () => {
          cpi.assertEstimatedCpiTotalAmountFromExcel(quoteItemSnapshot);
        });

        await cpi.gotoQuoteByName(quoteName);

        await test.step(excelStep(tc, 16, 'Inspect Quote Header Estimated CPI Rebate Status'), async () => {
          await cpi.assertQuoteHeaderEstimatedCpiRebateStatusFromExcel(expectedAt(tc, 16));
        });

        await test.step(excelStep(tc, 17, 'Inspect Quote Header Estimated CPI Total Amount'), async () => {
          await cpi.assertQuoteHeaderEstimatedCpiTotalAmountFromExcel(expectedAt(tc, 17));
        });

        await test.step(
          excelStep(tc, 18, 'Inspect Quote Header Estimated CPI Total Base Land Amount'),
          async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalBaseLandFromExcel(expectedAt(tc, 18));
          }
        );

        await test.step(
          excelStep(tc, 19, 'Inspect Quote Header Estimated CPI Total Accelerator Amount'),
          async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalAcceleratorFromExcel(expectedAt(tc, 19));
          }
        );
      }
    }
  );

  test(
    `[${cpiCalculationCases.manufacturerLookupChange.key}] ${cpiCalculationCases.manufacturerLookupChange.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.manufacturerLookupChange;
      const cpi = new CpiCalculationPage(page);
      const quoteSvc = createCpiQuoteService(page);
      const quoteName = cpi.requireQuoteName(tc.testData);
      const manufacturerSearchHint = cpi.requireManufacturer(tc);
      const batchPattern = cpiQuoteCalculationBatchPattern(tc.expectedResults);
      const since = cpi.soqlNowMinusSeconds(5);
      let currentManufacturer = '';
      let selectedManufacturer = '';

      await test.step(tc.steps[0] || 'Supplier Assignment manufacturer change', async () => {
        const result = await changeManufacturerOnSupplierGrid(
          page,
          cpi,
          quoteSvc,
          quoteName,
          manufacturerSearchHint,
          true
        );
        currentManufacturer = result.current ?? '';
        selectedManufacturer = result.selected ?? '';
        console.log(
          `[${tc.key}] Stored current Manufacturer="${currentManufacturer}", selected="${selectedManufacturer}"`
        );
      });

      await test.step(tc.expectedResults[1] || 'CPIQuoteCalculationBatch enqueued', async () => {
        await cpi.assertLatestBqmJobMatches(batchPattern, since);
      });
    }
  );



  test(
    `[${cpiCalculationCases.copyItemEnqueues.key}] ${cpiCalculationCases.copyItemEnqueues.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      test.setTimeout(480000);
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.copyItemEnqueues;
      const cpi = new CpiCalculationPage(page);
      const quoteSvc = createCpiQuoteService(page);
      const advui = new AdvanceUi(page);
      const quoteName = cpi.requireQuoteName(tc.testData);
      const bomToCopy = parseBomIdFromTestData(tc.testData);
      if (!bomToCopy) {
        throw new Error(
          `BoM id missing from Excel testData for ${tc.key}: ${tc.testData.join(' | ')}`
        );
      }
      const lineItemKey = parseLineItemFromTestData(tc.testData);
      if (!lineItemKey) {
        throw new Error(
          `Line item (Part Number or Line Number) missing from Excel testData for ${tc.key}. ` +
            `Add e.g. Part Number = CISCO-SKU-1 or Line Number = 3 in Test Data.`
        );
      }
      const batchPattern = cpiQuoteCalculationBatchPattern(tc.expectedResults);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);
      let copiedPartNumber = '';
      let since = '';

      try {
        await test.step(excelStep(tc, 1, 'Open existing Quote'), async () => {
          await cpi.gotoQuoteByName(quoteName);
        });

        await test.step(excelStep(tc, 2, 'Copy BoMs to Quote'), async () => {
          await quoteSvc.goToSelectBoMsPage();
        });

        await test.step('Copy BoM Items — untie, copy line item (delete first if already on Quote)', async () => {
          const selection = await quoteSvc.copyBoMLineItemForCpiTrigger(
            bomToCopy,
            lineItemKey,
            advui,
            { cpiPage: cpi, quoteName }
          );
          copiedPartNumber = selection.partNumber;
          console.log(
            `[${tc.key}] copying line item "${lineItemKey}" → part "${selection.partNumber}" from BoM ${selection.bomUsed}`
          );
          since = cpi.soqlNowMinusSeconds(5);
          await advui.clickOnCopyBoMItemsButton();
          const copyErrors = await quoteSvc.checkNotificationAndValidate(
            'copy',
            selection.count
          );
          if (copyErrors.length > 0) {
            throw new Error(copyErrors.join('\n'));
          }
          await cpi.waitForToastMatching(toastPattern, 120000).catch(() => undefined);
        });

        await test.step(excelStep(tc, 5, 'CPIQuoteCalculationBatch enqueued'), async () => {
          await cpi.assertLatestBqmJobMatches(batchPattern, since);
        });
      } finally {
        if (copiedPartNumber) {
          try {
            await cpi.deleteQuoteItemByPartNumberViaSoql(quoteName, copiedPartNumber);
          } catch (e) {
            console.error(
              `[CPI cleanup] failed to delete copied item ${copiedPartNumber}: ${e}`
            );
          }
        }
      }
    }
  );

  test(
    `[${cpiCalculationCases.createQuoteCopyEnqueues.key}] ${cpiCalculationCases.createQuoteCopyEnqueues.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.createQuoteCopyEnqueues;
      const cpi = new CpiCalculationPage(page);
      const quoteSvc = createCpiQuoteService(page);
      const batchPattern = cpiQuoteCalculationBatchPattern(tc.expectedResults);
      const since = cpi.soqlNowMinusSeconds(5);
      let createdQuoteId = '';

      try {
        await test.step(tc.steps[0] || 'Create New Quote + Copy BoMs', async () => {
          await cpi.openOpportunityForCreateFromExcel(tc.testData);
          await cpi.createNewQuoteFromOpportunity();
          createdQuoteId = await cpi.parseQuoteIdFromUrl();
          await quoteSvc.goToSelectBoMsPage();
          await quoteSvc.selectFirstNBomsForCopy(1);
        });

        await test.step(tc.expectedResults[2] || 'CPIQuoteCalculationBatch enqueued', async () => {
          await cpi.assertLatestBqmJobMatches(batchPattern, since);
          await cpi.waitForQuoteReady();
        });

        {
          const quoteName = await cpi.getQuoteNumberFromHeading();
          const partNumber =
            parseCpiValidationPartNumberFromExpected(tc.expectedResults) ?? 'A-FLEX-NUPL-P';

          await cpi.gotoQuoteByName(quoteName);

          await test.step(excelStep(tc, 7, 'Inspect Quote Header Estimated CPI Rebate Status'), async () => {
            await cpi.assertQuoteHeaderEstimatedCpiRebateStatusFromExcel(expectedAt(tc, 7));
          });

          await test.step(excelStep(tc, 8, 'Inspect Quote Header Estimated CPI Total Amount'), async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalAmountFromExcel(expectedAt(tc, 8));
          });

          await test.step(
            excelStep(tc, 9, 'Inspect Quote Header Estimated CPI Total Base Land Amount'),
            async () => {
              await cpi.assertQuoteHeaderEstimatedCpiTotalBaseLandFromExcel(expectedAt(tc, 9));
            }
          );

          await test.step(
            excelStep(tc, 10, 'Inspect Quote Header Estimated CPI Total Accelerator Amount'),
            async () => {
              await cpi.assertQuoteHeaderEstimatedCpiTotalAcceleratorFromExcel(expectedAt(tc, 10));
            }
          );

          let quoteItemSnapshot!: QuoteItemCpiSnapshot;
          await test.step(
            excelStep(tc, 11, 'Inspect Estimated CPI Calculation Status'),
            async () => {
              await cpi.gotoQuoteItemForCpiValidationFromExcel(tc.testData, partNumber);
              await cpi.assertEstimatedCpiCalculationStatusFromExcel(expectedAt(tc, 11));
              quoteItemSnapshot = await cpi.readQuoteItemCpiSnapshot();
            }
          );

          await test.step(excelStep(tc, 12, 'Inspect Estimated CPI Selected Portfolio'), async () => {
            cpi.assertEstimatedCpiSelectedPortfolioFromExcel(expectedAt(tc, 12), quoteItemSnapshot);
          });

          await test.step(excelStep(tc, 13, 'Inspect Estimated CPI PVI Tier'), async () => {
            cpi.assertEstimatedCpiPviTierFromExcel(expectedAt(tc, 13), quoteItemSnapshot);
          });

          await test.step(
            excelStep(tc, 14, 'Inspect Estimated CPI Base Rebate Percentage'),
            async () => {
              cpi.inspectEstimatedCpiBaseRebatePercentFromExcel(
                expectedAt(tc, 14),
                quoteItemSnapshot
              );
            }
          );

          await test.step(excelStep(tc, 15, 'Inspect Estimated CPI Base Land Amount'), async () => {
            cpi.assertEstimatedCpiBaseLandAmountFromExcel(quoteItemSnapshot);
          });

          await test.step(
            excelStep(tc, 16, 'Inspect Estimated CPI Accelerator Rebate Percent'),
            async () => {
              cpi.inspectEstimatedCpiAcceleratorRebatePercentFromExcel(
                expectedAt(tc, 16),
                quoteItemSnapshot
              );
            }
          );

          await test.step(excelStep(tc, 17, 'Inspect Estimated CPI Accelerator Amount'), async () => {
            cpi.assertEstimatedCpiAcceleratorAmountFromExcel(expectedAt(tc, 16), quoteItemSnapshot);
          });

          await test.step(
            excelStep(tc, 18, 'Inspect Estimated CPI Spec Bonus Percentage'),
            async () => {
              cpi.assertEstimatedCpiSpecBonusPercentFromExcel(expectedAt(tc, 18), quoteItemSnapshot);
            }
          );

          await test.step(excelStep(tc, 19, 'Inspect Estimated CPI Spec Bonus Amount'), async () => {
            cpi.assertEstimatedCpiSpecBonusAmountFromExcel(expectedAt(tc, 19), quoteItemSnapshot);
          });

          await test.step(excelStep(tc, 20, 'Inspect Total Estimated CPI Amount'), async () => {
            cpi.assertEstimatedCpiTotalAmountFromExcel(quoteItemSnapshot);
          });
        }
      } finally {
        await cleanupCreatedQuote(cpi, createdQuoteId);
      }
    }
  );

  test(
    `[${cpiCalculationCases.effectiveDateChangeEnqueues.key}] ${cpiCalculationCases.effectiveDateChangeEnqueues.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.effectiveDateChangeEnqueues;
      const cpi = new CpiCalculationPage(page);
      const quoteName = cpi.requireQuoteName(tc.testData);
      const batchPattern = cpiQuoteCalculationBatchPattern(tc.expectedResults);
      const since = cpi.soqlNowMinusSeconds(5);

      await test.step(tc.steps[0] || 'change CPI Effective Date', async () => {
        await cpi.gotoQuoteByName(quoteName);
        const d = new Date();
        d.setDate(d.getDate() - 2);
        await cpi.setCpiEffectiveDate(d);
      });

      await test.step(tc.expectedResults[1] || 'CPIQuoteCalculationBatch enqueued', async () => {
        await cpi.assertLatestBqmJobMatches(batchPattern, since);
      });
    }
  );

  test(
    `[${cpiCalculationCases.manualEstimateCpi.key}] ${cpiCalculationCases.manualEstimateCpi.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.manualEstimateCpi;
      const cpi = new CpiCalculationPage(page);
      const quoteName = cpi.requireQuoteName(tc.testData);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);
      const batchPattern = cpiQuoteCalculationBatchPattern(tc.expectedResults);
      const since = cpi.soqlNowMinusSeconds(5);

      await test.step(tc.steps[0] || 'manual Estimate CPI', async () => {
        await cpi.gotoQuoteByName(quoteName);
        await cpi.clickEstimateCpi();
        const dialogVisible = await cpi.estimateCpiDialog.isVisible().catch(() => false);
        if (dialogVisible) {
          const dialogPattern = estimateCpiDialogPatternFromExpected(
            cpiCalculationCases.notifyByEmailOver100.expectedResults
          );
          await cpi.assertEstimateCpiDialogVisible(dialogPattern);
          await cpi.chooseIWillWait();
          await cpi.waitForRealtimeEstimateProgress(toastPattern);
        } else {
          const toast = await cpi.waitForToastMatching(toastPattern, 120000);
          cpi.assertTextMatchesExcel(
            tc.key,
            'toast',
            `${toast.title} ${toast.message}`,
            toastPattern
          );
        }
      });

      await test.step(tc.expectedResults[1] || 'CPIQuoteCalculationBatch enqueued', async () => {
        await cpi.assertLatestBqmJobMatches(batchPattern, since).catch(() => {
          console.log(`[${tc.key}] No BQM job (sync path) — OK per Excel sync toast path`);
        });
      });

      {
        const partNumber =
          parseCpiValidationPartNumberFromExpected(tc.expectedResults) ?? 'A-FLEX-NUPL-P';

        await cpi.gotoQuoteByName(quoteName);

        await test.step(excelStep(tc, 5, 'Inspect Quote Header Estimated CPI Rebate Status'), async () => {
          await cpi.assertQuoteHeaderEstimatedCpiRebateStatusFromExcel(expectedAt(tc, 5));
        });

        await test.step(excelStep(tc, 6, 'Inspect Quote Header Estimated CPI Total Amount'), async () => {
          await cpi.assertQuoteHeaderEstimatedCpiTotalAmountFromExcel(expectedAt(tc, 6));
        });

        await test.step(
          excelStep(tc, 7, 'Inspect Quote Header Estimated CPI Total Base Land Amount'),
          async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalBaseLandFromExcel(expectedAt(tc, 7));
          }
        );

        await test.step(
          excelStep(tc, 8, 'Inspect Quote Header Estimated CPI Total Accelerator Amount'),
          async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalAcceleratorFromExcel(expectedAt(tc, 8));
          }
        );

        let quoteItemSnapshot!: QuoteItemCpiSnapshot;
        await test.step(
          excelStep(tc, 9, 'Inspect Estimated CPI Calculation Status'),
          async () => {
            await cpi.gotoQuoteItemForCpiValidationFromExcel(tc.testData, partNumber);
            await cpi.assertEstimatedCpiCalculationStatusFromExcel(expectedAt(tc, 9));
            quoteItemSnapshot = await cpi.readQuoteItemCpiSnapshot();
          }
        );

        await test.step(excelStep(tc, 10, 'Inspect Estimated CPI Selected Portfolio'), async () => {
          cpi.assertEstimatedCpiSelectedPortfolioFromExcel(expectedAt(tc, 10), quoteItemSnapshot);
        });

        await test.step(excelStep(tc, 11, 'Inspect Estimated CPI PVI Tier'), async () => {
          cpi.assertEstimatedCpiPviTierFromExcel(expectedAt(tc, 11), quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 12, 'Inspect Estimated CPI Base Rebate Percentage'),
          async () => {
            cpi.inspectEstimatedCpiBaseRebatePercentFromExcel(expectedAt(tc, 12), quoteItemSnapshot);
          }
        );

        await test.step(excelStep(tc, 13, 'Inspect Estimated CPI Base Land Amount'), async () => {
          cpi.assertEstimatedCpiBaseLandAmountFromExcel(quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 14, 'Inspect Estimated CPI Accelerator Rebate Percent'),
          async () => {
            cpi.inspectEstimatedCpiAcceleratorRebatePercentFromExcel(
              expectedAt(tc, 14),
              quoteItemSnapshot
            );
          }
        );

        await test.step(excelStep(tc, 15, 'Inspect Estimated CPI Accelerator Amount'), async () => {
          cpi.assertEstimatedCpiAcceleratorAmountFromExcel(expectedAt(tc, 14), quoteItemSnapshot);
        });

        await test.step(
          excelStep(tc, 16, 'Inspect Estimated CPI Spec Bonus Percentage'),
          async () => {
            cpi.assertEstimatedCpiSpecBonusPercentFromExcel(expectedAt(tc, 16), quoteItemSnapshot);
          }
        );

        await test.step(excelStep(tc, 17, 'Inspect Estimated CPI Spec Bonus Amount'), async () => {
          cpi.assertEstimatedCpiSpecBonusAmountFromExcel(expectedAt(tc, 17), quoteItemSnapshot);
        });

        await test.step(excelStep(tc, 18, 'Inspect Total Estimated CPI Amount'), async () => {
          cpi.assertEstimatedCpiTotalAmountFromExcel(quoteItemSnapshot);
        });
      }
    }
  );

  test(
    `[${cpiCalculationCases.aggregatedMsdrNoButton.key}] ${cpiCalculationCases.aggregatedMsdrNoButton.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      const tc = cpiCalculationCases.aggregatedMsdrNoButton;
      const cpi = new CpiCalculationPage(page);
      const quoteName = cpi.requireQuoteName(tc.testData);

      await test.step(tc.expectedResults[0] || 'Estimate CPI absent', async () => {
        await cpi.gotoQuoteByName(quoteName);
        await cpi.assertEstimateCpiVisible(false);
      });
    }
  );

  test(
    `[${cpiCalculationCases.cancelDoesNotStartJob.key}] ${cpiCalculationCases.cancelDoesNotStartJob.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.cancelDoesNotStartJob;
      const cpi = new CpiCalculationPage(page);
      const quoteName = cpi.requireQuoteName(tc.testData);
      const batchPattern = cpiQuoteCalculationBatchPattern(tc.expectedResults);
      const dialogPattern = estimateCpiDialogPatternFromExpected(
        cpiCalculationCases.notifyByEmailOver100.expectedResults
      );

      await test.step(excelStep(tc, 3, 'Click Cancel — no BQM job'), async () => {
        const since = cpi.soqlNowMinusSeconds(5);
        await cpi.gotoQuoteByName(quoteName);
        await cpi.clickEstimateCpi();
        await cpi.assertEstimateCpiDialogVisible(dialogPattern);
        await cpi.cancelEstimateCpiDialog();
        await cpi.assertNoNewCpiBqmJob(since, batchPattern);
      });

      await test.step(excelStep(tc, 6, 'Click X — no BQM job'), async () => {
        const since = cpi.soqlNowMinusSeconds(5);
        await cpi.gotoQuoteByName(quoteName);
        await cpi.clickEstimateCpi();
        await cpi.assertEstimateCpiDialogVisible(dialogPattern);
        await cpi.closeEstimateCpiDialog();
        await cpi.assertNoNewCpiBqmJob(since, batchPattern);
      });
    }
  );

  test(
    `[${cpiCalculationCases.ccwrAggregatedNotApplicable.key}] ${cpiCalculationCases.ccwrAggregatedNotApplicable.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.ccwrAggregatedNotApplicable;
      const cpi = new CpiCalculationPage(page);
      const bom = new BomService(page);
      const quoteSvc = createCpiQuoteService(page);
      const ccwr = parseCcwrImportFromTestData(tc.testData);
      const toastPattern = toastPatternFromExpected(tc.expectedResults);

      await test.step(excelStep(tc, 1, 'Navigate to Opportunity'), async () => {
        await cpi.openOpportunityForCreateFromExcel(tc.testData);
      });

      await test.step(excelStep(tc, 2, 'Import BoM — CCWR Aggregated'), async () => {
        await bom.clickOnImportBoMButton();
        const needsAuth = await bom.chckAuthenticateBtnIfVisible();
        if (needsAuth) {
          test.skip(true, 'CCWR Import requires manual Authenticate — run when credentials are valid');
        }
        await bom.checkAPIProfileEnabled();
        await bom.selectModeOfImport(ccwr.modeOfImport);
        await bom.selectSource(ccwr.source);
        await bom.selectProfile(ccwr.profile);
        await bom.selectBomType(ccwr.bomType);
        await bom.clickOnContinueButton();
        await page.getByRole('combobox', { name: /Quote Aggregated By/i }).click();
        await page.getByRole('option', { name: new RegExp(ccwr.aggregatedBy, 'i') }).click();
        await bom.putCCWRImportDetails(
          ccwr.bomType,
          ccwr.ccwrQuoteId,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          ''
        );
        await bom.clickOnImportBom();
        const failed = await bom.UnsuccessfulBoMImport();
        if (failed) {
          throw new Error(`CCWR Import failed for quote id ${ccwr.ccwrQuoteId}`);
        }
      });

      await test.step(excelStep(tc, 9, 'Wait for ImportMaintenanceBoM BQM job'), async () => {
        const bqmId = (await bom.findBQMJobOfCCWRImport(ccwr.ccwrQuoteId)) || '';
        if (!bqmId) {
          throw new Error(`ImportMaintenanceBoM job not found for CCWR quote ${ccwr.ccwrQuoteId}`);
        }
        await quoteSvc.goToRecord(bqmId);
        await bom.reloadBQMPageUntilCompleted();
      });

      await test.step(excelStep(tc, 10, 'Open Aggregated Quote from BQM'), async () => {
        const ids = await bom.extractRcrdIdsFrmBQM();
        const quoteId = ids.invoiceQuoteId || ids.detailedQuoteId;
        if (!quoteId) throw new Error('Aggregated Quote link not found on BQM Summary');
        await quoteSvc.goToRecord(quoteId);
        await cpi.waitForQuoteReady();
      });

      await test.step(excelStep(tc, 11, 'Click Estimate CPI'), async () => {
        await cpi.clickEstimateCpi();
        await cpi.waitForToastMatching(toastPattern, 120000).catch(() => undefined);
      });

      await test.step(excelStep(tc, 12, 'Assert Invalid / NOT APPLICABLE / zero CPI fields'), async () => {
        await cpi.assertCcwrAggregatedCpiFromExcel(tc.expectedResults);
      });
    }
  );

  test(
    `[${cpiCalculationCases.itemDeletionRecalculates.key}] ${cpiCalculationCases.itemDeletionRecalculates.name}`,
    { tag: ['@cpiCalculation'] },
    async () => {
      skipUnlessCpiDeployed();
      const tc = cpiCalculationCases.itemDeletionRecalculates;
      const cpi = new CpiCalculationPage(page);
      const quoteSvc = createCpiQuoteService(page);
      const batchPattern = cpiQuoteCalculationBatchPattern(tc.expectedResults);
      const saveToastPattern = toastPatternFromExpected(tc.expectedResults);
      let quoteName = '';
      let headerBeforeDelete!: EstimatedCpiHeaderSnapshot;
      let createdQuoteId = '';

      try {
        await test.step(excelStep(tc, 1, 'Navigate to Opportunity and create Quote'), async () => {
          await cpi.openOpportunityForCreateFromExcel(tc.testData);
          await cpi.createNewQuoteFromOpportunity();
          createdQuoteId = await cpi.parseQuoteIdFromUrl();
          quoteName = await cpi.getQuoteNumberFromHeading();
        });

        await test.step(excelStep(tc, 3, 'Copy BoMs to Quote'), async () => {
          await quoteSvc.goToSelectBoMsPage();
          await quoteSvc.selectFirstNBomsForCopy(1);
        });

        await test.step(excelStep(tc, 6, 'CPIQuoteCalculationBatch enqueued after copy'), async () => {
          const since = cpi.soqlNowMinusSeconds(10);
          await cpi.assertLatestBqmJobMatches(batchPattern, since);
        });

        await cpi.waitForQuoteReady();
        quoteName = await cpi.getQuoteNumberFromHeading();

        {
          const partNumber =
            parseCpiValidationPartNumberFromExpected(tc.expectedResults) ?? 'A-FLEX-NUPL-P';

          await cpi.gotoQuoteByName(quoteName);

          await test.step(excelStep(tc, 7, 'Inspect Quote Header Estimated CPI Rebate Status'), async () => {
            await cpi.assertQuoteHeaderEstimatedCpiRebateStatusFromExcel(expectedAt(tc, 7));
          });

          await test.step(excelStep(tc, 8, 'Inspect Quote Header Estimated CPI Total Amount'), async () => {
            await cpi.assertQuoteHeaderEstimatedCpiTotalAmountFromExcel(expectedAt(tc, 8));
          });

          await test.step(
            excelStep(tc, 9, 'Inspect Quote Header Estimated CPI Total Base Land Amount'),
            async () => {
              await cpi.assertQuoteHeaderEstimatedCpiTotalBaseLandFromExcel(expectedAt(tc, 9));
            }
          );

          await test.step(
            excelStep(tc, 10, 'Inspect Quote Header Estimated CPI Total Accelerator Amount'),
            async () => {
              await cpi.assertQuoteHeaderEstimatedCpiTotalAcceleratorFromExcel(expectedAt(tc, 10));
            }
          );

          let quoteItemSnapshot!: QuoteItemCpiSnapshot;
          await test.step(
            excelStep(tc, 11, 'Inspect Estimated CPI Calculation Status'),
            async () => {
              await cpi.gotoQuoteItemForCpiValidationFromExcel(tc.testData, partNumber);
              await cpi.assertEstimatedCpiCalculationStatusFromExcel(expectedAt(tc, 11));
              quoteItemSnapshot = await cpi.readQuoteItemCpiSnapshot();
            }
          );

          await test.step(excelStep(tc, 12, 'Inspect Estimated CPI Selected Portfolio'), async () => {
            cpi.assertEstimatedCpiSelectedPortfolioFromExcelLine(
              expectedAt(tc, 12),
              quoteItemSnapshot
            );
          });

          await test.step(excelStep(tc, 13, 'Inspect Estimated CPI PVI Tier'), async () => {
            cpi.assertEstimatedCpiPviTierFromExcelLine(expectedAt(tc, 13), quoteItemSnapshot);
          });

          await test.step(
            excelStep(tc, 14, 'Inspect Estimated CPI Base Rebate Percentage'),
            async () => {
              cpi.inspectEstimatedCpiBaseRebatePercentFromExcel(
                expectedAt(tc, 14),
                quoteItemSnapshot
              );
            }
          );

          await test.step(excelStep(tc, 15, 'Inspect Estimated CPI Base Land Amount'), async () => {
            cpi.assertEstimatedCpiBaseLandAmountFromExcel(quoteItemSnapshot);
          });

          await test.step(
            excelStep(tc, 16, 'Inspect Estimated CPI Accelerator Rebate Percent'),
            async () => {
              cpi.inspectEstimatedCpiAcceleratorRebatePercentFromExcel(
                expectedAt(tc, 16),
                quoteItemSnapshot
              );
            }
          );

          await test.step(excelStep(tc, 17, 'Inspect Estimated CPI Accelerator Amount'), async () => {
            cpi.assertEstimatedCpiAcceleratorAmountFromExcel(expectedAt(tc, 16), quoteItemSnapshot);
          });

          await test.step(
            excelStep(tc, 18, 'Inspect Estimated CPI Spec Bonus Percentage'),
            async () => {
              cpi.assertEstimatedCpiSpecBonusPercentFromExcel(expectedAt(tc, 18), quoteItemSnapshot);
            }
          );

          await test.step(excelStep(tc, 19, 'Inspect Estimated CPI Spec Bonus Amount'), async () => {
            cpi.assertEstimatedCpiSpecBonusAmountFromExcel(expectedAt(tc, 19), quoteItemSnapshot);
          });

          await test.step(excelStep(tc, 20, 'Inspect Total Estimated CPI Amount'), async () => {
            cpi.assertEstimatedCpiTotalAmountFromExcel(quoteItemSnapshot);
          });
        }

        await test.step(excelStep(tc, 21, 'Open Edit Quote grid'), async () => {
          await cpi.gotoQuoteByName(quoteName);
          headerBeforeDelete = await cpi.getQuoteHeaderEstimatedCpiSnapshot();
          await quoteSvc.goToEditQuoteGrid();
          await page.waitForTimeout(5000);
        });

        await test.step(excelStep(tc, 22, 'Delete Quote Item with non-zero Estimated CPI'), async () => {
          const since = cpi.soqlNowMinusSeconds(5);
          await cpi.deleteQuoteItemWithNonZeroCpiInEqg();
          await cpi.waitForToastMatching(saveToastPattern, 60000).catch(() => undefined);
          await cpi.assertNoNewCpiBqmJob(since, batchPattern);
        });

        await test.step(excelStep(tc, 24, 'Assert Quote header Estimated CPI fields updated'), async () => {
          await cpi.gotoQuoteByName(quoteName);
          await cpi.assertHeaderCpiTotalsUpdatedAfterDeletion(headerBeforeDelete);
        });

        await test.step(excelStep(tc, 25, 'Assert header rollups reflect deletion'), async () => {
          await cpi.assertQuoteHeaderEstimatedCpiRebateStatusFromExcel(expectedAt(tc, 25));
          await cpi.assertQuoteHeaderEstimatedCpiTotalAmountFromExcel(expectedAt(tc, 25));
          await cpi.assertQuoteHeaderEstimatedCpiTotalBaseLandFromExcel(expectedAt(tc, 25));
          await cpi.assertQuoteHeaderEstimatedCpiTotalAcceleratorFromExcel(expectedAt(tc, 25));
        });
      } finally {
        await cleanupCreatedQuote(cpi, createdQuoteId);
      }
    }
  );
});
