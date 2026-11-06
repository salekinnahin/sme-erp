import type { Role } from "@/lib/tenancy/context";
import {
  PURCHASE_ORDER_TRANSITIONS,
  isPurchaseOrderUserTargetStatus,
  isPurchaseOrderUserTransitionAllowed,
  type PurchaseOrderStatus,
  type PurchaseOrderUserTargetStatus,
} from "./validation";

/** All active roles may create, edit drafts and order. Only owners/managers
 * cancel. Goods Receiving alone will control receiving statuses. SQL enforces
 * these permissions independently of the caller's UI/server checks. */
export type PurchaseOrderAction =
  | "view"
  | "create"
  | "editDraft"
  | "order"
  | "cancel";

const PERMISSIONS: Record<PurchaseOrderAction, readonly Role[]> = {
  view: ["owner", "manager", "employee"],
  create: ["owner", "manager", "employee"],
  editDraft: ["owner", "manager", "employee"],
  order: ["owner", "manager", "employee"],
  cancel: ["owner", "manager"],
};

export function canPurchaseOrder(role: Role, action: PurchaseOrderAction): boolean {
  return PERMISSIONS[action].includes(role);
}

/** The action that moving a purchase order to each user-settable status requires. */
export const PURCHASE_ORDER_STATUS_ACTIONS: Record<PurchaseOrderUserTargetStatus, PurchaseOrderAction> = {
  ordered: "order",
  cancelled: "cancel",
};

/**
 * True if the role may move a purchase order from `from` to `to`. Receiving statuses
 * are never user-settable, whatever the role.
 */
export function canChangePurchaseOrderStatus(role: Role, from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  if (!isPurchaseOrderUserTargetStatus(to) || !isPurchaseOrderUserTransitionAllowed(from, to)) return false;
  return canPurchaseOrder(role, PURCHASE_ORDER_STATUS_ACTIONS[to]);
}

/** Status changes the role may make from the current status (for the UI). */
export function availablePurchaseOrderStatusChanges(role: Role, from: PurchaseOrderStatus): PurchaseOrderUserTargetStatus[] {
  return PURCHASE_ORDER_TRANSITIONS[from].filter(
    (to): to is PurchaseOrderUserTargetStatus =>
      isPurchaseOrderUserTargetStatus(to) && canPurchaseOrder(role, PURCHASE_ORDER_STATUS_ACTIONS[to]),
  );
}

/** Only drafts are editable, by any role that may edit drafts. */
export function canEditPurchaseOrder(role: Role, status: PurchaseOrderStatus): boolean {
  return status === "draft" && canPurchaseOrder(role, "editDraft");
}
