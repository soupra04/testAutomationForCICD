import type { Page } from '@playwright/test';
import { Connection } from 'jsforce';

interface GlobalVars {
  salesforceBaseUrl?: string;
  loginUrl?: string;
  startUrl?: string;
  [key: string]: any;
}

let globalVars: GlobalVars = {};

export let libs = {
  SF_INIT: async function (page: Page): Promise<void> {
    const salesforceBaseUrl = process.env.SF_INSTANCE_URL;
    const sessionId = process.env.SF_SESSION_ID;
    const VARS = process.env.SF_VARS !== undefined ? process.env.SF_VARS : '{}';

    Object.assign(globalVars, JSON.parse(VARS));
    globalVars.salesforceBaseUrl = salesforceBaseUrl;
    globalVars.loginUrl = `${salesforceBaseUrl}/secure/frontdoor.jsp?sid=${sessionId}`;
    globalVars.startUrl = salesforceBaseUrl + (globalVars?.startUrl ?? '');

    console.log('Salesforce BASE_URL:', salesforceBaseUrl);
    console.log('Salesforce LOGIN_URL:', globalVars.loginUrl);
    console.log('Salesforce START_URL:', globalVars.startUrl);

    if (!salesforceBaseUrl || !sessionId) {
      throw new Error('Salesforce BASE_URL or SESSION_ID is not set');
    }

    globalVars.sfConn = new Connection({
      instanceUrl: salesforceBaseUrl,
      accessToken: sessionId
    });

    page.context().addCookies([{
      name: "sid",
      value: sessionId!,
      domain: ".salesforce.com",
      path: "/",
      httpOnly: true,
      secure: true
    }]);

    console.log('Global VARS:', globalVars);
  },

  getGlobalVars: function (): GlobalVars {
    return globalVars;
  }
};


// ✅ Export globalVars separately so other files can import it
export { globalVars };
