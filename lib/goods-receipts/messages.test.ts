import { describe, expect, it } from "vitest";
import { GOODS_RECEIPT_MESSAGES, goodsReceiptFailure, type GoodsReceiptFailure } from "./errors";
import { RECEIVING_STALE_MESSAGE, isStaleReceivingFailure, receivingFailureState } from "./messages";

const reasons = Object.keys(GOODS_RECEIPT_MESSAGES) as GoodsReceiptFailure[];

describe("receive form failure messages", () => {
  it.each(["over_receiving", "fully_received", "conflict"] as const)("maps concurrent %s to the stale review message and a refresh", (reason) => {
    expect(receivingFailureState(reason)).toEqual({ error: RECEIVING_STALE_MESSAGE, stale: true });
  });
  it("maps SQLSTATE conflicts (serialization, deadlock, lock) to the stale message", () => {
    for (const code of ["40001", "40P01", "55P03", "GR003", "GR004"]) {
      expect(receivingFailureState(goodsReceiptFailure({ code }))).toMatchObject({ error: RECEIVING_STALE_MESSAGE, stale: true });
    }
  });
  it("refreshes when the PO is no longer receivable, missing or a line changed", () => {
    for (const reason of ["not_receivable", "not_found", "line_not_found"] as const) {
      expect(receivingFailureState(reason).stale).toBe(true);
    }
    for (const reason of ["forbidden", "invalid", "invalid_quantity", "service", "unknown_product_type", "failed", "invalid_date"] as const) {
      expect(isStaleReceivingFailure(reason)).toBe(false);
    }
  });
  it("puts invalid dates next to the date field", () => {
    expect(receivingFailureState("invalid_date")).toMatchObject({ fieldErrors: { receivedDate: "Enter a valid received date on or after the order date." } });
  });
  it.each(reasons)("%s is a safe, non-technical message", (reason) => {
    const { error, fieldErrors } = receivingFailureState(reason);
    const text = `${error} ${fieldErrors?.receivedDate ?? ""}`;
    expect(text.trim().length).toBeGreaterThan(10);
    expect(text).not.toMatch(/sqlstate|postgres|supabase|\b(GR0\d\d|P0002|42501|23514|40001)\b|stock|inventory/i);
  });
  it("hides unknown database errors", () => {
    expect(receivingFailureState(goodsReceiptFailure({ code: "XX000" }))).toEqual({ error: "Could not record the goods receipt. Please try again." });
  });
});
