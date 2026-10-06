/**
 * @deprecated Do not import. Mutating process.env.SF_ORG_PREFIX here poisoned
 * main-suite workers (BoM, Quote, etc.) when the full suite ran.
 *
 * CPI suites now use the same SF_ORG_PREFIX as the main suite:
 *   new QuoteService(page)
 *
 * Kept as a stub so old imports fail safely (no side effects).
 */
import dotenv from 'dotenv';

dotenv.config();
