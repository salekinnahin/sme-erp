import { describe, expect, it } from "vitest";
import { invoiceStatusActions } from "./status-actions";
import { INVOICE_STATUSES } from "./validation";
import { salesOrderConversionView } from "./conversion";
import { salesOrderStatusActions } from "@/lib/sales-orders/status-actions";

const roles = ["owner", "manager", "employee"] as const;

describe("invoice workflow controls", () => {
  it.each(roles)("%s may issue; only owners/managers cancel", (role) => {
    const targets = (status: "draft" | "issued") => invoiceStatusActions(role, status).map(a => a.status);
    expect(targets("draft")).toEqual(role === "employee" ? ["issued"] : ["issued", "cancelled"]);
    expect(targets("issued")).toEqual(role === "employee" ? [] : ["cancelled"]);
    for (const status of INVOICE_STATUSES) {
      for (const action of invoiceStatusActions(role, status)) {
        expect(["issued", "cancelled"]).toContain(action.status);
        expect(action.confirm).toContain("?");
      }
    }
    for (const status of ["partially_paid", "paid", "cancelled"] as const)
      expect(invoiceStatusActions(role, status)).toEqual([]);
  });

  it.each(roles)("%s can convert only a confirmed, uninvoiced order", (role) => {
    expect(salesOrderConversionView(role, "confirmed", null)).toEqual({ kind: "create" });
    for (const status of ["draft", "completed", "cancelled", "bogus"])
      expect(salesOrderConversionView(role, status, null)).toEqual({ kind: "hidden" });
  });

  it("keeps View invoice after cancellation or order completion, never offers reconversion", () => {
    for (const role of roles)
      for (const orderStatus of ["confirmed", "completed"])
        expect(salesOrderConversionView(role, orderStatus, { id: "inv", invoiceNumber: "INV-000001" })).toEqual({
          kind: "view", invoiceId: "inv", invoiceNumber: "INV-000001",
        });
  });

  it("an invoiced order hides Cancel but retains Complete for owners and managers", () => {
    for (const role of ["owner", "manager"] as const) {
      expect(salesOrderStatusActions(role, "confirmed", true).map(a => a.status)).toEqual(["completed"]);
      expect(salesOrderStatusActions(role, "confirmed", false).map(a => a.status)).toEqual(["completed", "cancelled"]);
    }
    expect(salesOrderStatusActions("employee", "confirmed", true)).toEqual([]);
  });
});
