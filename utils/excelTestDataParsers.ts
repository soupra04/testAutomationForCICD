/**
 * Generic parsers/mappers for Zephyr Excel Test Data / Expected Result cells.
 * Prefer extending this module over adding feature-specific *Data.ts helpers.
 */

/** Join multi-step Excel cells into one normalized string. */
export function joinedExcelText(values: string | string[]): string {
  return (Array.isArray(values) ? values : [values]).join(' ').replace(/\s+/g, ' ').trim();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract "double" or 'single' quoted phrases from Excel expected/test text. */
export function extractQuotedStrings(text: string | string[]): string[] {
  const source = joinedExcelText(text);
  const matches = [...source.matchAll(/"([^"]+)"|'([^']+)'/g)];
  return matches
    .map((m) => (m[1] ?? m[2] ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Build a case-insensitive RegExp from the first quoted Excel phrase (preferred). */
export function patternFromQuotedExpected(
  expectedResults: string | string[],
  fallbackSubstring?: string
): RegExp {
  const quoted = extractQuotedStrings(expectedResults);
  const phrase = quoted[0] || fallbackSubstring || joinedExcelText(expectedResults).slice(0, 80);
  if (!phrase) throw new Error('No expected phrase available to build assertion pattern');
  return new RegExp(escapeRegExp(phrase.replace(/\s+/g, ' ').trim()), 'i');
}

/**
 * Prefer a quoted toast/success phrase; otherwise derive a pattern from Excel wording.
 * Works for CPI Search/Config and any suite that quotes UI toast copy in Expected Result.
 */
export function toastPatternFromExpected(expectedResults: string | string[]): RegExp {
  const quoted = extractQuotedStrings(expectedResults);
  const toastLike = quoted.find((q) =>
    /updated|success|saved|enabled specialization|already active|item\(s\)|changes saved|no matching|cpi estimate|eligible quote items|batch has been started/i.test(
      q
    )
  );
  if (toastLike) {
    const normalized = toastLike.replace(/\s+/g, ' ').trim();
    // Excel often combines toast title + body ("Success Changes saved.")
    if (/success/i.test(normalized) && /saved|updated/i.test(normalized)) {
      return /success|changes\s*saved|saved|updated/i;
    }
    // Title + body may use em dash, en dash, or hyphen between segments
    if (/success/i.test(normalized) && /cpi estimate calculation completed/i.test(normalized)) {
      return /success[\s—–-]*cpi estimate calculation completed/i;
    }
    return new RegExp(escapeRegExp(normalized), 'i');
  }

  const text = joinedExcelText(expectedResults);
  const active = text.match(/A PVI record[\s\S]*?inserting\.?/i);
  if (active) return new RegExp(escapeRegExp(active[0].replace(/\s+/g, ' ').trim()), 'i');

  if (/no eligible quote items were found for cpi estimate/i.test(text)) {
    return /no eligible quote items were found for cpi estimate/i;
  }
  if (/cpi estimate calculation completed/i.test(text)) {
    return /cpi estimate calculation completed/i;
  }
  if (/cpi recalculation has been queued|cpi recalculation was successfully completed/i.test(text)) {
    return /cpi recalculation has been queued|cpi recalculation was successfully completed|success/i;
  }
  if (/no quote line items found for the selected quote/i.test(text)) {
    return /no quote line items found/i;
  }
  if (/cpi effective date is empty/i.test(text)) {
    return /cpi effective date is empty/i;
  }
  // Prefer realtime "success toast" over dialog copy that mentions email notify option
  if (
    /success\s+toast/i.test(text) &&
    (/i will wait|real\s*time|loading screen|finished executing/i.test(text) ||
      !/batch has been started/i.test(text))
  ) {
    return /cpi estimate calculation completed|success/i;
  }
  if (/batch has been started|notified via mail/i.test(text)) {
    return /batch has been started|notified|email|cpi estimate/i;
  }

  if (/success toast|saved successfully|success message|will be saved|toast/i.test(text)) {
    const parts = ['success', 'saved', 'updated', 'toast', 'batch', 'cpi estimate'].filter((w) =>
      new RegExp(w, 'i').test(text)
    );
    if (parts.length) return new RegExp(parts.join('|'), 'i');
  }

  throw new Error(`Unable to derive toast assertion pattern from Excel expected results: ${text}`);
}

/** Quote number from Zephyr cells: `QT-000001029` or `Quote Id = QT-…`. */
export function parseQuoteIdFromTestData(values: string | string[]): string | undefined {
  const labeled = parseLabeledValue(values, ['Quote Id', 'Quote', 'Quote Number', 'Quote Name']);
  if (labeled && /^QT-/i.test(labeled)) return labeled.trim();

  const list = Array.isArray(values) ? values : [values];
  for (const raw of list) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    const match = value.match(/\b(QT-\d+)\b/i);
    if (match) return match[1];
  }
  return undefined;
}

/** Opportunity name from Test Data (e.g. `Oppo1_Aone` or `Opportunity = …`). */
export function parseOpportunityNameFromTestData(
  values: string | string[]
): string | undefined {
  const labeled = parseLabeledValue(values, ['Opportunity', 'Opportunity Name', 'Opp']);
  if (labeled) return labeled.trim();

  const list = Array.isArray(values) ? values : [values];
  for (const raw of list) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!value || /^QT-/i.test(value) || /^\d{5,}-\d+$/.test(value) || /[:=]/.test(value)) {
      continue;
    }
    return value;
  }
  return undefined;
}

/** BoM / deal id from Test Data (e.g. `85243852-4798085167` or `BoM = …`). */
export function parseBomIdFromTestData(values: string | string[]): string | undefined {
  const labeled = parseLabeledValue(values, ['BoM', 'BoM Id', 'BoM Name', 'MSDR']);
  if (labeled) return labeled.trim();

  const list = Array.isArray(values) ? values : [values];
  for (const raw of list) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    if (/^\d{5,}-\d+$/.test(value)) return value;
  }
  return undefined;
}

