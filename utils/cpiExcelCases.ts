/**
 * CPI Search + Configuration Excel bindings and named case maps.
 * Shared Zephyr loaders/parsers: excelTestCaseData / excelTestDataParsers.
 */
import {
  CPI_CALCULATION_TRIGGER_TEST_DATA,
  CPI_CONFIGURATION_TEST_DATA,
  CPI_RECALCULATION_TEST_DATA,
  CPI_SEARCH_TEST_DATA,
} from '../assets/test_data_constants';
import {
  ExcelTestCaseData,
  getExcelTestCases,
  requireExcelTestCase,
  requireExcelTestCaseByName,
} from './excelTestCaseData';
import { parseLineItemFromTestData } from './excelTestDataParsers';
import { getRequiredEnv } from './envConfig';

/** PQW-T5003: BoM line to copy on Copy BoM Items (also set in Excel Test Data when sheet is editable). */
function withCopyItemLineItem(tc: ExcelTestCaseData): ExcelTestCaseData {
  if (parseLineItemFromTestData(tc.testData)) return tc;
  return { ...tc, testData: [...tc.testData, 'Part Number = ASR-9902'] };
}

export type CpiExcelCaseData = ExcelTestCaseData;

/** Workbook paths from assets/test_data_constants; sheet tab names from .env (same as other suites). */
export function cpiSearchSheetName(): string {
  return getRequiredEnv('CPI_SEARCH_SHEET_NAME');
}

export function cpiConfigurationSheetName(): string {
  return getRequiredEnv('CPI_CONFIGURATION_SHEET_NAME');
}

export function cpiCalculationSheetName(): string {
  return getRequiredEnv('CPI_CALCULATION_SHEET_NAME');
}

export function cpiRecalculationSheetName(): string {
  return getRequiredEnv('CPI_RECALCULATION_SHEET_NAME');
}

export function getCpiSearchCases(
  filePath: string = CPI_SEARCH_TEST_DATA,
  sheetName: string = cpiSearchSheetName()
): Record<string, CpiExcelCaseData> {
  return getExcelTestCases(filePath, sheetName);
}

export function getCpiConfigurationCases(
  filePath: string = CPI_CONFIGURATION_TEST_DATA,
  sheetName: string = cpiConfigurationSheetName()
): Record<string, CpiExcelCaseData> {
  return getExcelTestCases(filePath, sheetName);
}

export function requireCpiCase(key: string): CpiExcelCaseData {
  return requireExcelTestCase(CPI_SEARCH_TEST_DATA, key, cpiSearchSheetName());
}

export function requireCpiCaseByName(name: string): CpiExcelCaseData {
  return requireExcelTestCaseByName(CPI_SEARCH_TEST_DATA, name, cpiSearchSheetName());
}

export function requireCpiConfigCase(key: string): CpiExcelCaseData {
  return requireExcelTestCase(CPI_CONFIGURATION_TEST_DATA, key, cpiConfigurationSheetName());
}

/**
 * Named Excel cases for CPI Search specs.
 * Zephyr Key / Name / testData / expectedResults always come from the sheet.
 * Getters load Search Excel only when a Search case is accessed (not on import).
 */
