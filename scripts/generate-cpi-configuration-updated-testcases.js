/**
 * Generates CPI_Configuration_Page_TestCases_Updated.xlsx in the same format as
 * assets/CPI_SEARCH_PAGE_TESTCASES_UPDATED.xlsx
 *
 * Usage: node scripts/generate-cpi-configuration-updated-testcases.js
 */
const XLSX = require('xlsx');
const path = require('path');

const HEADERS = [
  'Key',
  'Name',
  'Precondition',
  'Objective',
  'Priority',
  'Test Script (Step-by-Step) - Step',
  'Test Script (Step-by-Step) - Test Data',
  'Test Script (Step-by-Step) - Expected Result',
];

const PRIORITY = 'Normal';

/** @typedef {{ step: string, testData?: string, expected: string }} ScriptStep */

/**
 * @param {{ key: string, name: string, precondition: string, objective: string, steps: ScriptStep[] }} tc
 * @returns {string[][]}
 */
function expandTestCase(tc) {
  const rows = [];
  tc.steps.forEach((s, index) => {
    if (index === 0) {
      rows.push([
        tc.key,
        tc.name,
        tc.precondition,
        tc.objective,
        PRIORITY,
        s.step,
        s.testData || '',
        s.expected,
      ]);
    } else {
      rows.push(['', '', '', '', '', s.step, s.testData || '', s.expected]);
    }
  });
  return rows;
}

