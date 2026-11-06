import { describe, expect, it } from "vitest";
import { availablePurchaseOrderStatusChanges, canChangePurchaseOrderStatus, canEditPurchaseOrder, canPurchaseOrder } from "./permissions";
import { PURCHASE_ORDER_STATUSES, isPurchaseOrderTransitionAllowed, isTerminalPurchaseOrderStatus } from "./validation";

describe("purchase order lifecycle and roles", () => {
  it("allows exactly the user and reserved system transitions", () => {
    expect(PURCHASE_ORDER_STATUSES.flatMap(from => PURCHASE_ORDER_STATUSES.filter(to => isPurchaseOrderTransitionAllowed(from, to)).map(to => `${from}->${to}`))).toEqual([
      "draft->ordered", "draft->cancelled", "ordered->partially_received", "ordered->received", "ordered->cancelled", "partially_received->received",
    ]);
    expect(PURCHASE_ORDER_STATUSES.filter(isTerminalPurchaseOrderStatus)).toEqual(["received", "cancelled"]);
  });
  for (const role of ["owner", "manager", "employee"] as const) {
    it(`${role} can create, edit drafts and order, but never control receiving`, () => {
      for (const action of ["view", "create", "editDraft", "order"] as const) expect(canPurchaseOrder(role, action)).toBe(true);
      expect(canEditPurchaseOrder(role, "draft")).toBe(true);
      for (const state of PURCHASE_ORDER_STATUSES.filter(s => s !== "draft")) expect(canEditPurchaseOrder(role, state)).toBe(false);
      for (const from of PURCHASE_ORDER_STATUSES) {
        expect(canChangePurchaseOrderStatus(role, from, "received")).toBe(false);
        expect(canChangePurchaseOrderStatus(role, from, "partially_received")).toBe(false);
        expect(canChangePurchaseOrderStatus(role, from, from)).toBe(false);
      }
      expect(availablePurchaseOrderStatusChanges(role, "draft")).toEqual(role === "employee" ? ["ordered"] : ["ordered", "cancelled"]);
      expect(availablePurchaseOrderStatusChanges(role, "ordered")).toEqual(role === "employee" ? [] : ["cancelled"]);
      expect(canPurchaseOrder(role, "cancel")).toBe(role !== "employee");
    });
  }
});
