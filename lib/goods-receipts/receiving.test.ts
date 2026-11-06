import { describe, expect, it } from "vitest";
import type { ReceivingLine } from "./calculations";
import {
  NO_QUANTITY_ERROR,
  NOT_RECEIVABLE_LINE_ERROR,
  QUANTITY_FORMAT_ERROR,
  RECEIVING_AVAILABILITY_MESSAGES,
  exactQuantity,
  normalizeReceivingEntries,
  parseReceivingItemsField,
  receiveGoodsAction,
  receivedByDisplay,
  receivedDateError,
  receivingAvailability,
  receivingLineState,
  showsReceivingSummary,
  validateReceivingForm,
  withoutCancelAfterReceipt,
} from "./receiving";

const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const C = "c0000000-0000-4000-8000-00000000000c";
const S = "d0000000-0000-4000-8000-00000000000d";
function line(id: string, ordered: string, received: string, remaining: string, product_type: ReceivingLine["product_type"] = "inventory", sort_order = 1): ReceivingLine {
  return {
    purchase_order_item_id: id, product_id: id, product_name: `P-${id.slice(0, 1)}`, sku: "SKU", description: null, unit: "pcs",
    product_type, receivable: product_type === "inventory" || product_type === "non_inventory",
    ordered_quantity: ordered, received_quantity: received, remaining_quantity: remaining, sort_order,
  };
}
const lines = [
  line(A, "100.000", "0.000", "100.000", "inventory", 1),
  line(B, "50.000", "0.000", "50.000", "non_inventory", 2),
  line(C, "20.000", "0.000", "20.000", "inventory", 3),
  line(S, "1.000", "0.000", "1.000", "service", 4),
];
const form = (quantities: Record<string, string>, receivedDate = "2026-11-07", notes = "") => ({ receivedDate, notes, quantities });

describe("line state and availability", () => {
  it("classifies open, fully received, service and legacy unknown lines", () => {
    expect(receivingLineState(line(A, "100.000", "40.000", "60.000"))).toBe("open");
    expect(receivingLineState(line(A, "50.000", "50.000", "0.000"))).toBe("complete");
    expect(receivingLineState(line(S, "1.000", "0.000", "1.000", "service"))).toBe("service");
    expect(receivingLineState(line(A, "1.000", "0.000", "1.000", null))).toBe("unknown");
  });
  it.each([
    ["draft", lines, "not_receivable"],
    ["cancelled", lines, "not_receivable"],
    ["received", [line(A, "1.000", "1.000", "0.000")], "complete"],
    ["ordered", lines, "open"],
    ["partially_received", [line(A, "100.000", "40.000", "60.000"), line(B, "50.000", "50.000", "0.000")], "open"],
    ["partially_received", [line(A, "50.000", "50.000", "0.000"), line(S, "1.000", "0.000", "1.000", "service")], "complete"],
    ["ordered", [line(S, "1.000", "0.000", "1.000", "service")], "nothing_receivable"],
    ["ordered", [line(A, "1.000", "0.000", "1.000", null), line(B, "1.000", "0.000", "1.000")], "needs_reconciliation"],
  ] as const)("%s → %s", (status, input, expected) => {
    expect(receivingAvailability(status, input)).toBe(expected);
  });
  it("has a friendly terminal message for every non-open state", () => {
    expect(RECEIVING_AVAILABILITY_MESSAGES.complete).toBe("All receivable goods have already been received.");
    for (const message of Object.values(RECEIVING_AVAILABILITY_MESSAGES)) {
      expect(message).not.toMatch(/\b(GR0\d\d|P0002|55000|42501)\b/);
      expect(message).not.toMatch(/sql|postgres|stock|inventory/i);
    }
  });
});

