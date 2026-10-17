export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.byteLength !== bb.byteLength) {
    let dummy = 0;
    for (let i = 0; i < aa.byteLength; i++) dummy |= aa[i]!;
    for (let i = 0; i < bb.byteLength; i++) dummy |= bb[i]!;
    return dummy < 0;
  }
  let out = 0;
  for (let i = 0; i < aa.byteLength; i++) {
    out |= aa[i]! ^ bb[i]!;
  }
  return out === 0;
}

export function authorizeSharedSecret(
  request: Request,
  secret: string | undefined,
): boolean {
  if (!secret) return true;
  const provided =
    request.headers.get("X-Webhook-Secret") ??
    request.headers.get("X-Shared-Secret") ??
    "";
  return timingSafeEqualString(provided, secret);
}
