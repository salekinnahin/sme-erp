import { describe, expect, it } from "vitest";
import * as quotationCalculations from "@/lib/quotations/calculations";
import { calculateLine, calculateTotals, type LineAmounts } from "./calculations";
import { initialInvoiceBalance } from "./validation";

// Invoices reuse the quotation calculation model. These examples are the
// same ones supabase/tests/invoices.sql pins in SQL.

function totals(lines: Parameters<typeof calculateLine>[0][]) {
  const amounts = lines.map((line) => {
    const result = calculateLine(line);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  });
  return { lines: amounts.map((a: LineAmounts) => a.lineTotal), totals: calculateTotals(amounts) };
}

describe("invoice calculations", () => {
  it("is the quotation implementation, not a copy", () => {
    expect(calculateLine).toBe(quotationCalculations.calculateLine);
    expect(calculateTotals).toBe(quotationCalculations.calculateTotals);
  });

  it("matches the direct-create example and its initial balance", () => {
    const result = totals([
      { quantity: "2.5", unitPrice: "100.00", discountAmount: "10.00", taxRate: "15" },
      { quantity: "3", unitPrice: "33.33", discountAmount: "0", taxRate: "7.5" },
    ]);
    expect(result.lines).toEqual(["276.00", "107.49"]);
    expect(result.totals).toEqual({
      ok: true,
      value: { subtotal: "349.99", discountTotal: "10.00", taxTotal: "43.50", grandTotal: "383.49" },
    });
    if (!result.totals.ok) throw new Error("totals");
    expect(initialInvoiceBalance(result.totals.value.grandTotal)).toEqual({ amountPaid: "0.00", amountDue: "383.49" });
  });

  it("matches the converted-sales-order example (decimal quantity, discount, tax rounding)", () => {
    const result = totals([
      { quantity: "2.5", unitPrice: "90.00", discountAmount: "10", taxRate: "15" },
      { quantity: "3", unitPrice: "12.50", discountAmount: "0", taxRate: "7.5" },
    ]);
    expect(result.lines).toEqual(["247.25", "40.31"]);
    expect(result.totals).toEqual({
      ok: true,
      value: { subtotal: "262.50", discountTotal: "10.00", taxTotal: "35.06", grandTotal: "287.56" },
    });
  });

  it("matches the rounding example", () => {
    const result = totals([
      { quantity: "1.005", unitPrice: "1.00", discountAmount: "0", taxRate: "0" },
      { quantity: "1", unitPrice: "10.00", discountAmount: "0", taxRate: "0.05" },
      { quantity: "0.001", unitPrice: "0.01", discountAmount: "0", taxRate: "0" },
      { quantity: "3", unitPrice: "19.99", discountAmount: "0.97", taxRate: "12.5" },
      { quantity: "1", unitPrice: "5", discountAmount: "5", taxRate: "0" },
    ]);
    expect(result.lines).toEqual(["1.01", "10.01", "0.00", "66.38", "0.00"]);
    expect(result.totals).toEqual({
      ok: true,
      value: { subtotal: "75.98", discountTotal: "5.97", taxTotal: "7.39", grandTotal: "77.40" },
    });
  });

  it("rejects a discount over the gross amount and amounts over numeric(18,2)", () => {
    expect(calculateLine({ quantity: "2", unitPrice: "5", discountAmount: "10.01", taxRate: "0" })).toEqual({
      ok: false,
      error: "discount_exceeds_gross",
    });
    expect(
      calculateLine({ quantity: "999999999999999", unitPrice: "9999999999999999.99", discountAmount: "0", taxRate: "0" }),
    ).toEqual({ ok: false, error: "too_large" });
  });
});