describe("Receive Goods action visibility", () => {
  it.each(["owner", "manager", "employee"] as const)("is available to %s with the same labels (no role differences)", (role) => {
    expect(receiveGoodsAction(role, "ordered", lines)).toEqual({ label: "Receive goods" });
    expect(receiveGoodsAction(role, "partially_received", [line(A, "100.000", "40.000", "60.000")])).toEqual({ label: "Receive remaining goods" });
  });
  it.each(["draft", "received", "cancelled"])("is hidden for %s orders", (status) => {
    expect(receiveGoodsAction("owner", status, lines)).toBeNull();
  });
  it("is hidden when nothing receivable remains, for service-only and legacy-unknown orders, and for unknown roles", () => {
    expect(receiveGoodsAction("owner", "partially_received", [line(A, "5.000", "5.000", "0.000"), line(S, "1.000", "0.000", "1.000", "service")])).toBeNull();
    expect(receiveGoodsAction("owner", "ordered", [line(S, "1.000", "0.000", "1.000", "service")])).toBeNull();
    expect(receiveGoodsAction("owner", "ordered", [line(A, "1.000", "0.000", "1.000", null)])).toBeNull();
    expect(receiveGoodsAction("auditor" as never, "ordered", lines)).toBeNull();
  });
  it("shows the receiving summary only after ordering", () => {
    expect(["draft", "ordered", "partially_received", "received", "cancelled"].map(showsReceivingSummary)).toEqual([false, true, true, true, false]);
  });
  it("drops Cancel once any receipt exists, keeps it otherwise", () => {
    const actions = [{ status: "ordered" }, { status: "cancelled" }];
    expect(withoutCancelAfterReceipt(actions, 0)).toEqual(actions);
    expect(withoutCancelAfterReceipt(actions, 1)).toEqual([{ status: "ordered" }]);
  });
});

describe("receiving form normalization", () => {
  it("omits blank and zero lines and canonicalizes exact decimals", () => {
    expect(normalizeReceivingEntries([
      { purchaseOrderItemId: A, receivedQuantity: " 030 " },
      { purchaseOrderItemId: B, receivedQuantity: "" },
      { purchaseOrderItemId: C, receivedQuantity: "0.000" },
      { purchaseOrderItemId: S, receivedQuantity: "  0 " },
    ])).toEqual({ items: [{ purchaseOrderItemId: A, receivedQuantity: "30" }], lineErrors: {} });
  });
  it.each(["-1", "1e2", "1,000", "1.0001", "abc", "NaN", "Infinity", "1234567890123456"])("rejects %s", (raw) => {
    expect(normalizeReceivingEntries([{ purchaseOrderItemId: A, receivedQuantity: raw }]).lineErrors[A]).toBe(QUANTITY_FORMAT_ERROR);
  });
});

describe("validateReceivingForm", () => {
  it("allows partial receiving: A 30, B 0, C 20 posts only A and C in PO line order", () => {
    expect(validateReceivingForm(form({ [C]: "20", [B]: "0", [A]: "30" }), lines, "2026-11-01")).toEqual({
      ok: true, notes: null,
      items: [{ purchaseOrderItemId: A, receivedQuantity: "30" }, { purchaseOrderItemId: C, receivedQuantity: "20" }],
    });
  });
  it("requires at least one positive quantity", () => {
    const result = validateReceivingForm(form({ [A]: "", [B]: "0" }), lines, "2026-11-01");
    expect(result).toEqual({ ok: false, fieldErrors: { items: NO_QUANTITY_ERROR }, lineErrors: {} });
  });
  it("limits each line to its current remaining quantity with the exact remaining text", () => {
    const partial = [line(A, "100.000", "70.000", "30.000")];
    expect(validateReceivingForm(form({ [A]: "30.001" }), partial, "2026-11-01")).toMatchObject({ ok: false, lineErrors: { [A]: "You can receive a maximum of 30.000." } });
    expect(validateReceivingForm(form({ [A]: "30.000" }), partial, "2026-11-01")).toMatchObject({ ok: true });
  });
  it("compares exactly beyond floating point precision", () => {
    const big = [line(A, "999999999999999.999", "0.001", "999999999999999.998")];
    // As JS numbers these two values are equal.
    expect(Number("999999999999999.999")).toBe(Number("999999999999999.998"));
    expect(validateReceivingForm(form({ [A]: "999999999999999.999" }), big, "2026-11-01")).toMatchObject({ ok: false, lineErrors: { [A]: "You can receive a maximum of 999999999999999.998." } });
    expect(validateReceivingForm(form({ [A]: "999999999999999.998" }), big, "2026-11-01")).toMatchObject({ ok: true, items: [{ receivedQuantity: "999999999999999.998" }] });
  });
  it("never accepts service, fully received or unknown lines", () => {
    const withComplete = [...lines, line(B, "5.000", "5.000", "0.000")];
    for (const id of [S, "e0000000-0000-4000-8000-00000000000e"]) {
      expect(validateReceivingForm(form({ [A]: "1", [id]: "1" }), lines, "2026-11-01")).toMatchObject({ ok: false, lineErrors: { [id]: NOT_RECEIVABLE_LINE_ERROR } });
    }
    expect(validateReceivingForm(form({ [B]: "1" }), withComplete.slice(-1), "2026-11-01")).toMatchObject({ ok: false, lineErrors: { [B]: NOT_RECEIVABLE_LINE_ERROR } });
  });
  it("validates the received date against the order date, with no future limit", () => {
    expect(validateReceivingForm(form({ [A]: "1" }, "2026-10-31"), lines, "2026-11-01")).toMatchObject({ ok: false, fieldErrors: { receivedDate: "The received date can't be before the order date (1 Nov 2026)." } });
    expect(validateReceivingForm(form({ [A]: "1" }, "2026-11-01"), lines, "2026-11-01")).toMatchObject({ ok: true });
    expect(validateReceivingForm(form({ [A]: "1" }, "2099-12-31"), lines, "2026-11-01")).toMatchObject({ ok: true });
  });
  it("trims notes and enforces the 2000-character limit", () => {
    expect(validateReceivingForm(form({ [A]: "1" }, "2026-11-07", "  Second shipment  "), lines, "2026-11-01")).toMatchObject({ ok: true, notes: "Second shipment" });
    expect(validateReceivingForm(form({ [A]: "1" }, "2026-11-07", "x".repeat(2001)), lines, "2026-11-01")).toMatchObject({ ok: false, fieldErrors: { notes: expect.any(String) } });
  });
});

