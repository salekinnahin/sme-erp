import { describe, expect, it } from "vitest";
import { affectedPurchaseOrderLines, purchaseOrderWriteFailure } from "./errors";

describe("safe purchase order error mapping", () => {
  it.each(["23514", "23502", "22001", "22003", "22007", "22008", "22023"])("maps invalid fields/dates/lines/amounts (%s)", code => {
    expect(purchaseOrderWriteFailure("createPurchaseOrder", { code })).toBe("invalid");
  });
  it("maps references, IDs, roles, stale edits and reserved statuses", () => {
    expect(purchaseOrderWriteFailure("createPurchaseOrder", { code: "23503" })).toBe("invalid_reference");
    for (const code of ["P0002", "22P02"]) expect(purchaseOrderWriteFailure("updatePurchaseOrderDraft", { code })).toBe("not_found");
    expect(purchaseOrderWriteFailure("updatePurchaseOrderDraft", { code: "55000" })).toBe("not_draft");
    expect(purchaseOrderWriteFailure("setPurchaseOrderStatus", { code: "55000" })).toBe("invalid_transition");
    expect(purchaseOrderWriteFailure("setPurchaseOrderStatus", { code: "42501" })).toBe("forbidden");
    expect(purchaseOrderWriteFailure("setPurchaseOrderStatus", { code: "42501", message: "purchase order receiving status is system controlled" })).toBe("reserved_receiving_status");
  });
});

describe("ordering check (ST006)", () => {
  it("maps to product_type_changed for the status action", () => {
    expect(purchaseOrderWriteFailure("setPurchaseOrderStatus", { code: "ST006", message: "private" })).toBe("product_type_changed");
  });
  it("parses only the strict affected-lines detail", () => {
    expect(affectedPurchaseOrderLines({ code: "ST006", details: "lines: 1" })).toEqual([1]);
    expect(affectedPurchaseOrderLines({ code: "ST006", details: "lines: 1,3,100" })).toEqual([1, 3, 100]);
    for (const details of [undefined, null, 3, "", "lines:", "lines: 0", "lines: 1, 3", "lines: 1;drop", "lines: 1000", "Key (id)=(x)"]) {
      expect(affectedPurchaseOrderLines({ code: "ST006", details })).toEqual([]);
    }
    expect(affectedPurchaseOrderLines({ code: "55000", details: "lines: 1" })).toEqual([]);
  });
});

