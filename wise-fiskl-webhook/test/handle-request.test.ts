import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/handle-request";
import type { WiseWebhookEnvelope } from "../src/types";

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    IDEMPOTENCY: memoryKv(),
    FISKL_API_KEY: "fsk_test",
    FISKL_API_BASE: "https://api.fiskl.com",
    FISKL_COMPANY_ID: "3618",
    FISKL_DEFAULT_EXPENSE_ACCOUNT_ID: "354816",
    FISKL_DEFAULT_INCOME_ACCOUNT_ID: "354765",
    WISE_PERSONAL_PROFILE_ID: "8027831",
    WISE_BUSINESS_PROFILE_ID: "70855943",
    WISE_ENVIRONMENT: "production",
    WISE_REQUIRE_SIGNATURE: "false",
    WISE_PROFILE_TO_FISKL_ACCOUNT:
      '{"8027831":"111111","70855943":"222222"}',
    ...overrides,
  };
}

function creditPayload(): WiseWebhookEnvelope {
  return {
    schema_version: "4.0.0",
    event_type: "balances#update",
    sent_at: "2023-03-08T14:55:39.456Z",
    data: {
      resource: { type: "balance-account", id: 2, profile_id: 70855943 },
      amount: 70,
      balance_id: 111,
      channel_name: "TRANSFER",
      currency: "GBP",
      occurred_at: "2023-03-08T14:55:38.123Z",
      step_id: 1234567,
      transaction_type: "credit",
      transfer_reference: "BNK-1234567",
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("handleRequest", () => {
  it("GET /healthz returns ok", async () => {
    const res = await handleRequest(
      new Request("https://worker.test/healthz"),
      testEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      service: "wise-fiskl-webhook",
    });
  });

  it("acks Wise test notifications with 200 and does not call Fiskl", async () => {
    const fiskl = vi.fn();
    vi.stubGlobal("fetch", fiskl);
    const res = await handleRequest(
      new Request("https://worker.test/wise/balances-update", {
        method: "POST",
        headers: { "X-Test-Notification": "true", "Content-Type": "application/json" },
        body: JSON.stringify(creditPayload()),
      }),
      testEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ok",
      skipped: "test_notification",
    });
    expect(fiskl).not.toHaveBeenCalled();
  });

  it("POSTs Fiskl INCOME and is idempotent on replay", async () => {
    const fiskl = vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    vi.stubGlobal("fetch", fiskl);
    const env = testEnv();
    const body = JSON.stringify(creditPayload());
    const headers = {
      "Content-Type": "application/json",
      "X-Delivery-Id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    };

    const first = await handleRequest(
      new Request("https://worker.test/wise/balances-update", {
        method: "POST",
        headers,
        body,
      }),
      env,
    );
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { externalId: string };
    expect(firstJson.externalId).toBe("wise:step:70855943:1234567");
    expect(fiskl).toHaveBeenCalledTimes(1);

    const posted = JSON.parse(
      (fiskl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(posted).toMatchObject({
      type: "INCOME",
      amount: 7000,
      name: "[BIZ] Wise BNK-1234567",
      accountId: 222222,
    });
    expect(
      (fiskl.mock.calls[0] as unknown as [string, RequestInit])[0],
    ).toBe("https://api.fiskl.com/v1/transactions");

    const second = await handleRequest(
      new Request("https://worker.test/wise/balances-update", {
        method: "POST",
        headers,
        body,
      }),
      env,
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ skipped: "duplicate" });
    expect(fiskl).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when Fiskl rejects so Wise can retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 400 })),
    );
    const res = await handleRequest(
      new Request("https://worker.test/wise/balances-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creditPayload()),
      }),
      testEnv(),
    );
    expect(res.status).toBe(502);
  });

});