const testCaseDefinitions = [
  {
    key: 'PQW-T4308',
    name: 'Check that CPI Configuration page loads all required UI elements for a PqW Admin user',
    precondition:
      'Salesforce org has the Cisco 360 CPI Configuration tab deployed; user has PqW_Admin permission set assigned.',
    objective:
      'Verify a PqW Admin user can open the CPI Configuration tab and all required page controls are visible.',
    steps: [
      {
        step: 'Log in to Salesforce as a user with the PqW_Admin permission set.',
        expected: 'Login succeeds and StrataVAR PqW app is available.',
      },
      {
        step: 'Navigate to the Cisco 360 CPI Configuration tab from the App Launcher.',
        expected: 'CPI Configuration tab opens successfully.',
      },
      {
        step: 'Observe the page contents.',
        expected:
          'Portfolio dropdown is populated; "Portfolios as of" badge is visible; Business Entity selector and Specialization checkboxes are visible.',
      },
    ],
  },
  {
    key: 'PQW-T4309',
    name: 'Check CPI Configuration tab is not accessible to a user without PqW_Admin permission set',
    precondition: 'A standard Salesforce user exists without the PqW_Admin permission set assigned.',
    objective:
      'Verify users without PqW_Admin cannot see or access the CPI Configuration tab.',
    steps: [
      {
        step: 'Log in to Salesforce as the standard user without PqW_Admin permissions.',
        expected: 'Login succeeds.',
      },
      {
        step: 'Attempt to navigate to the Cisco 360 CPI Configuration tab from the App Launcher.',
        expected: 'CPI Configuration tab is not visible in the App Launcher or navigation.',
      },
      {
        step: 'Observe the result.',
        expected: 'User cannot access the CPI Configuration page.',
      },
    ],
  },
  {
    key: 'PQW-T4310',
    name: "Check clicking 'Portfolios as of' button refreshes portfolios and specializations from GW",
    precondition:
      'PqW Admin user is on the CPI Configuration tab; GW endpoint is reachable.',
    objective:
      'Verify clicking the Portfolios as of button triggers a fresh fetch from GW and shows a success confirmation.',
    steps: [
      {
        step: 'Note the current portfolio dropdown contents.',
        expected: 'Current portfolio list is visible before refresh.',
      },
      {
        step: "Click the 'Portfolios as of' button.",
        testData: 'Portfolios as of July 16, 2026',
        expected: 'Refresh action is triggered.',
      },
      {
        step: 'Wait for the refresh to complete.',
        expected:
          'Success toast is displayed: "Successfully refreshed portfolios and specializations." Portfolio dropdown reflects refreshed data.',
      },
    ],
  },
  {
    key: 'PQW-T4311',
    name: 'Check Business Entity dropdown lists all Business Entities and loads corresponding portfolios',
    precondition:
      'PqW Admin user is logged in; multiple partners with multiple Business Entity GEO IDs exist in the org.',
    objective:
      'Verify the Business Entity dropdown is populated and selecting a BE loads active portfolios with PVI scores.',
    steps: [
      {
        step: 'Open the CPI Configuration tab.',
        expected: 'CPI Configuration page loads.',
      },
      {
        step: 'Verify the Business Entity dropdown is available.',
        testData:
          'SELECT Id, Name FROM pqwXrlDev7__Business_Entity__c',
        expected:
          'Business Entity dropdown is visible and lists all Business Entities created in the org.',
      },
      {
        step: 'Select a Business Entity from the dropdown.',
        testData: 'SQ-FILTER-BE-2',
        expected: 'Selected Business Entity is applied on the page.',
      },
      {
        step: 'Observe the portfolio list for the selected Business Entity.',
        testData:
          "SELECT pqwXrlDev7__Portfolio__c, pqwXrlDev7__Applicable_PVI__c, pqwXrlDev7__Effective_Start_Date__c, pqwXrlDev7__Effective_End_Date__c FROM pqwXrlDev7__PVI__c WHERE pqwXrlDev7__Business_Entity__r.Name = 'SQ-FILTER-BE-2' AND pqwXrlDev7__Is_Active__c = true AND pqwXrlDev7__Effective_End_Date__c > TODAY ORDER BY pqwXrlDev7__Effective_Start_Date__c ASC LIMIT 200",
        expected:
          'All active portfolios under the selected Business Entity are displayed with their corresponding PVI scores.',
      },
    ],
  },
  {
    key: 'PQW-T4313',
    name: 'Check PVI input rejects values outside 0.00-10.00 range',
    precondition:
      'PqW Admin user is on the CPI Configuration tab with Business Entity, portfolio, and date selections completed.',
    objective:
      'Verify PVI values below 0.00 or above 10.00 are rejected, while boundary values 0.00 and 10.00 are accepted.',
    steps: [
      {
        step: 'Navigate to the CPI Configuration tab.',
        expected: 'CPI Configuration page loads.',
      },
      {
        step: 'Select a Business Entity from the dropdown.',
        testData: 'SQ-FILTER-BE-2',
        expected: 'Business Entity is selected.',
      },
      {
        step: 'Enter a PVI value on any portfolio and press Enter.',
        testData: 'PVI = -0.01',
        expected:
          'Inline validation error is shown: "Applicable PVI must be between 0.00 and 10.00."',
      },
      {
        step: 'Click the Save icon.',
        expected: 'Invalid PVI value is not saved.',
      },
      {
        step: 'Enter a PVI value on any portfolio and press Enter.',
        testData: 'PVI = 10.01',
        expected:
          'Inline validation error is shown: "Applicable PVI must be between 0.00 and 10.00."',
      },
      {
        step: 'Click the Save icon.',
        expected: 'Invalid PVI value is not saved.',
      },
      {
        step: 'Enter a PVI value on any portfolio and press Enter.',
        testData: 'PVI = 0.00',
        expected: 'PVI value is accepted.',
      },
      {
        step: 'Click the Save icon.',
        expected: 'Value is saved successfully; success toast shows "1 of 1 item(s) updated".',
      },
      {
        step: 'Enter a PVI value on any portfolio and press Enter.',
        testData: 'PVI = 10.00',
        expected: 'PVI value is accepted.',
      },
      {
        step: 'Click the Save icon.',
        expected: 'Value is saved successfully; success toast shows "1 of 1 item(s) updated".',
      },
    ],
  },
  {
    key: 'PQW-T4314',
    name: 'Check PVI input rejects more than two decimal places',
    precondition:
      'PqW Admin user is on the CPI Configuration tab with all required dropdown selections completed.',
    objective:
      'Verify PVI input enforces a maximum of two decimal places for inline edits and add/update PVI actions.',
    steps: [
      {
        step: 'Navigate to the CPI Configuration tab.',
        expected: 'CPI Configuration page loads.',
      },
      {
        step: 'Select a Business Entity from the dropdown.',
        testData: 'SQ-FILTER-BE-2',
        expected: 'Business Entity is selected.',
      },
      {
        step: 'Enter a PVI value with more than two decimal places on any portfolio.',
        testData: 'PVI = 7.259',
        expected:
          'Field restricts input to two decimal places (X.XX format); error message: "Incorrect input, maximum of two decimal places."',
      },
      {
        step: 'Click Add or Update PVI.',
        expected: 'Add or Update PVI dialog opens.',
      },
      {
        step: 'Select a portfolio and enter a PVI value with more than two decimal places.',
        testData: 'PVI = 5.552',
        expected:
          'Field restricts input to two decimal places (X.XX format); error message: "Incorrect input, maximum of two decimal places."',
      },
    ],
  },
  {
    key: 'PQW-T4316',
    name: 'Check duplicate PVI record for same Business Entity and Portfolio is rejected',
    precondition:
      'An active PVI record already exists for Business Entity SQ-FILTER-BE-2, portfolio Cisco Security, PVI 1.00, effective start date Jun 10, 2026.',
    objective:
      'Verify the system rejects inserting a duplicate active PVI record for the same Business Entity, portfolio, and effective start date.',
    steps: [
      {
        step: 'Navigate to the CPI Configuration tab.',
        expected: 'CPI Configuration page loads.',
      },
      {
        step: 'Select a Business Entity from the dropdown.',
        testData: 'SQ-FILTER-BE-2',
        expected: 'Business Entity is selected.',
      },
      {
        step: 'Click Add or Update PVI.',
        expected: 'Add or Update PVI dialog opens.',
      },
      {
        step: 'Select portfolio, enter PVI value, and set effective start date.',
        testData: 'Portfolio: Cisco Security; PVI = 1.00; Effective Start Date: Jun 10, 2026',
        expected:
          'Duplicate values match the existing active PVI record.',
      },
      {
        step: 'Attempt to save the new PVI record.',
        expected:
          'System rejects the insert; toast warning: "A PVI record for this Business Entity and Portfolio is already active on the supplied Effective Start Date. Please review existing records before inserting."',
      },
    ],
  },
  {
    key: 'PQW-T4317',
    name: 'Check PVI tier label and bar colour reflect entered PVI value',
    precondition:
      'PqW Admin user is on the CPI Configuration tab with all required dropdown selections completed.',
    objective:
      'Verify each PVI value maps to the correct tier label and bar fill colour after save.',
    steps: [
      {
        step: 'Navigate to the CPI Configuration tab and select a Business Entity.',
        testData: 'SQ-FILTER-BE-2',
        expected: 'Business Entity is selected.',
      },
      {
        step: 'Enter a PVI value on any portfolio, save, and observe tier and bar colour.',
        testData: 'PVI = 0.00',
        expected:
          'Value saves successfully with toast "1 of 1 item(s) updated"; tier displays "Not eligible" with Gray colour.',
      },
      {
        step: 'Enter a PVI value on any portfolio, save, and observe tier and bar colour.',
        testData: 'PVI = 4.99',
        expected:
          'Value saves successfully with toast "1 of 1 item(s) updated"; tier displays "Not eligible" with Gray colour.',
      },
      {
        step: 'Enter a PVI value on any portfolio, save, and observe tier and bar colour.',
        testData: 'PVI = 5.00',
        expected:
          'Value saves successfully with toast "1 of 1 item(s) updated"; tier displays "Partner" with Sky Blue colour.',
      },
      {
        step: 'Enter a PVI value on any portfolio, save, and observe tier and bar colour.',
        testData: 'PVI = 7.49',
        expected:
          'Value saves successfully with toast "1 of 1 item(s) updated"; tier displays "Partner" with Sky Blue colour.',
      },
      {
        step: 'Enter a PVI value on any portfolio, save, and observe tier and bar colour.',
        testData: 'PVI = 7.50',
        expected:
          'Value saves successfully with toast "1 of 1 item(s) updated"; tier displays "Preferred Partner" with Light Green colour.',
      },
      {
        step: 'Enter a PVI value on any portfolio, save, and observe tier and bar colour.',
        testData: 'PVI = 10.00',
        expected:
          'Value saves successfully with toast "1 of 1 item(s) updated"; tier displays "Preferred Partner" with Light Green colour.',
      },
    ],
  },
  {
    key: 'PQW-T4319',
    name: 'Check Specialization labels are exact and toggle state persists after save and refresh',
    precondition:
      'PqW Admin user is on the CPI Configuration tab with a Business Entity selected.',
    objective:
      'Verify both Specialization labels render exactly and enabled state persists after save and page refresh.',
    steps: [
      {
        step: 'Navigate to the CPI Configuration tab and open the Specialization section.',
        expected: 'Specialization section is visible.',
      },
      {
        step: 'Verify the Specialization labels.',
        expected:
          'Two rows exist with exact labels: "Secure Al Infrastructure Specialization" and "Secure Networking Specialization".',
      },
      {
        step: 'Enable Secure Al Infrastructure Specialization only and save.',
        testData: 'Secure Al Infrastructure Specialization: checked',
        expected: 'Success toast is displayed: "Successfully enabled specialization."',
      },
      {
        step: 'Refresh the page.',
        expected: 'Secure Al Infrastructure Specialization toggle remains enabled.',
      },
    ],
  },
  {
    key: 'PQW-T4320',
    name: 'Check PVI value 0.00 results in Not Eligible tier with zero rebate on quote estimation',
    precondition:
      'PqW Admin user is on the CPI Configuration tab; no existing PVI exists for the selected Business Entity and portfolio combination.',
    objective:
      'Verify saving PVI 0.00 produces Not Eligible tier and zero rebate when Estimate CPI is run on a matching quote.',
    steps: [
      {
        step: 'Navigate to the CPI Configuration tab and select a Business Entity.',
        testData: 'SQ-FILTER-BE-2',
        expected: 'Business Entity is selected.',
      },
      {
        step: 'Enter and save PVI for the selected portfolio with effective start date today.',
        testData: 'Portfolio: Cisco Security; PVI = 0.00; Effective Start Date: today',
        expected: 'PVI record saves successfully.',
      },
      {
        step: 'Open a quote for the same Business Entity with CPI Effective Date today and quote items from Cisco Security portfolio.',
        testData: 'Business Entity: SQ-FILTER-BE-2; CPI Effective Date: today',
        expected: 'Quote opens with matching Business Entity and portfolio line items.',
      },
      {
        step: 'Click Estimate CPI.',
        expected:
          'Quote header shows pvi_tier = NOT_ELIGIBLE, rebate = $0.00, CPI Status = Valid, and Total Estimated CPI = $0.00.',
      },
    ],
  },
  {
    key: 'PQW-T4321',
    name: "Check 'Enable Automatic Rebate Calculation' controls automatic CPI calculation on new quote items",
    precondition:
      'PqW Admin user is on the CPI Configuration tab; System Configuration section is visible.',
    objective:
      'Verify disabling the checkbox prevents automatic CPI calculation and enabling it triggers Calculate CPIEstimate batch job.',
    steps: [
      {
        step: "Navigate to CPI Configuration and uncheck 'Enable Automatic Rebate Calculation' for the Business Entity.",
        testData: 'Business Entity: SQ-FILTER-BE-2',
        expected: 'Checkbox is unchecked and setting is saved.',
      },
      {
        step: 'Open a quote for the same Business Entity with CPI Start Date today and create a new Quote Item.',
        testData: 'Business Entity: SQ-FILTER-BE-2; CPI Start Date: today',
        expected: 'New Quote Item is created.',
      },
      {
        step: 'Observe CPI calculation status and Batch Queue Manager.',
        expected:
          'New Quote Item CPI Status = Not Calculated; no Calculate CPIEstimate job is present in Batch Queue Manager.',
      },
      {
        step: "Navigate to CPI Configuration and check 'Enable Automatic Rebate Calculation' for the Business Entity.",
        testData: 'Business Entity: SQ-FILTER-BE-2',
        expected: 'Checkbox is checked and setting is saved.',
      },
      {
        step: 'Open a quote for the same Business Entity with CPI Start Date today and create a new Quote Item.',
        testData: 'Business Entity: SQ-FILTER-BE-2; CPI Start Date: today',
        expected: 'New Quote Item is created.',
      },
      {
        step: 'Observe CPI calculation status and Batch Queue Manager.',
        expected:
          'New Quote Item CPI Status = Calculated; Calculate CPIEstimate job is present in Batch Queue Manager.',
      },
    ],
  },
  {
    key: 'PQW-T4322',
    name: "Check 'Mark Existing Rebates as Invalid when PVI Changes' invalidates open quote CPI status",
    precondition:
      "PqW Admin user is on the CPI Configuration tab; 'Mark Existing Rebates as Invalid when PVI Changes' is checked; at least two open non-Won quotes exist with CPI Status = Valid for SQ-FILTER-BE-2.",
    objective:
      'Verify changing PVI invalidates CPI on affected open non-Won quotes while Won quotes remain unchanged.',
    steps: [
      {
        step: 'Verify at least two open non-Won quotes have CPI Status = Valid.',
        testData: 'Business Entity: SQ-FILTER-BE-2',
        expected: 'Two or more qualifying quotes show CPI Status = Valid.',
      },
      {
        step: 'Change PVI for the Business Entity and portfolio, then save.',
        testData: 'Business Entity: SQ-FILTER-BE-2; Portfolio: Cisco Security; PVI: 7.0 to 4.0',
        expected: 'PVI change saves successfully.',
      },
      {
        step: 'Review CPI Status on affected open non-Won quotes.',
        expected:
          'CPI Status on open non-Won quotes changes to Invalid; CPI Amount fields are hidden on those quotes.',
      },
      {
        step: 'Review CPI Status on Won quotes for the same Business Entity.',
        expected: 'Won quotes are unaffected and retain their prior CPI status.',
      },
    ],
  },
];

const allRows = [HEADERS];
for (const tc of testCaseDefinitions) {
  allRows.push(...expandTestCase(tc));
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(allRows), 'Sheet0');

const xlsxOut = path.join(
  __dirname,
  '../assets/CPI_Configuration_Page_TestCases_Updated.xlsx'
);
XLSX.writeFile(wb, xlsxOut);

const csvOut = path.join(
  __dirname,
  '../assets/CPI_Configuration_Page_TestCases_Updated.csv'
);
const csvSheet = XLSX.utils.aoa_to_sheet(allRows);
const csvContent = XLSX.utils.sheet_to_csv(csvSheet);
require('fs').writeFileSync(csvOut, csvContent, 'utf8');

const downloadsCsvOut =
  'c:/Users/SoupraMaity/Downloads/CPI Configuration Page updated manual(Sheet0).csv';
require('fs').writeFileSync(downloadsCsvOut, csvContent, 'utf8');

console.log(`Written: ${xlsxOut}`);
console.log(`Written: ${csvOut}`);
console.log(`Updated: ${downloadsCsvOut}`);
console.log(`Test cases: ${testCaseDefinitions.length}, total step rows: ${allRows.length - 1}`);
