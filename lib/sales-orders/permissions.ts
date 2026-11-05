import type { Role } from "@/lib/tenancy/context";
import {
  SALES_ORDER_TRANSITIONS,
  isSalesOrderTransitionAllowed,
  type SalesOrderStatus,
  type SalesOrderTargetStatus,
} from "./validation";

/**
 * Version 1 sales order permissions.
 *
 * Used by Server Actions and domain functions to reject operations early and
 * by pages to decide which controls to show. The database enforces the same
 * rules: clients cannot write sales orders directly; create_sales_order(),
 * create_sales_order_from_quotation() and update_sales_order_draft() accept
 * any active member; set_sales_order_status() allows "confirmed" for every
 * role and "completed" / "cancelled" for owners and managers only.
 */
export type SalesOrderAction =
  | "view"
  | "create"
  | "convertQuotation"
  | "editDraft"
  | "confirm"
  | "complete"
  | "cancel";

const PERMISSIONS: Record<SalesOrderAction, readonly Role[]> = {
  view: ["owner", "manager", "employee"],
  create: ["owner", "manager", "employee"],
  convertQuotation: ["owner", "manager", "employee"],
  editDraft: ["owner", "manager", "employee"],
  confirm: ["owner", "manager", "employee"],
  complete: ["owner", "manager"],
  cancel: ["owner", "manager"],
};

export function canSalesOrder(role: Role, action: SalesOrderAction): boolean {
  return PERMISSIONS[action].includes(role);
}

/** The action that moving a sales order to each status requires. */
export const SALES_ORDER_STATUS_ACTIONS: Record<SalesOrderTargetStatus, SalesOrderAction> = {
  confirmed: "confirm",
  completed: "complete",
  cancelled: "cancel",
};

/** True if the role may move a sales order from `from` to `to`. */
export function canChangeSalesOrderStatus(
  role: Role,
  from: SalesOrderStatus,
  to: SalesOrderStatus,
): boolean {
  if (to === "draft" || !isSalesOrderTransitionAllowed(from, to)) return false;
  return canSalesOrder(role, SALES_ORDER_STATUS_ACTIONS[to]);
}

/** Status changes the role may make from the current status (for the UI). */
export function availableSalesOrderStatusChanges(
  role: Role,
  from: SalesOrderStatus,
): SalesOrderTargetStatus[] {
  return SALES_ORDER_TRANSITIONS[from].filter(
    (to): to is SalesOrderTargetStatus =>
      to !== "draft" && canSalesOrder(role, SALES_ORDER_STATUS_ACTIONS[to]),
  );
}

/** Only drafts are editable, by any role that may edit drafts. */
export function canEditSalesOrder(role: Role, status: SalesOrderStatus): boolean {
  return status === "draft" && canSalesOrder(role, "editDraft");
}
