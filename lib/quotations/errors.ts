/**
 * Write failures of the quotation domain functions. Server Actions map each
 * reason to a safe message; database details are only logged on the server.
 */
export type QuotationWriteFailure =
  | "invalid"
  | "forbidden"
  | "not_found"
  /** Customer or product missing, of another organization, or inactive. */
  | "invalid_reference"
  /** The quotation is no longer a draft (edit). */
  | "not_draft"
  /** The status change is not allowed from the current status. */
  | "invalid_transition"
  | "failed";

/**
 * Maps a database error from create_quotation(), update_quotation_draft() or
 * set_quotation_status(). 55000 (object_not_in_prerequisite_state) means
 * "not a draft" for edits and "transition not allowed" for status changes.
 */
export function quotationWriteFailure(
  operation: "createQuotation" | "updateQuotationDraft" | "setQuotationStatus",
  error: { code?: string; message?: string },
): QuotationWriteFailure {
  switch (error.code) {
    case "23503": // foreign_key_violation: customer / product not usable
      return "invalid_reference";
    case "55000":
      return operation === "setQuotationStatus" ? "invalid_transition" : "not_draft";
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
    default:
      console.error(`${operation} failed`, { code: error.code, message: error.message });
      return "failed";
  }
}
