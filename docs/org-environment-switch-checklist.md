# Org / Environment Switch Checklist — Playwright Test Automation

> **Purpose:** Use this checklist whenever you switch the Salesforce org or environment used for local test runs (e.g. Demo Sales → Demo Int QA → 3.9 Test Org).
>
> **Applies to:** `testautomation` Playwright + TypeScript framework  
> **Primary config file:** `.env` (local) / `SF_VARS` JSON (CI / Bitbucket)

---

## Quick reference — known environments

| Environment | UI URL (browser) | API URL (`SF_INSTANCE_URL`) | Typical namespace |
|---|---|---|---|
| **Demo Sales** | `https://demosales.lightning.force.com` | `https://demosales.my.salesforce.com` | `StrataVAR` |
| **Demo Int QA** (sandbox) | `https://demosales--sdo1intqa.sandbox.lightning.force.com` | `https://demosales--sdo1intqa.sandbox.my.salesforce.com` | `StrataVAR` |
| **3.9 Test Org** (sandbox) | `https://st1723635638241--pqw3v9.sandbox.lightning.force.com` | `https://st1723635638241--pqw3v9.sandbox.my.salesforce.com` | `StrataVAR` |

---

## Pre-switch checklist (before changing anything)

- [ ] Confirm which **target org** you are switching to (name + sandbox if applicable)
- [ ] Confirm you have a **valid session ID** (`sid`) or username/password for that org
- [ ] Confirm you know the **Excel sheet tab names** for that org’s test data
- [ ] Notify the team if you are changing shared `.env` values on a shared machine
- [ ] Close any running Playwright browsers / test runs

---

## Step 1 — Update Salesforce authentication (main org)

All values go in **`.env`** unless running in CI (see Step 6).

### 1.1 Instance URL

| Variable | Required | How to set |
|---|---|---|
| `SF_INSTANCE_URL` | **Yes** | Use the **`*.my.salesforce.com`** format (API URL), **not** the Lightning URL |

**Correct examples:**
```env
SF_INSTANCE_URL=https://demosales.my.salesforce.com
SF_INSTANCE_URL=https://demosales--sdo1intqa.sandbox.my.salesforce.com
```

**Avoid (causes jsforce error):**
```env
SF_INSTANCE_URL=https://demosales.lightning.force.com   # ❌ "lightning URLs are not valid as instance URLs"
```

> **Note:** The framework auto-converts Lightning URLs to API URLs at startup (`utils/envConfig.ts`), but always prefer setting the correct API URL directly.

**Rules:**
- Only **one active** `SF_INSTANCE_URL` line — remove or comment duplicates
- No spaces around `=` (use `KEY=value`, not `KEY = value`)

---

### 1.2 Session ID

| Variable | Required | How to set |
|---|---|---|
| `SF_SESSION_ID` | **Yes** | Session token (`sid`) from the **same org** as `SF_INSTANCE_URL` |

**How to obtain a session:**

**Option A — Manual (browser)**
1. Log in to the target org in Chrome
2. Open DevTools → Application → Cookies → `.salesforce.com`
3. Copy the `sid` cookie value into `.env`

**Option B — Automated (`fetch-sid.ts`)**
1. Set `SF_LOGIN_URL`, `SF_USERNAME`, `SF_PASSWORD` (and `SF_SECURITY_TOKEN` if needed)
2. Run:
   ```bash
   npx ts-node fetch-sid.ts
   ```
3. Script updates `SF_SESSION_ID` and `SF_INSTANCE_URL` in `.env` automatically

**Critical rule:** Session and URL must belong to the **same org**. A Demo Int QA session with a Demo Sales URL will open the wrong org or fail login.

---

### 1.3 Login credentials (for session refresh)

| Variable | Required | When used |
|---|---|---|
| `SF_LOGIN_URL` | Recommended | SOAP login endpoint for `fetch-sid.ts` |
| `SF_USERNAME` | If using fetch-sid | Org username |
| `SF_PASSWORD` | If using fetch-sid | Org password |
| `SF_SECURITY_TOKEN` | Optional | Appended to password for non-IP-whitelisted users |

