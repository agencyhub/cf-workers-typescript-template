import { describe, expect, it } from "vitest";
import { currencyExponent, formatMajor, toUnsignedMinorUnits } from "../src/money";

describe("toUnsignedMinorUnits", () => {
  it("converts Wise major-unit examples to Fiskl minor units", () => {
    expect(toUnsignedMinorUnits(70, "GBP")).toBe(7000);
    expect(toUnsignedMinorUnits(9.6, "GBP")).toBe(960);
    expect(toUnsignedMinorUnits("12.34", "BRL")).toBe(1234);
    expect(toUnsignedMinorUnits(100, "JPY")).toBe(100);
    expect(toUnsignedMinorUnits("1.234", "BHD")).toBe(1234);
  });

  it("treats signed Wise amounts as unsigned (direction is transaction_type)", () => {
    expect(toUnsignedMinorUnits(-9.6, "GBP")).toBe(960);
  });

  it("uses ISO exponents", () => {
    expect(currencyExponent("BRL")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
    expect(formatMajor(1234, "BRL")).toBe("12.34");
  });
});
