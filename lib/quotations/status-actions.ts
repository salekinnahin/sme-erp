import type { Role } from "@/lib/tenancy/context";
import { availableStatusChanges } from "./permissions";
import type { QuotationStatus, QuotationTargetStatus } from "./validation";

/**
 * Status buttons for the quotation detail page. Which buttons appear comes
 * only from availableStatusChanges() (the Part 1 transition table and role
 * rules); this file only adds wording. set_quotation_status() re-checks the
 * role and the transition against the locked row, so a hidden button is
 * never the protection.
 */

export type StatusActionTone = "primary" | "secondary" | "danger";

export type StatusActionPresentation = {
  label: string;
  /** Question shown before the change is made; every change is final. */
  confirm: string;
  pendingText: string;
  tone: StatusActionTone;
};

export const STATUS_ACTION_PRESENTATION: Record<QuotationTargetStatus, StatusActionPresentation> = {
  sent: {
    label: "Mark sent",
    confirm: "Mark this quotation as sent? It can no longer be edited after this.",
    pendingText: "Marking sent…",
    tone: "primary",
  },
  accepted: {
    label: "Accept",
    confirm: "Mark this quotation as accepted by the customer? This cannot be undone.",
    pendingText: "Accepting…",
    tone: "primary",
  },
  rejected: {
    label: "Reject",
    confirm: "Mark this quotation as rejected by the customer? This cannot be undone.",
    pendingText: "Rejecting…",
    tone: "secondary",
  },
  expired: {
    label: "Expire",
    confirm: "Mark this quotation as expired? This cannot be undone.",
    pendingText: "Expiring…",
    tone: "secondary",
  },
  cancelled: {
    label: "Cancel quotation",
    confirm: "Cancel this quotation? This cannot be undone.",
    pendingText: "Cancelling…",
    tone: "danger",
  },
};

export type StatusAction = StatusActionPresentation & { status: QuotationTargetStatus };

/** The status buttons to show for this role and current status. */
export function quotationStatusActions(role: Role, status: QuotationStatus): StatusAction[] {
  return availableStatusChanges(role, status).map((to) => ({
    status: to,
    ...STATUS_ACTION_PRESENTATION[to],
  }));
}
