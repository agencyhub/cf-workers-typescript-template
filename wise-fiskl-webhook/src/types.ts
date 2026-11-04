/**
 * Locked against Wise Platform docs (2026Q3):
 * https://docs.wise.com/api-reference/webhook-event/eventbalancesupdate
 *
 * Schema 4.0.0 payload fields used by the mapper:
 * - data.resource.profile_id
 * - data.amount (major units; unsigned in official examples)
 * - data.currency (ISO 4217)
 * - data.transaction_type ("credit" | "debit")
 * - data.channel_name (e.g. TRANSFER, CARD, CONVERSION)
 * - data.occurred_at, data.step_id, data.balance_id, data.transfer_reference
 *
 * Headers: X-Signature-SHA256, X-Delivery-Id, X-Test-Notification
 */

export type WiseTransactionType = "credit" | "debit";

export interface WiseBalanceResource {
  type?: string;
  id?: number | string;
  profile_id?: number | string;
}

export interface WiseBalanceUpdateData {
  resource?: WiseBalanceResource;
  amount?: number | string;
  balance_id?: number | string;
  channel_name?: string;
  currency?: string;
  occurred_at?: string;
  post_transaction_balance_amount?: number | string;
  step_id?: number | string;
  transaction_type?: string;
  transfer_reference?: string;
}

export interface WiseWebhookEnvelope {
  schema_version?: string;
  subscription_id?: string;
  event_type?: string;
  sent_at?: string;
  data?: WiseBalanceUpdateData;
}

export type FisklTransactionType = "EXPENSE" | "INCOME" | "TRANSFER";

export interface FisklTransactionLine {
  amount: number;
  categoryId: number;
}

export interface FisklTransactionRequest {
  externalId: string;
  type: FisklTransactionType;
  accountId: number;
  date: string;
  amount: number;
  currencyCode: string;
  name: string;
  description?: string;
  reference?: string;
  lines?: FisklTransactionLine[];
  transferToAccountId?: number;
  transferToAmount?: number;
}

export type MapSkipReason =
  | "test_notification"
  | "unsupported_event"
  | "missing_fields"
  | "zero_amount"
  | "unmapped_profile"
  | "internal_conversion_skipped"
  | "placeholder_account";

export type MapResult =
  | { kind: "post"; body: FisklTransactionRequest }
  | { kind: "skip"; reason: MapSkipReason; detail: string };
