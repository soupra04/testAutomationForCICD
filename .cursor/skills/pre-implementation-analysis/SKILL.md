---

name: playwright-test-case-analysis
description: Use this skill whenever the user requests to create, write, generate, implement, automate, or modify Playwright + TypeScript automation test cases. This skill gathers the required information, waits for explicit approval before analysis, generates an impact analysis report, and waits for a second explicit approval before generating automation code.
---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# Skill Activation (Highest Priority)

This skill applies whenever the user's intent is to create, write, generate, implement, automate, or modify Playwright + TypeScript automation test cases.

Examples include :

* Write Test Case
* Write Test Cases
* Create Test Case
* Create Test Cases
* Generate Test Case
* Generate Test Cases
* Automate Test Case
* Automate Test Cases
* Implement Test Case
* Implement Test Cases
* Create Playwright Test
* Write Playwright Test
* Create Automation
* Write Automation
* Add Playwright Test
* Modify Playwright Test
* Update Test Case

If the user's request is **not** related to Playwright + TypeScript automation test cases:

* Do NOT gather information.
* Do NOT inspect project files.
* Do NOT search the repository.
* Do NOT use Playwright MCP.
* Do NOT generate a report.
* Do NOT generate any code.

This skill is not applicable. Stop.

---

# Mandatory Approval Gate (Second Highest Priority)

This skill has three mandatory phases.

Proceed to the next phase only after the previous phase has completed.

---

# Phase 1 – Collect Information

Before performing any analysis, verify that all required information has been provided.

## Required Inputs

### Mandatory

* Feature Name
* Test Steps / User Flow

### Conditional

* Target Page or URL (only if Playwright MCP is required)
* Test Data (Excel or other supported format, if applicable)

### Test Cases

The user may provide test cases in either of the following formats:

* Excel
* Plain text

If neither is provided:

* Ask the user whether they want you to generate the test cases.
* Do NOT generate test cases unless the user explicitly requests you to.

---

## Missing Information Rules

If any mandatory information is missing:

* Do NOT read any project files.
* Do NOT search the repository.
* Do NOT inspect the UI.
* Do NOT use Playwright MCP.
* Do NOT generate a report.
* Do NOT generate code.
* Ask only for the missing information.
* Stop.

---

## Information Complete

If all required information has been collected:

Do NOT:

* Read project files.
* Search the repository.
* Inspect Page Objects.
* Inspect Service classes.
* Inspect Utility classes.
* Use Playwright MCP.
* Generate a report.
* Generate code.

Reply only with:

All required information has been collected.

To begin the analysis, reply exactly:

GENERATE REPORT

Stop after this message.

---

# Phase 2 – Generate Analysis Report

Begin this phase only when the user's entire message is:

GENERATE REPORT

Do NOT infer approval from messages such as:

* Yes
* Okay
* Continue
* Proceed
* Go Ahead
* Analyze
* Create Report

These are **not** valid approvals.

---

## Repository Inspection Rules

Inspect only the files directly related to the requested feature.

Read only:

1. Relevant Page Object
2. Related Service class
3. Related Utility class

Read additional files only when they are directly referenced and absolutely necessary.

Never scan the entire repository.

Use Playwright MCP only when:

* Live UI verification is required.
* Selector verification is required.
* Accessibility roles are required.

If Playwright MCP is required and the user has not provided a URL, ask for the URL first.

---

## Generate the Report

Generate the report using exactly the following structure:

1. Reusable methods
2. Page Object to update
3. New locators required
4. Existing reusable locators/helpers
5. New methods needed
6. Regression risks

Generate only the report.

Do NOT generate code.

Stop after the report.

Reply with:

Analysis completed.

To begin implementation, reply exactly:

GENERATE CODE

---

# Phase 3 – Generate Automation Code

Begin this phase only when the user's entire message is:

GENERATE CODE

Do NOT infer approval from messages such as:

* Yes
* Continue
* Proceed
* Go Ahead
* Implement
* Start Coding

These are **not** valid approvals.

---

## Implementation Rules

Before creating anything new:

* Reuse existing methods whenever possible.
* Reuse existing locators whenever possible.
* Reuse existing helper methods whenever possible.

Modify existing classes instead of creating duplicate functionality.

Generate only the automation code requested by the user.

Do not generate additional reports or analyses during this phase.

---

# Excel Test Data Standard (Mandatory for New Suites)

For **new** Playwright + TypeScript suites driven by Excel/Zephyr, use **one fixed structure** and **generic utils**. Do not invent a new Excel layout or a new `*Data.ts` helper file per feature unless the report explicitly justifies it.

## Canonical Excel structure

Use the Zephyr export shape already loaded by `utils/excelTestCaseData.ts`:

| Column | Purpose |
|--------|---------|
| `Key` | Stable case id (e.g. `PQW-T4564`) |
| `Name` | Case title |
| `Test Script (Step-by-Step) - Test Data` | Inputs (may span multiple step rows) |
| `Test Script (Step-by-Step) - Expected Result` | Assertions / expected UI copy |

Register the file path once in `assets/test_data_constants.ts`.

Prefer structured **Test Data** cells so generic parsers work:

* `key = value` pairs (examples: `Business Entity = …`, `Portfolio = …`, `Applicable PVI = 1.00`, `Limit = 500`)
* Quoted UI strings in Expected Result for toasts/errors (examples: `"Changes saved."`)

Do **not** introduce Edit Quote Grid–style flat column maps (`Quote Id`, `BoM Source`, …) for new Zephyr suites. That pattern stays for existing EQG sheets only.

## Generic utils (prefer these; extend instead of cloning)

| Module | Responsibility |
|--------|----------------|
| `utils/excelReader.ts` | Low-level sheet access |
| `utils/excelTestCaseData.ts` | Zephyr load/map: `getExcelTestCases`, `requireExcelTestCase`, `requireExcelTestCaseByName`, `ExcelTestCaseData` |
| `utils/excelTestDataParsers.ts` | Shared parse/assert helpers: quoted phrases → RegExp, toast/error patterns, `key = value` extraction, limit/portfolio/date/PVI parsers, `escapeRegExp` |

When a parse/assert helper is reusable, **add or extend `excelTestDataParsers.ts`**. Do **not** copy helpers into product case-map files or invent a new parse module per feature.

Reference CPI case maps (thin Excel bindings only):

* `utils/cpiExcelCases.ts` — Search + Configuration Excel paths, `cpiCases` / `cpiConfigCases`, suite defaults

## What may stay feature-specific

Only keep a thin product case-map file (or inline in the spec) when something cannot be generic:

* Named case map for that suite (`beDropdown` → `PQW-T4564`) — still prefer **Key**-based lookup
* Page-specific formatting that is not Excel parsing (put on the page object, e.g. `CpiConfigurationPage.formatApplicablePviInput`)

Do **not** create a new full helper class/module per functionality just to load Excel or map Key/Name/testData/expectedResults — that already exists.

For additional Zephyr suites outside CPI, either extend `cpiExcelCases.ts` only if they share the same product area, or add one thin `<area>ExcelCases.ts` case-map file — never a second copy of parsers.

## Analysis / implementation checklist

During Phase 2 and Phase 3, explicitly check:

1. Can this suite use `excelTestCaseData` + `excelTestDataParsers` as-is?
2. Can new parsers live in `excelTestDataParsers.ts` instead of a new helper file?
3. Is Test Data written as parseable `key = value` / quoted expected text?
4. Prefer extending `cpiExcelCases.ts` (or one thin area case-map file) for path + named cases; put UI format quirks on the page object.

Call this out under **Reusable methods** and **New methods needed** in the analysis report.
