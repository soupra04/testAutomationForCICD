let cachedSfVars: Record<string, string> | null = null;
let sfVarsHydrated = false;

function getSfVars(): Record<string, string> {
  if (cachedSfVars !== null) return cachedSfVars;

  const raw = process.env.SF_VARS;
  if (!raw) {
    cachedSfVars = {};
    return cachedSfVars;
  }

  cachedSfVars = JSON.parse(raw) as Record<string, string>;
  return cachedSfVars;
}

/**
 * jsforce and SOAP API require *.my.salesforce.com — not *.lightning.force.com.
 * Accept either format in .env and normalize once at startup.
 */
export function normalizeSfInstanceUrl(url: string): string {
  return url
    .trim()
    .replace(/\/$/, "")
    .replace(".lightning.force.com", ".my.salesforce.com");
}

export function normalizeSfEnvUrls(): void {
  if (process.env.SF_INSTANCE_URL) {
    process.env.SF_INSTANCE_URL = normalizeSfInstanceUrl(process.env.SF_INSTANCE_URL);
  }
}

/**
 * Copies SF_VARS JSON keys into process.env when the key is not already set.
 * Needed because most of the codebase reads process.env.SF_ORG_PREFIX directly,
 * while CI only provides values inside the SF_VARS blob.
 */
export function hydrateSfVarsIntoProcessEnv(): void {
  if (sfVarsHydrated) return;
  sfVarsHydrated = true;

  const vars = getSfVars();
  for (const [key, value] of Object.entries(vars)) {
    if (value == null || value === "") continue;
    if (process.env[key]) continue;
    process.env[key] = String(value);
  }

  normalizeSfEnvUrls();
}

export function getEnv(key: string, defaultValue?: string): string | undefined {
  hydrateSfVarsIntoProcessEnv();

  const direct = process.env[key];
  if (direct) return direct;

  const fromSfVars = getSfVars()[key];
  if (fromSfVars) return fromSfVars;

  return defaultValue;
}

export function getRequiredEnv(key: string): string {
  const value = getEnv(key);
  if (!value) {
    throw new Error(
      `${key} is not set. Provide it via .env locally or inside SF_VARS (Bitbucket vars) in CI.`
    );
  }
  return value;
}
