import { itemErrorsByKey } from "@/lib/quotations/form";
import { FIX_FIELDS_ERROR, GENERIC_ERROR } from "@/lib/quotations/messages";
import type { SalesOrderWriteFailure } from "./errors";
import type {
  ConversionField,
  SalesOrderFieldErrors,
  SalesOrderItemErrors,
} from "./validation";

/**
 * Safe, user-facing messages for sales order write failures. Raw database
 * messages never reach the browser: domain functions return a reason
 * (errors.ts) and log details on the server only.
 */

export { FIX_FIELDS_ERROR, GENERIC_ERROR };
export const UNREADABLE_ITEMS_ERROR =
  "The line items could not be read. Please reload the page and try again.";

export const SALES_ORDER_FAILURE_MESSAGES: Record<SalesOrderWriteFailure, string> = {
  invalid: "Some details are not valid. Please check the form and try again.",
  forbidden: "You don't have permission to do that.",
  not_found:
    "This sales order could not be found. It may not exist, or you may not have access to it.",
  invalid_reference:
    "A customer or product on this sales order is no longer available. Check your choices and try again.",
  not_draft:
    "This sales order is no longer a draft, so it can't be edited. Reload it to see its latest status.",
  invalid_transition:
    "This status change is not possible from the sales order's current status. The page now shows its latest status.",
  quotation_not_accepted:
    "Only an accepted quotation can be converted to a sales order. Reload the quotation to see its latest status.",
  already_converted:
    "This quotation has already been converted to a sales order.",
  failed: GENERIC_ERROR,
};

/** Conversion uses its own wording where the subject is the quotation. */
export const CONVERSION_FAILURE_MESSAGES: Record<SalesOrderWriteFailure, string> = {
  ...SALES_ORDER_FAILURE_MESSAGES,
  invalid: "Check the dates and try again.",
  not_found:
    "This quotation could not be found. It may not exist, or you may not have access to it.",
  invalid_reference: SALES_ORDER_FAILURE_MESSAGES.failed,
  not_draft: SALES_ORDER_FAILURE_MESSAGES.failed,
  invalid_transition: SALES_ORDER_FAILURE_MESSAGES.failed,
};

/**
 * Failures after which the page's data is stale (the order or quotation
 * changed elsewhere), so the Server Action revalidates the page and it shows
 * the latest state next to the message.
 */
export function isStaleFailure(reason: SalesOrderWriteFailure): boolean {
  return (
    reason === "not_draft" ||
    reason === "invalid_transition" ||
    reason === "not_found" ||
    reason === "quotation_not_accepted" ||
    reason === "already_converted"
  );
}

export type SalesOrderFormState = {
  error?: string;
  fieldErrors?: SalesOrderFieldErrors;
  /** Errors per line, keyed by the line's client key. */
  itemErrors?: Record<string, SalesOrderItemErrors>;
};

/**
 * Form state for a failed create or update. Per-field and per-line errors
 * (inactive customer, inactive product, missing price, discount too large,
 * line no longer exists, …) stay next to their fields; everything else is
 * one safe message.
 */
export function salesOrderFailureState(
  failure: {
    reason: SalesOrderWriteFailure;
    fieldErrors?: SalesOrderFieldErrors;
    itemErrors?: (SalesOrderItemErrors | undefined)[];
  },
  keys: readonly string[],
): SalesOrderFormState {
  const itemErrors = itemErrorsByKey<SalesOrderItemErrors>(keys, failure.itemErrors);
  const fieldErrors = failure.fieldErrors ?? {};
  if (
    failure.reason === "invalid" &&
    (Object.keys(fieldErrors).length > 0 || Object.keys(itemErrors).length > 0)
  )
    return { error: FIX_FIELDS_ERROR, fieldErrors, itemErrors };
  return { error: SALES_ORDER_FAILURE_MESSAGES[failure.reason] };
}

export type ConversionFormState = {
  error?: string;
  fieldErrors?: Partial<Record<ConversionField, string>>;
};
