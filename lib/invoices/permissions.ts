import type { Role } from "@/lib/tenancy/context";
import {
  INVOICE_TRANSITIONS,
  isInvoiceUserTargetStatus,
  isInvoiceUserTransitionAllowed,
  type InvoiceStatus,
  type InvoiceUserTargetStatus,
} from "./validation";

/**
 * Version 1 invoice permissions.
 *
 * Used by Server Actions and domain functions to reject operations early and
 * by pages to decide which controls to show. The database enforces the same
 * rules: clients cannot write invoices directly; create_invoice(),
 * create_invoice_from_sales_order() and update_invoice_draft() accept any
 * active member; set_invoice_status() allows "issued" for every role,
 * "cancelled" for owners and managers only, and never "partially_paid" or
 * "paid" (reserved for the Payment module).
 */
export type InvoiceAction =
  | "view"
  | "create"
  | "convertSalesOrder"
  | "editDraft"
  | "issue"
  | "cancel";

const PERMISSIONS: Record<InvoiceAction, readonly Role[]> = {
  view: ["owner", "manager", "employee"],
  create: ["owner", "manager", "employee"],
  convertSalesOrder: ["owner", "manager", "employee"],
  editDraft: ["owner", "manager", "employee"],
  issue: ["owner", "manager", "employee"],
  cancel: ["owner", "manager"],
};

export function canInvoice(role: Role, action: InvoiceAction): boolean {
  return PERMISSIONS[action].includes(role);
}

/** The action that moving an invoice to each user-settable status requires. */
export const INVOICE_STATUS_ACTIONS: Record<InvoiceUserTargetStatus, InvoiceAction> = {
  issued: "issue",
  cancelled: "cancel",
};

/**
 * True if the role may move an invoice from `from` to `to`. Payment statuses
 * are never user-settable, whatever the role.
 */
export function canChangeInvoiceStatus(role: Role, from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (!isInvoiceUserTargetStatus(to) || !isInvoiceUserTransitionAllowed(from, to)) return false;
  return canInvoice(role, INVOICE_STATUS_ACTIONS[to]);
}

/** Status changes the role may make from the current status (for the UI). */
export function availableInvoiceStatusChanges(role: Role, from: InvoiceStatus): InvoiceUserTargetStatus[] {
  return INVOICE_TRANSITIONS[from].filter(
    (to): to is InvoiceUserTargetStatus =>
      isInvoiceUserTargetStatus(to) && canInvoice(role, INVOICE_STATUS_ACTIONS[to]),
  );
}

/** Only drafts are editable, by any role that may edit drafts. */
export function canEditInvoice(role: Role, status: InvoiceStatus): boolean {
  return status === "draft" && canInvoice(role, "editDraft");
}
