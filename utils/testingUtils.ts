import { Page, expect } from '@playwright/test';

export class TestingUtils {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
 * Checks if a popup notification with the expected message appears.
 * @param expectedMessage Full or partial message to validate
 * @param exactMatch Whether to match the full text exactly (default: true)
 * @returns true if message matches, false otherwise
 */
  async verifyNotificationMessage(expectedMessage: string){
    const iframe = await this.page.locator('iframe[name^="vfFrameId_"]').contentFrame();
    const locator = await iframe.locator('span[data-notify-text]');    
    await locator.first().waitFor({ state: 'attached', timeout: 5000 });       // wait for the notification element to appear and become visible
    const notifyText = await locator.first().textContent();
    console.log(" Captured notification:", notifyText);     
    if (notifyText === expectedMessage || notifyText?.includes(expectedMessage)){
        return true;
    }
    else {return false};
  }

    async findMismatchedKeys(sfData: any, excelData: any) {
        // Compare the values and find mismatched keys
        if (typeof sfData === 'string') sfData = JSON.parse(sfData);
        if (typeof excelData === 'string') excelData = JSON.parse(excelData);

        // Use first element if input is an array
        if (Array.isArray(sfData)) sfData = sfData[0] || {};
        if (Array.isArray(excelData)) excelData = excelData[0] || {};

        const mismatched: Record<string, unknown> = {};

        for (const key in sfData) {
            if (sfData[key] !== excelData[key]) {
                // mismatched object stoores the incorrect sf values
                mismatched[key] = sfData[key];
            }
        }
        return mismatched;
    }

    async formatFieldName(fieldName: string) {
    // Format the field name to be more readable    
        return fieldName
        .replace(/_/g, ' ') // Replace underscores with spaces
        .replace(/qtGrid /g, '') // Remove "qtGrid" prefix
        .replace(/StrataVAR /g, '') // Remove "StrataVAR" prefix
        .replace(/ c/g, '') // Remove C
        .replace(/\b(\w)/g, (match) => match.toUpperCase()); // Capitalize the first letter of each word
    }

    async parsedHTMLTable(htmlError: any){
        // Parses the HTML error message and logs the comparison table in text format for better readability in test logs
        // If the HTML is empty or null, log a warning and return
        const html = typeof htmlError === 'string' ? htmlError : String(htmlError ?? '');
        if (!html) {
            console.warn('parsedHTMLTable: no HTML to parse (null/empty).');
            return;
        }

        const rows = [...htmlError.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
            .map(m => [...m[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(c => c[1].replace(/<[^>]+>/g, "").trim()))
            .filter(r => r.length);

        if (!rows.length) {         // If no error details could be parsed from the HTML, throw the raw HTML for debugging
            throw new Error(`Test did not pass. Values are not equal. Comparison details could not be parsed from HTML output. Raw HTML:\n${htmlError}`);
        }

        const widths = rows[0].map((_, i) => Math.max(...rows.map(r => (r[i] || "").length)));
        const pad = (s: string, w: number) => s.padEnd(w);
        const formatRow = (row: string[]) => row.map((cell, i) => pad(cell, widths[i])).join(" | ");

        const header = formatRow(rows[0]);
        const separator = widths.map(w => "─".repeat(w)).join("─┼─");
        const body = rows.slice(1).map(formatRow).join("\n");

        return `\n\n${header}\n${separator}${body ? "\n" + body:""}\n`;
    }
}

