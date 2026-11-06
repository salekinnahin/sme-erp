import { describe, expect, it } from "vitest";
import { purchaseOrderWriteFailure } from "./errors";

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