**Examples:**
```env
# Demo Sales
SF_LOGIN_URL=https://demosales.my.salesforce.com

# Sandbox
SF_LOGIN_URL=https://demosales--sdo1intqa.sandbox.my.salesforce.com
```

---

### 1.4 Org namespace prefix

| Variable | Required | How to set |
|---|---|---|
| `SF_ORG_PREFIX` | **Yes** | Managed package namespace (usually `StrataVAR`) |

Used throughout tests for:
- Custom field API names (`StrataVAR__CustomerBoM__c`)
- Lightning component selectors
- jsforce SOQL queries

**Verify:** Open any StrataVAR record in the target org → confirm field prefix matches `SF_ORG_PREFIX`.

---

### 1.5 SF_VARS (CI / fallback blob)

| Variable | Required | How to set |
|---|---|---|
| `SF_VARS` | CI: Yes / Local: Optional | JSON string with org-related keys |

**Local `.env` example:**
```env
SF_VARS={"SF_INSTANCE_URL":"https://demosales.my.salesforce.com","SF_OPPORTUNITY_NAME":"Sitangshu Test"}
```

**CI behaviour:** Bitbucket stores org config inside `SF_VARS`. Keys are copied into `process.env` only when not already set locally.

**On org switch:** Update `SF_VARS` in Bitbucket pipeline variables to match the new org. Do **not** leave stale `SF_INSTANCE_URL` or `SF_SESSION_ID` from a previous org inside the JSON.

---

### 1.6 BoM distributor login (if running BoM tests)

| Variable | Required | When used |
|---|---|---|
| `AUTH_USERNAME` | BoM tests | Distributor portal login |
| `AUTH_PASSWORD` | BoM tests | Distributor portal password |

Update these if the distributor credentials differ per environment.

---

## Step 2 — Update Excel test data sheet names

Each test suite reads data from an Excel file using a **sheet tab name** from `.env`. Sheet names are **org-specific** — they must match the tab name in the Excel workbook for your target environment.

| Env variable | Test area | Excel file |
|---|---|---|
| `BOM_IMPORT_SHEET_NAME` | BoM import | `assets/TestData_with_BoM_Type.xlsx` |
| `SET_GROUPING_SHEET_NAME` | Set grouping | `assets/Edit_Quote_Data.xlsx` |
| `CLONE_SHEET_NAME` | Clone boxes | `assets/Edit_Quote_Data.xlsx` |
| `SPLIT_SHEET_NAME` | Split boxes | `assets/Edit_Quote_Data.xlsx` |
| `EQG_SHEET_NAME` | Edit Quote Grid | `assets/Edit_Quote_Data.xlsx` |
| `BULK_EDIT_SHEET_NAME` | Bulk edit | `assets/Edit_Quote_Data.xlsx` |
| `MASTER_ITEM_SHEET_NAME` | Copy master items | `assets/Edit_Quote_Data.xlsx` |
| `CREATE_QUOTE_SHEET_NAME` | Create quote | `assets/CreateQuoteTestData.xlsx` |
| `CREATE_NEW_VERSION_SHEET_NAME` | Create new version | `assets/CreateNewVersion_SaveAsNewQuote.xlsx` |
| `SAVE_AS_NEW_QUOTE_SHEET_NAME` | Save as new quote | `assets/CreateNewVersion_SaveAsNewQuote.xlsx` |
| `SEARCH_QUOTES_SERVER_SHEET_NAME` | Search quotes (server) | `assets/SearchQuoteAndSearchQuoteItems.xlsx` |
| `SEARCH_QUOTES_CLIENT_SHEET_NAME` | Search quotes (client) | `assets/SearchQuoteAndSearchQuoteItems.xlsx` |
| `SEARCH_QUOTE_ITEMS_SERVER_SHEET_NAME` | Search quote items (server) | `assets/SearchQuoteAndSearchQuoteItems.xlsx` |
| `SEARCH_QUOTE_ITEMS_CLIENT_SHEET_NAME` | Search quote items (client) | `assets/SearchQuoteAndSearchQuoteItems.xlsx` |
| `SHIP_TO_SHEET_NAME` | Ship-to assignment | `assets/Edit_Quote_Data.xlsx` |
| `SHIP_TO_SINGLE_SHEET_NAME` | Ship-to (single) | `assets/Edit_Quote_Data.xlsx` |
| `SUPP_SHEET` | Supplier assignment | `assets/Edit_Quote_Data.xlsx` |
| `SUPP_SINGLE_SHEET` | Supplier (single) | `assets/Edit_Quote_Data.xlsx` |

