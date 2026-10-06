import fs from "fs";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

async function fetchSessionId() {
  const loginUrl = process.env.SF_LOGIN_URL || "https://login.salesforce.com";
  const username = process.env.SF_USERNAME;
  const password = process.env.SF_PASSWORD;
  const securityToken = process.env.SF_SECURITY_TOKEN || "";

  if (!username || !password) {
    throw new Error("❌ Missing SF_USERNAME or SF_PASSWORD in .env");
  }

  console.log("🔑 Logging into Salesforce via SOAP API...");

  try {
    // --- Step 1: SOAP login ---
    const response = await axios.post(
      `${loginUrl}/services/Soap/u/59.0`,
      `<?xml version="1.0" encoding="utf-8" ?>
        <env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                      xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
          <env:Body>
            <n1:login xmlns:n1="urn:partner.soap.sforce.com">
              <n1:username>${username}</n1:username>
              <n1:password>${password}${securityToken}</n1:password>
            </n1:login>
          </env:Body>
        </env:Envelope>`,
      {
        headers: {
          "Content-Type": "text/xml",
          SOAPAction: "login",
        },
      }
    );

    const sidMatch = response.data.match(/<sessionId>(.+?)<\/sessionId>/);
    const urlMatch = response.data.match(/<serverUrl>(.+?)<\/serverUrl>/);

    if (!sidMatch || !urlMatch) {
      throw new Error("❌ Could not extract sessionId/serverUrl from SOAP response");
    }

    const sid = sidMatch[1];
    const serverUrl = new URL(urlMatch[1]).origin;

    console.log("✅ Got Salesforce sessionId and serverUrl");

    // --- Step 2: Update .env ---
    const envPath = ".env";
    let envContents = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

    envContents = envContents.replace(/SF_SESSION_ID=.*/g, "").trim();
    envContents = envContents.replace(/SF_INSTANCE_URL=.*/g, "").trim();

    envContents += `\nSF_SESSION_ID=${sid}`;
    envContents += `\nSF_INSTANCE_URL=${serverUrl}\n`;

    fs.writeFileSync(envPath, envContents);
    console.log("✅ Updated .env with SF_SESSION_ID & SF_INSTANCE_URL");

  } catch (err: any) {
    console.error("❌ Login failed", err.response?.data || err.message);
    process.exit(1);
  }
}

fetchSessionId();