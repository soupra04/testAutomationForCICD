// global-setup.ts
import dotenv from "dotenv";
import { execSync } from "child_process";
import { chromium, FullConfig } from "@playwright/test";
import { libs, globalVars } from "../../libs/lib"; //
import { hydrateSfVarsIntoProcessEnv, normalizeSfEnvUrls } from "../../utils/envConfig";

export default async function globalSetup(config: FullConfig) {
    dotenv.config();
    hydrateSfVarsIntoProcessEnv();
    normalizeSfEnvUrls();

    console.log("Resolved SF_ORG_PREFIX:", process.env.SF_ORG_PREFIX);

    // Ensure SF_SESSION_ID exists
    if (!process.env.SF_SESSION_ID) {
        console.log("⚡ No SF_SESSION_ID found. Fetching via fetch-sid.js...");

        execSync("npx ts-node fetch-sid.ts", {
            stdio: "inherit"
        });
        dotenv.config(); // reload env
    }

    if (!process.env.SF_SESSION_ID) {
        console.log("❌ SF_SESSION_ID still missing after fetch-sid");
    }

    console.log("✅ Token ready, preparing Playwright state...");

    // Use Playwright to preload cookies
    // Use Playwright to preload cookies
    const browser = await chromium.launch({
        headless: true,
		args: [
		    '--headless',
		    '--no-sandbox',
		    '--disable-setuid-sandbox',
		    '--disable-gpu',
		    '--disable-dev-shm-usage',
			'--ozone-platform=wayland',
			'--ozone-platform=headless'
		  ]
    });
    const page = await browser.newPage();


    await libs.SF_INIT(page);

    console.log("Global vars:", globalVars);

    await page.context().addCookies([{
        name: "sid",
        value: process.env.SF_SESSION_ID!,
        domain: ".salesforce.com",
        path: "/",
        httpOnly: true,
        secure: true,
    }, ]);

    // Save state so all tests reuse it
    await page.context().storageState({
        path: "state.chromium.json"
    });
    await browser.close();

    console.log("✅ Global setup completed, state.json ready");
}
