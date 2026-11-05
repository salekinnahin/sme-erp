import type { Role } from "@/lib/tenancy/context";
import type { StatusActionPresentation } from "@/lib/quotations/status-actions";
import { availableInvoiceStatusChanges } from "./permissions";
import type { InvoiceStatus, InvoiceUserTargetStatus } from "./validation";

/**
 * Status buttons for the invoice detail page. Which buttons appear comes
 * only from availableInvoiceStatusChanges() (the Part 1 transition table
 * and role rules); this file only adds wording. set_invoice_status()
 * re-checks the role and the transition against the locked row, so a hidden
 * button is never the protection.
 */

export const INVOICE_STATUS_ACTION_PRESENTATION: Record<
  InvoiceUserTargetStatus,
  StatusActionPresentation
> = {
  issued: {
    label: "Issue invoice",
    confirm: "Issue this invoice? Its content can no longer be edited after this.",
    pendingText: "Issuing…",
    tone: "primary",
  },
  cancelled: {
    label: "Cancel invoice",
    confirm: "Cancel this invoice? This cannot be undone.",
    pendingText: "Cancelling…",
    tone: "danger",
  },
};

export type InvoiceStatusAction = StatusActionPresentation & { status: InvoiceUserTargetStatus };

/** The status buttons to show for this role and current status. */
export function invoiceStatusActions(
  role: Role,
  status: InvoiceStatus,
): InvoiceStatusAction[] {
  return availableInvoiceStatusChanges(role, status).map((to) => ({
    status: to,
    ...INVOICE_STATUS_ACTION_PRESENTATION[to],
  }));
}
