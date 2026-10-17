import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_PROFILE_ID,
  PERSONAL_PROFILE_ID,
  parseProfileAccountMap,
  type WorkerConfig,
} from "../src/config";
import {
  mapWiseBalanceUpdateToFiskl,
  resolveOccurrenceIds,
} from "../src/map-wise-to-fiskl";
import type { WiseWebhookEnvelope } from "../src/types";

const fixturesDir = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): WiseWebhookEnvelope {
  const raw = readFileSync(join(fixturesDir, "fixtures", name), "utf8");
  return JSON.parse(raw) as WiseWebhookEnvelope;
}

function config(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    fisklApiBase: "https://api.fiskl.com",
    fisklCompanyId: "3618",
    defaultExpenseCategoryId: 354816,
    defaultIncomeCategoryId: 354765,
    conversionCounterpartyAccountId: null,
    personalProfileId: PERSONAL_PROFILE_ID,
    businessProfileId: BUSINESS_PROFILE_ID,
    wiseEnvironment: "production",
    requireSignature: true,
    profileToFisklAccount: new Map([
      [PERSONAL_PROFILE_ID, 111111],
      [BUSINESS_PROFILE_ID, 222222],
    ]),
    ...overrides,
  };
}

describe("mapWiseBalanceUpdateToFiskl", () => {
  it("maps a Wise 4.0.0 credit (business) to Fiskl INCOME in minor units", () => {
    const event = loadFixture("wise-credit.json");
    const ids = resolveOccurrenceIds(
      new Headers({ "X-Delivery-Id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }),
      event,
    );
    const result = mapWiseBalanceUpdateToFiskl(event, config(), ids);

    expect(result.kind).toBe("post");
    if (result.kind !== "post") return;

    expect(result.body).toMatchObject({
      type: "INCOME",
      accountId: 222222,
      amount: 7000,
      currencyCode: "GBP",
      date: "2023-03-08",
      name: "[BIZ] Wise BNK-1234567",
      externalId: "wise:step:70855943:1234567",
    });
    expect(result.body.lines).toEqual([{ amount: 7000, categoryId: 354765 }]);
    expect(result.body.lines?.[0]?.categoryId).toBe(
      config().defaultIncomeCategoryId,
    );
  });

  it("maps a Wise debit (personal) to Fiskl EXPENSE", () => {
    const event = loadFixture("wise-debit.json");
    const ids = resolveOccurrenceIds(new Headers(), event);
    const result = mapWiseBalanceUpdateToFiskl(event, config(), ids);

    expect(result.kind).toBe("post");
    if (result.kind !== "post") return;

    expect(result.body.type).toBe("EXPENSE");
    expect(result.body.accountId).toBe(111111);
    expect(result.body.amount).toBe(960);
    expect(result.body.name).toBe("[PERS] Wise 47500002");
    expect(result.body.lines).toEqual([{ amount: 960, categoryId: 354816 }]);
    expect(result.body.externalId).toMatch(/^wise:occ:8027831:/);
  });

  it("prefixes [BIZ] vs [PERS] from profileId", () => {
    const event = loadFixture("wise-credit.json");
    event.data!.transfer_reference = undefined;
    const biz = mapWiseBalanceUpdateToFiskl(
      event,
      config(),
      resolveOccurrenceIds(new Headers(), event),
    );
    expect(biz.kind).toBe("post");
    if (biz.kind === "post") {
      expect(biz.body.name.startsWith("[BIZ] ")).toBe(true);
    }

    event.data!.resource!.profile_id = 8027831;
    const pers = mapWiseBalanceUpdateToFiskl(
      event,
      config(),
      resolveOccurrenceIds(new Headers(), event),
    );
    expect(pers.kind).toBe("post");
    if (pers.kind === "post") {
      expect(pers.body.name.startsWith("[PERS] ")).toBe(true);
    }
  });

  it("skips internal conversions unless a counterparty cash account is configured", () => {
    const event = loadFixture("wise-credit.json");
    event.data!.channel_name = "CONVERSION";
    const skipped = mapWiseBalanceUpdateToFiskl(
      event,
      config(),
      resolveOccurrenceIds(new Headers(), event),
    );
    expect(skipped).toMatchObject({
      kind: "skip",
      reason: "internal_conversion_skipped",
    });

    const transferred = mapWiseBalanceUpdateToFiskl(
      event,
      config({ conversionCounterpartyAccountId: 999001 }),
      resolveOccurrenceIds(new Headers(), event),
    );
    expect(transferred.kind).toBe("post");
    if (transferred.kind !== "post") return;
    expect(transferred.body.type).toBe("TRANSFER");
    expect(transferred.body.accountId).toBe(999001);
    expect(transferred.body.transferToAccountId).toBe(222222);
    expect(transferred.body.lines).toBeUndefined();

    event.data!.transaction_type = "debit";
    const debitTransferred = mapWiseBalanceUpdateToFiskl(
      event,
      config({ conversionCounterpartyAccountId: 999001 }),
      resolveOccurrenceIds(new Headers(), event),
    );
    expect(debitTransferred.kind).toBe("post");
    if (debitTransferred.kind !== "post") return;
    expect(debitTransferred.body.accountId).toBe(222222);
    expect(debitTransferred.body.transferToAccountId).toBe(999001);
  });

  it("does not treat Wise channel_name TRANSFER as a Fiskl TRANSFER", () => {
    const event = loadFixture("wise-debit.json");
    const result = mapWiseBalanceUpdateToFiskl(
      event,
      config(),
      resolveOccurrenceIds(new Headers(), event),
    );
    expect(result.kind).toBe("post");
    if (result.kind === "post") {
      expect(result.body.type).toBe("EXPENSE");
    }
  });

  it("skips unmapped profiles and placeholder account ids", () => {
    const event = loadFixture("wise-credit.json");
    event.data!.resource!.profile_id = 1;
    const unmapped = mapWiseBalanceUpdateToFiskl(
      event,
      config(),
      resolveOccurrenceIds(new Headers(), event),
    );
    expect(unmapped).toMatchObject({ kind: "skip", reason: "unmapped_profile" });

    event.data!.resource!.profile_id = 70855943;
    const placeholder = mapWiseBalanceUpdateToFiskl(
      event,
      config({
        profileToFisklAccount: new Map([[BUSINESS_PROFILE_ID, 0]]),
      }),
      resolveOccurrenceIds(new Headers(), event),
    );
    expect(placeholder).toMatchObject({
      kind: "skip",
      reason: "placeholder_account",
    });
  });

  it("uses X-Delivery-Id when step_id is absent", () => {
    const event = loadFixture("wise-debit.json");
    const ids = resolveOccurrenceIds(
      new Headers({ "X-Delivery-Id": "delivery-uuid" }),
      event,
    );
    expect(ids.externalId).toBe("wise:delivery:delivery-uuid");
  });
});

describe("parseProfileAccountMap", () => {
  it("accepts string and numeric account ids", () => {
    const map = parseProfileAccountMap(
      '{"8027831":"111111","70855943":222222}',
    );
    expect(map.get("8027831")).toBe(111111);
    expect(map.get("70855943")).toBe(222222);
  });
});
