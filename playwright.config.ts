import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { hydrateSfVarsIntoProcessEnv, normalizeSfEnvUrls } from './utils/envConfig';

// CI provides sheet names / SF_ORG_PREFIX inside SF_VARS JSON, not as top-level env vars.
// Hydrate early so process.env.SF_ORG_PREFIX works for all existing code.
hydrateSfVarsIntoProcessEnv();
normalizeSfEnvUrls();

// Create timestamped report folder for HTML reports
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportDir = path.join('reports/playwright-report', `report-${timestamp}`);

// Ensure Zephyr report folder exists
const zephyrDir = path.resolve(__dirname, 'reports', 'zephyr'); // absolute folder
// if (!fs.existsSync(zephyrDir)) {
//   fs.mkdirSync(zephyrDir, { recursive: true });
// }
const zephyrReportPath = path.join(zephyrDir, 'zephyr-results.json'); // absolute file path

// --------------------
// REPORTERS (only logic added)
// --------------------
const reporters: any[] = [
  //['list'],
  //['json', { outputFile: 'result.json' }],
  ['html', { open: 'always', outputFolder: reportDir }],
  ['allure-playwright'],
];



if (process.env.ENABLE_ZEPHYR === 'true') {   // need to add ENABLE_ZEPHYR field in .env file
  reporters.push([
    'playwright-zephyr/lib/src/cloud',
    {
      projectKey: 'PQW',
      authorizationToken:
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJjb250ZXh0Ijp7ImJhc2VVcmwiOiJodHRwczovL3N0cmF0YXZhci5hdGxhc3NpYW4ubmV0IiwidXNlciI6eyJhY2NvdW50SWQiOiI1ZDRlZjY3YjJjMGZlYTBkMDdjYTNjMWQiLCJ0b2tlbklkIjoiZTY2YWM1MWItZDljNi00MmU5LTg4NWEtMjEwOGViYWZjMWY5In19LCJpc3MiOiJjb20ua2Fub2FoLnRlc3QtbWFuYWdlciIsInN1YiI6ImppcmE6ZGRiOTU1OWMtNGNlZi00ZWY2LTk4ZjYtN2FiNTdkODgzZmU0IiwiZXhwIjoxNzg1MDY2MDU1LCJpYXQiOjE3NTM1MzAwNTV9.qnLG-ewUbnpegiIvI_OXjicqYkNGb9P6W05rXrgtCSA",
      reportPath: zephyrReportPath, // use full path
    },
  ]);
}

// --------------------
// EXISTING CONFIG (unchanged)
// --------------------
export default defineConfig({
  timeout: 500000,
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 3,
  workers: process.env.CI ? 1 : 2,

  reporter: reporters,

  globalSetup: './integration/sf/globalSetup',

  use: {
    storageState: 'state.chromium.json',
    baseURL: process.env.SF_INSTANCE_URL,

    headless: process.env.CI ? true : false,
    // trace: 'on-first-retry',     // or 'on'
    screenshot: 'on',
    video: 'retain-on-failure',
    // //trace: 'off',

    // video: { mode: 'off' },
    // screenshot: { mode: 'off' },
    // // launchOptions: process.env.CI
    // //   ? {}
    // //   : { args: ['--start-maximized'] },


  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