/** Strip URL / HTML-link noise from Excel cells (e.g. `E3C-EP-CME\\n<https://…>`). */
export function stripExcelUrlNoise(raw: string): string {
  return String(raw || '')
    .split(/\r?\n/)[0]
    .replace(/<https?:\/\/[^>\s]+>/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Line Number from Test Data (e.g. `Line Number = 3` or bare integer cell). */
export function parseLineNumberFromTestData(values: string | string[]): string | undefined {
  const labeled = parseLabeledValue(values, [
    'Line Number',
    'Line_Number',
    'Line Item',
    'Line Item Number',
  ]);
  if (labeled) return labeled.trim();

  const list = Array.isArray(values) ? values : [values];
  for (const raw of list) {
    const value = String(raw || '').trim();
    if (!/^\d+$/.test(value)) continue;
    if (/^QT-/i.test(value)) continue;
    if (/^\d{5,}-\d+$/.test(value)) continue;
    return value;
  }
  return undefined;
}

/** Part Number or Line Number for Copy BoM Items row selection. */
export function parseLineItemFromTestData(values: string | string[]): string | undefined {
  return parsePartNumberFromTestData(values) ?? parseLineNumberFromTestData(values);
}

/** Part Number value from Test Data (e.g. `Part_ABC` or `Part Number = …`). */
export function parsePartNumberFromTestData(values: string | string[]): string | undefined {
  const labeled = parseLabeledValue(values, ['Part Number', 'Part_Number', 'Part No']);
  if (labeled) return stripExcelUrlNoise(labeled);

  const be = parseBusinessEntity(values);
  const list = Array.isArray(values) ? values : [values];
  const candidates: string[] = [];
  for (const raw of list) {
    const value = stripExcelUrlNoise(String(raw || ''));
    if (!value || /^QT-/i.test(value) || /^\d{5,}-\d+$/.test(value) || /^\d+(\.\d+)?$/.test(value)) {
      continue;
    }
    if (/[:=]/.test(value)) continue;
    if (be && value.toLowerCase() === be.toLowerCase()) continue;
    candidates.push(value);
  }
  // Prefer SKU-like tokens (hyphenated) over bare BE-style names.
  const skuLike = candidates.find(
    (c) => /[A-Za-z0-9]+-[A-Za-z0-9-]+/.test(c) && !/_BE$/i.test(c) && !/FILTER-BE/i.test(c)
  );
  return skuLike || candidates[0];
}

/** List Price from Test Data (`List Price = 100` or a bare numeric cell). */
export function parseListPriceFromTestData(values: string | string[]): string | undefined {
  const labeled = parseLabeledValue(values, ['List Price', 'List_Price', 'Price']);
  if (labeled && /^\d+(\.\d+)?$/.test(labeled.trim())) return labeled.trim();

  const list = Array.isArray(values) ? values : [values];
  for (let i = list.length - 1; i >= 0; i--) {
    const value = stripExcelUrlNoise(String(list[i] || ''));
    if (/^\d+(\.\d+)?$/.test(value)) return value;
  }
  return undefined;
}

/** CCWR Aggregated Import BoM values from Zephyr Test Data cells (PQW-T5016). */
export type CcwrImportTestData = {
  ccwrQuoteId: string;
  source: string;
  profile: string;
  aggregatedBy: string;
  modeOfImport: string;
  bomType: string;
};

/** Parse CCWR Import wizard inputs from Excel Test Data (positional + labeled). */
export function parseCcwrImportFromTestData(values: string | string[]): CcwrImportTestData {
  const list = Array.isArray(values) ? values : [values];
  const ccwrQuoteId =
    list.find((v) => /^\d{6,}$/.test(String(v).trim())) ||
    parseLabeledValue(list, ['Quote Id', 'GDT CCWR Quote Id', 'CCWR Quote Id']) ||
    '471851166';
  const profile =
    list.find((v) => /ccwr api profile/i.test(String(v))) ||
    parseLabeledValue(list, ['Profile', 'CCWR API Profile']) ||
    'CCWR API Profile';
  const source =
    list.find((v) => /^all$/i.test(String(v).trim())) ||
    parseLabeledValue(list, ['Source']) ||
    'All';
  const aggregatedBy =
    parseLabeledValue(list, ['Quote Aggregated By', 'Quote Aggregated by']) ||
    source ||
    'All';

  return {
    ccwrQuoteId: String(ccwrQuoteId).trim(),
    source: String(source).trim(),
    profile: String(profile).trim(),
    aggregatedBy: String(aggregatedBy).trim(),
    modeOfImport: 'API',
    bomType: 'CCWR Quote',
  };
}

/** BQM job name fragment expected for CPI calculation batches. */
export function cpiQuoteCalculationBatchPattern(
  expectedResults?: string | string[]
): RegExp {
  const text = expectedResults ? joinedExcelText(expectedResults) : '';
  const tokens: string[] = [];
  if (/CPIQuoteCalculationBatch/i.test(text)) {
    tokens.push('CPIQuoteCalculationBatch', 'CpiQuoteItemCalculationBatch', 'CPI\\s*Estimate\\s*Calculation');
  }
  if (/CPI estimate|Calculate CPIEstimate|QuoteItem CPI estimate/i.test(text)) {
    tokens.push(
      'Calculate\\s*CPIEstimate',
      'CPI\\s*Estimate',
      'enqueueCpiEstimate',
      'CpiQuoteItemCalculationBatch',
      'CPI\\s*Estimate\\s*Calculation'
    );
  }
  if (tokens.length) {
    return new RegExp(tokens.join('|'), 'i');
  }
  return /CPIQuoteCalculationBatch|CpiQuoteItemCalculationBatch|CPI\s*Estimate\s*Calculation|Calculate\s*CPIEstimate|CPI\s*Estimate|Calculate\s*CPI/i;
}

/**
 * Estimate CPI async dialog body pattern from Excel Expected Result
 * (e.g. "more than 100" / "line items").
 */
export function estimateCpiDialogPatternFromExpected(
  expectedResults: string | string[]
): RegExp {
  const text = joinedExcelText(expectedResults);
  if (/more than 100/i.test(text) && /line items/i.test(text)) {
    return /more than 100|line items/i;
  }
  if (/more than 100/i.test(text)) return /more than 100/i;
  if (/line items/i.test(text)) return /line items/i;
  if (/Estimate CPI/i.test(text)) return /Estimate CPI/i;
  throw new Error(
    `Unable to derive Estimate CPI dialog pattern from Excel expected results: ${text}`
  );
}

/**
 * Estimated CPI Calculation Status from Excel Expected Result.
 * Supports `Status = Calculated`, `Status will be 'Not Calculated'`, or quoted status near the label.
 */
export function parseEstimatedCpiItemStatusFromExpected(
  expectedResults: string | string[]
): RegExp {
  const text = joinedExcelText(expectedResults);
  const eqMatch = text.match(
    /Estimated\s+CPI\s+Calculation\s+Status\s*=\s*['"]?([A-Za-z][A-Za-z0-9_ /\-]*)['"]?/i
  );
  if (eqMatch?.[1]) {
    return new RegExp(escapeRegExp(eqMatch[1].trim()), 'i');
  }
  const willBe = text.match(
    /Estimated\s+CPI\s+Calculation\s+Status\s+will\s+be\s+['"]([^'"]+)['"]/i
  );
  if (willBe?.[1]) {
    return new RegExp(escapeRegExp(willBe[1].trim()), 'i');
  }
  if (/Estimated\s+CPI\s+Calculation\s+Status/i.test(text)) {
    const quoted = extractQuotedStrings(text).find((q) =>
      /not\s+calculated|calculated|in\s*progress|failed|pending/i.test(q)
    );
    if (quoted) return new RegExp(escapeRegExp(quoted), 'i');
  }
  throw new Error(
    `Unable to parse Estimated CPI Calculation Status from Excel expected results: ${text}`
  );
}

/** `Estimated CPI Rebate Status = Valid` from Excel Expected Result. */
export function parseEstimatedCpiRebateStatusFromExpected(
  expectedResults: string | string[]
): RegExp {
  const text = joinedExcelText(expectedResults);
  const match = text.match(
    /Estimated\s+CPI\s+Rebate\s+Status\s*=\s*([A-Za-z][A-Za-z0-9_/]*)/i
  );
  if (match?.[1]) {
    return new RegExp(escapeRegExp(match[1].trim()), 'i');
  }
  throw new Error(
    `Unable to parse Estimated CPI Rebate Status from Excel expected results: ${text}`
  );
}

/**
 * Quote/header Estimated CPI field labels that Excel expects to be populated
 * (labels that appear with `=` in Expected Result).
 */
export function parseEstimatedCpiHeaderLabelsFromExpected(
  expectedResults: string | string[]
): string[] {
  const text = joinedExcelText(expectedResults);
  const labels = [
    'Estimated CPI Rebate Status',
    'Estimated CPI Total Amount',
    'Estimated CPI Total Base Land Amount',
    'Estimated CPI Total Accelerator Amount',
  ];
  const found = labels.filter((label) =>
    new RegExp(escapeRegExp(label), 'i').test(text)
  );
  if (!found.length) {
    throw new Error(
      `Unable to parse Estimated CPI header field labels from Excel expected results: ${text}`
    );
  }
  return found;
}

/** Quote Item number from Zephyr cells: `QTITM-001738973` or `Quote Item = QTITM-…`. */
export function parseQuoteItemNameFromTestData(values: string | string[]): string | undefined {
  const labeled = parseLabeledValue(values, ['Quote Item', 'Quote Item Name', 'Quote Item Id']);
  if (labeled && /^QTITM-/i.test(labeled)) return labeled.trim();

  const list = Array.isArray(values) ? values : [values];
  for (const raw of list) {
    const match = String(raw || '').match(/\b(QTITM-\d+)\b/i);
    if (match) return match[1];
  }
  return undefined;
}

/** Expected Selected Portfolio (e.g. Cisco Collaboration) from Excel Expected Result step. */
export function parseEstimatedCpiPortfolioFromExpected(
  expectedResults: string | string[]
): string | undefined {
  const list = Array.isArray(expectedResults) ? expectedResults : [expectedResults];
  for (const raw of list) {
    const value = String(raw || '').replace(/\s+/g, ' ').replace(/\.$/, '').trim();
    const labeled = value.match(
      /Estimated\s+CPI\s+Selected\s+Portfolio\s*=\s*(.+)/i
    );
    if (labeled?.[1]) return labeled[1].replace(/[."]+$/g, '').trim();
    const ciscoPortfolio = value.match(
      /^Cisco\s+(Collaboration|Security|Networking|Cloud\s*\+\s*AI\s*Infrastructure)$/i
    );
    if (ciscoPortfolio) {
      return value.replace(/\s+/g, ' ').trim();
    }
  }
  return undefined;
}

/** Expected PVI Tier (e.g. Preferred) from Excel Expected Result step. */
export function parseEstimatedCpiPviTierFromExpected(
  expectedResults: string | string[]
): RegExp | undefined {
  const list = Array.isArray(expectedResults) ? expectedResults : [expectedResults];
  for (const raw of list) {
    const value = String(raw || '').replace(/\s+/g, ' ').replace(/\.$/, '').trim();
    const labeled = value.match(/Estimated\s+CPI\s+PVI\s+Tier\s*=\s*(.+)/i);
    if (labeled?.[1]) {
      return new RegExp(escapeRegExp(labeled[1].replace(/[."]+$/g, '').trim()), 'i');
    }
    if (/^Preferred$/i.test(value)) return /Preferred/i;
    if (/^Partner$/i.test(value)) return /Partner/i;
    if (/^Not Eligible$/i.test(value)) return /Not Eligible/i;
    if (/^Not Applicable$/i.test(value)) return /Not Applicable/i;
  }
  return undefined;
}

/** EQG column API suffix from an Excel inline-edit step (e.g. VAR_Unit_Cost__c). */
export function parseEqgFieldApiFromStep(step: string): string {
  const text = step.replace(/\s+/g, ' ').trim();
  const apiMatch = text.match(/\b([A-Za-z0-9_]+__c)\b/);
  if (apiMatch?.[1]) return apiMatch[1];

  if (/var\s+unit\s+cost/i.test(text)) return 'VAR_Unit_Cost__c';
  if (/var\s+total\s+cost/i.test(text)) return 'VAR_Total_Cost__c';

  throw new Error(`Unable to derive EQG field API from Excel step: ${text}`);
}

/** Human-readable EQG column header from a field API suffix. */
export function eqgFieldLabelFromApi(fieldApi: string): string {
  return fieldApi
    .replace(/__c$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Inline-edit numeric value from Excel Test Data (excludes Quote / Quote Item ids). */
export function parseEqgInlineEditValueFromTestData(testData: string | string[]): string {
  const list = Array.isArray(testData) ? testData : [testData];
  for (const raw of list) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!value || /^QT-/i.test(value) || /^QTITM-/i.test(value)) continue;
    if (/^[\d,.]+$/.test(value)) return value.replace(/,/g, '');
  }
  throw new Error(
    `Inline-edit numeric value missing from Excel testData: ${list.join(' | ')}`
  );
}

/** Part number used for CPI field validation (from Cisco Excel Expected Result lines). */
export function parseCpiValidationPartNumberFromExpected(
  expectedResults: string | string[]
): string | undefined {
  const list = Array.isArray(expectedResults) ? expectedResults : [expectedResults];
  for (const raw of list) {
    const match = String(raw || '').match(/part\s*number\s+([A-Z0-9][A-Z0-9-]*)/i);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** Excel Expected Result requires Cisco rate matrix validation (not available in automation). */
export function expectsCiscoExcelRateValidation(expectedResults: string | string[]): boolean {
  return /cisco\s+excel/i.test(joinedExcelText(expectedResults));
}

/** Excel expects Estimated CPI Spec Bonus Percentage/Amount to be zero. */
export function expectsEstimatedCpiSpecBonusZero(expectedResults: string | string[]): boolean {
  const list = Array.isArray(expectedResults) ? expectedResults : [expectedResults];
  for (const raw of list) {
    const line = String(raw || '').replace(/\s+/g, ' ').trim();
    if (/^0\s+as\s+/i.test(line)) return true;
  }
  const text = joinedExcelText(expectedResults);
  return (
    /Spec\s+Bonus\s+Percentage\s+shows\s+0/i.test(text) ||
    /Spec\s+Bonus\s+Amount\s*=\s*0/i.test(text) ||
    /Spec\s+Bonus\s+Percentage\s*=\s*0/i.test(text) ||
    /Spec\s+Bonus\s+Amount[\s\S]*Percentage\s*=\s*0/i.test(text) ||
    /Spec\s+Bonus\s+Amount[\s\S]*Percentage\s*=\s*0\s*$/i.test(text)
  );
}

/** Manufacturer / Manufacturer Name from Test Data, Steps, or quoted Name text. */
export function parseManufacturerFromExcel(parts: {
  testData?: string | string[];
  steps?: string | string[];
  name?: string;
  precondition?: string;
}): string | undefined {
  const labeled = parseLabeledValue(parts.testData || [], [
    'Manufacturer Name',
    'Manufacturer',
  ]);
  if (labeled) return labeled.trim();

  const steps = Array.isArray(parts.steps) ? parts.steps : parts.steps ? [parts.steps] : [];
  const testData = Array.isArray(parts.testData)
    ? parts.testData
    : parts.testData
      ? [parts.testData]
      : [];

  const manufacturerChangeStep = steps.some(
    (step) =>
      /manufacturer\s*name|manufacturer_name__c|manufacturer__c|\bmanufacturer\s*\(/i.test(step) &&
      /change|update|set|\bto\b/i.test(step)
  );

  // testData omits blank cells (see excelTestCaseData), so scan values — e.g. T5001 → "Cisco".
  if (manufacturerChangeStep) {
    for (const raw of testData) {
      const data = stripExcelUrlNoise(String(raw || ''));
      if (
        data &&
        !/^QT-/i.test(data) &&
        !/^QTITM-/i.test(data) &&
        !/^\d{5,}-\d+$/.test(data)
      ) {
        return data;
      }
    }
  }

  const blob = joinedExcelText([
    ...(Array.isArray(parts.testData) ? parts.testData : parts.testData ? [parts.testData] : []),
    ...(Array.isArray(parts.steps) ? parts.steps : parts.steps ? [parts.steps] : []),
    parts.precondition || '',
    parts.name || '',
  ]);

  const toMatch = blob.match(
    /manufacturer\s*name[\s\S]*?\bto\s+([A-Za-z0-9_.-]+)/i
  );
  if (toMatch?.[1]) return toMatch[1].trim();

  // Excel phrasing: "Cisco-name manufacturer record"
  const ciscoName = blob.match(/\b(Cisco)[- ]name\s+manufacturer/i);
  if (ciscoName?.[1]) return ciscoName[1];

  const quoted = extractQuotedStrings(blob).find(
    (q) => q && !/^QT-/i.test(q) && q.length < 80 && !/Estimate CPI/i.test(q)
  );
  if (quoted && /manufacturer/i.test(blob)) return quoted;

  return undefined;
}

/** Known Quote Status picklist labels (avoid substring matches like "Open" in step prose). */
const QUOTE_STATUS_LABEL =
  /^(Won|won|Draft|Open|Lost|Accepted|Approval(?:\s+in\s+Progress)?|--None--)$/i;

/**
 * Quote Status / Stage value from Excel (e.g. Name/Step containing 'Won').
 */
export function parseQuoteStatusFromExcel(parts: {
  testData?: string | string[];
  steps?: string | string[];
  name?: string;
  expectedResults?: string | string[];
}): string {
  const labeled = parseLabeledValue(parts.testData || [], [
    'Quote Status',
    'Status',
    'Stage',
  ]);
  if (labeled) return labeled.trim();

  const blob = joinedExcelText([
    ...(Array.isArray(parts.testData) ? parts.testData : parts.testData ? [parts.testData] : []),
    ...(Array.isArray(parts.steps) ? parts.steps : parts.steps ? [parts.steps] : []),
    ...(Array.isArray(parts.expectedResults)
      ? parts.expectedResults
      : parts.expectedResults
        ? [parts.expectedResults]
        : []),
    parts.name || '',
  ]);

  const stageMatch = blob.match(
    /(?:stage|status)\s+(?:field\s+)?(?:changes?\s+)?to\s+'([^']+)'/i
  );
  if (stageMatch?.[1]) return stageMatch[1].trim();

  const quoted = extractQuotedStrings(blob).find((q) => QUOTE_STATUS_LABEL.test(q.trim()));
  if (quoted) return quoted.trim();

  const nameMatch = (parts.name || '').match(/\b(Won|Draft|Open|Lost|Accepted)\b/i);
  if (nameMatch?.[1]) return nameMatch[1];

  throw new Error(
    `Unable to parse Quote Status/Stage from Excel name/steps/testData: ${blob.slice(0, 200)}`
  );
}

/** True when Excel Expected Result says no BQM / recalculation job should start. */
export function expectsNoBqmJob(expectedResults: string | string[]): boolean {
  const text = joinedExcelText(expectedResults);
  return /no\s+bqm\s+job|no\s+recalculation\s+job|should not start/i.test(text);
}

/** Quoted inline/validation error phrase from Expected Result. */
export function inlineErrorPatternFromExpected(expectedResults: string | string[]): RegExp {
  const quoted = extractQuotedStrings(expectedResults);
  const errorLike =
    quoted.find((q) =>
      /applicable pvi|decimal|incorrect input|between|character|required|invalid/i.test(q)
    ) || quoted[0];
  if (errorLike) return new RegExp(escapeRegExp(errorLike.replace(/\.*$/, '')), 'i');
  return patternFromQuotedExpected(expectedResults);
}

/**
 * Extract `Label = value` / `Label: value` from Test Data.
 * Labels are matched case-insensitively; value stops at `,` or `;`.
 */
export function parseLabeledValue(
  values: string | string[],
  labels: string | string[]
): string | undefined {
  const text = joinedExcelText(values);
  const labelList = Array.isArray(labels) ? labels : [labels];
  for (const label of labelList) {
    const escaped = escapeRegExp(label).replace(/\s+/g, '\\s*');
    const match = text.match(new RegExp(`${escaped}\\s*[:=]\\s*([^,;]+)`, 'i'));
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

/** Extract a numeric limit from values like "500", "Limit: 100", "All Portfolios; Limit = 1000" */
export function parseLimitFromTestData(values: string | string[]): string | undefined {
  const labeled = parseLabeledValue(values, 'Limit');
  if (labeled && /^\d+$/.test(labeled)) return labeled;

  const list = Array.isArray(values) ? values : [values];
  for (const value of list) {
    const match = value.match(/Limit\s*[:=]\s*(\d+)/i) || value.match(/^\s*(\d+)\s*$/);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Portfolio from Test Data:
 * - `portfolio = Cisco Security`
 * - combined cells like `All Portfolios; Limit = 1000`
 * - Config quirk: `PVI = 0.00 for BE: Cisco Security, ...` (portfolio labeled as BE)
 */
export function parsePortfolioFromTestData(values: string | string[]): string | undefined {
  const labeled = parseLabeledValue(values, ['portfolio', 'Cisco Portfolio']);
  if (labeled) return labeled;

  const text = joinedExcelText(values);
  const forBe = text.match(/for\s+BE\s*:\s*([^,;]+)/i);
  if (forBe?.[1] && /PVI\s*=/i.test(text)) return forBe[1].trim();

  const list = Array.isArray(values) ? values : [values];
  for (const value of list) {
    const portfolioPart = value.split(';')[0]?.trim();
    if (
      portfolioPart &&
      !/^\d+$/.test(portfolioPart) &&
      !/^Limit\s*[:=]/i.test(portfolioPart) &&
      !/[:=]/.test(portfolioPart)
    ) {
      return portfolioPart;
    }
  }
  return undefined;
}

/** Alias used by CPI Configuration specs. */
export const parsePortfolio = parsePortfolioFromTestData;

export function parseBusinessEntity(testData: string | string[]): string | undefined {
  const labeled = parseLabeledValue(testData, 'Business Entity');
  if (labeled) return labeled;

  const list = Array.isArray(testData) ? testData : [testData];
  for (const raw of list) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    const fromProse = parseBusinessEntityFromProse(value);
    if (fromProse) return fromProse;
    // Bare BE cell (e.g. StrataVAR_BE) — not a prose sentence
    if (value && !/[:=]/.test(value) && value.length < 80 && !/\s{2,}/.test(value)) {
      if (!/quote|portfolio|applicable|pvi|limit|today|update value/i.test(value)) {
        return value;
      }
    }
  }
  return undefined;
}

/** BE name embedded in Step / Precondition / Expected Result prose or SOQL. */
export function parseBusinessEntityFromProse(text: string): string | undefined {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;

  const patterns = [
    /Business Entity\s*[:=]\s*([A-Za-z0-9_-]+)/i,
    /Select\s+(?:a\s+)?Business Entity\s+([A-Za-z0-9_-]+)/i,
    /Select\s+Business Entity\s+([A-Za-z0-9_-]+)\s+from/i,
    /Select\s+BE\s+"([^"]+)"/i,
    /\bBE\s*=\s*"([^"]+)"/i,
    /under Business Entity\s+([A-Za-z0-9_-]+)/i,
    /Business_Entity__r\.name\s*=\s*'([^']+)'/i,
    /Business_Entity__r\.Name\s*=\s*'([^']+)'/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

type ExcelCaseFields = {
  key: string;
  testData: string[];
  steps?: string[];
  precondition?: string;
  expectedResults?: string[];
};

/** Business Entity for one Zephyr row — Test Data, then Step, Precondition, Expected Result. */
export function parseBusinessEntityFromCase(tc: ExcelCaseFields): string {
  const chunks = [
    ...tc.testData,
    ...(tc.steps ?? []),
    tc.precondition ?? '',
    ...(tc.expectedResults ?? []),
  ].filter(Boolean);

  for (const chunk of chunks) {
    const labeled = parseBusinessEntity([chunk]);
    if (labeled) return labeled;
    const prose = parseBusinessEntityFromProse(chunk);
    if (prose) return prose;
  }

  throw new Error(
    `Business Entity not found in Excel case ${tc.key}. Check Test Data, Step, or Precondition columns.`
  );
}

function looksLikePortfolioName(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 80) return false;
  if (/\b(update value|from \d|Applicable PVI|Quote under|PVI\s*=)/i.test(v)) return false;
  return true;
}

/** Portfolio for one Zephyr row — Test Data, then Step, Precondition. */
export function parsePortfolioFromCase(tc: ExcelCaseFields): string | undefined {
  for (const chunk of tc.testData) {
    const fromTestData = parsePortfolio([chunk]);
    if (fromTestData && looksLikePortfolioName(fromTestData)) return fromTestData;
  }

  for (const chunk of [...(tc.steps ?? []), tc.precondition ?? ''].filter(Boolean)) {
    const labeled = chunk.match(/(?:For\s+)?Portfolio\s*[:=]\s*([^,;\r\n]+)/i);
    if (labeled?.[1]) return labeled[1].trim();
  }
  return undefined;
}

export function requirePortfolioFromCase(tc: ExcelCaseFields): string {
  const portfolio = parsePortfolioFromCase(tc);
  if (!portfolio) {
    throw new Error(
      `Portfolio not found in Excel case ${tc.key}. Check Test Data, Step, or Precondition columns.`
    );
  }
  return portfolio;
}

export function parseEffectiveStartDate(testData: string | string[]): string | undefined {
  return parseLabeledValue(testData, [
    'Effective Start Date',
    'CPI start date',
    'start date',
    'Effective Date',
  ]);
}

export function parseApplicablePvi(testData: string | string[]): string {
  const labeled =
    parseLabeledValue(testData, ['Applicable PVI', 'PVI']) ||
    (() => {
      const text = joinedExcelText(testData);
      const bare = text.match(/^\s*([-\d.]+)\s*$/);
      return bare?.[1];
    })();
  if (!labeled) {
    throw new Error(`Unable to parse Applicable PVI from test data: ${joinedExcelText(testData)}`);
  }
  return labeled;
}

export function parseAllApplicablePviValues(testData: string[]): string[] {
  return testData.map((entry) => parseApplicablePvi(entry));
}

/** Excel "update value from 7.0 to 4.0." */
export function parsePviFromTo(testData: string | string[]): { from: string; to: string } {
  const text = joinedExcelText(testData);
  const match = text.match(/from\s+([-\d.]+)\s+to\s+([-\d.]+)/i);
  if (!match) throw new Error(`Unable to parse PVI from/to values from: ${text}`);
  return { from: match[1], to: match[2] };
}

/** Tier label from Excel expected text like: We will see "Partner" Tier */
export function parseTierFromExpected(expectedResults: string | string[]): RegExp {
  const text = joinedExcelText(expectedResults);
  const quotedTier = text.match(/"([^"]+)"\s*Tier/i);
  if (quotedTier?.[1]) {
    const tier = quotedTier[1].trim();
    return new RegExp(`^${escapeRegExp(tier)}$`, 'i');
  }
  const pviTier = text.match(/pvi_tier\s*=\s*'([^']+)'/i);
  if (pviTier?.[1]) {
    return new RegExp(escapeRegExp(pviTier[1].replace(/_/g, ' ')), 'i');
  }
  throw new Error(`Unable to parse tier from expected results: ${text}`);
}

/** Parse column header list from expected-result text ("columns: ..." or "columns shown are ..."). */
export function parseColumnHeadersFromExpected(expectedResults: string[]): string[] {
  const line = expectedResults.find((e) => /columns(?:\s*:\s*|\s+shown\s+are\s+)/i.test(e));
  if (!line) return [];
  const after = line.split(/columns(?:\s*:\s*|\s+shown\s+are\s+)/i)[1] ?? '';
  return after
    .replace(/\.$/, '')
    .split(',')
    .map((s) => s.trim().replace(/^and\s+/i, ''))
    .filter(Boolean);
}

/**
 * Normalize Excel / free-text dates to UI short form: "Jul 14, 2026"
 * (CPI field hint: Format: Dec 31, 2024)
 */
export function normalizeCpiEffectiveDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Effective Date value is empty');
  }

  const formatUi = (d: Date): string =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const uiMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (uiMatch) {
    const d = new Date(`${uiMatch[1]} ${uiMatch[2]}, ${uiMatch[3]}`);
    if (!Number.isNaN(d.getTime())) return formatUi(d);
  }

  const excelMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{2}|\d{4})$/);
  if (excelMatch) {
    const day = excelMatch[1];
    const month = excelMatch[2];
    const year = excelMatch[3].length === 2 ? `20${excelMatch[3]}` : excelMatch[3];
    const d = new Date(`${month} ${day}, ${year}`);
    if (!Number.isNaN(d.getTime())) return formatUi(d);
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return formatUi(parsed);

  throw new Error(`Unable to normalize Effective Date: "${value}"`);
}

/** Local calendar YYYY-MM-DD (avoids UTC shift from Date#toISOString). */
export function cpiEffectiveDateLocalIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Format a local Date to CPI UI short form ("Jul 14, 2026"). */
export function formatCpiEffectiveDateFromLocalDate(d: Date): string {
  return normalizeCpiEffectiveDate(cpiEffectiveDateLocalIso(d));
}

/** Normalize relative presets used in CPI tests ("today", "yesterday"). */
export function resolveCpiEffectiveDateInput(value: string | Date): string {
  if (value instanceof Date) {
    return formatCpiEffectiveDateFromLocalDate(value);
  }
  if (/today/i.test(value)) {
    return formatCpiEffectiveDateFromLocalDate(new Date());
  }
  if (/yesterday/i.test(value)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return formatCpiEffectiveDateFromLocalDate(d);
  }
  return normalizeCpiEffectiveDate(value);
}

/** Normalize numeric display values for comparison (4 / 4.0 / 4.00). */
export function normalizePviDisplay(value: string): string {
  const n = Number.parseFloat(String(value).trim());
  if (Number.isNaN(n)) return String(value).trim();
  return n.toFixed(2);
}

/** Extract a SOQL query from a single Excel expected-result cell. */
function extractSoqlFromText(text: string): string | undefined {
  const match =
    text.match(/SOQL:\s*(SELECT[\s\S]+)/i) ||
    text.match(/\b(SELECT\s+[\s\S]+?\bFROM\b[\s\S]+)/i);
  if (!match?.[1]) return undefined;

  return match[1]
    .replace(/\s+(It should validate[\s\S]*)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract SOQL query embedded in Excel Expected Result cells. */
export function parseSoqlFromExpected(expectedResults: string | string[]): string | undefined {
  const entries = (Array.isArray(expectedResults) ? expectedResults : [expectedResults])
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);

  // Prefer the cell that contains SOQL — joining all cells pulls in unrelated prose.
  for (const entry of entries) {
    if (!/SOQL:\s*SELECT/i.test(entry)) continue;
    const query = extractSoqlFromText(entry);
    if (query) return query;
  }

  return extractSoqlFromText(joinedExcelText(expectedResults));
}

/** All QT- quote numbers from multi-line Test Data cells. */
export function parseQuoteNumbersFromTestData(values: string | string[]): string[] {
  const list = Array.isArray(values) ? values : [values];
  const quotes = new Set<string>();
  for (const raw of list) {
    for (const match of String(raw || '').matchAll(/\b(QT-\d+)\b/gi)) {
      quotes.add(match[1]);
    }
  }
  return [...quotes];
}

/** Rebate Status from Test Data (Invalid / Valid / All). */
export function parseRebateStatusFromTestData(values: string | string[]): string | undefined {
  return parseLabeledValue(values, ['Rebate Status', 'Rebate_Status']);
}

/** Quote Status values from step-aligned Test Data rows. */
export function parseQuoteStatusValuesFromTestData(values: string | string[]): string[] {
  const list = Array.isArray(values) ? values : [values];
  return list
    .map((v) => parseLabeledValue([v], ['Quote Status', 'Status']) || String(v || '').trim())
    .filter(Boolean);
}

/** Opportunity Stage values from step-aligned Test Data rows. */
export function parseOpportunityStageValuesFromTestData(values: string | string[]): string[] {
  const list = Array.isArray(values) ? values : [values];
  return list
    .map(
      (v) =>
        parseLabeledValue([v], ['Opportunity Stage', 'Stage']) || String(v || '').trim()
    )
    .filter(Boolean);
}

/** Account name from Test Data (labeled or bare value on the Account filter step). */
export function parseAccountFromTestData(values: string | string[]): string | undefined {
  const labeled = parseLabeledValue(values, [
    'Account',
    'Account Name',
    'Account Filter',
    'accountFilter',
  ]);
  if (labeled) return labeled.trim();

  const list = Array.isArray(values) ? values : [values];
  for (const raw of list) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!value || /^QT-/i.test(value) || /^\d{5,}-\d+$/.test(value) || /[:=]/.test(value)) {
      continue;
    }
    if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(value)) continue;
    if (/^(won|lost|draft|invalid|valid|open|closed)$/i.test(value)) continue;
    return value;
  }
  return undefined;
}

