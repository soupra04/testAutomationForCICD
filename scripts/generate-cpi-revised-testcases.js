/**
 * Generates CPI_Search_Page_TestCases_Revised.xlsx in the same format as the original
 * CPI_Search_Page_TestCases.xlsx (Zephyr-style multi-row steps).
 *
 * Usage: node scripts/generate-cpi-revised-testcases.js
 */
const XLSX = require('xlsx');
const path = require('path');

const HEADERS = [
  'Name',
  'Precondition',
  'Objective',
  'Folder',
  'Priority',
  'Test Script (Step-by-Step) - Step',
  'Test Script (Step-by-Step) - Test Data',
  'Test Script (Step-by-Step) - Expected Result',
  'Test Script (Plain Text)',
  'Test Script (BDD)',
];

const FOLDER = '/Cisco 360/CPI Search Page';
const PRIORITY = 'Normal';

/** @typedef {{ step: string, testData?: string, expected: string }} ScriptStep */

/**
 * @param {{ name: string, precondition: string, objective: string, steps: ScriptStep[] }} tc
 * @returns {string[][]}
 */
function expandTestCase(tc) {
  const rows = [];
  tc.steps.forEach((s, index) => {
    if (index === 0) {
      rows.push([
        tc.name,
        tc.precondition,
        tc.objective,
        FOLDER,
        PRIORITY,
        s.step,
        s.testData || '',
        s.expected,
        '',
        '',
      ]);
    } else {
      rows.push(['', '', '', '', '', s.step, s.testData || '', s.expected, '', '']);
    }
  });
  return rows;
}

