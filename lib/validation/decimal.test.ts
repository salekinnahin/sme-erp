import { describe, expect, it } from "vitest";
import { fromScaled, parseDecimal, rescaleHalfUp, toScaled } from "./decimal";

// parseDecimal is also covered through lib/products/validation.test.ts.

describe("parseDecimal", () => {
  const F = { integerDigits: 15, scale: 3 };

  it("canonicalizes without converting to a number", () => {
    expect(parseDecimal("007.500", F)).toEqual({ ok: true, value: "7.500" });
    expect(parseDecimal(".5", F)).toEqual({ ok: true, value: "0.5" });
    expect(parseDecimal("5.", F)).toEqual({ ok: true, value: "5" });
    expect(parseDecimal("999999999999999.999", F)).toEqual({
      ok: true,
      value: "999999999999999.999",
    });
  });

  it("rejects signs, exponents, separators and other numerals", () => {
    for (const raw of ["-1", "+1", "1e3", "1,000", "١٢", "NaN", "Infinity", "", ".", "1 000"])
      expect(parseDecimal(raw, F).ok).toBe(false);
  });

  it("rejects extra decimals instead of rounding", () => {
    expect(parseDecimal("1.0001", F)).toEqual({ ok: false, error: "scale" });
    expect(parseDecimal("1000000000000000", F)).toEqual({ ok: false, error: "too_large" });
  });
});

describe("scaled BigInt arithmetic", () => {
  it("converts decimal strings to scaled integers and back", () => {
    expect(toScaled("12.5", 2)).toBe(BigInt(1250));
    expect(toScaled("0", 3)).toBe(BigInt(0));
    expect(toScaled("9999999999999999.99", 2)).toBe(BigInt("999999999999999999"));
    expect(fromScaled(BigInt(1250), 2)).toBe("12.50");
    expect(fromScaled(BigInt(5), 2)).toBe("0.05");
    expect(fromScaled(BigInt(0), 2)).toBe("0.00");
    expect(fromScaled(BigInt(42), 0)).toBe("42");
  });

  it("refuses values it would have to round or cannot represent", () => {
    expect(() => toScaled("1.234", 2)).toThrow();
    expect(() => toScaled("-1", 2)).toThrow();
    expect(() => toScaled("1e2", 2)).toThrow();
    expect(() => fromScaled(BigInt(-1), 2)).toThrow();
  });

  it("rounds half up (PostgreSQL round() for non-negative values)", () => {
    expect(rescaleHalfUp(BigInt(1005), 3, 2)).toBe(BigInt(101)); // 1.005 -> 1.01
    expect(rescaleHalfUp(BigInt(1004), 3, 2)).toBe(BigInt(100)); // 1.004 -> 1.00
    expect(rescaleHalfUp(BigInt(4995), 4, 2)).toBe(BigInt(50)); // 0.4995 -> 0.50
    expect(rescaleHalfUp(BigInt(4949), 4, 2)).toBe(BigInt(49)); // no double rounding
    expect(rescaleHalfUp(BigInt(12), 2, 3)).toBe(BigInt(120));
  });
});
