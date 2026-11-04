#!/usr/bin/env node
/**
 * Subscribe both Wise profiles to balances#update.
 *
 * Usage:
 *   WISE_API_TOKEN=... WORKER_URL=https://wise-fiskl-webhook.<account>.workers.dev \
 *     npm run subscribe
 *
 * Token is read from the environment only — never committed.
 * This script does not call Wise balance-statement endpoints and does not move money.
 */

const WISE_API_BASE = (process.env.WISE_API_BASE || "https://api.wise.com").replace(
  /\/$/,
  "",
);
const PERSONAL = process.env.WISE_PERSONAL_PROFILE_ID || "8027831";
const BUSINESS = process.env.WISE_BUSINESS_PROFILE_ID || "70855943";
const SCHEMA_VERSION = process.env.WISE_DELIVERY_VERSION || "4.0.0";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const token = process.env.WISE_API_TOKEN;
if (!token) fail("WISE_API_TOKEN is required (export it; do not put it in git).");

const workerUrl = process.env.WORKER_URL;
if (!workerUrl) fail("WORKER_URL is required, e.g. https://wise-fiskl-webhook.example.workers.dev");

const callbackUrl = `${workerUrl.replace(/\/$/, "")}/wise/balances-update`;
if (!callbackUrl.startsWith("https://")) fail("WORKER_URL must be https");
if (callbackUrl.includes("?")) fail("Wise callback URLs cannot include query parameters");

const profiles = (process.env.WISE_PROFILE_IDS || `${PERSONAL},${BUSINESS}`)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function subscribe(profileId) {
  const url = `${WISE_API_BASE}/v3/profiles/${profileId}/subscriptions`;
  const body = {
    name: `Fiskl balances#update (${profileId})`,
    trigger_on: "balances#update",
    delivery: {
      version: SCHEMA_VERSION,
      url: callbackUrl,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  return { profileId, status: response.status, body: parsed };
}

const results = [];
for (const profileId of profiles) {
  const result = await subscribe(profileId);
  results.push(result);
  const ok = result.status >= 200 && result.status < 300;
  console.log(
    JSON.stringify({
      profileId: result.profileId,
      httpStatus: result.status,
      ok,
      id: result.body?.id ?? null,
      trigger_on: result.body?.trigger_on ?? null,
    }),
  );
  if (!ok) {
    console.error(JSON.stringify({ profileId, error: result.body }));
  }
}

const failed = results.filter((r) => r.status < 200 || r.status >= 300);
process.exit(failed.length ? 1 : 0);
