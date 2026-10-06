/**
 * @deprecated CPI suites use the same SF_INSTANCE_URL / SF_SESSION_ID / SF_ORG_PREFIX
 * auth as the rest of the framework (globalSetup → state.chromium.json).
 *
 * Use `utils/cpiOrg.ts` for tab URLs and jsforce. Do not import this module for new code.
 */
import {
  getCpiConfigurationTabUrl,
  getCpiHomeUrl,
  getCpiSearchTabUrl,
  getSfInstanceUrl,
  getSfJsforceConnection,
  getSfOrgPrefix,
  getSfSessionId,
  toMySalesforceOrigin,
} from './cpiOrg';

export {
  getCpiConfigurationTabUrl,
  getCpiHomeUrl,
  getCpiSearchTabUrl,
  getSfInstanceUrl,
  getSfJsforceConnection,
  getSfOrgPrefix,
  getSfSessionId,
  toMySalesforceOrigin,
};

/** @deprecated Use getSfJsforceConnection from utils/cpiOrg. */
export const getCpiJsforceConnection = getSfJsforceConnection;

/** @deprecated Removed — Playwright storageState provides the session. */
export async function addCpiOrgCookies(): Promise<void> {
  throw new Error(
    'addCpiOrgCookies is removed. CPI tests use SF_SESSION_ID via globalSetup storageState.'
  );
}

/** @deprecated Removed — Playwright storageState provides the session. */
export async function loginCpi(): Promise<void> {
  throw new Error(
    'loginCpi is removed. CPI tests use SF_SESSION_ID via globalSetup storageState.'
  );
}

/** @deprecated Always true when using storageState. */
export function isCpiContextAuthenticated(): boolean {
  return true;
}

/** @deprecated Use getSfInstanceUrl / getSfOrgPrefix / getSfSessionId from utils/cpiOrg. */
export function getCpiOrgConfig(): {
  instanceUrl: string;
  sessionId: string;
  orgPrefix: string;
} {
  return {
    instanceUrl: getSfInstanceUrl(),
    sessionId: getSfSessionId(),
    orgPrefix: getSfOrgPrefix(),
  };
}
