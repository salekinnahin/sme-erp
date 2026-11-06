import type { Role } from "@/lib/tenancy/context";
import type { StatusActionPresentation } from "@/lib/quotations/status-actions";
import { availablePurchaseOrderStatusChanges } from "./permissions";
import type { PurchaseOrderStatus, PurchaseOrderUserTargetStatus } from "./validation";

/**
 * Status buttons for the purchase order detail page. Which buttons appear
 * comes only from availablePurchaseOrderStatusChanges() (the Part 1
 * transition table and role rules), which never includes the receiving
 * statuses; this file only adds wording. set_purchase_order_status()
 * re-checks the role and transition against the locked row.
 */

export const PURCHASE_ORDER_STATUS_ACTION_PRESENTATION: Record<
  PurchaseOrderUserTargetStatus,
  StatusActionPresentation
> = {
  ordered: {
    label: "Mark ordered",
    confirm:
      "Mark this purchase order as ordered from the vendor? Its content can no longer be edited after this. Stock is not changed.",
    pendingText: "Ordering…",
    tone: "primary",
  },
  cancelled: {
    label: "Cancel purchase order",
    confirm: "Cancel this purchase order? This cannot be undone.",
    pendingText: "Cancelling…",
    tone: "danger",
  },
};

export type PurchaseOrderStatusAction = StatusActionPresentation & { status: PurchaseOrderUserTargetStatus };

/** The status buttons to show for this role and current status. */
export function purchaseOrderStatusActions(
  role: Role,
  status: PurchaseOrderStatus,
): PurchaseOrderStatusAction[] {
  return availablePurchaseOrderStatusChanges(role, status).map((to) => ({
    status: to,
    ...PURCHASE_ORDER_STATUS_ACTION_PRESENTATION[to],
  }));
}