/** Toast shown when selected quotes have no CPI-eligible line items. */
export function noEligibleQuoteItemsToastPattern(): RegExp {
  return /no eligible quote items were found for cpi estimate/i;
}

/** BQM / batch job name pattern for CPI Recalculation batches (derived from Excel Expected Result). */
export function cpiRecalculationBatchPattern(
  expectedResults?: string | string[]
): RegExp {
  const text = expectedResults ? joinedExcelText(expectedResults) : '';

  const quoted = extractQuotedStrings(expectedResults || '');
  const jobPhrase = quoted.find((q) => /batch|recalculation|cpi estimate|cpi/i.test(q));
  if (jobPhrase) {
    return new RegExp(escapeRegExp(jobPhrase.replace(/\s+/g, ' ').trim()), 'i');
  }

  const tokens: string[] = [];
  if (/CpiRecalculationService(?:\.startBatch)?/i.test(text)) {
    tokens.push('CpiRecalculationService', 'CpiRecalculation', 'CPI\\s*Recalculation');
  }
  if (/enqueueCpiEstimate/i.test(text)) {
    tokens.push('enqueueCpiEstimate', 'CPIQuoteCalculationBatch', 'CPI\\s*Estimate');
  }
  if (/CPIQuoteCalculationBatch/i.test(text)) {
    tokens.push('CPIQuoteCalculationBatch');
  }
  if (/recalculation batch/i.test(text)) {
    tokens.push('CpiRecalculation', 'CPI\\s*Recalculation', 'Recalculate\\s*CPI');
  }

  if (tokens.length) {
    return new RegExp(tokens.join('|'), 'i');
  }

  return /CpiRecalculation|CPI\s*Recalculation|Recalculate\s*CPI|CPIQuoteCalculationBatch/i;
}

/** Recalculate CPI confirmation dialog body pattern from Excel Expected Result. */
export function recalculateCpiDialogPatternFromExpected(
  expectedResults: string | string[]
): RegExp {
  const text = joinedExcelText(expectedResults);
  if (/Recalculate CPI/i.test(text)) return /Recalculate CPI|selected quote/i;
  if (/confirmation popup/i.test(text)) return /Recalculate CPI|confirm/i;
  throw new Error(
    `Unable to derive Recalculate CPI dialog pattern from Excel expected results: ${text}`
  );
}