**Format in `.env`:**
```env
BOM_IMPORT_SHEET_NAME=Testing Sheet demo Sales
CREATE_QUOTE_SHEET_NAME=createQuote DemoSales
```

**Rules:**
- Use plain `KEY=value` format — **not** JSON fragments
- Do not comment out required sheet names
- Open the Excel file and verify the tab name matches **exactly** (case and spacing)

**Example sheet names by org:**

| Org | Example `BOM_IMPORT_SHEET_NAME` |
|---|---|
| Demo Sales | `Testing Sheet demo Sales` |
| Demo Int QA | `Testing Sheet demo int qa` |

---

## Step 3 — Update test data records (if needed)

Switching orgs often means **different Salesforce record IDs** in Excel (Opportunity Id, Quote Id, etc.).

- [ ] Open the Excel file for your test suite
- [ ] Confirm the active sheet tab matches the env variable
- [ ] Verify Opportunity / Quote / Account IDs exist in the **target org**
- [ ] Update expected pricing values if org data differs

---

## Step 4 — Clear cached browser auth state

Playwright caches login cookies in `state.chromium.json`. After changing org or session, **delete this file** so `globalSetup` rebuilds it.

```bash
# PowerShell
Remove-Item state.chromium.json

# Then run any test — globalSetup recreates the file
npx playwright test tests/example.spec.ts
```

**When to delete `state.chromium.json`:**
- After changing `SF_SESSION_ID`
- After changing `SF_INSTANCE_URL`
- After switching orgs
- When tests open the wrong org despite correct `.env`

---

## Step 5 — CPI specs (same org as main suite)

CPI Search / Configuration / Calculation live under `tests/cpi/`. Future CPI specs belong in that folder only.

They use the **same** auth as every other suite:

| Variable | Purpose |
|---|---|
| `SF_INSTANCE_URL` | Org URL (same as BoM / Quote / etc.) |
| `SF_SESSION_ID` | Session → `state.chromium.json` via globalSetup |
| `SF_ORG_PREFIX` | Namespace for CPI tab URLs and SOQL |

Optional Excel SKUs (if used by data): `CPI_VALID_SKU` / `CPI_SERVICES_SKU`.

Do **not** set `CPI_SF_*` auth variables — they are obsolete.

Run examples:
```bash
npx playwright test tests/cpi
npx playwright test tests/cpi/cpiSearch.spec.ts
```

---

## Step 6 — CI / Bitbucket pipeline variables

When changing org for pipeline runs:

| Item | Action |
|---|---|
| `SF_VARS` | Update JSON with new org URL, session, sheet names, credentials |
| `SF_ORG_PREFIX` | Confirm namespace in `SF_VARS` or as pipeline variable |
| Sheet name keys | Include all `*_SHEET_NAME` variables inside `SF_VARS` for CI |
| Secrets | Rotate session IDs and passwords in Bitbucket secured variables |

Local `.env` values take precedence over `SF_VARS` when both are set (except keys not defined locally).

---

## Step 7 — Verify the switch

Run these checks after updating configuration:

### 7.1 Confirm env values loaded

```bash
node -e "require('dotenv').config(); console.log('URL:', process.env.SF_INSTANCE_URL); console.log('Prefix:', process.env.SF_ORG_PREFIX); console.log('Sheet:', process.env.BOM_IMPORT_SHEET_NAME);"
```

**Expected:**
- URL ends with `.my.salesforce.com` (not `.lightning.force.com`)
- Only one URL value printed
- Sheet name matches your target org

### 7.2 Confirm tests are discoverable

```bash
npx playwright test tests/bom/testBoM.spec.ts --list
```

**Expected:** Tests listed without `getRequiredEnv` / sheet name errors.

### 7.3 Run a smoke test

```bash
npx playwright test tests/example.spec.ts
```

Or run one tagged test from your target suite.

### 7.4 Confirm correct org in browser

