import { describe, expect, it } from "vitest";
import { calculateLine, calculateTotals, type LineAmounts, type LineInput } from "./calculations";

// The expected values match supabase/tests/quotations.sql, so the TypeScript
// and SQL calculations are pinned to the same results.

function line(input: Partial<LineInput> & Pick<LineInput, "quantity" | "unitPrice">): LineAmounts {
  const result = calculateLine({ discountAmount: "0", taxRate: "0", ...input });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("calculateLine", () => {
  it("computes gross, discount, tax and line total", () => {
    expect(line({ quantity: "2.5", unitPrice: "100.00", discountAmount: "10.00", taxRate: "15" })).toEqual({
      gross: "250.00",
      discountAmount: "10.00",
      taxableAmount: "240.00",
      taxAmount: "36.00",
      lineTotal: "276.00",
    });
    expect(line({ quantity: "3", unitPrice: "33.33", taxRate: "7.5" })).toMatchObject({
      gross: "99.99",
      taxAmount: "7.50", // 7.49925
      lineTotal: "107.49",
    });
  });

  it("rounds half up to 2 decimals", () => {
    expect(line({ quantity: "1.005", unitPrice: "1.00" }).lineTotal).toBe("1.01");
    expect(line({ quantity: "1", unitPrice: "10.00", taxRate: "0.05" }).taxAmount).toBe("0.01");
    expect(line({ quantity: "0.001", unitPrice: "0.01" }).lineTotal).toBe("0.00");
    expect(
      line({ quantity: "3", unitPrice: "19.99", discountAmount: "0.97", taxRate: "12.5" }),
    ).toMatchObject({ gross: "59.97", taxableAmount: "59.00", taxAmount: "7.38", lineTotal: "66.38" });
    // 0.333 × 1.50 = 0.4995 -> 0.50 (not 0.49)
    expect(line({ quantity: "0.333", unitPrice: "1.50" }).gross).toBe("0.50");
  });

  it("is exact where floating point is not", () => {
    // 0.1 + 0.2 style errors: 3 × 0.10 = 0.30 exactly, 1.15 × 100 = 115.00.
    expect(line({ quantity: "3", unitPrice: "0.10" }).gross).toBe("0.30");
    expect(line({ quantity: "1.15", unitPrice: "100" }).gross).toBe("115.00");
    expect(
      line({ quantity: "999999999999999.999", unitPrice: "0.01" }).gross,
    ).toBe("10000000000000.00");
  });

  it("allows a discount equal to the gross amount, not more", () => {
    expect(line({ quantity: "1", unitPrice: "5", discountAmount: "5" }).lineTotal).toBe("0.00");
    expect(
      calculateLine({ quantity: "2", unitPrice: "5", discountAmount: "10.01", taxRate: "0" }),
    ).toEqual({ ok: false, error: "discount_exceeds_gross" });
  });

  it("handles 0% and 100% tax", () => {
    expect(line({ quantity: "1", unitPrice: "80", taxRate: "0" }).lineTotal).toBe("80.00");
    expect(line({ quantity: "1", unitPrice: "80", taxRate: "100" }).lineTotal).toBe("160.00");
  });

  it("rejects amounts that do not fit numeric(18,2)", () => {
    expect(
      calculateLine({ quantity: "999999999999999", unitPrice: "9999999999999999.99", discountAmount: "0", taxRate: "0" }),
    ).toEqual({ ok: false, error: "too_large" });
    expect(
      calculateLine({ quantity: "1", unitPrice: "9999999999999999.99", discountAmount: "0", taxRate: "1" }),
    ).toEqual({ ok: false, error: "too_large" });
    expect(
      calculateLine({ quantity: "1", unitPrice: "9999999999999999.99", discountAmount: "0", taxRate: "0" }).ok,
    ).toBe(true);
  });
});

describe("calculateTotals", () => {
  it("sums gross, discounts and tax", () => {
    const lines = [
      line({ quantity: "1.005", unitPrice: "1.00" }),
      line({ quantity: "1", unitPrice: "10.00", taxRate: "0.05" }),
      line({ quantity: "0.001", unitPrice: "0.01" }),
      line({ quantity: "3", unitPrice: "19.99", discountAmount: "0.97", taxRate: "12.5" }),
      line({ quantity: "1", unitPrice: "5", discountAmount: "5" }),
    ];
    expect(calculateTotals(lines)).toEqual({
      ok: true,
      value: { subtotal: "75.98", discountTotal: "5.97", taxTotal: "7.39", grandTotal: "77.40" },
    });
  });

  it("grand total equals the sum of line totals", () => {
    const lines = [
      line({ quantity: "2.5", unitPrice: "100.00", discountAmount: "10.00", taxRate: "15" }),
      line({ quantity: "3", unitPrice: "33.33", taxRate: "7.5" }),
    ];
    const totals = calculateTotals(lines);
    expect(totals).toEqual({
      ok: true,
      value: { subtotal: "349.99", discountTotal: "10.00", taxTotal: "43.50", grandTotal: "383.49" },
    });
  });

  it("is zero for no lines and rejects totals over numeric(18,2)", () => {
    expect(calculateTotals([])).toEqual({
      ok: true,
      value: { subtotal: "0.00", discountTotal: "0.00", taxTotal: "0.00", grandTotal: "0.00" },
    });
    const big = line({ quantity: "1", unitPrice: "9999999999999999.99" });
    expect(calculateTotals([big, big])).toEqual({ ok: false, error: "too_large" });
  });
});