export const cpiCases = {
  get pageLoad() {
    return requireCpiCaseByName(
      'Check that CPI search Page loads all the Filters as well as Column Headers as Required'
    );
  },
  get equals() {
    return requireCpiCaseByName("Check SKU search with 'Equals' returns exact match only");
  },
  get contains() {
    return requireCpiCaseByName("Check SKU search with 'Contains' returns all partial matches");
  },
  get minLength() {
    return requireCpiCaseByName(
      'Check searching with fewer than 3 characters is blocked with inline validation'
    );
  },
  get emptySku() {
    return requireCpiCaseByName('Check Empty Cisco SKU returns all SKUs up to selected limit');
  },
  get portfolio() {
    return requireCpiCaseByName('Check that Cisco Portfolio filter works as expected');
  },
  get geography() {
    return requireCpiCaseByName('Check Geography filter works as expected for given portfolio');
  },
  get limit500() {
    return requireCpiCaseByName('Limit dropdown - selecting 500 returns up to 500 rows');
  },
  get rebateSort() {
    return requireCpiCaseByName(
      'Check Results are sorted in descending order for PARTNER REBATE % column'
    );
  },
  get serviceSku() {
    return requireCpiCaseByName(
      'Check for Service SKUs GEOGRAPHY, GSP, and SERVICE TIER have values and null for non-services SKUs'
    );
  },
  get startsWith() {
    return requireCpiCaseByName(
      "Check 'Starts with' matches only SKUs beginning with the input string"
    );
  },
  get endsWith() {
    return requireCpiCaseByName(
      "Check 'Ends with' matches only SKUs ending with the input string"
    );
  },
  get noMatches() {
    return requireCpiCaseByName('Check search with no matches shows UI toast');
  },
  get limit1000() {
    return requireCpiCaseByName('Check that users get toast if limit surpasses 1000 records');
  },
  get noPermission() {
    return requireCpiCaseByName(
      'Check CPI Search page not accessible to a user without any PqW permission set'
    );
  },
  get columnSort() {
    return requireCpiCaseByName(
      'Check table column sorting toggles ascending/descending; grid is read-only'
    );
  },
  get gwError() {
    return requireCpiCaseByName('Check error shown if GW server unreachable');
  },
  get effectiveDate() {
    return requireCpiCaseByName('Effective Date drives CPI search results for selected date');
  },
};

/** Named Excel cases for CPI Configuration specs (keys from Zephyr sheet). */
export const cpiConfigCases = {
  duplicatePortfolio: requireCpiConfigCase('PQW-T4546'),
  tierPvi000: requireCpiConfigCase('PQW-T4547'),
  tierPvi499: requireCpiConfigCase('PQW-T4548'),
  tierPvi500: requireCpiConfigCase('PQW-T4549'),
  tierPvi749: requireCpiConfigCase('PQW-T4550'),
  tierPvi750: requireCpiConfigCase('PQW-T4551'),
  tierPvi10: requireCpiConfigCase('PQW-T4552'),
  pviZeroNoRebate: requireCpiConfigCase('PQW-T4553'),
  autoRebateOff: requireCpiConfigCase('PQW-T4554'),
  autoRebateOn: requireCpiConfigCase('PQW-T4555'),
  markInvalidOnChange: requireCpiConfigCase('PQW-T4556'),
  wonQuotesSkipped: requireCpiConfigCase('PQW-T4557'),
  pviBelowMin: requireCpiConfigCase('PQW-T4558'),
  pviAboveMax: requireCpiConfigCase('PQW-T4559'),
  pviAcceptMin: requireCpiConfigCase('PQW-T4560'),
  pviAcceptMax: requireCpiConfigCase('PQW-T4561'),
  beDropdown: requireCpiConfigCase('PQW-T4564'),
  decimalPlaces: requireCpiConfigCase('PQW-T4565'),
  specializations: requireCpiConfigCase('PQW-T4566'),
} as const;

/** Tier mapping cases driven entirely from Excel testData + expectedResults. */
export const cpiConfigTierCases = [
  cpiConfigCases.tierPvi000,
  cpiConfigCases.tierPvi499,
  cpiConfigCases.tierPvi500,
  cpiConfigCases.tierPvi749,
  cpiConfigCases.tierPvi750,
  cpiConfigCases.tierPvi10,
] as const;

export function getCpiCalculationCases(
  filePath: string = CPI_CALCULATION_TRIGGER_TEST_DATA,
  sheetName: string = cpiCalculationSheetName()
): Record<string, CpiExcelCaseData> {
  return getExcelTestCases(filePath, sheetName);
}

export function requireCpiCalculationCase(key: string): CpiExcelCaseData {
  return requireExcelTestCase(
    CPI_CALCULATION_TRIGGER_TEST_DATA,
    key,
    cpiCalculationSheetName()
  );
}

