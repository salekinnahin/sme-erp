import type { QuotationWriteFailure } from "./errors";
import { itemErrorsByKey } from "./form";
import type { QuotationFieldErrors, QuotationItemErrors } from "./validation";

/**
 * Safe, user-facing messages for quotation write failures. Raw database
 * messages never reach the browser: domain functions return a reason
 * (errors.ts) and log details on the server only.
 */

export const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
export const FIX_FIELDS_ERROR = "Please fix the highlighted fields.";
export const UNREADABLE_ITEMS_ERROR =
  "The line items could not be read. Please reload the page and try again.";

export const QUOTATION_FAILURE_MESSAGES: Record<QuotationWriteFailure, string> = {
  invalid: "Some details are not valid. Please check the form and try again.",
  forbidden: "You don't have permission to do that.",
  not_found: "This quotation could not be found. It may not exist, or you may not have access to it.",
  invalid_reference:
    "A customer or product on this quotation is no longer available. Check your choices and try again.",
  not_draft: "This quotation is no longer a draft, so it can't be edited.",
  invalid_transition:
    "This status change is not possible from the quotation's current status. Reload the page to see its latest status.",
  failed: GENERIC_ERROR,
};

export type QuotationFormState = {
  error?: string;
  fieldErrors?: QuotationFieldErrors;
  /** Errors per line, keyed by the line's client key. */
  itemErrors?: Record<string, QuotationItemErrors>;
};

/**
 * Form state for a failed create or update. Per-field and per-line errors
 * (inactive customer, inactive product, missing price, discount too large,
 * …) stay next to their fields; everything else is one safe message.
 */
export function quotationFailureState(
  failure: {
    reason: QuotationWriteFailure;
    fieldErrors?: QuotationFieldErrors;
    itemErrors?: (QuotationItemErrors | undefined)[];
  },
  keys: readonly string[],
): QuotationFormState {
  const itemErrors = itemErrorsByKey(keys, failure.itemErrors);
  const fieldErrors = failure.fieldErrors ?? {};
  if (
    failure.reason === "invalid" &&
    (Object.keys(fieldErrors).length > 0 || Object.keys(itemErrors).length > 0)
  )
    return { error: FIX_FIELDS_ERROR, fieldErrors, itemErrors };
  return { error: QUOTATION_FAILURE_MESSAGES[failure.reason] };
}
