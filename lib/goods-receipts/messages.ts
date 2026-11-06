import { GOODS_RECEIPT_MESSAGES, type GoodsReceiptFailure } from "./errors";
import type { ReceivingFieldErrors, ReceivingLineErrors } from "./receiving";

/**
 * Safe UI messages for the receive form. Raw PostgreSQL/Supabase errors
 * never reach the browser: the domain returns an allowlisted reason
 * (errors.ts) and this maps it to wording.
 */

export const GOODS_RECEIPT_RECORDED_MESSAGE = "Goods receipt recorded successfully.";
export const RECEIVING_STALE_MESSAGE =
  "The received quantities changed since this page was opened. Review the latest remaining quantities and try again.";
export const RECEIVING_FIX_FIELDS_MESSAGE = "Check the highlighted fields and try again.";
export const RECEIVING_UNREADABLE_MESSAGE = "The receiving quantities could not be read. Reload the page and try again.";
export const RECEIVING_GENERIC_MESSAGE = GOODS_RECEIPT_MESSAGES.failed;

export type ReceiveGoodsFormState = {
  error?: string;
  fieldErrors?: ReceivingFieldErrors;
  lineErrors?: ReceivingLineErrors;
  /** The receiving data changed elsewhere; the page was refreshed with the latest summary. */
  stale?: boolean;
};

/**
 * Failures caused by someone else changing the purchase order or its
 * receipts after the page was loaded (another receipt, completion,
 * cancellation, lock/serialization conflict). The action revalidates the
 * page so the latest remaining quantities are shown next to the message.
 */
export function isStaleReceivingFailure(reason: GoodsReceiptFailure): boolean {
  return ["not_receivable", "over_receiving", "fully_received", "conflict", "line_not_found", "not_found"].includes(reason);
}

const FAILURE_MESSAGES: Partial<Record<GoodsReceiptFailure, string>> = {
  not_found: "This purchase order could not be found. It may not exist, or you may not have access to it.",
  not_receivable: "This purchase order can no longer receive goods. The page now shows its latest status.",
  over_receiving: RECEIVING_STALE_MESSAGE,
  fully_received: RECEIVING_STALE_MESSAGE,
  conflict: RECEIVING_STALE_MESSAGE,
  line_not_found: "A line on this purchase order changed. Review the latest lines and try again.",
  service: "Service lines are not applicable for goods receiving.",
  invalid_quantity: "Enter positive quantities with at most 3 decimal places.",
  invalid_date: "Enter a valid received date on or after the order date.",
  forbidden: "You don't have permission to receive goods in this organization.",
  invalid: "Check the receipt details and try again.",
};

export function receivingFailureState(reason: GoodsReceiptFailure): ReceiveGoodsFormState {
  if (reason === "invalid_date")
    return { error: RECEIVING_FIX_FIELDS_MESSAGE, fieldErrors: { receivedDate: FAILURE_MESSAGES.invalid_date } };
  return {
    error: FAILURE_MESSAGES[reason] ?? GOODS_RECEIPT_MESSAGES[reason],
    ...(isStaleReceivingFailure(reason) ? { stale: true } : {}),
  };
}
