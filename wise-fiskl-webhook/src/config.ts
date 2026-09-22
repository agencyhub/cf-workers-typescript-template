export const PERSONAL_PROFILE_ID = "8027831";
export const BUSINESS_PROFILE_ID = "70855943";

/** Wise channels that are intra-balance conversions, not P&L cash. */
export const INTERNAL_CONVERSION_CHANNELS = new Set([
  "CONVERSION",
  "CURRENCY_CONVERSION",
  "BALANCE_CONVERSION",
]);

export type ProfileLabel = "PERS" | "BIZ" | "WISE";

export interface WorkerConfig {
  fisklApiBase: string;
  fisklCompanyId: string;
  defaultExpenseCategoryId: number;
  defaultIncomeCategoryId: number;
  conversionCounterpartyAccountId: number | null;
  personalProfileId: string;
  businessProfileId: string;
  wiseEnvironment: "production" | "sandbox";
  requireSignature: boolean;
  profileToFisklAccount: Map<string, number>;
}

function requiredString(env: Env, key: keyof Env): string {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing env ${String(key)}`);
  }
  return value.trim();
}

function parsePositiveInt(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`invalid ${label}: ${raw}`);
  }
  return n;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

export function parseProfileAccountMap(raw: string): Map<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("WISE_PROFILE_TO_FISKL_ACCOUNT must be JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("WISE_PROFILE_TO_FISKL_ACCOUNT must be a JSON object");
  }
  const map = new Map<string, number>();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const id =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value.trim())
          : NaN;
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`invalid Fiskl accountId for profile ${key}`);
    }
    map.set(String(key), id);
  }
  return map;
}

export function loadConfig(env: Env): WorkerConfig {
  const wiseEnvironmentRaw = (env.WISE_ENVIRONMENT ?? "production")
    .trim()
    .toLowerCase();
  const wiseEnvironment =
    wiseEnvironmentRaw === "sandbox" ? "sandbox" : "production";

  const conversionRaw = env.FISKL_CONVERSION_COUNTERPARTY_ACCOUNT_ID?.trim();

  return {
    fisklApiBase: (env.FISKL_API_BASE || "https://api.fiskl.com").replace(
      /\/$/,
      "",
    ),
    fisklCompanyId: env.FISKL_COMPANY_ID?.trim() || "3618",
    defaultExpenseCategoryId: parsePositiveInt(
      requiredString(env, "FISKL_DEFAULT_EXPENSE_ACCOUNT_ID"),
      "FISKL_DEFAULT_EXPENSE_ACCOUNT_ID",
    ),
    defaultIncomeCategoryId: parsePositiveInt(
      requiredString(env, "FISKL_DEFAULT_INCOME_ACCOUNT_ID"),
      "FISKL_DEFAULT_INCOME_ACCOUNT_ID",
    ),
    conversionCounterpartyAccountId:
      conversionRaw && conversionRaw.length > 0
        ? parsePositiveInt(
            conversionRaw,
            "FISKL_CONVERSION_COUNTERPARTY_ACCOUNT_ID",
          )
        : null,
    personalProfileId: env.WISE_PERSONAL_PROFILE_ID?.trim() || PERSONAL_PROFILE_ID,
    businessProfileId: env.WISE_BUSINESS_PROFILE_ID?.trim() || BUSINESS_PROFILE_ID,
    wiseEnvironment,
    requireSignature: parseBool(env.WISE_REQUIRE_SIGNATURE, true),
    profileToFisklAccount: parseProfileAccountMap(
      requiredString(env, "WISE_PROFILE_TO_FISKL_ACCOUNT"),
    ),
  };
}

export function profileLabel(
  profileId: string,
  config: Pick<WorkerConfig, "personalProfileId" | "businessProfileId">,
): ProfileLabel {
  if (profileId === config.personalProfileId) return "PERS";
  if (profileId === config.businessProfileId) return "BIZ";
  return "WISE";
}

