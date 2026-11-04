# REVIEW.md — review standards

Reviewer-facing rules for automated code review. Author-side conventions
live in `AGENTS.md` and `wise-fiskl-webhook/README.md` — this file encodes
what reviewers should flag, and what they should not.

## Flag these

### Secrets committed anywhere

`FISKL_API_KEY` (`fsk_…`), `WISE_API_TOKEN`, Cloudflare API tokens, or any
bearer-looking credential in tracked files. Non-secret vars in
`wrangler.jsonc` (account ids, profile ids, timeouts) are fine — secrets go
through `wrangler secret put` / `.dev.vars` only.

### Signature verification weakened

`WISE_REQUIRE_SIGNATURE` bypassed or defaulted off, `verifyWiseSignature`
short-circuited/skipped for non-test traffic, public-key material swapped
for a constant, or test-notification shortcuts that also accept unsigned
real events. A subscription **test ping** (`X-Test-Notification: true`)
acking 200 is correct behavior — a signed-path hole is not.

### Idempotency regressions

- A Fiskl `POST` reached without a prior KV claim on the occurrence keys.
- Fiskl `409`/`200`-conflict treated as retryable — it means the
  `externalId` was already recorded and must ack 200 + `markProcessed`.
- `markProcessed` on a retryable-failure path — the event is then
  permanently skipped while Wise believes it succeeded.
- Failure exits that don't `releaseClaim` — a stuck `processing` marker
  returns 503 to every retry until its TTL expires.

### Unbounded external calls on the hot path

Any `fetch` (Fiskl, Wise, or new integrations) without an
`AbortSignal.timeout` budget. Wise's ack SLA is 5s end-to-end — an
unbounded upstream call turns a slow dependency into a duplicate-storm.

### Wise statement / payout / money-moving endpoints

BR personal tokens are blocked from Wise balance-statement endpoints, and
this Worker must never move money. Flag any call to Wise beyond signature
public keys and the documented subscription API in `scripts/subscribe.mjs`.

### Config-caused skips acked as success

Skip reasons caused by deployment config (missing/placeholder account
mapping, missing counterparty config) must surface as 503 so Wise retries —
acking them 200 permanently drops real cash movements. Event-caused skips
(bad payload, zero amount, unsupported event) stay 200 + `markProcessed`.

### Money mapping errors

`data.amount` is major units — must reach Fiskl as unsigned **minor** units.
`TRANSFER` direction must use `transaction_type` (credit = money into the
mapped Wise account, debit = out), not a fixed accountId ordering.

### Tests weakened without justification

Deleted assertions, relaxed comparisons, flipped sense, or dropped fields
from equality checks — unless the PR body documents the behavior change.

## Do not flag

- `logJson` statements (Workers observability) — unless the payload may
  contain secrets or auth material.
- KV namespace id `0000…` and `WISE_PROFILE_TO_FISKL_ACCOUNT` `"0"`
  placeholders in `wrangler.jsonc` — documented deploy steps; the latter
  surfaces as a retryable `placeholder_account` 503 by design.
- Template boilerplate outside `wise-fiskl-webhook/` — legacy fork surface,
  not the maintained app.
- The removed GitHub Actions workflows — this repo intentionally has no CI;
  local gates + manual deploys are the process (see `AGENTS.md`).

## Severity guidance

- **Important:** signature bypass, secret leaks, idempotency/claim breaks,
  retry-loop-causing status codes, money direction/units, missing timeouts.
- **Nit:** naming, comment style, formatting — linters already enforce.
