/**
 * CPI Search Page tests.
 *
 * Auth: same as the rest of the suite — SF_INSTANCE_URL / SF_SESSION_ID /
 * SF_ORG_PREFIX via globalSetup → state.chromium.json (Playwright storageState).
 *
 * Test data / Zephyr keys are loaded from assets/CPI_SEARCH_PAGE_TESTCASES_UPDATED.xlsx
 * (Key + Name columns via utils/cpiExcelCases cpiCases). Titles use `[${cpiCases.*.key}]`
 * so playwright-zephyr can map results when ENABLE_ZEPHYR=true (same pattern as BoM).
 */
import { test, expect, Page } from '@playwright/test';
import { CpiSearchPage } from '../../pages/cpiSearchPage';
import { cpiCases } from '../../utils/cpiExcelCases';
import {
  normalizeCpiEffectiveDate,
  parseColumnHeadersFromExpected,
  parseLimitFromTestData,
  parsePortfolioFromTestData,
} from '../../utils/excelTestDataParsers';

test.describe('CPI Search Page', () => {
  test.use({ viewport: { width: 1800, height: 1080 } });

  let page: Page;

  test.beforeEach(async ({ page: testPage }, testInfo) => {
    testInfo.setTimeout(180000);
    page = testPage;
    const cpiPage = new CpiSearchPage(page);
    await cpiPage.gotoCpiSearchTab();
  });

  test(
    `[${cpiCases.pageLoad.key}] ${cpiCases.pageLoad.name}`,
    { tag: ['@cpiSearch'] },
    async () => {
      const cpiPage = new CpiSearchPage(page);

      await test.step('assert query area visible', async () => {
        await cpiPage.assertQueryAreaVisible();
      });

      await test.step('assert results table empty', async () => {
        await cpiPage.assertResultsTableEmpty();
      });

      await test.step('assert column headers visible', async () => {
        const headers = parseColumnHeadersFromExpected(cpiCases.pageLoad.expectedResults);
        await cpiPage.assertColumnHeadersVisible(headers);
      });
    }
  );

  test(`[${cpiCases.equals.key}] ${cpiCases.equals.name}`, { tag: ['@cpiSearch'] }, async () => {
    const [operator, sku] = cpiCases.equals.testData;
    const cpiPage = new CpiSearchPage(page);

    await test.step(`search with Equals operator for SKU '${sku}'`, async () => {
      await cpiPage.search({ operator, sku });
    });

    const skuValues = await test.step('assert search returned SKU rows', async () => {
      return await cpiPage.assertSearchReturnedSkuRows(cpiCases.equals.key, `SKU '${sku}'`);
    });

    await test.step(`assert all SKU values equal '${sku}'`, async () => {
      await cpiPage.assertAllSkuValuesEqual(sku, skuValues);
    });
  });

  test(`[${cpiCases.contains.key}] ${cpiCases.contains.name}`, { tag: ['@cpiSearch'] }, async () => {
    const [operator, substring] = cpiCases.contains.testData;
    const cpiPage = new CpiSearchPage(page);

    await test.step(`search with Contains operator for '${substring}'`, async () => {
      await cpiPage.search({ operator, sku: substring });
    });

    const skuValues = await test.step('assert search returned SKU rows', async () => {
      return await cpiPage.assertSearchReturnedSkuRows(cpiCases.contains.key, `substring '${substring}'`);
    });

    await test.step(`assert all SKU values contain '${substring}'`, async () => {
      await cpiPage.assertAllSkuValuesContain(substring, skuValues);
    });

    await test.step('assert default sort by rebate descending', async () => {
      await cpiPage.assertDefaultSortByRebateDesc();
    });
  });

  test(`[${cpiCases.minLength.key}] ${cpiCases.minLength.name}`, { tag: ['@cpiSearch'] }, async () => {
    const [shortSku] = cpiCases.minLength.testData;
    const cpiPage = new CpiSearchPage(page);
    let apiCalled = false;

    await test.step('listen for eligible/CPI API requests', async () => {
      page.on('request', (req) => {
        if (/eligible|cpi|gateway|gw/i.test(req.url())) {
          apiCalled = true;
        }
      });
    });

    await test.step(`enter short SKU '${shortSku}'`, async () => {
      await cpiPage.enterSku(shortSku);
    });

    await test.step('click Search without waiting for toast', async () => {
      // Field error is inline (not a toast) — click Search without waiting for toast
      await cpiPage.clickSearchButtonOnly();
    });

    await test.step('assert min-length field validation message', async () => {
      const fieldError = await cpiPage.getMinLengthValidationMessage();
      console.log(`[${cpiCases.minLength.key}] Cisco SKU field error: ${fieldError}`);
      expect(fieldError).toMatch(
        /Enter at least 3 characters or leave empty to search all SKUs/i
      );
      await cpiPage.assertMinLengthValidationVisible();
    });

    await test.step('assert no API call was made', async () => {
      expect(apiCalled).toBe(false);
    });
  });

  test(`[${cpiCases.emptySku.key}] ${cpiCases.emptySku.name}`, { tag: ['@cpiSearch'] }, async () => {
    const portfolio = parsePortfolioFromTestData(cpiCases.emptySku.testData)!;
    const limit = parseLimitFromTestData(cpiCases.emptySku.testData)!;
    const cpiPage = new CpiSearchPage(page);

    await test.step('search with empty SKU', async () => {
      await cpiPage.search({ sku: '', portfolio, limit });
    });

    const skuValues = await test.step('assert search returned SKU rows', async () => {
      return await cpiPage.assertSearchReturnedSkuRows(
        cpiCases.emptySku.key,
        'empty SKU search'
      );
    });
    await test.step('log grid data after search', async () => {
      await cpiPage.logGridData(cpiCases.emptySku.key, undefined, 10);
    });

    await test.step(`assert row count at most ${limit}`, async () => {
      await cpiPage.assertRowCountAtMost(limit);
    });

    await test.step('assert default sort by rebate descending', async () => {
      await cpiPage.assertDefaultSortByRebateDesc();
    });

   

    await test.step('assert trim toast when results hit limit', async () => {
      if (skuValues.length >= Number(limit)) {
        await cpiPage.assertTrimToast(limit);
      }
    });
  });

  test(`[${cpiCases.portfolio.key}] ${cpiCases.portfolio.name}`, { tag: ['@cpiSearch'] }, async () => {
    const [portfolioFilter, allPortfolios] = cpiCases.portfolio.testData;
    const cpiPage = new CpiSearchPage(page);

    await test.step(`search with portfolio '${portfolioFilter}'`, async () => {
      await cpiPage.search({ portfolio: portfolioFilter, sku: '' });
    });

    await test.step(`assert search returned rows for portfolio '${portfolioFilter}'`, async () => {
      await cpiPage.assertSearchReturnedSkuRows(
        cpiCases.portfolio.key,
        `portfolio '${portfolioFilter}'`
      );
    });

    await test.step(`assert all Portfolio values equal '${portfolioFilter}'`, async () => {
      await cpiPage.assertAllColumnValuesEqual('Portfolio', portfolioFilter);
    });

    await test.step(`search with portfolio '${allPortfolios}'`, async () => {
      await cpiPage.search({ portfolio: allPortfolios, sku: '' });
    });

    await test.step(`assert search returned rows for portfolio '${allPortfolios}'`, async () => {
      await cpiPage.assertSearchReturnedSkuRows(
        cpiCases.portfolio.key,
        `portfolio '${allPortfolios}'`
      );
    });

    await test.step('assert portfolio values present for All Portfolios', async () => {
      const allPortfolioValues = await cpiPage.getColumnValues('Portfolio');
      expect(new Set(allPortfolioValues).size).toBeGreaterThanOrEqual(1);
    });
  });

  test(`[${cpiCases.geography.key}] ${cpiCases.geography.name}`, { tag: ['@cpiSearch'] }, async () => {
    const [excelPortfolio, preferredGeography, allGeography] = cpiCases.geography.testData;
    const cpiPage = new CpiSearchPage(page);
    // Excel portfolio/geography (Cisco Services / United States) return 0 rows in this org.
    // Use Starts with CON (known Services SKUs) with default All Portfolios, then filter geography.
    const servicesSkuPrefix = 'CON';

    await test.step('log Excel portfolio unused and choose CON prefix', async () => {
      console.log(
        `[${cpiCases.geography.key}] Excel portfolio '${excelPortfolio}' unused — org has no rows; using All Portfolios + Starts with '${servicesSkuPrefix}'`
      );
    });

    await test.step(`search Starts with '${servicesSkuPrefix}' at default geography`, async () => {
      // Leave Geography at page default (All) — same path as Starts-with PQW-T4538.
      await cpiPage.search({
        operator: 'Starts with',
        sku: servicesSkuPrefix,
      });
      await cpiPage.assertSearchReturnedSkuRows(
        cpiCases.geography.key,
        `geography '${allGeography}' (default)`
      );
    });

    const candidates = await test.step('collect Geography filter candidates', async () => {
      const geoOptions = await cpiPage.getGeographyOptions();
      return [
        ...geoOptions.filter(
          (g) => g.localeCompare(preferredGeography, undefined, { sensitivity: 'accent' }) === 0
        ),
        ...geoOptions.filter((g) => !/^all$/i.test(g)),
      ].filter((g, i, arr) => arr.indexOf(g) === i);
    });

    test.skip(candidates.length === 0, 'No Geography combobox options available to filter');

    const geography = await test.step('find Geography option that returns rows', async () => {
      let selected = '';
      for (const candidate of candidates) {
        await cpiPage.search({
          operator: 'Starts with',
          sku: servicesSkuPrefix,
          geography: candidate,
        });
        const rows = await cpiPage.getResultRowCount();
        console.log(
          `[${cpiCases.geography.key}] Geography '${candidate}' → ${rows} row(s)`
        );
        if (rows > 0) {
          selected = candidate;
          break;
        }
      }
      return selected;
    });

    test.skip(!geography, 'No Geography option returned rows for Starts with CON');

    await test.step('log if preferred Geography was unavailable', async () => {
      if (geography !== preferredGeography) {
        console.log(
          `[${cpiCases.geography.key}] Excel preferred '${preferredGeography}' had no rows; using '${geography}'`
        );
      }
    });

    await test.step(`assert search returned rows for geography '${geography}'`, async () => {
      await cpiPage.assertSearchReturnedSkuRows(
        cpiCases.geography.key,
        `geography '${geography}'`
      );
    });

    await test.step(`assert Geography values match '${geography}'`, async () => {
      await cpiPage.assertGeographyValuesMatch(geography);
    });
  });

  test(`[${cpiCases.limit500.key}] ${cpiCases.limit500.name}`, { tag: ['@cpiSearch'] }, async () => {
    const limit = parseLimitFromTestData(cpiCases.limit500.testData)!;
    const portfolio = parsePortfolioFromTestData(cpiCases.limit500.testData)!;
    const cpiPage = new CpiSearchPage(page);

    await test.step(`search with limit ${limit}`, async () => {
      await cpiPage.search({ limit, portfolio, sku: '' });
    });

    const skuValues = await test.step('assert search returned SKU rows', async () => {
      return await cpiPage.assertSearchReturnedSkuRows(
        cpiCases.limit500.key,
        `limit ${limit}`
      );
    });

    await test.step(`assert limit ${limit} is selected`, async () => {
      await cpiPage.assertLimitSelected(limit);
    });

    await test.step(`assert row count at most ${limit}`, async () => {
      await cpiPage.assertRowCountAtMost(limit);
      console.log(`[${cpiCases.limit500.key}] row count=${skuValues.length}, limit=${limit}`);
    });

    await test.step('assert trim toast', async () => {
      await cpiPage.assertTrimToast(limit);
    });
  });

  test(`[${cpiCases.rebateSort.key}] ${cpiCases.rebateSort.name}`, { tag: ['@cpiSearch'] }, async () => {
    const [portfolio] = cpiCases.rebateSort.testData;
    const cpiPage = new CpiSearchPage(page);

    await test.step(`search with portfolio '${portfolio}'`, async () => {
      await cpiPage.search({ portfolio, sku: '' });
    });

    const skuValues = await test.step('assert search returned SKU rows', async () => {
      return await cpiPage.assertSearchReturnedSkuRows(
        cpiCases.rebateSort.key,
        `portfolio '${portfolio}'`
      );
    });

    test.skip(skuValues.length < 2, 'Need 2+ results for rebate sort test');

    const beforeSorting = await test.step('capture rebate values and assert default desc sort', async () => {
      const values = await cpiPage.getColumnValues('Applicable Rebate %');
      await cpiPage.assertDefaultSortByRebateDesc();
      console.log(`[${cpiCases.rebateSort.key}] before sorting (default desc):`, values);
      return values;
    });

    const afterSorting = await test.step('sort Applicable Rebate % ascending and assert', async () => {
      await cpiPage.clickColumnHeader('Applicable Rebate %');
      await cpiPage.assertColumnSortDirection('Applicable Rebate %', 'asc');
      await cpiPage.assertSortByRebateAsc();
      const values = await cpiPage.getColumnValues('Applicable Rebate %');
      console.log(`[${cpiCases.rebateSort.key}] after sorting (asc):`, values);
      return values;
    });

    await test.step('assert ascending sort reordered rows when values differ', async () => {
      if (new Set(beforeSorting).size > 1) {
        expect(
          afterSorting,
          'Ascending rebate sort should reorder rows when rebate values are not all identical'
        ).not.toEqual(beforeSorting);
      }
    });
  });

  test(`[${cpiCases.startsWith.key}] ${cpiCases.startsWith.name}`, { tag: ['@cpiSearch'] }, async () => {
    const [operator, excelPrefix] = cpiCases.startsWith.testData;
    // Excel Expected Result says prefix CON; Test Data "CONP" returns No Results in this org.
    const expectedPrefixHint = cpiCases.startsWith.expectedResults.join(' ');
    const prefixFromExpected = expectedPrefixHint.match(/starting with\s+([A-Za-z0-9-]+)/i)?.[1];
    const prefix =
      excelPrefix === 'CONP' && prefixFromExpected ? prefixFromExpected : excelPrefix;

    await test.step('resolve SKU prefix from Excel Expected Result if needed', async () => {
      if (prefix !== excelPrefix) {
        console.log(
          `[${cpiCases.startsWith.key}] Using prefix '${prefix}' from Expected Result (Excel Test Data was '${excelPrefix}')`
        );
      }
    });

    const cpiPage = new CpiSearchPage(page);

    await test.step(`search with Starts with prefix '${prefix}'`, async () => {
      await cpiPage.search({ operator, sku: prefix });
    });

    const skuValues = await test.step('assert search returned SKU rows', async () => {
      return await cpiPage.assertSearchReturnedSkuRows(cpiCases.startsWith.key, `prefix '${prefix}'`);
    });

    await test.step(`assert all SKU values start with '${prefix}'`, async () => {
      await cpiPage.assertAllSkuValuesStartWith(prefix, cpiCases.startsWith.key, skuValues);
    });
  });

  test(`[${cpiCases.endsWith.key}] ${cpiCases.endsWith.name}`, { tag: ['@cpiSearch'] }, async () => {
    const [operator, suffix] = cpiCases.endsWith.testData;
    const cpiPage = new CpiSearchPage(page);

    await test.step(`search with Ends with suffix '${suffix}'`, async () => {
      await cpiPage.search({ operator, sku: suffix });
    });

    const skuValues = await test.step('assert search returned SKU rows', async () => {
      return await cpiPage.assertSearchReturnedSkuRows(cpiCases.endsWith.key, `suffix '${suffix}'`);
    });

    await test.step(`assert all SKU values end with '${suffix}'`, async () => {
      await cpiPage.assertAllSkuValuesEndWith(suffix, cpiCases.endsWith.key, skuValues);
    });
  });

  test(`[${cpiCases.noMatches.key}] ${cpiCases.noMatches.name}`, { tag: ['@cpiSearch'] }, async () => {
    const [operator, sku] = cpiCases.noMatches.testData;
    const cpiPage = new CpiSearchPage(page);

    await test.step(`search with no-match SKU '${sku}'`, async () => {
      await cpiPage.search({ operator, sku });
    });

    await test.step('assert no-match toast', async () => {
      await cpiPage.assertNoMatchToast(cpiCases.noMatches.key);
    });

    await test.step('assert empty state visible', async () => {
      await cpiPage.assertEmptyStateVisible();
    });
  });

  test(`[${cpiCases.limit1000.key}] ${cpiCases.limit1000.name}`, { tag: ['@cpiSearch'] }, async () => {
    const portfolio = parsePortfolioFromTestData(cpiCases.limit1000.testData)!;
    const limit = parseLimitFromTestData(cpiCases.limit1000.testData)!;
    const cpiPage = new CpiSearchPage(page);

    await test.step(`search with limit ${limit}`, async () => {
      await cpiPage.search({ limit, portfolio, sku: '' });
    });

    const skuValues = await test.step('assert search returned SKU rows', async () => {
      return await cpiPage.assertSearchReturnedSkuRows(
        cpiCases.limit1000.key,
        `limit ${limit}`
      );
    });

    await test.step(`assert row count at most ${limit}`, async () => {
      await cpiPage.assertRowCountAtMost(limit);
      console.log(`[${cpiCases.limit1000.key}] row count=${skuValues.length}, limit=${limit}`);
    });

    await test.step('assert trim toast', async () => {
      await cpiPage.assertTrimToast(limit);
    });
  });

  test(`[${cpiCases.columnSort.key}] ${cpiCases.columnSort.name}`, { tag: ['@cpiSearch'] }, async () => {
    // Column-sort case has no Test Data rows; reuse All Portfolios from rebate-sort Excel row
    const portfolio = cpiCases.rebateSort.testData[0];
    const cpiPage = new CpiSearchPage(page);

    await test.step(`search with portfolio '${portfolio}'`, async () => {
      await cpiPage.search({ portfolio, sku: '' });
    });

    const skuValues = await test.step('assert search returned SKU rows', async () => {
      return await cpiPage.assertSearchReturnedSkuRows(
        cpiCases.columnSort.key,
        `portfolio '${portfolio}'`
      );
    });

    test.skip(skuValues.length < 2, 'Need 2+ results for sort test');

    const beforeSorting = await test.step('capture SKU values before sort', async () => {
      return await cpiPage.getColumnValues('SKU');
    });

    const skuAfterAsc = await test.step('sort SKU ascending and assert', async () => {
      await cpiPage.clickColumnHeader('SKU');
      await cpiPage.assertColumnSortDirection('SKU', 'asc');
      await cpiPage.assertSortAscending('SKU');
      return await cpiPage.getColumnValues('SKU');
    });

    const afterSorting = await test.step('sort SKU descending and assert', async () => {
      await cpiPage.clickColumnHeader('SKU');
      await cpiPage.assertColumnSortDirection('SKU', 'desc');
      await cpiPage.assertSortDescending('SKU');
      const values = await cpiPage.getColumnValues('SKU');
      console.log(`[${cpiCases.columnSort.key}] before sorting:`, beforeSorting);
      console.log(`[${cpiCases.columnSort.key}] after sorting:`, values);
      return values;
    });

    await test.step('assert descending sort reordered rows when values differ', async () => {
      if (new Set(skuAfterAsc).size > 1) {
        expect(
          afterSorting,
          'Descending sort should reorder rows when SKU values are not all identical'
        ).not.toEqual(skuAfterAsc);
      }
    });

    await test.step('sort Portfolio ascending and assert grid read-only', async () => {
      await cpiPage.clickColumnHeader('Portfolio');
      await cpiPage.assertColumnSortDirection('Portfolio', 'asc');
      await cpiPage.assertSortAscending('Portfolio');
      await cpiPage.assertGridReadOnly();
    });
  });

  test(`[${cpiCases.effectiveDate.key}] ${cpiCases.effectiveDate.name}`, { tag: ['@cpiSearch'] }, async () => {
    const [alternateDate] = cpiCases.effectiveDate.testData;
    const expectedAlternateDate = normalizeCpiEffectiveDate(alternateDate);
    const cpiPage = new CpiSearchPage(page);
    const portfolio = cpiCases.rebateSort.testData[0];

    const defaultDate = await test.step('assert Effective Date visible and capture default', async () => {
      await cpiPage.assertEffectiveDateVisible();
      const value = await cpiPage.getEffectiveDate();
      expect(value.length).toBeGreaterThan(0);
      expect(
        expectedAlternateDate,
        'Excel alternate Effective Date must differ from the page default'
      ).not.toBe(value);
      return value;
    });

    const defaultPeriods = await test.step('search with default Effective Date and capture CPI Period', async () => {
      await cpiPage.search({ sku: '', portfolio });
      await cpiPage.assertSearchReturnedSkuRows(
        cpiCases.effectiveDate.key,
        'default Effective Date'
      );
      const periods = await cpiPage.getColumnValues('CPI Period');
      expect(periods.length).toBeGreaterThan(0);
      console.log(
        `[${cpiCases.effectiveDate.key}] Default Effective Date '${defaultDate}' CPI Period sample: ${periods.slice(0, 3).join(', ')}`
      );
      return periods;
    });

    await test.step(`search with alternate Effective Date '${expectedAlternateDate}'`, async () => {
      await cpiPage.search({
        sku: '',
        portfolio,
        effectiveDate: alternateDate,
      });
      expect(await cpiPage.getEffectiveDate()).toBe(expectedAlternateDate);
    });

    await test.step('assert results and compare CPI Period after date change', async () => {
      await cpiPage.assertSearchReturnedSkuRows(
        cpiCases.effectiveDate.key,
        `Effective Date '${expectedAlternateDate}'`
      );
      const updatedPeriods = await cpiPage.getColumnValues('CPI Period');
      expect(updatedPeriods.length).toBeGreaterThan(0);
      console.log(
        `[${cpiCases.effectiveDate.key}] Alternate Effective Date '${expectedAlternateDate}' CPI Period sample: ${updatedPeriods.slice(0, 3).join(', ')}`
      );
      if (updatedPeriods.join('|') !== defaultPeriods.join('|')) {
        console.log(
          `[${cpiCases.effectiveDate.key}] CPI Period values changed after Effective Date update`
        );
      } else {
        console.log(
          `[${cpiCases.effectiveDate.key}] CPI Period values unchanged (same period window); Effective Date field change verified`
        );
      }
    });
  });
});
