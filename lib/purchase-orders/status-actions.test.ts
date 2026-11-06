import { describe, expect, it } from "vitest";
import { canEditPurchaseOrder } from "./permissions";
import { purchaseOrderStatusActions } from "./status-actions";
import { PURCHASE_ORDER_STATUSES } from "./validation";

const roles = ["owner", "manager", "employee"] as const;
const targets = (role: (typeof roles)[number], status: (typeof PURCHASE_ORDER_STATUSES)[number]) =>
  purchaseOrderStatusActions(role, status).map((a) => a.status);

describe("purchase order status actions", () => {
  it.each(roles)("draft: %s may order; only owners/managers cancel", (role) => {
    expect(targets(role, "draft")).toEqual(role === "employee" ? ["ordered"] : ["ordered", "cancelled"]);
  });

  it.each(roles)("ordered: only owners/managers cancel (%s)", (role) => {
    expect(targets(role, "ordered")).toEqual(role === "employee" ? [] : ["cancelled"]);
  });

  it.each(roles)("partially received, received and cancelled have no user actions (%s)", (role) => {
    for (const status of ["partially_received", "received", "cancelled"] as const) expect(targets(role, status)).toEqual([]);
  });

  it("never offers receiving statuses; every action asks for confirmation", () => {
    for (const role of roles)
      for (const status of PURCHASE_ORDER_STATUSES)
        for (const action of purchaseOrderStatusActions(role, status)) {
          expect(["ordered", "cancelled"]).toContain(action.status);
          expect(action.label).not.toMatch(/receiv/i);
          expect(action.confirm).toContain("?");
        }
  });

  it("ordering says it does not change stock", () => {
    expect(purchaseOrderStatusActions("owner", "draft")[0].confirm).toMatch(/Stock is not changed/);
  });

  it.each(roles)("only drafts show Edit (%s)", (role) => {
    for (const status of PURCHASE_ORDER_STATUSES) expect(canEditPurchaseOrder(role, status)).toBe(status === "draft");
  });
});
