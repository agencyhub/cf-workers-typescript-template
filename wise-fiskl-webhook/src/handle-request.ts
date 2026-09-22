import { loadConfig } from "./config";
import { postFisklTransaction } from "./fiskl-client";
import { alreadyProcessed, markProcessed } from "./idempotency";
import { logJson } from "./log";
import { mapWiseBalanceUpdateToFiskl, resolveOccurrenceIds } from "./map-wise-to-fiskl";
import { authorizeSharedSecret } from "./secrets";
import type { WiseWebhookEnvelope } from "./types";
import { verifyWiseSignature } from "./wise-signature";

const MAX_BODY_BYTES = 256 * 1024;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function isTestNotification(headers: Headers): boolean {
  return headers.get("X-Test-Notification")?.toLowerCase() === "true";
}

async function handleHealthz(): Promise<Response> {
  return json(200, { ok: true, service: "wise-fiskl-webhook" });
}

async function handleBalancesUpdate(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.FISKL_API_KEY) {
    logJson("error", { message: "missing_fiskl_api_key" });
    return json(500, { status: "error", error: "misconfigured" });
  }

  if (!authorizeSharedSecret(request, env.WEBHOOK_SHARED_SECRET)) {
    return json(401, { status: "error", error: "unauthorized" });
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return json(413, { status: "error", error: "payload_too_large" });
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) {
    return json(413, { status: "error", error: "payload_too_large" });
  }

  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    logJson("error", {
      message: "invalid_config",
      error: error instanceof Error ? error.message : String(error),
    });
    return json(500, { status: "error", error: "misconfigured" });
  }

  const signature = request.headers.get("X-Signature-SHA256");
  const test = isTestNotification(request.headers);
  if (config.requireSignature || signature) {
    const ok = await verifyWiseSignature(
      raw,
      signature,
      config.wiseEnvironment,
    );
    if (!ok) {
      logJson("warn", {
        message: "invalid_signature",
        test,
        hasSignature: Boolean(signature),
      });
      return json(401, { status: "error", error: "invalid_signature" });
    }
  }

  if (raw.byteLength === 0) {
    return json(200, { status: "ok", skipped: "empty_body" });
  }

  let event: WiseWebhookEnvelope;
  try {
    event = JSON.parse(new TextDecoder().decode(raw)) as WiseWebhookEnvelope;
  } catch {
    return json(400, { status: "error", error: "invalid_json" });
  }

  if (test) {
    logJson("info", {
      message: "wise_test_notification",
      event_type: event.event_type ?? null,
      delivery_id: request.headers.get("X-Delivery-Id") ?? null,
    });
    return json(200, { status: "ok", skipped: "test_notification" });
  }

  const ids = resolveOccurrenceIds(request.headers, event);

  if (await alreadyProcessed(env.IDEMPOTENCY, ids.deliveryId, ids.occurrenceId)) {
    logJson("info", {
      message: "duplicate_skipped",
      delivery_id: ids.deliveryId,
      occurrence_id: ids.occurrenceId,
    });
    return json(200, { status: "ok", skipped: "duplicate" });
  }

  const mapped = mapWiseBalanceUpdateToFiskl(event, config, ids);
  if (mapped.kind === "skip") {
    logJson("info", {
      message: "event_skipped",
      reason: mapped.reason,
      detail: mapped.detail,
      delivery_id: ids.deliveryId,
      occurrence_id: ids.occurrenceId,
    });
    await markProcessed(env.IDEMPOTENCY, ids.deliveryId, ids.occurrenceId);
    return json(200, { status: "ok", skipped: mapped.reason });
  }

  const fiskl = await postFisklTransaction(
    env,
    config.fisklApiBase,
    mapped.body,
  );

  if (!fiskl.ok) {
    logJson("error", {
      message: "fiskl_post_failed",
      status: fiskl.status,
      retryable: fiskl.retryable,
      delivery_id: ids.deliveryId,
      occurrence_id: ids.occurrenceId,
      external_id: mapped.body.externalId,
      fiskl_body: fiskl.bodyText,
    });
    return json(fiskl.retryable ? 503 : 502, {
      status: "error",
      error: "fiskl_post_failed",
    });
  }

  await markProcessed(env.IDEMPOTENCY, ids.deliveryId, ids.occurrenceId);

  logJson("info", {
    message: "fiskl_posted",
    duplicate: fiskl.duplicate,
    fiskl_status: fiskl.status,
    type: mapped.body.type,
    amount: mapped.body.amount,
    currency: mapped.body.currencyCode,
    account_id: mapped.body.accountId,
    delivery_id: ids.deliveryId,
    occurrence_id: ids.occurrenceId,
    external_id: mapped.body.externalId,
    company_id: config.fisklCompanyId,
  });

  return json(200, {
    status: "ok",
    duplicate: fiskl.duplicate,
    externalId: mapped.body.externalId,
  });
}

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (path === "/healthz" && request.method === "GET") {
      return handleHealthz();
    }

    if (path === "/wise/balances-update") {
      if (request.method !== "POST") {
        return json(405, { status: "error", error: "method_not_allowed" });
      }
      return handleBalancesUpdate(request, env);
    }

    return json(404, { status: "error", error: "not_found" });
  } catch (error) {
    logJson("error", {
      message: "unhandled",
      error: error instanceof Error ? error.message : String(error),
      path,
      method: request.method,
    });
    return json(500, { status: "error", error: "internal" });
  }
}
