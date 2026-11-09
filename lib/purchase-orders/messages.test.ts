import { describe, expect, it, vi } from "vitest";
import { purchaseOrderWriteFailure, type PurchaseOrderWriteFailure } from "./errors";
import {
  FIX_FIELDS_ERROR,
  PURCHASE_ORDER_FAILURE_MESSAGES,
  isStaleFailure,
  purchaseOrderFailureState,
  purchaseOrderStatusFailureMessage,
} from "./messages";

const REASONS: PurchaseOrderWriteFailure[] = [
  "invalid", "forbidden", "not_found", "invalid_reference", "not_draft",
  "invalid_transition", "reserved_receiving_status", "product_type_changed", "failed",
];

describe("purchase order messages", () => {
  it("has a safe message for every reason, never a database detail", () => {
    for (const reason of REASONS) {
      expect(PURCHASE_ORDER_FAILURE_MESSAGES[reason]).toBeTruthy();
      expect(PURCHASE_ORDER_FAILURE_MESSAGES[reason]).not.toMatch(/sql|constraint|violat|23503|P0002|55000|purchase_orders_/i);
    }
  });

  it.each([
    ["23503", "createPurchaseOrder", /vendor or product .* no longer available/i],
    ["55000", "updatePurchaseOrderDraft", /no longer a draft/],
    ["55000", "setPurchaseOrderStatus", /latest status/],
    ["P0002", "setPurchaseOrderStatus", /could not be found/],
    ["22P02", "updatePurchaseOrderDraft", /could not be found/],
    ["22008", "createPurchaseOrder", /not valid/],
    ["22003", "createPurchaseOrder", /not valid/],
    ["42501", "setPurchaseOrderStatus", /permission/],
    ["XX000", "createPurchaseOrder", /Something went wrong/],
  ] as const)("maps SQLSTATE %s from %s to friendly text", (code, op, text) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const reason = purchaseOrderWriteFailure(op, { code, message: 'relation "purchase_orders" secret detail' });
    expect(PURCHASE_ORDER_FAILURE_MESSAGES[reason]).toMatch(text);
    expect(PURCHASE_ORDER_FAILURE_MESSAGES[reason]).not.toContain("secret");
    log.mockRestore();
  });

  it("stale failures refresh the page; validation failures do not", () => {
    expect(REASONS.filter(isStaleFailure)).toEqual(["not_found", "not_draft", "invalid_transition"]);
  });

  it("keeps per-field / per-line errors (inactive vendor, missing purchase price, line mismatch) next to their fields", () => {
    const state = purchaseOrderFailureState(
      {
        reason: "invalid",
        fieldErrors: { vendorId: "This vendor is inactive. Choose an active vendor." },
        itemErrors: [
          { unitPrice: "Enter a unit price. This product has no purchase price." },
          { lineId: "This line no longer exists. Reload the purchase order and try again." },
        ],
      },
      ["a", "b"],
    );
    expect(state).toEqual({
      error: FIX_FIELDS_ERROR,
      fieldErrors: { vendorId: "This vendor is inactive. Choose an active vendor." },
      itemErrors: {
        a: { unitPrice: "Enter a unit price. This product has no purchase price." },
        b: { lineId: "This line no longer exists. Reload the purchase order and try again." },
      },
    });
    expect(purchaseOrderFailureState({ reason: "not_draft" }, [])).toEqual({ error: PURCHASE_ORDER_FAILURE_MESSAGES.not_draft });
    expect(purchaseOrderFailureState({ reason: "invalid" }, [])).toEqual({ error: PURCHASE_ORDER_FAILURE_MESSAGES.invalid });
  });
});

describe("ordering refused for retyped inventory products", () => {
  const base = "One or more inventory products have changed type since this purchase order was created. Restore their product type before marking the purchase order as ordered.";
  it("uses the friendly message and names affected lines when known", () => {
    expect(PURCHASE_ORDER_FAILURE_MESSAGES[purchaseOrderWriteFailure("setPurchaseOrderStatus", { code: "ST006" })]).toBe(base);
    expect(purchaseOrderStatusFailureMessage("product_type_changed")).toBe(base);
    expect(purchaseOrderStatusFailureMessage("product_type_changed", [2])).toBe(`${base} Affected line: 2.`);
    expect(purchaseOrderStatusFailureMessage("product_type_changed", [1, 3])).toBe(`${base} Affected lines: 1, 3.`);
  });
  it("leaves other status messages unchanged and is not a stale failure", () => {
    expect(purchaseOrderStatusFailureMessage("invalid_transition", [1])).toBe(PURCHASE_ORDER_FAILURE_MESSAGES.invalid_transition);
    expect(isStaleFailure("product_type_changed")).toBe(false);
  });
});

