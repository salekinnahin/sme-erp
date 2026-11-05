import type { Role } from "@/lib/tenancy/context";
import type { StatusActionPresentation } from "@/lib/quotations/status-actions";
import { availableSalesOrderStatusChanges } from "./permissions";
import type { SalesOrderStatus, SalesOrderTargetStatus } from "./validation";

/**
 * Status buttons for the sales order detail page. Which buttons appear comes
 * only from availableSalesOrderStatusChanges() (the Part 1 transition table
 * and role rules); this file only adds wording. set_sales_order_status()
 * re-checks the role and the transition against the locked row, so a hidden
 * button is never the protection.
 */

export const SALES_ORDER_STATUS_ACTION_PRESENTATION: Record<
  SalesOrderTargetStatus,
  StatusActionPresentation
> = {
  confirmed: {
    label: "Confirm",
    confirm: "Confirm this sales order? It can no longer be edited after this.",
    pendingText: "Confirming…",
    tone: "primary",
  },
  completed: {
    label: "Mark completed",
    confirm: "Mark this sales order as completed? This cannot be undone.",
    pendingText: "Completing…",
    tone: "primary",
  },
  cancelled: {
    label: "Cancel sales order",
    confirm: "Cancel this sales order? This cannot be undone.",
    pendingText: "Cancelling…",
    tone: "danger",
  },
};

export type SalesOrderStatusAction = StatusActionPresentation & { status: SalesOrderTargetStatus };

/** The status buttons to show for this role and current status. */
export function salesOrderStatusActions(
  role: Role,
  status: SalesOrderStatus,
  hasInvoice = false,
): SalesOrderStatusAction[] {
  return availableSalesOrderStatusChanges(role, status)
    .filter((to) => !hasInvoice || to !== "cancelled")
    .map((to) => ({ status: to, ...SALES_ORDER_STATUS_ACTION_PRESENTATION[to] }));
}
