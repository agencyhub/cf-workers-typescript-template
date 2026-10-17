import { describe, expect, it } from "vitest";
import {
  importWiseKeysForTests,
  verifyWiseSignature,
  WISE_PRODUCTION_PUBLIC_KEY,
  WISE_SANDBOX_PUBLIC_KEY,
} from "../src/wise-signature";

describe("Wise signature keys", () => {
  it("imports the published production and sandbox SPKI keys", async () => {
    const keys = await importWiseKeysForTests();
    expect(keys.production.type).toBe("public");
    expect(keys.sandbox.type).toBe("public");
    expect(WISE_PRODUCTION_PUBLIC_KEY).toContain("BEGIN PUBLIC KEY");
    expect(WISE_SANDBOX_PUBLIC_KEY).toContain("BEGIN PUBLIC KEY");
  });

  it("accepts a matching RSASSA-PKCS1-v1_5 SHA-256 signature and rejects a bad one", async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const body = new TextEncoder().encode('{"event_type":"balances#update"}');
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      body,
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pair.publicKey,
      signature,
      body,
    );
    expect(ok).toBe(true);

    const wiseOk = await verifyWiseSignature(
      body,
      btoa(String.fromCharCode(...new Uint8Array(signature))),
      "production",
    );
    expect(wiseOk).toBe(false);
  });
});
