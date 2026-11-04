import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const scriptsDir = join(srcDir, "..", "scripts");

function collectTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectTs(path);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".mjs") ? [path] : [];
  });
}

describe("BR / money-movement guards", () => {
  it("never calls Wise balance-statement or payout endpoints", () => {
    const files = [...collectTs(srcDir), ...collectTs(scriptsDir)];
    const forbidden = [
      "balance-statements",
      "balance_statements",
      "/statement",
      "/v1/transfers",
      "/v2/transfers",
      "/v3/transfers",
      "payouts",
      "fund-transfer",
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const needle of forbidden) {
        expect(text, `${file} contains ${needle}`).not.toContain(needle);
      }
    }
  });
});
