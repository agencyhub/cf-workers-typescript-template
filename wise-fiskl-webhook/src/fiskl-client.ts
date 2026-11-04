import type { FisklTransactionRequest } from "./types";

export interface FisklPostResult {
  ok: boolean;
  duplicate: boolean;
  status: number;
  retryable: boolean;
  bodyText: string;
}

function truncate(text: string, max = 500): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export async function postFisklTransaction(
  env: Env,
  apiBase: string,
  payload: FisklTransactionRequest,
  timeoutMs: number,
): Promise<FisklPostResult> {
  const url = `${apiBase}/v1/transactions`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.FISKL_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": payload.externalId,
      },
      body: JSON.stringify(payload),
      // Bounded wait so the Worker can answer Wise inside its 5s ack SLA.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // AbortError (timeout) or a network-level failure — retryable either way.
    return {
      ok: false,
      duplicate: false,
      status: 0,
      retryable: true,
      bodyText: truncate(error instanceof Error ? error.message : String(error)),
    };
  }

  const bodyText = truncate(await response.text());
  const status = response.status;
  // 200 = Fiskl already had this externalId; 409 = same conflict surfaced.
  const duplicate = status === 200 || status === 409;
  const ok = status === 200 || status === 201 || status === 409;
  const retryable = status === 429 || status >= 500;

  return { ok, duplicate, status, retryable, bodyText };
}
