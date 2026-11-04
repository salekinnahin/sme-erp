import { describe, expect, it } from "vitest";
import { formatMoney, formatQuantity, plainDecimal } from "./format";

describe("formatMoney", () => {
  it("groups thousands and shows two decimals in the base currency", () => {
    expect(formatMoney("1250.50", "BDT")).toBe("BDT 1,250.50");
    expect(formatMoney("0.00", "USD")).toBe("USD 0.00");
    expect(formatMoney("12", "EUR")).toBe("EUR 12.00");
  });

  it("keeps the largest numeric(18,2) value exact", () => {
    expect(formatMoney("9999999999999999.99", "BDT")).toBe(
      "BDT 9,999,999,999,999,999.99",
    );
  });
});

describe("formatQuantity", () => {
  it("drops trailing zeros", () => {
    expect(formatQuantity("5.000")).toBe("5");
    expect(formatQuantity("2.500")).toBe("2.5");
    expect(formatQuantity("1200.125")).toBe("1,200.125");
    expect(formatQuantity("0.000")).toBe("0");
  });
});

describe("plainDecimal", () => {
  it("drops trailing fractional zeros only", () => {
    expect(plainDecimal("1200.00")).toBe("1200");
    expect(plainDecimal("1000.50")).toBe("1000.5");
    expect(plainDecimal("100")).toBe("100");
    expect(plainDecimal("5.000")).toBe("5");
  });
});