/** Named Excel cases for CPI Calculation Trigger specs (keys from Zephyr sheet). */
export const cpiCalculationCases = {
  effectiveDateOnCreate: requireCpiCalculationCase('PQW-T4989'),
  effectiveDateOnWon: requireCpiCalculationCase('PQW-T4990'),
  nullEffectiveDateBlocked: requireCpiCalculationCase('PQW-T4991'),
  partNumberChangeEnqueues: requireCpiCalculationCase('PQW-T4992'),
  syncModeUnder100: requireCpiCalculationCase('PQW-T4993'),
  notifyByEmailOver100: requireCpiCalculationCase('PQW-T4994'),
  iWillWaitOver100: requireCpiCalculationCase('PQW-T4995'),
  errorLogsTodo: requireCpiCalculationCase('PQW-T4996'),
  varTotalCostChange: requireCpiCalculationCase('PQW-T4997'),
  manufacturerLookupChange: requireCpiCalculationCase('PQW-T5000'),
  copyItemEnqueues: withCopyItemLineItem(requireCpiCalculationCase('PQW-T5003')),
  createQuoteCopyEnqueues: requireCpiCalculationCase('PQW-T5004'),
  effectiveDateChangeEnqueues: requireCpiCalculationCase('PQW-T5005'),
  manualEstimateCpi: requireCpiCalculationCase('PQW-T5006'),
  aggregatedMsdrNoButton: requireCpiCalculationCase('PQW-T5007'),
  cancelDoesNotStartJob: requireCpiCalculationCase('PQW-T5008'),
  ccwrAggregatedNotApplicable: requireCpiCalculationCase('PQW-T5016'),
  itemDeletionRecalculates: requireCpiCalculationCase('PQW-T5017'),
} as const;

export function getCpiRecalculationCases(
  filePath: string = CPI_RECALCULATION_TEST_DATA,
  sheetName: string = cpiRecalculationSheetName()
): Record<string, CpiExcelCaseData> {
  return getExcelTestCases(filePath, sheetName);
}

export function requireCpiRecalculationCase(key: string): CpiExcelCaseData {
  return requireExcelTestCase(CPI_RECALCULATION_TEST_DATA, key, cpiRecalculationSheetName());
}

/** Named Excel cases for CPI ReCalculation specs (keys from Zephyr sheet). */
export const cpiRecalculationCases = {
  dateRangeAndRebateFilter: requireCpiRecalculationCase('PQW-T4952'),
  selectAllAcrossPages: requireCpiRecalculationCase('PQW-T4953'),
  batchNotifyByEmail: requireCpiRecalculationCase('PQW-T4954'),
  cpiEffectiveDateFrom: requireCpiRecalculationCase('PQW-T4955'),
  cpiEffectiveDateTo: requireCpiRecalculationCase('PQW-T4956'),
  defaultFiltersNoError: requireCpiRecalculationCase('PQW-T4957'),
  rebateStatusDefault: requireCpiRecalculationCase('PQW-T4958'),
  multipleQuoteStatuses: requireCpiRecalculationCase('PQW-T4959'),
  multipleOpportunityStages: requireCpiRecalculationCase('PQW-T4960'),
  accountFilter: requireCpiRecalculationCase('PQW-T4961'),
  opportunityFilter: requireCpiRecalculationCase('PQW-T4962'),
  businessEntityFilter: requireCpiRecalculationCase('PQW-T4963'),
  combinedFilters: requireCpiRecalculationCase('PQW-T4964'),
  notCalculatedDisplay: requireCpiRecalculationCase('PQW-T4965'),
  quoteNumberLink: requireCpiRecalculationCase('PQW-T4966'),
  cancelNoJob: requireCpiRecalculationCase('PQW-T4967'),
  asyncModeOver100: requireCpiRecalculationCase('PQW-T4968'),
  syncModeUnder100: requireCpiRecalculationCase('PQW-T4969'),
  recalculationUpdatesFields: requireCpiRecalculationCase('PQW-T4971'),
  recalculationToastMessages: requireCpiRecalculationCase('PQW-T4972'),
  mixedDateQuotesSuccess: requireCpiRecalculationCase('PQW-T4988'),
} as const;

/** All CPI ReCalculation Excel cases for data-driven iteration. */
export const cpiRecalculationCaseList = Object.values(cpiRecalculationCases);
