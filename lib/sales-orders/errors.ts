/**
 * Write failures of the sales order domain functions. Server Actions map
 * each reason to a safe message; database details are only logged on the
 * server.
 */
export type SalesOrderWriteFailure =
  | "invalid"
  | "forbidden"
  /** Sales order, or (conversion) quotation, missing or of another tenant. */
  | "not_found"
  /** Customer or product missing, of another organization, or inactive. */
  | "invalid_reference"
  /** The sales order is no longer a draft (edit). */
  | "not_draft"
  /** The status change is not allowed from the current status. */
  | "invalid_transition"
  /** Conversion: the quotation is not accepted. */
  | "quotation_not_accepted"
  /** Conversion: the quotation already has a sales order. */
  | "already_converted"
  | "failed";

export type SalesOrderOperation =
  | "createSalesOrder"
  | "createSalesOrderFromQuotation"
  | "updateSalesOrderDraft"
  | "setSalesOrderStatus";

/**
 * Maps a database error from the sales order functions. 55000
 * (object_not_in_prerequisite_state) means "not a draft" for edits,
 * "transition not allowed" for status changes and "quotation not accepted"
 * for conversions. 23505 (unique_violation) only arises from conversion:
 * the quotation already has a sales order.
 */
export function salesOrderWriteFailure(
  operation: SalesOrderOperation,
  error: { code?: string; message?: string },
): SalesOrderWriteFailure {
  switch (error.code) {
    case "23503": // foreign_key_violation: customer / product not usable
      return "invalid_reference";
    case "23505":
      if (operation === "createSalesOrderFromQuotation") return "already_converted";
      break;
    case "55000":
      if (operation === "setSalesOrderStatus") return "invalid_transition";
      if (operation === "createSalesOrderFromQuotation") return "quotation_not_accepted";
      return "not_draft";
    case "23514": // check_violation
    case "23502": // not_null_violation
    case "22001": // string_data_right_truncation
    case "22003": // numeric_value_out_of_range
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
    case "22023": // invalid_parameter_value
      return "invalid";
    case "42501": // insufficient_privilege
      return "forbidden";
    case "P0002": // no_data_found
    case "22P02": // invalid_text_representation (bad UUID)
      return "not_found";
  }
  console.error(`${operation} failed`, { code: error.code, message: error.message });
  return "failed";
}
