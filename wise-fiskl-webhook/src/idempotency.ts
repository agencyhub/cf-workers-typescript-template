const DONE = "done";
const PROCESSING = "processing";
const KV_TTL_SECONDS = 60 * 60 * 24 * 90;
// Short TTL is the crash-safety valve: if the Worker dies between claiming an
// occurrence and settling it, a later retry can re-claim once this expires.
const PROCESSING_TTL_SECONDS = 60 * 15;

export function deliveryKvKey(deliveryId: string): string {
  return `delivery:${deliveryId}`;
}

export function occurrenceKvKey(occurrenceId: string): string {
  return `occ:${occurrenceId}`;
}

function keysFor(
  deliveryId: string | null,
  occurrenceId: string,
): string[] {
  return [
    deliveryId ? deliveryKvKey(deliveryId) : null,
    occurrenceKvKey(occurrenceId),
  ].filter((k): k is string => k !== null);
}

export type ClaimResult = "claimed" | "processing" | "done";

/**
 * Claim the occurrence before doing any work so a concurrent retry sees a
 * marker instead of also posting to Fiskl. KV has no put-if-absent, so two
 * truly simultaneous first deliveries can still both claim — that residual
 * race is covered by Fiskl's Idempotency-Key / externalId dedup.
 */
export async function claimOccurrence(
  kv: KVNamespace,
  deliveryId: string | null,
  occurrenceId: string,
): Promise<ClaimResult> {
  const keys = keysFor(deliveryId, occurrenceId);
  const values = await Promise.all(keys.map((key) => kv.get(key)));
  if (values.some((v) => v === DONE)) return "done";
  if (values.some((v) => v === PROCESSING)) return "processing";

  await Promise.all(
    keys.map((key) =>
      kv.put(key, PROCESSING, { expirationTtl: PROCESSING_TTL_SECONDS }),
    ),
  );
  return "claimed";
}

export async function markProcessed(
  kv: KVNamespace,
  deliveryId: string | null,
  occurrenceId: string,
): Promise<void> {
  await Promise.all(
    keysFor(deliveryId, occurrenceId).map((key) =>
      kv.put(key, DONE, { expirationTtl: KV_TTL_SECONDS }),
    ),
  );
}

/** Drop a claim so a later retry can reprocess the event. */
export async function releaseClaim(
  kv: KVNamespace,
  deliveryId: string | null,
  occurrenceId: string,
): Promise<void> {
  await Promise.all(
    keysFor(deliveryId, occurrenceId).map((key) => kv.delete(key)),
  );
}
