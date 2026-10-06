import path from 'path';
import { getExcelData } from './excelReader';

export interface ExcelTestCaseData {
  key: string;
  name: string;
  /** First-row Precondition cell for this Zephyr case */
  precondition: string;
  /** Non-empty values from "Test Script (Step-by-Step) - Step", in step order */
  steps: string[];
  /** Non-empty values from "Test Script (Step-by-Step) - Test Data", in step order */
  testData: string[];
  expectedResults: string[];
}

const STEP_COL = 'Test Script (Step-by-Step) - Step';
const TEST_DATA_COL = 'Test Script (Step-by-Step) - Test Data';
const EXPECTED_COL = 'Test Script (Step-by-Step) - Expected Result';
const DEFAULT_SHEET = 'Sheet0';

const cache = new Map<string, Record<string, ExcelTestCaseData>>();

/** Resolve Excel path from repo root so IDE / Test Runner cwd does not break discovery. */
export function resolveExcelPath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(__dirname, '..', filePath);
}

/**
 * Generic Zephyr Excel loader for sheets with Key / Name / Test Data / Expected Result columns.
 * Works for CPI Search, CPI Configuration, and any future suite using the same format.
 */
export function getExcelTestCases(
  filePath: string,
  sheetName: string = DEFAULT_SHEET
): Record<string, ExcelTestCaseData> {
  const resolvedPath = resolveExcelPath(filePath);
  const cacheKey = `${resolvedPath}::${sheetName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const sheet = getExcelData(resolvedPath, sheetName);
  const rows = sheet.getAllRows();
  const cases: Record<string, ExcelTestCaseData> = {};
  let currentKey = '';

  for (const row of rows) {
    const key = String(row.Key ?? '').trim();
    if (key) {
      currentKey = key;
      cases[currentKey] = {
        key: currentKey,
        name: String(row.Name ?? '').trim(),
        precondition: String(row.Precondition ?? '')
          .replace(/\r\n/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
        steps: [],
        testData: [],
        expectedResults: [],
      };
    }
    if (!currentKey || !cases[currentKey]) continue;

    if (row.Name) {
      cases[currentKey].name = String(row.Name).trim();
    }

    const step = String(row[STEP_COL] ?? '')
      .replace(/\r\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (step) {
      cases[currentKey].steps.push(step);
    }

    const data = String(row[TEST_DATA_COL] ?? '').trim();
    if (data) {
      cases[currentKey].testData.push(data);
    }

    const expected = String(row[EXPECTED_COL] ?? '')
      .replace(/\r\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (expected) {
      cases[currentKey].expectedResults.push(expected);
    }
  }

  cache.set(cacheKey, cases);
  return cases;
}

export function requireExcelTestCase(
  filePath: string,
  key: string,
  sheetName: string = DEFAULT_SHEET
): ExcelTestCaseData {
  const c = getExcelTestCases(filePath, sheetName)[key];
  if (!c) {
    throw new Error(`Test case ${key} not found in ${filePath} (sheet: ${sheetName})`);
  }
  return c;
}

export function requireExcelTestCaseByName(
  filePath: string,
  name: string,
  sheetName: string = DEFAULT_SHEET
): ExcelTestCaseData {
  const match = Object.values(getExcelTestCases(filePath, sheetName)).find((c) => c.name === name);
  if (!match) {
    throw new Error(`Test case not found in ${filePath} (sheet: ${sheetName}) for Name: ${name}`);
  }
  return match;
}