const testCaseDefinitions = [
  {
    name: 'Search page loads with all CPI Search UI elements for a PqW Standard user',
    precondition:
      'Salesforce org has the CPI Search tab deployed; user has PqW_Standard permission set and can open StrataVAR PqW app.',
    objective:
      'Verify the CPI Search page renders every required query and results UI element per live Lightning UI.',
    steps: [
      {
        step: 'Log in to Salesforce as a user with the PqW_Standard permission set.',
        expected: 'Login succeeds and StrataVAR PqW app is available.',
      },
      {
        step: 'Navigate to the CPI Search tab (/lightning/n/{NS}__CPI_Search).',
        expected: 'CPI Search page opens with heading "CPI Search".',
      },
      {
        step: 'Observe the Search Criteria section.',
        expected:
          'SKU Operator (default Contains), Cisco SKU, Cisco Portfolio (default All Portfolios), Geography (Services only) (default All), Effective Date, Limit (default 100), and Search button are visible.',
      },
      {
        step: 'Observe the Search Results grid headers.',
        expected:
          'Grid shows columns: SKU (PART NUMBER), FAMILY, PARTNER REBATE %, PREFERRED PARTNER REBATE %, PORTFOLIO, CPI PERIOD, GEOGRAPHY, GSP, SERVICE TIER.',
      },
      {
        step: 'Observe the results area before running a search.',
        expected: 'Results area shows "Record(s) Not Found" until a search is executed.',
      },
    ],
  },
  {
    name: "SKU search with 'Equals' returns exact match only",
    precondition:
      'Test Data Setup sheet: equals_exact_sku and equals_near_miss_sku exist in org for selected Effective Date.',
    objective: 'Verify the Equals operator returns only the exact Cisco SKU and excludes near-matches.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: "Select SKU Operator value 'Equals'.",
        testData: 'Equals',
        expected: 'SKU Operator is set to Equals.',
      },
      {
        step: 'Enter equals_exact_sku into the Cisco SKU field.',
        testData: '{equals_exact_sku}',
        expected: 'SKU value is accepted in Cisco SKU field.',
      },
      {
        step: 'Click Search.',
        expected:
          "Only '{equals_exact_sku}' appears in SKU (PART NUMBER) column; '{equals_near_miss_sku}' is not returned.",
      },
      {
        step: 'Inspect the results table columns.',
        expected: 'Row shows PORTFOLIO, PARTNER REBATE %, and CPI PERIOD columns populated.',
      },
    ],
  },
  {
    name: "SKU search with 'Contains' returns all partial matches",
    precondition:
      'Test Data Setup sheet: contains_substring and expected matching SKUs exist for selected Effective Date.',
    objective:
      'Verify Contains operator returns every SKU containing the substring, sorted by PARTNER REBATE % descending.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: "Select SKU Operator value 'Contains'.",
        testData: 'Contains',
        expected: 'SKU Operator is set to Contains.',
      },
      {
        step: 'Enter contains_substring into the Cisco SKU field.',
        testData: '{contains_substring}',
        expected: 'Value accepted.',
      },
      {
        step: 'Click Search.',
        expected: 'All SKUs in Test Data Setup contains_expected_skus list are returned.',
      },
      {
        step: 'Inspect the results sort order.',
        expected: 'Results are sorted by PARTNER REBATE % descending (default sort).',
      },
    ],
  },
  {
    name: 'Search with fewer than 3 characters blocked with inline validation',
    precondition: 'CPI Search page is loaded.',
    objective:
      'Verify Cisco SKU input under 3 characters is blocked client-side with inline message; no GW/API call is fired.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: 'Enter a 2-character value into the Cisco SKU field.',
        testData: 'AB',
        expected: 'Value accepted in the field.',
      },
      {
        step: 'Attempt to click Search.',
        expected:
          'Search is blocked; inline message states at least 3 characters are required; no API call is fired.',
      },
    ],
  },
  {
    name: 'Empty Cisco SKU returns results up to the selected result limit',
    precondition: 'Org has CPI data for selected Effective Date; Limit default is 100.',
    objective:
      'Verify empty Cisco SKU search returns SKUs up to the result limit, sorted, with trim toast when applicable.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: 'Leave the Cisco SKU field empty.',
        expected: 'Cisco SKU field is empty.',
      },
      {
        step: "Set Cisco Portfolio to 'All Portfolios'.",
        testData: 'All Portfolios',
        expected: 'Cisco Portfolio is set to All Portfolios.',
      },
      {
        step: 'Ensure Limit is 100 and click Search.',
        testData: 'Limit: 100',
        expected:
          'Up to 100 rows returned; sorted by PARTNER REBATE % descending; if trimmed, toast reads e.g. "Results limited to highest rebate percentages. Refine your search for complete results."',
      },
    ],
  },
  {
    name: 'Cisco Portfolio filter narrows results to the selected portfolio only',
    precondition:
      'Org has SKUs in multiple portfolios; Test Data Setup defines portfolio_filter for selected Effective Date.',
    objective:
      "Verify Cisco Portfolio filter restricts results to chosen portfolio and 'All Portfolios' restores all portfolios.",
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: "Set Cisco Portfolio to '{portfolio_filter}'.",
        testData: '{portfolio_filter}',
        expected: 'Cisco Portfolio is set.',
      },
      {
        step: 'Leave Cisco SKU empty and click Search.',
        expected: "Every returned row shows PORTFOLIO = '{portfolio_filter}'.",
      },
      {
        step: "Change Cisco Portfolio to 'All Portfolios' and click Search again.",
        testData: 'All Portfolios',
        expected: 'Results include SKUs from multiple portfolios.',
      },
    ],
  },
  {
    name: 'Geography (Services only) filter restricts Services results to the selected region',
    precondition:
      'Org has Services SKUs with geography values; Test Data Setup defines geography_filter.',
    objective:
      'Verify Geography (Services only) restricts Services rows; non-services SKUs unaffected; All restores all regions.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: "Set Geography (Services only) to '{geography_filter}'.",
        testData: '{geography_filter}',
        expected: 'Geography is set.',
      },
      {
        step: 'Click Search with empty Cisco SKU.',
        expected: "Services rows show GEOGRAPHY for '{geography_filter}' only.",
      },
      {
        step: 'Inspect GEOGRAPHY column for non-services SKUs.',
        expected: 'Non-services SKUs may have blank GEOGRAPHY (unaffected).',
      },
      {
        step: "Set Geography (Services only) to 'All' and click Search.",
        testData: 'All',
        expected: 'Results include all regions.',
      },
    ],
  },
  {
    name: 'Limit dropdown - selecting 500 returns up to 500 rows',
    precondition: 'Org has CPI data; Limit supports 100, 200, 500, 1000.',
    objective:
      'Verify Limit=500 is applied, row count is at most 500, and grid remains responsive.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: "Set Limit to '500'.",
        testData: '500',
        expected: 'Limit is set to 500.',
      },
      {
        step: 'Leave Cisco SKU empty, set Cisco Portfolio to All Portfolios, and click Search.',
        testData: 'All Portfolios',
        expected:
          'Limit shows 500; row count ≤ 500; if data exceeds 500, trim toast may appear; grid handles results without freeze.',
      },
    ],
  },
  {
    name: 'Results table default sort is PARTNER REBATE % descending',
    precondition: 'Empty SKU search returns at least 2 rows for selected Effective Date.',
    objective:
      'Verify results grid defaults to PARTNER REBATE % descending and clicking the header reverses sort.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: 'Search with empty Cisco SKU and Cisco Portfolio = All Portfolios.',
        testData: 'All Portfolios',
        expected: 'Results are returned.',
      },
      {
        step: 'Inspect sort order of PARTNER REBATE % column.',
        expected: 'First row has highest PARTNER REBATE %; last row lowest.',
      },
      {
        step: 'Click the PARTNER REBATE % column header.',
        expected: 'Sort reverses to ascending.',
      },
    ],
  },
  {
    name: 'Services SKU shows GEOGRAPHY, GSP, and SERVICE TIER; non-services SKU blank',
    precondition: 'Test Data Setup defines services_sku and non_services_sku for selected Effective Date.',
    objective:
      'Verify services columns populate for Services SKUs and remain blank for non-services SKUs.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: 'Search for services_sku using Equals operator.',
        testData: '{services_sku}',
        expected: 'GEOGRAPHY, GSP, and SERVICE TIER populated (non-zero tiers only).',
      },
      {
        step: 'Search for non_services_sku.',
        testData: '{non_services_sku}',
        expected: 'GEOGRAPHY, GSP, and SERVICE TIER are blank.',
      },
    ],
  },
  {
    name: "'Starts with' matches only SKUs beginning with the input string",
    precondition: 'Test Data Setup defines starts_with_prefix, include, and exclude SKUs.',
    objective: 'Verify Starts with operator matches prefix only (UI label: Starts with).',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: "Select SKU Operator value 'Starts with'.",
        testData: 'Starts with',
        expected: 'SKU Operator is set to Starts with.',
      },
      {
        step: 'Enter starts_with_prefix into Cisco SKU.',
        testData: '{starts_with_prefix}',
        expected: 'Value accepted.',
      },
      {
        step: 'Click Search.',
        expected: 'starts_with_include SKUs returned; starts_with_exclude SKU not returned.',
      },
    ],
  },
  {
    name: "'Ends with' matches only SKUs ending with the input string",
    precondition: 'Test Data Setup defines ends_with_suffix, include, and exclude SKUs.',
    objective: 'Verify Ends with operator matches suffix only (UI label: Ends with).',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: "Select SKU Operator value 'Ends with'.",
        testData: 'Ends with',
        expected: 'SKU Operator is set to Ends with.',
      },
      {
        step: 'Enter ends_with_suffix into Cisco SKU.',
        testData: '{ends_with_suffix}',
        expected: 'Value accepted.',
      },
      {
        step: 'Click Search.',
        expected: 'ends_with_include SKUs returned; ends_with_exclude SKU not returned.',
      },
    ],
  },
  {
    name: 'Search with no matches shows an empty state, not an error',
    precondition: 'CPI Search page loaded; bogus SKU does not exist.',
    objective: 'Verify zero-result search shows empty state with no error toast or exception.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: "Select SKU Operator value 'Equals'.",
        testData: 'Equals',
        expected: 'SKU Operator is set to Equals.',
      },
      {
        step: 'Enter a non-existent SKU into Cisco SKU.',
        testData: 'NONEXISTENT-SKU-9999',
        expected: 'Value accepted.',
      },
      {
        step: 'Click Search.',
        expected:
          'Grid shows "Record(s) Not Found"; no error toast or exception; GW returns empty results.',
      },
    ],
  },
  {
    name: 'Results trimmed to 1000 max with toast notification',
    precondition: 'Org may have 1000+ CPI rows for selected Effective Date.',
    objective: 'Verify row count ≤ 1000 and trim toast appears when data exceeds cap.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: 'Leave Cisco SKU empty, set Cisco Portfolio to All Portfolios, set Limit to 1000.',
        testData: 'All Portfolios; Limit = 1000',
        expected: 'Filters set as specified.',
      },
      {
        step: 'Click Search.',
        expected:
          'Row count ≤ 1000; if total > 1000, toast indicates results were limited/refined.',
      },
    ],
  },
  {
    name: 'CPI Search page not accessible to a user without any PqW permission set',
    precondition: 'A user with no PqW permission set exists.',
    objective: 'Verify non-PqW user cannot reach CPI Search or see eligible-offers data.',
    steps: [
      {
        step: 'Log in as a user who has no PqW permission set.',
        expected: 'Login succeeds; CPI Search tab is absent from navigation bar.',
      },
      {
        step: 'Attempt to navigate directly to the CPI Search tab URL.',
        testData: '/lightning/n/{NS}__CPI_Search',
        expected: 'Page shows Access Denied; no CPI data is exposed.',
      },
    ],
  },
  {
    name: 'Cisco SKU field accepts exactly 80 characters without truncation',
    precondition: 'CPI Search page is loaded.',
    objective: 'Verify Cisco SKU accepts a full 80-character value with no truncation.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: 'Paste an 80-character string into the Cisco SKU field.',
        testData: '{80-character string}',
        expected: 'Full 80-character input is accepted with no truncation.',
      },
    ],
  },
  {
    name: 'Table column sorting toggles ascending/descending; grid is read-only',
    precondition: 'A search has returned at least 2 results.',
    objective:
      'Verify column header click toggles sort direction and grid remains read-only.',
    steps: [
      {
        step: 'Log in, navigate to CPI Search, and run a search returning multiple rows.',
        expected: 'Results table shows 2+ rows.',
      },
      {
        step: "Click the 'SKU (PART NUMBER)' column header.",
        expected: 'Rows sort alphabetically ascending by SKU.',
      },
      {
        step: "Click the 'SKU (PART NUMBER)' column header again.",
        expected: 'Rows sort alphabetically descending by SKU.',
      },
      {
        step: "Click the 'PORTFOLIO' column header.",
        expected: 'Rows sort by PORTFOLIO; grid is read-only (no edits via grid).',
      },
    ],
  },
  {
    name: 'GW unreachable - user-friendly error shown, no silent empty result',
    precondition: 'GW endpoint is unreachable (simulated); user is on CPI Search page.',
    objective:
      'Verify GW outage surfaces friendly error with retry guidance, not misleading empty table.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads.',
      },
      {
        step: 'Simulate GW outage and enter a valid SKU into Cisco SKU.',
        testData: '{valid SKU from Test Data Setup}',
        expected: 'Value accepted.',
      },
      {
        step: 'Click Search.',
        expected:
          'Friendly error shown (no stack trace); table does not show misleading "Record(s) Not Found"; retry or guidance shown.',
      },
    ],
  },
  {
    name: 'Effective Date drives CPI search results for selected date',
    precondition: 'Org has CPI data for at least two Effective Dates.',
    objective: 'Verify Effective Date picker filters CPI PERIOD/results to the chosen date.',
    steps: [
      {
        step: 'Log in as a PqW user and navigate to the CPI Search tab.',
        expected: 'CPI Search page loads; Effective Date field is visible with a default value.',
      },
      {
        step: 'Search with empty Cisco SKU using default Effective Date.',
        expected: 'Results returned reflect default Effective Date / CPI PERIOD.',
      },
      {
        step: 'Change Effective Date to an alternate date and search again.',
        testData: '{effective_date_b}',
        expected: 'Result set or CPI PERIOD values reflect the newly selected Effective Date.',
      },
    ],
  },
];

