import { itemErrorsByKey } from "@/lib/quotations/form";
import { FIX_FIELDS_ERROR, GENERIC_ERROR } from "@/lib/quotations/messages";
import type { PurchaseOrderWriteFailure } from "./errors";
import type { PurchaseOrderFieldErrors, PurchaseOrderItemErrors } from "./validation";

/**
 * Safe, user-facing messages for purchase order write failures. Raw database
 * messages never reach the browser: domain functions return a reason
 * (errors.ts) and log details on the server only.
 */

export { FIX_FIELDS_ERROR, GENERIC_ERROR };
export const UNREADABLE_ITEMS_ERROR =
  "The line items could not be read. Please reload the page and try again.";

export const PURCHASE_ORDER_FAILURE_MESSAGES: Record<PurchaseOrderWriteFailure, string> = {
  invalid: "Some details are not valid. Please check the form and try again.",
  forbidden: "You don't have permission to do that.",
  not_found:
    "This purchase order could not be found. It may not exist, or you may not have access to it.",
  invalid_reference:
    "A vendor or product on this purchase order is no longer available. Choose an active vendor or product and try again.",
  not_draft:
    "This purchase order is no longer a draft, so it can't be edited. Reload it to see its latest status.",
  invalid_transition:
    "This status change is not possible from the purchase order's current status. The page now shows its latest status.",
  reserved_receiving_status:
    "Received statuses are set by goods receiving, not by hand.",
  product_type_changed:
    "One or more inventory products have changed type since this purchase order was created. Restore their product type before marking the purchase order as ordered.",
  failed: GENERIC_ERROR,
};

/** A status failure message, naming the affected lines when the database reported them. */
export function purchaseOrderStatusFailureMessage(reason: PurchaseOrderWriteFailure, affectedLines: readonly number[] = []): string {
  const message = PURCHASE_ORDER_FAILURE_MESSAGES[reason];
  if (reason !== "product_type_changed" || affectedLines.length === 0) return message;
  return `${message} Affected ${affectedLines.length === 1 ? "line" : "lines"}: ${affectedLines.join(", ")}.`;
}

/**
 * Failures after which the page's data is stale (the order changed
 * elsewhere), so the Server Action revalidates the page and it shows the
 * latest state next to the message.
 */
export function isStaleFailure(reason: PurchaseOrderWriteFailure): boolean {
  return reason === "not_draft" || reason === "invalid_transition" || reason === "not_found";
}

export type PurchaseOrderFormState = {
  error?: string;
  fieldErrors?: PurchaseOrderFieldErrors;
  /** Errors per line, keyed by the line's client key. */
  itemErrors?: Record<string, PurchaseOrderItemErrors>;
};

/**
 * Form state for a failed create or update. Per-field and per-line errors
 * (inactive vendor, inactive product, missing purchase price, discount too
 * large, line no longer exists, …) stay next to their fields; everything
 * else is one safe message.
 */
export function purchaseOrderFailureState(
  failure: {
    reason: PurchaseOrderWriteFailure;
    fieldErrors?: PurchaseOrderFieldErrors;
    itemErrors?: (PurchaseOrderItemErrors | undefined)[];
  },
  keys: readonly string[],
): PurchaseOrderFormState {
  const itemErrors = itemErrorsByKey<PurchaseOrderItemErrors>(keys, failure.itemErrors);
  const fieldErrors = failure.fieldErrors ?? {};
  if (
    failure.reason === "invalid" &&
    (Object.keys(fieldErrors).length > 0 || Object.keys(itemErrors).length > 0)
  )
    return { error: FIX_FIELDS_ERROR, fieldErrors, itemErrors };
  return { error: PURCHASE_ORDER_FAILURE_MESSAGES[failure.reason] };
}
