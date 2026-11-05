import type { Role } from "@/lib/tenancy/context";
import {
  QUOTATION_TRANSITIONS,
  isTransitionAllowed,
  type QuotationStatus,
  type QuotationTargetStatus,
} from "./validation";

/**
 * Version 1 quotation permissions.
 *
 * Used by Server Actions and domain functions to reject operations early and
 * by pages to decide which controls to show. The database enforces the same
 * rules: clients cannot write quotations directly, create_quotation() and
 * update_quotation_draft() accept any active member, and
 * set_quotation_status() allows "sent" for every role and the other statuses
 * for owners and managers only. Hiding a control is never the only
 * protection.
 */
export type QuotationAction =
  | "view"
  | "create"
  | "editDraft"
  | "markSent"
  | "accept"
  | "reject"
  | "expire"
  | "cancel";

const PERMISSIONS: Record<QuotationAction, readonly Role[]> = {
  view: ["owner", "manager", "employee"],
  create: ["owner", "manager", "employee"],
  editDraft: ["owner", "manager", "employee"],
  markSent: ["owner", "manager", "employee"],
  accept: ["owner", "manager"],
  reject: ["owner", "manager"],
  expire: ["owner", "manager"],
  cancel: ["owner", "manager"],
};

export function canQuotation(role: Role, action: QuotationAction): boolean {
  return PERMISSIONS[action].includes(role);
}

/** The action that moving a quotation to each status requires. */
export const STATUS_ACTIONS: Record<QuotationTargetStatus, QuotationAction> = {
  sent: "markSent",
  accepted: "accept",
  rejected: "reject",
  expired: "expire",
  cancelled: "cancel",
};

/** True if the role may move a quotation from `from` to `to`. */
export function canChangeQuotationStatus(
  role: Role,
  from: QuotationStatus,
  to: QuotationStatus,
): boolean {
  if (to === "draft" || !isTransitionAllowed(from, to)) return false;
  return canQuotation(role, STATUS_ACTIONS[to]);
}

/** Status changes the role may make from the current status (for the UI). */
export function availableStatusChanges(
  role: Role,
  from: QuotationStatus,
): QuotationTargetStatus[] {
  return QUOTATION_TRANSITIONS[from].filter(
    (to): to is QuotationTargetStatus => to !== "draft" && canQuotation(role, STATUS_ACTIONS[to]),
  );
}

/** Only drafts are editable, by any role that may edit drafts. */
export function canEditQuotation(role: Role, status: QuotationStatus): boolean {
  return status === "draft" && canQuotation(role, "editDraft");
}
