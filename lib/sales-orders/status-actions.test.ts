import { describe, expect, it } from "vitest";
import { salesOrderStatusActions } from "./status-actions";
import { SALES_ORDER_STATUSES, isSalesOrderTransitionAllowed } from "./validation";

type Role = "owner" | "manager" | "employee";
const shown = (role: Role, status: (typeof SALES_ORDER_STATUSES)[number]) =>
  salesOrderStatusActions(role, status).map((a) => a.status);

describe("salesOrderStatusActions", () => {
  it.each(["owner", "manager"] as const)("%s: draft → confirm, cancel; confirmed → complete, cancel", (role) => {
    expect(shown(role, "draft")).toEqual(["confirmed", "cancelled"]);
    expect(shown(role, "confirmed")).toEqual(["completed", "cancelled"]);
  });

  it("employee: only Confirm, only on a draft", () => {
    expect(shown("employee", "draft")).toEqual(["confirmed"]);
    expect(shown("employee", "confirmed")).toEqual([]);
  });

  it.each(["completed", "cancelled"] as const)("no actions for the terminal status %s", (status) => {
    for (const role of ["owner", "manager", "employee"] as const) expect(shown(role, status)).toEqual([]);
  });

  it("never shows an invalid transition or a change back to draft", () => {
    for (const role of ["owner", "manager", "employee"] as const)
      for (const from of SALES_ORDER_STATUSES)
        for (const to of shown(role, from)) {
          expect(to).not.toBe("draft");
          expect(isSalesOrderTransitionAllowed(from, to)).toBe(true);
        }
  });

  it("labels the buttons and asks for confirmation", () => {
    const actions = salesOrderStatusActions("owner", "confirmed");
    expect(actions.map((a) => a.label)).toEqual(["Mark completed", "Cancel sales order"]);
    expect(actions[1].tone).toBe("danger");
    for (const a of actions) expect(a.confirm).toMatch(/\?/);
  });
});