describe("receivedDateError", () => {
  it.each([["", "Enter the received date."], ["2026-02-30", "Enter a valid received date."], ["07/11/2026", "Enter a valid received date."]])("%s", (value, message) => {
    expect(receivedDateError(value, "2026-01-01")).toBe(message);
  });
  it("accepts the order date itself and later dates", () => {
    expect(receivedDateError("2026-11-06", "2026-11-06")).toBeUndefined();
    expect(receivedDateError("2027-01-01", "2026-11-06")).toBeUndefined();
    expect(receivedDateError("2026-11-05", null)).toBeUndefined();
  });
});

describe("parseReceivingItemsField", () => {
  it("keeps only line ID and quantity; product IDs, snapshots and organization are dropped", () => {
    const raw = JSON.stringify([{ purchaseOrderItemId: A.toUpperCase(), receivedQuantity: "3", productId: "x", product_name: "FORGED", organization_id: "x", ordered_quantity_snapshot: "999" }]);
    expect(parseReceivingItemsField(raw)).toEqual([{ purchaseOrderItemId: A, receivedQuantity: "3" }]);
  });
  it.each([
    ["not JSON", "{"],
    ["object", "{}"],
    ["non-uuid line", JSON.stringify([{ purchaseOrderItemId: "1", receivedQuantity: "1" }])],
    ["numeric quantity", JSON.stringify([{ purchaseOrderItemId: A, receivedQuantity: 1 }])],
    ["duplicate line", JSON.stringify([{ purchaseOrderItemId: A, receivedQuantity: "1" }, { purchaseOrderItemId: A.toUpperCase(), receivedQuantity: "1" }])],
    ["too many lines", JSON.stringify(Array.from({ length: 101 }, () => ({ purchaseOrderItemId: A, receivedQuantity: "1" })))],
    ["null entry", "[null]"],
  ])("rejects %s", (_label, raw) => {
    expect(parseReceivingItemsField(raw)).toBeNull();
  });
  it("rejects missing or file values", () => {
    expect(parseReceivingItemsField(null)).toBeNull();
    expect(parseReceivingItemsField(new File(["[]"], "x"))).toBeNull();
  });
});

describe("display helpers", () => {
  it("shows the stored recorder name, or a neutral placeholder when none was recorded", () => {
    expect(receivedByDisplay("Rahim Uddin")).toBe("Rahim Uddin");
    for (const missing of [null, undefined, "", "  "]) expect(receivedByDisplay(missing)).toBe("Name not recorded");
  });
  it("keeps all decimals of exact quantities", () => {
    expect(exactQuantity("1234567.500")).toBe("1,234,567.500");
    expect(exactQuantity("0.000")).toBe("0.000");
    expect(exactQuantity("12")).toBe("12");
  });
});