const uiReference = [
  ['CPI Search — Live UI Reference'],
  ['Element', 'Live UI Label / Value', 'Notes'],
  ['Tab', 'CPI Search', '/lightning/n/{NS}__CPI_Search'],
  ['SKU input', 'Cisco SKU', ''],
  ['Operator', 'SKU Operator', 'Equals | Contains | Starts with | Ends with'],
  ['Portfolio', 'Cisco Portfolio', 'Default: All Portfolios'],
  ['Geography', 'Geography (Services only)', 'Default: All'],
  ['Date', 'Effective Date', 'Required field'],
  ['Limit', 'Limit', '100, 200, 500, 1000; default 100'],
  ['Search button', 'Search', 'In main content area'],
  ['Empty state', 'Record(s) Not Found', ''],
  ['Toast (trim)', 'Results limited to highest rebate percentages...', ''],
  ['Sort column', 'PARTNER REBATE %', 'Formerly "Applicable Rebate %" in manual docs'],
  ['Grid columns', 'SKU (PART NUMBER), FAMILY, PARTNER REBATE %, PREFERRED PARTNER REBATE %, PORTFOLIO, CPI PERIOD, GEOGRAPHY, GSP, SERVICE TIER', ''],
  ['Pagination', '20 rows per page', ''],
];

