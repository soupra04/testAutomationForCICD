import * as XLSX from "xlsx";
export function getExcelData(filePath: string, sheetName: string) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[sheetName];
  // Original column-based parsing
  const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

  // Row-based JSON string parsing (for special sheets like Split Boxes)
  const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  const parsedJsonRows: Record<string, any>[] = [];
  for (const row of rawRows) {
    const cell = row[0]; // JSON string in column A
    if (typeof cell !== "string") continue;

    let cleaned = cell
      .trim()
      .replace(/^[\uFEFF\xEF\xBB\xBF]+/, "") // remove BOM
      .replace(/\r?\n|\r/g, "")              // strip newlines
      .replace(/\s{2,}/g, " ");              // collapse multiple spaces

    // Excel sometimes wraps JSON in quotes and doubles internal quotes
    while (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.slice(1, -1);
    }
    if (cleaned.includes('""')) {
      cleaned = cleaned.replace(/""/g, '"');
    }

    // If wrapped in double braces {{...}}, strip one layer
    if (cleaned.startsWith("{{") && cleaned.endsWith("}}")) {
      cleaned = cleaned.slice(1, -1);
    }

    if (!cleaned.startsWith("{") || !cleaned.endsWith("}")) continue;

    try {
      const parsed = JSON.parse(cleaned);
      parsedJsonRows.push(parsed);
    } catch (err) {
      console.warn("Failed to parse JSON row:", cell, err);
    }
  }





  return {
    // Original column-based access
    getColumn: (columnName: string): any[] => {
      return jsonData.map((row) => row[columnName] ?? null);
    },

    getCell: (rowNumber: number, columnName: string): any => {
      if (rowNumber < 1 || rowNumber > jsonData.length) {
        throw new Error(`Row ${rowNumber} is out of range`);
      }
      return jsonData[rowNumber - 1][columnName] ?? null;
    },

    getRow: (rowNumber: number): Record<string, any> => {
      if (rowNumber < 1 || rowNumber > jsonData.length) {
        throw new Error(`Row ${rowNumber} is out of range`);
      }
      return jsonData[rowNumber - 1];
    },

    getAllRows: (): Record<string, any>[] => {
      // If parsed JSON rows exist, return them; else fallback to column-based
      return parsedJsonRows.length > 0 ? parsedJsonRows : jsonData;
    },

    getTestDataMap: (): Record<string, any> => {
      const sourceRows = parsedJsonRows.length > 0 ? parsedJsonRows : jsonData;
      const testDataMap: Record<string, any> = {};
      for (const row of sourceRows) {
        const testNo = row["Zephyr Test Number"]?.toString().trim().toUpperCase();
        if (testNo && !testDataMap[testNo]) {
          testDataMap[testNo] = row;
        }
      }
      return testDataMap;
    }
  };
}
