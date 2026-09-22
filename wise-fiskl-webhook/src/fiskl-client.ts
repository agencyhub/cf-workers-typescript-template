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
): Promise<FisklPostResult> {
  const url = `${apiBase}/v1/transactions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.FISKL_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": payload.externalId,
    },
    body: JSON.stringify(payload),
  });

  const bodyText = truncate(await response.text());
  const status = response.status;
  const duplicate = status === 200;
  const ok = status === 200 || status === 201;
  const retryable = status === 409 || status === 429 || status >= 500;

  return { ok, duplicate, status, retryable, bodyText };
}
