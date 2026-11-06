/**
 * Write failures of the purchase order domain functions. Server Actions map
 * each reason to a safe message; database details are only logged on the
 * server.
 */
export type PurchaseOrderWriteFailure =
  | "invalid"
  | "forbidden"
  /** Purchase order missing or of another tenant. */
  | "not_found"
  /** Vendor or product missing, of another organization, or inactive. */
  | "invalid_reference"
  /** The purchase order is no longer a draft (edit). */
  | "not_draft"
  /** The status change is not allowed from the current status. */
  | "invalid_transition"
  | "reserved_receiving_status"
  | "failed";

export type PurchaseOrderOperation =
  | "createPurchaseOrder"
  | "updatePurchaseOrderDraft"
  | "setPurchaseOrderStatus";

/** Safe SQLSTATE mapping; details never need to reach future UI. */
export function purchaseOrderWriteFailure(
  operation: PurchaseOrderOperation,
  error: { code?: string; message?: string },
): PurchaseOrderWriteFailure {
  switch (error.code) {
    case "23503": // foreign_key_violation: vendor / product not usable
      return "invalid_reference";
    case "55000":
      if (operation === "setPurchaseOrderStatus") return "invalid_transition";
      return "not_draft";
    case "23514": // check_violation
    case "23502": // not_null_violation
    case "22001": // string_data_right_truncation
    case "22003": // numeric_value_out_of_range
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
    case "22023": // invalid_parameter_value
      return "invalid";
    case "42501": // reserved receiving targets never become user actions
      return error.message === "purchase order receiving status is system controlled"
        ? "reserved_receiving_status" : "forbidden";
    case "P0002": // no_data_found
    case "22P02": // invalid_text_representation (bad UUID)
      return "not_found";
  }
  console.error(`${operation} failed`, { code: error.code, message: error.message });
  return "failed";
}
