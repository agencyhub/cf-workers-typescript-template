/** ISO 4217 minor-unit exponents. Default 2 (BRL/GBP/USD/EUR). */
const ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function currencyExponent(currency: string): number {
  const code = currency.trim().toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

function amountToDecimalString(amount: number | string): string {
  if (typeof amount === "string") {
    const trimmed = amount.trim();
    if (!trimmed) throw new Error("empty amount");
    return trimmed;
  }
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new Error("invalid amount");
  }
  return amount.toFixed(12).replace(/\.?0+$/, "");
}

/**
 * Convert Wise major-unit amount to Fiskl unsigned minor units.
 * Wise official examples use unsigned amounts plus transaction_type.
 */
export function toUnsignedMinorUnits(
  amount: number | string,
  currency: string,
): number {
  const exp = currencyExponent(currency);
  const raw = amountToDecimalString(amount);
  const negative = raw.startsWith("-");
  const unsigned = raw.replace(/^[+-]/, "");
  const [wholeRaw, fracRaw = ""] = unsigned.split(".");
  const whole = wholeRaw && /^\d+$/.test(wholeRaw) ? wholeRaw : "";
  if (whole === "" && fracRaw === "") throw new Error("invalid amount");
  if (whole !== "" && !/^\d+$/.test(whole)) throw new Error("invalid amount");
  if (fracRaw && !/^\d+$/.test(fracRaw)) throw new Error("invalid amount");

  const fracPadded = (fracRaw + "0".repeat(exp)).slice(0, exp);
  const leftover = fracRaw.slice(exp);
  let minor =
    BigInt(whole || "0") * 10n ** BigInt(exp) + BigInt(fracPadded || "0");
  if (leftover.length > 0 && leftover[0]! >= "5") {
    minor += 1n;
  }
  if (negative) {
    // Direction comes from transaction_type; Fiskl amounts are unsigned.
    minor = minor < 0n ? -minor : minor;
  }
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("amount exceeds safe integer");
  }
  return Number(minor);
}

export function formatMajor(amountMinor: number, currency: string): string {
  const exp = currencyExponent(currency);
  if (exp === 0) return String(amountMinor);
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const scale = 10 ** exp;
  const whole = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(exp, "0");
  return `${sign}${whole}.${frac}`;
}

export function toIsoDateUtc(occurredAt: string | undefined, fallback: Date): string {
  const d = occurredAt ? new Date(occurredAt) : fallback;
  if (Number.isNaN(d.getTime())) {
    throw new Error("invalid occurred_at");
  }
  return d.toISOString().slice(0, 10);
}
