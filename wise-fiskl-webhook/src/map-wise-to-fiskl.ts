import {
  INTERNAL_CONVERSION_CHANNELS,
  profileLabel,
  type WorkerConfig,
} from "./config";
import { formatMajor, toIsoDateUtc, toUnsignedMinorUnits } from "./money";
import type {
  FisklTransactionRequest,
  FisklTransactionType,
  MapResult,
  WiseWebhookEnvelope,
} from "./types";

export interface OccurrenceIds {
  deliveryId: string | null;
  occurrenceId: string;
  externalId: string;
}

export function resolveOccurrenceIds(
  headers: Headers,
  event: WiseWebhookEnvelope,
): OccurrenceIds {
  const deliveryId = headers.get("X-Delivery-Id")?.trim() || null;
  const data = event.data ?? {};
  const profileId = data.resource?.profile_id;
  const stepId = data.step_id;

  let occurrenceId: string;
  if (stepId !== undefined && stepId !== null && String(stepId) !== "") {
    occurrenceId = `step:${profileId ?? "unknown"}:${stepId}`;
  } else if (deliveryId) {
    occurrenceId = `delivery:${deliveryId}`;
  } else {
    occurrenceId = [
      "occ",
      profileId ?? "unknown",
      data.occurred_at ?? event.sent_at ?? "unknown",
      String(data.amount ?? "na"),
      data.currency ?? "na",
      data.transaction_type ?? "na",
      String(data.balance_id ?? "na"),
    ].join(":");
  }

  return {
    deliveryId,
    occurrenceId,
    externalId: `wise:${occurrenceId}`,
  };
}

function normalizeTransactionType(
  raw: string | undefined,
  amount: number | string | undefined,
): "credit" | "debit" | null {
  const t = raw?.trim().toLowerCase();
  if (t === "credit" || t === "debit") return t;
  if (typeof amount === "number" && amount < 0) return "debit";
  if (typeof amount === "string" && amount.trim().startsWith("-")) return "debit";
  if (amount !== undefined && amount !== null && amount !== "") return "credit";
  return null;
}

function isInternalConversion(channelName: string | undefined): boolean {
  if (!channelName) return false;
  return INTERNAL_CONVERSION_CHANNELS.has(channelName.trim().toUpperCase());
}

/**
 * Map Wise balances#update → Fiskl POST /v1/transactions body.
 * Pure function: no I/O, no Wise statement calls, no money movement.
 */
export function mapWiseBalanceUpdateToFiskl(
  event: WiseWebhookEnvelope,
  config: WorkerConfig,
  ids: OccurrenceIds,
): MapResult {
  const eventType = event.event_type?.trim();
  if (eventType && eventType !== "balances#update") {
    return {
      kind: "skip",
      reason: "unsupported_event",
      detail: eventType,
    };
  }

  const data = event.data;
  if (!data) {
    return { kind: "skip", reason: "missing_fields", detail: "data" };
  }

  const profileId = data.resource?.profile_id;
  const currency = data.currency?.trim().toUpperCase();
  const occurredAt = data.occurred_at;
  const transactionType = normalizeTransactionType(
    data.transaction_type,
    data.amount,
  );

  if (
    profileId === undefined ||
    profileId === null ||
    profileId === "" ||
    !currency ||
    data.amount === undefined ||
    data.amount === null ||
    data.amount === "" ||
    !transactionType
  ) {
    return {
      kind: "skip",
      reason: "missing_fields",
      detail: "profile_id|currency|amount|transaction_type",
    };
  }

  const profileKey = String(profileId);
  const accountId = config.profileToFisklAccount.get(profileKey);
  if (accountId === undefined) {
    return {
      kind: "skip",
      reason: "unmapped_profile",
      detail: profileKey,
    };
  }
  if (accountId <= 0) {
    return {
      kind: "skip",
      reason: "placeholder_account",
      detail: profileKey,
    };
  }

  let amountMinor: number;
  try {
    amountMinor = toUnsignedMinorUnits(data.amount, currency);
  } catch (error) {
    return {
      kind: "skip",
      reason: "missing_fields",
      detail: error instanceof Error ? error.message : "invalid amount",
    };
  }

  if (amountMinor === 0) {
    return { kind: "skip", reason: "zero_amount", detail: "0" };
  }

  const channel = data.channel_name?.trim() || "UNKNOWN";
  const internal = isInternalConversion(channel);
  const moneyIn = transactionType === "credit";

  let type: FisklTransactionType = moneyIn ? "INCOME" : "EXPENSE";
  if (internal) {
    if (!config.conversionCounterpartyAccountId) {
      return {
        kind: "skip",
        reason: "internal_conversion_skipped",
        detail: channel,
      };
    }
    type = "TRANSFER";
  }

  const label = profileLabel(profileKey, config);
  const major = formatMajor(amountMinor, currency);
  const reference = data.transfer_reference?.trim();
  const nameParts = [`[${label}]`, "Wise"];
  if (reference) nameParts.push(reference);
  else nameParts.push(channel, transactionType, `${currency} ${major}`);
  const name = nameParts.join(" ").slice(0, 240);

  let date: string;
  try {
    date = toIsoDateUtc(occurredAt, new Date());
  } catch {
    return {
      kind: "skip",
      reason: "missing_fields",
      detail: "occurred_at",
    };
  }

  const categoryId = moneyIn
    ? config.defaultIncomeCategoryId
    : config.defaultExpenseCategoryId;

  const body: FisklTransactionRequest = {
    externalId: ids.externalId,
    type,
    accountId,
    date,
    amount: amountMinor,
    currencyCode: currency,
    name,
    description: [
      `wise.channel=${channel}`,
      `wise.transaction_type=${transactionType}`,
      data.step_id !== undefined ? `wise.step_id=${data.step_id}` : null,
      data.balance_id !== undefined ? `wise.balance_id=${data.balance_id}` : null,
      `wise.profile_id=${profileKey}`,
    ]
      .filter(Boolean)
      .join(" "),
    reference: reference || (data.step_id !== undefined ? String(data.step_id) : undefined),
  };

  if (type === "TRANSFER") {
    if (moneyIn) {
      body.accountId = config.conversionCounterpartyAccountId!;
      body.transferToAccountId = accountId;
    } else {
      body.transferToAccountId = config.conversionCounterpartyAccountId!;
    }
    body.transferToAmount = amountMinor;
  } else {
    body.lines = [{ amount: amountMinor, categoryId }];
  }

  return { kind: "post", body };
}
