// global-setup.ts
import dotenv from "dotenv";
import { execSync } from "child_process";
import path from "path";
import { chromium, FullConfig } from "@playwright/test";
import { libs, globalVars } from "../../libs/lib"; //
import { hydrateSfVarsIntoProcessEnv, normalizeSfEnvUrls } from "../../utils/envConfig";

const projectRoot = path.resolve(__dirname, "../..");

export default async function globalSetup(config: FullConfig) {
    if (process.env.SKIP_SF_GLOBAL_SETUP === 'true') {
        console.log('⏭️ SKIP_SF_GLOBAL_SETUP=true — skipping Salesforce global setup');
        return;
    }

    dotenv.config();
    hydrateSfVarsIntoProcessEnv();
    normalizeSfEnvUrls();

    console.log("Resolved SF_ORG_PREFIX:", process.env.SF_ORG_PREFIX);

    // Ensure SF_SESSION_ID exists
    if (!process.env.SF_SESSION_ID) {
        console.log("⚡ No SF_SESSION_ID found. Fetching via fetch-sid.js...");

        execSync("npx ts-node --project tsconfig.json fetch-sid.ts", {
            stdio: "inherit",
            cwd: projectRoot,
            env: process.env,
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