const testDataSetup = [
  ['Key', 'Description', 'Example Value'],
  ['equals_exact_sku', 'Exact-match SKU in org', 'SEC-SKU-1'],
  ['equals_near_miss_sku', 'Similar SKU that must NOT match Equals', 'SEC-SKU-10'],
  ['contains_substring', 'Contains search string', 'CON-SNT'],
  ['contains_expected_skus', 'Comma-separated SKUs that must appear', 'CON-SNT-A1,CON-SNT-B2,CON-SNTX-C3'],
  ['starts_with_prefix', 'Starts with input', 'CON'],
  ['starts_with_include', 'Must appear', 'CON-AAA,CON-BBB'],
  ['starts_with_exclude', 'Must NOT appear', 'XCCON-AAA'],
  ['ends_with_suffix', 'Ends with input', 'SKU-1'],
  ['ends_with_include', 'Must appear', 'ABC-SKU-1,XYZ-SKU-1'],
  ['ends_with_exclude', 'Must NOT appear', 'SKU-10'],
  ['portfolio_filter', 'Portfolio picklist value', 'Cisco Security'],
  ['geography_filter', 'Geography picklist value', 'United States'],
  ['services_sku', 'Known Services SKU', '(org-specific)'],
  ['non_services_sku', 'Known non-Services SKU', '(org-specific)'],
  ['effective_date_a', 'Default Effective Date', 'Jul 1, 2026'],
  ['effective_date_b', 'Alternate Effective Date', '(org-specific)'],
];

const allRows = [HEADERS];
for (const tc of testCaseDefinitions) {
  allRows.push(...expandTestCase(tc));
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(allRows), 'Test Cases');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(uiReference), 'UI Reference');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(testDataSetup), 'Test Data Setup');

const outPath = path.join(__dirname, '../assets/CPI_Search_Page_TestCases_Revised.xlsx');
XLSX.writeFile(wb, outPath);

const stepRows = allRows.length - 1;
console.log(`Written: ${outPath}`);
console.log(`Test cases: ${testCaseDefinitions.length}, total step rows: ${stepRows}`);
