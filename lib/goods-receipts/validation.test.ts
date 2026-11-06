import { describe, expect, it } from "vitest";
import { toGoodsReceiptRpcArgs, validateGoodsReceipt } from "./validation";
const PO = "aaaaaaaa-0000-4000-8000-000000000001";
const LINE = "bbbbbbbb-0000-4000-8000-000000000002";
const raw = (q: unknown = "40") => ({ purchaseOrderId: PO, receivedDate: "2026-11-06", notes: " received ", items: [{ purchaseOrderItemId: LINE, receivedQuantity: q }] });
describe("receipt payload validation", () => {
  it("canonicalizes decimals and strips forged values from RPC input", () => {
    const value = raw("00040.010");
    const result = validateGoodsReceipt({ ...value, organizationId: "forged", items: [{ ...value.items[0], product_id: PO, product_name: "forged", sort_order: 99 }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(toGoodsReceiptRpcArgs(result.value)).toEqual({ p_purchase_order_id: PO, p_received_date: "2026-11-06", p_notes: "received", p_items: [{ purchase_order_item_id: LINE, received_quantity: "40.010" }] });
  });
  it.each(["0", "0.000", "-1", "NaN", "Infinity", "1e2", "1.0001", "9999999999999999", "", 1, null])("rejects invalid quantity %s", (q) => {
    expect(validateGoodsReceipt(raw(q))).toEqual({ ok: false, reason: "invalid_quantity" });
  });
  it.each([".001", "1.", "999999999999999.999", "0.001"])("accepts exact positive quantities %s", (q) => {
    expect(validateGoodsReceipt(raw(q)).ok).toBe(true);
  });
  it.each(["2026-02-30", "2026-02-29", "0000-01-01", "infinity", "2026-11-06T00:00:00Z", "", null])("rejects invalid date %s", (receivedDate) => {
    expect(validateGoodsReceipt({ ...raw(), receivedDate })).toEqual({ ok: false, reason: "invalid_date" });
  });
  it("accepts leap dates without timezone conversion", () => {
    const result = validateGoodsReceipt({ ...raw(), receivedDate: "2028-02-29" });
    expect(result.ok && result.value.receivedDate).toBe("2028-02-29");
  });
  it("rejects duplicate IDs regardless of UUID casing", () => {
    const item = raw().items[0];
    expect(validateGoodsReceipt({ ...raw(), items: [item, { ...item, purchaseOrderItemId: LINE.toUpperCase() }] })).toEqual({ ok: false, reason: "invalid" });
  });
  it.each([null, {}, [], { ...raw(), items: [] }, { ...raw(), items: [null] }, { ...raw(), items: Array(101).fill(raw().items[0]) }, { ...raw(), notes: "x".repeat(2001) }, { ...raw(), notes: 123 }])("rejects malformed payload", (value) => {
    expect(validateGoodsReceipt(value).ok).toBe(false);
  });
  it("accepts 100 distinct lines", () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ purchaseOrderItemId: `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, "0")}`, receivedQuantity: "1" }));
    expect(validateGoodsReceipt({ ...raw(), items }).ok).toBe(true);
  });
});
