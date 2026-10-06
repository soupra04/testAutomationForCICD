import { Connection } from 'jsforce';
import { getRequiredEnv, normalizeSfInstanceUrl } from './envConfig';

/**
 * Thin CPI org helpers — same SF_INSTANCE_URL / SF_SESSION_ID / SF_ORG_PREFIX
 * as the rest of the suite (globalSetup → state.chromium.json).
 * Not a separate auth path; do not introduce CPI_SF_* here.
 */

export function getSfInstanceUrl(): string {
  return getRequiredEnv('SF_INSTANCE_URL').replace(/\/$/, '');
}

export function getSfOrgPrefix(): string {
  return getRequiredEnv('SF_ORG_PREFIX').trim();
}

export function getSfSessionId(): string {
  return getRequiredEnv('SF_SESSION_ID');
}

/** API / cookie host (*.my.salesforce.com). */
export function toMySalesforceOrigin(instanceUrl: string): string {
  return normalizeSfInstanceUrl(instanceUrl);
}

export function getCpiSearchTabUrl(): string {
  const instanceUrl = getSfInstanceUrl();
  const orgPrefix = getSfOrgPrefix();
  return `${instanceUrl}/lightning/n/${orgPrefix}__CPI_Search`;
}

export function getCpiConfigurationTabUrl(): string {
  const instanceUrl = getSfInstanceUrl();
  const orgPrefix = getSfOrgPrefix();
  return `${instanceUrl}/lightning/n/${orgPrefix}__CPI_Configuration`;
}

export function getCpiHomeUrl(): string {
  return `${getSfInstanceUrl()}/lightning/page/home`;
}

export function getSearchQuotesTabUrl(): string {
  const instanceUrl = getSfInstanceUrl().replace('.my.salesforce.com', '.lightning.force.com');
  const orgPrefix = getSfOrgPrefix();
  return `${instanceUrl}/lightning/n/${orgPrefix}__Search_Quotes_and_Quote_Items`;
}

/** jsforce against the same org/session as main-suite tests. */
export function getSfJsforceConnection(): Connection {
  return new Connection({
    instanceUrl: toMySalesforceOrigin(getSfInstanceUrl()),
    accessToken: getSfSessionId(),
    version: '59.0',
  });
}
