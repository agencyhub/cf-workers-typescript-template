# Wise → Fiskl webhook Worker

Deterministic Cloudflare Worker: receives Wise profile webhooks (`balances#update`) and records matching cash movements in Fiskl via `POST /v1/transactions`. No LLM in the hot path. Never moves money. Never calls Wise balance-statement endpoints (blocked for BR personal tokens).

This folder is a dedicated Worker app. The repository root remains the generic TypeScript Workers template.

## Routes

| Method | Path | Behaviour |
| --- | --- | --- |
| `GET` | `/healthz` | `{ "ok": true }` |
| `POST` | `/wise/balances-update` | Wise webhook receiver |

Wise must receive **HTTP 200** within 5 seconds (including the subscription test ping with `X-Test-Notification: true`).

## Mapping (locked to current Wise docs)

Source of truth for the payload: [Balance update webhook](https://docs.wise.com/api-reference/webhook-event/eventbalancesupdate) schema **4.0.0** (also accepts 3.0.0 / 2.x field subsets).

| Wise field | Fiskl field |
| --- | --- |
| `data.transaction_type = credit` | `type: INCOME` |
| `data.transaction_type = debit` | `type: EXPENSE` |
| `data.channel_name` in `CONVERSION` / `CURRENCY_CONVERSION` / `BALANCE_CONVERSION` | `type: TRANSFER` **only if** `FISKL_CONVERSION_COUNTERPARTY_ACCOUNT_ID` is set; otherwise skipped (avoids P&L noise). Wise `channel_name: TRANSFER` is a generic money movement, **not** a Fiskl transfer. |
| `data.amount` (major units, e.g. `70` GBP / `9.6` GBP) | unsigned integer **minor units** (`7000` / `960`) |
| `data.currency` | `currencyCode` |
| `data.occurred_at` | `date` (`YYYY-MM-DD`, UTC) |
| `data.resource.profile_id` | `[PERS]` / `[BIZ]` name prefix + Fiskl `accountId` |
| `data.step_id` (else `X-Delivery-Id`) | `externalId` = `wise:step:{profileId}:{stepId}` |

Fiskl body (OpenAPI `TransactionV1Request`): `type`, `date`, `amount`, `name`, `accountId`, `lines[].categoryId` (omitted for `TRANSFER`), `externalId`.

### Profiles and chart hints (company `3618`)

| Wise profile | Label | Fiskl cash account |
| --- | --- | --- |
| `8027831` Personal — Daniel Lourenco da Cruz | `[PERS]` | create bank/cash **`[PERS] Wise`**, put id in `WISE_PROFILE_TO_FISKL_ACCOUNT` |
| `70855943` Business — LTD HUNT LIFETIME DEALS PROMOCAO DE VENDAS LTDA | `[BIZ]` | create bank/cash **`[BIZ] Wise`**, put id in `WISE_PROFILE_TO_FISKL_ACCOUNT` |

| Role | Fiskl account id (defaults) |
| --- | --- |
| Uncategorised Expenses (expense line) | `354816` → `FISKL_DEFAULT_EXPENSE_ACCOUNT_ID` |
| Sales (income line) | `354765` → `FISKL_DEFAULT_INCOME_ACCOUNT_ID` |

Existing Fiskl banks (not Wise): `3265465` Stripe BRL, `1527776`, `354718`.

## Env

Secrets (`wrangler secret put`, never commit):

| Name | Required | Use |
| --- | --- | --- |
| `FISKL_API_KEY` | yes | `Authorization: Bearer` on Fiskl (`fsk_…`, needs `transactions:write`) |
| `WISE_API_TOKEN` | subscribe script | profile webhook subscriptions only — **not** used to fetch statements |

Vars (`wrangler.jsonc` or dashboard):

| Name | Example |
| --- | --- |
| `WISE_PROFILE_TO_FISKL_ACCOUNT` | `{"8027831":"<PERS cash id>","70855943":"<BIZ cash id>"}` |
| `FISKL_DEFAULT_EXPENSE_ACCOUNT_ID` | `354816` |
| `FISKL_DEFAULT_INCOME_ACCOUNT_ID` | `354765` |
| `FISKL_COMPANY_ID` | `3618` (documented; API key is company-scoped) |
| `FISKL_API_BASE` | `https://api.fiskl.com` |
| `WISE_REQUIRE_SIGNATURE` | `true` in production (RSA-SHA256 `X-Signature-SHA256`) |
| `WISE_ENVIRONMENT` | `production` or `sandbox` (selects Wise public key first) |
| `FISKL_CONVERSION_COUNTERPARTY_ACCOUNT_ID` | optional cash account for conversion `TRANSFER`s |

KV binding: `IDEMPOTENCY` (delivery id + occurrence id, 90-day TTL). Fiskl `externalId` is the second idempotency layer.

## Deploy

```bash
cd wise-fiskl-webhook
npm ci
npm test
npx wrangler kv namespace create IDEMPOTENCY
# paste the returned id into wrangler.jsonc → kv_namespaces[0].id

# after creating [PERS] Wise and [BIZ] Wise cash accounts in Fiskl:
npx wrangler secret put FISKL_API_KEY
# optional: npx wrangler secret put WISE_API_TOKEN   # only if you want it on the Worker

# set the real profile → cash map (no secrets, but environment-specific):
npx wrangler deploy
```

Then update `WISE_PROFILE_TO_FISKL_ACCOUNT` in the dashboard (or `wrangler.jsonc` vars) to the real Fiskl account ids and redeploy.

Health check:

```bash
curl -sS https://<worker-host>/healthz
```

### Subscribe both profiles

Wise [create profile subscription](https://docs.wise.com/guides/developer/webhooks/subscribe-to-webhooks):

```bash
export WISE_API_TOKEN='…'          # from ~/secrets/wise.env — do not commit
export WORKER_URL='https://<worker-host>'
npm run subscribe
```

Equivalent curl (repeat for `8027831` and `70855943`):

```bash
curl -sS -X POST "https://api.wise.com/v3/profiles/70855943/subscriptions" \
  -H "Authorization: Bearer $WISE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Fiskl balances#update (70855943)",
    "trigger_on": "balances#update",
    "delivery": {
      "version": "4.0.0",
      "url": "https://<worker-host>/wise/balances-update"
    }
  }'
```

Creating a subscription sends a **test event**; this Worker returns 200 without writing to Fiskl.

Local ping (signature check off via `.dev.vars`):

```bash
cp .dev.vars.example .dev.vars   # then edit
npm run dev
curl -sS http://localhost:8787/healthz
curl -sS -X POST http://localhost:8787/wise/balances-update \
  -H 'Content-Type: application/json' \
  -H 'X-Test-Notification: true' \
  -d @test/fixtures/wise-credit.json
```

## Tests

```bash
cd wise-fiskl-webhook
npm test
```

Covers payload → Fiskl body mapping, minor units, `[BIZ]`/`[PERS]` prefixes, idempotency, test-ping 200, and a source guard against Wise statement/payout URLs.

## Out of scope

- AI classification / Grok on each event
- Moving money / Wise payouts
- Parsing Wise email
- Fiskl UI bank connect
