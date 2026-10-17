const DONE = "done";
const KV_TTL_SECONDS = 60 * 60 * 24 * 90;

export function deliveryKvKey(deliveryId: string): string {
  return `delivery:${deliveryId}`;
}

export function occurrenceKvKey(occurrenceId: string): string {
  return `occ:${occurrenceId}`;
}

export async function alreadyProcessed(
  kv: KVNamespace,
  deliveryId: string | null,
  occurrenceId: string,
): Promise<boolean> {
  const keys = [
    deliveryId ? deliveryKvKey(deliveryId) : null,
    occurrenceKvKey(occurrenceId),
  ].filter((k): k is string => k !== null);

  const values = await Promise.all(keys.map((key) => kv.get(key)));
  return values.some((v) => v === DONE);
}

export async function markProcessed(
  kv: KVNamespace,
  deliveryId: string | null,
  occurrenceId: string,
): Promise<void> {
  const keys = [
    deliveryId ? deliveryKvKey(deliveryId) : null,
    occurrenceKvKey(occurrenceId),
  ].filter((k): k is string => k !== null);

  await Promise.all(
    keys.map((key) =>
      kv.put(key, DONE, { expirationTtl: KV_TTL_SECONDS }),
    ),
  );
}
