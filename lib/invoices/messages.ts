import { itemErrorsByKey } from "@/lib/quotations/form";
import { FIX_FIELDS_ERROR, GENERIC_ERROR } from "@/lib/quotations/messages";
import type { InvoiceWriteFailure } from "./errors";
import type {
  InvoiceConversionField,
  InvoiceFieldErrors,
  InvoiceItemErrors,
} from "./validation";

/**
 * Safe, user-facing messages for invoice write failures. Raw database
 * messages never reach the browser: domain functions return a reason
 * (errors.ts) and log details on the server only.
 */

export { FIX_FIELDS_ERROR, GENERIC_ERROR };
export const UNREADABLE_ITEMS_ERROR =
  "The line items could not be read. Please reload the page and try again.";

export const INVOICE_FAILURE_MESSAGES: Record<InvoiceWriteFailure, string> = {
  invalid: "Some details are not valid. Please check the form and try again.",
  forbidden: "You don't have permission to do that.",
  not_found:
    "This invoice could not be found. It may not exist, or you may not have access to it.",
  invalid_reference:
    "A customer or product on this invoice is no longer available. Check your choices and try again.",
  not_draft:
    "This invoice is no longer a draft, so it can't be edited. Reload it to see its latest status.",
  invalid_transition:
    "This status change is not possible from the invoice's current status. The page now shows its latest status.",
  sales_order_not_confirmed:
    "Only a confirmed sales order can be converted to an invoice. Reload the sales order to see its latest status.",
  already_invoiced:
    "This sales order already has an invoice, including if it was cancelled.",
  failed: GENERIC_ERROR,
};

/** Conversion uses its own wording where the subject is the sales order. */
export const CONVERSION_FAILURE_MESSAGES: Record<InvoiceWriteFailure, string> = {
  ...INVOICE_FAILURE_MESSAGES,
  invalid: "Check the dates and try again.",
  not_found:
    "This sales order could not be found. It may not exist, or you may not have access to it.",
  invalid_reference: INVOICE_FAILURE_MESSAGES.failed,
  not_draft: INVOICE_FAILURE_MESSAGES.failed,
  invalid_transition: INVOICE_FAILURE_MESSAGES.failed,
};

/**
 * Failures after which the page's data is stale (the invoice or sales order
 * changed elsewhere), so the Server Action revalidates the page and it shows
 * the latest state next to the message.
 */
export function isStaleFailure(reason: InvoiceWriteFailure): boolean {
  return (
    reason === "not_draft" ||
    reason === "invalid_transition" ||
    reason === "not_found" ||
    reason === "sales_order_not_confirmed" ||
    reason === "already_invoiced"
  );
}

export type InvoiceFormState = {
  error?: string;
  fieldErrors?: InvoiceFieldErrors;
  /** Errors per line, keyed by the line's client key. */
  itemErrors?: Record<string, InvoiceItemErrors>;
};

/**
 * Form state for a failed create or update. Per-field and per-line errors
 * (inactive customer, inactive product, missing price, discount too large,
 * line no longer exists, …) stay next to their fields; everything else is
 * one safe message.
 */
export function invoiceFailureState(
  failure: {
    reason: InvoiceWriteFailure;
    fieldErrors?: InvoiceFieldErrors;
    itemErrors?: (InvoiceItemErrors | undefined)[];
  },
  keys: readonly string[],
): InvoiceFormState {
  const itemErrors = itemErrorsByKey<InvoiceItemErrors>(keys, failure.itemErrors);
  const fieldErrors = failure.fieldErrors ?? {};
  if (
    failure.reason === "invalid" &&
    (Object.keys(fieldErrors).length > 0 || Object.keys(itemErrors).length > 0)
  )
    return { error: FIX_FIELDS_ERROR, fieldErrors, itemErrors };
  return { error: INVOICE_FAILURE_MESSAGES[failure.reason] };
}

export type ConversionFormState = {
  error?: string;
  fieldErrors?: Partial<Record<InvoiceConversionField, string>>;
};