During test run, verify:
- [ ] Browser opens the **expected org name** (top-left in Lightning)
- [ ] URL domain matches target environment
- [ ] Test records (Opportunity / Quote) load without "Record not found"

---

## Common mistakes and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Tests open **Demo Int QA** instead of Demo Sales | Session ID is from a different org | Get new `SF_SESSION_ID` from target org |
| `lightning URLs are not valid as instance URLs` | `SF_INSTANCE_URL` uses `.lightning.force.com` | Use `*.my.salesforce.com` format |
| `BOM_IMPORT_SHEET_NAME is not set` | Sheet name commented out or invalid `.env` syntax | Use `KEY=value` format; uncomment/set sheet names |
| `No tests found` / test discovery fails | Missing env vars at module load | Fix `.env`; reload IDE |
| Wrong pricing / record not found | Excel has IDs from old org | Update Excel data for new org |
| Auth works in CLI but wrong org in UI | Stale `state.chromium.json` | Delete file and re-run tests |
| Multiple org configs conflicting | Duplicate `SF_INSTANCE_URL` lines or stale `SF_VARS` | Keep one active URL; align `SF_VARS` |
| jsforce / API calls fail | Session expired | Refresh via `fetch-sid.ts` or manual `sid` |

---

## `.env` template for org switch

Copy and fill in for your target org:

```env
# ── Main Salesforce org ──────────────────────────────────
SF_INSTANCE_URL=https://<org>.my.salesforce.com
SF_LOGIN_URL=https://<org>.my.salesforce.com
SF_SESSION_ID=<sid-from-target-org>
SF_ORG_PREFIX=StrataVAR
SF_USERNAME=<username>
SF_PASSWORD=<password>
SF_SECURITY_TOKEN=

SF_VARS={"SF_INSTANCE_URL":"https://<org>.my.salesforce.com","SF_OPPORTUNITY_NAME":"<test-opportunity-name>"}

# ── Excel sheet names (match Excel tab names exactly) ─────
BOM_IMPORT_SHEET_NAME=<sheet-name>
CREATE_QUOTE_SHEET_NAME=<sheet-name>
CREATE_NEW_VERSION_SHEET_NAME=<sheet-name>
SAVE_AS_NEW_QUOTE_SHEET_NAME=<sheet-name>
SET_GROUPING_SHEET_NAME=<sheet-name>
CLONE_SHEET_NAME=<sheet-name>
SPLIT_SHEET_NAME=<sheet-name>
EQG_SHEET_NAME=<sheet-name>
BULK_EDIT_SHEET_NAME=<sheet-name>
MASTER_ITEM_SHEET_NAME=<sheet-name>
SEARCH_QUOTES_SERVER_SHEET_NAME=<sheet-name>
SEARCH_QUOTES_CLIENT_SHEET_NAME=<sheet-name>
SEARCH_QUOTE_ITEMS_SERVER_SHEET_NAME=<sheet-name>
SEARCH_QUOTE_ITEMS_CLIENT_SHEET_NAME=<sheet-name>
SHIP_TO_SHEET_NAME=<sheet-name>
SHIP_TO_SINGLE_SHEET_NAME=<sheet-name>
SUPP_SHEET=<sheet-name>
SUPP_SINGLE_SHEET=<sheet-name>

# ── BoM distributor auth (if applicable) ───────────────────
AUTH_USERNAME=<username>
AUTH_PASSWORD=<password>
```

---

## Files affected by org switch

| File / artifact | Action on org change |
|---|---|
| `.env` | Update all org + sheet variables |
| `state.chromium.json` | **Delete** (auto-regenerated) |
| `assets/*.xlsx` | Verify/update record IDs and sheet tabs |
| Bitbucket `SF_VARS` | Update for CI runs |
| `playwright.config.ts` | No change needed (reads from env) |
| `globalSetup.ts` | No change needed (reads from env) |

---

## Related documentation

- Local troubleshooting: `docs/troubleshooting.md`
- Session fetch script: `fetch-sid.ts`
- Env helpers: `utils/envConfig.ts`
- Global auth setup: `integration/sf/globalSetup.ts`

---

## Document history

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-08-24 | Automation Team | Initial checklist based on Demo Sales / Demo Int QA switch issues |
