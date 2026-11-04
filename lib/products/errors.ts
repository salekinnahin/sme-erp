/**
 * Write failures shared by the product and category domain functions. The
 * Server Actions map each reason to a safe message; database details are
 * only logged on the server.
 */
export type ProductWriteFailure =
  | "invalid"
  | "forbidden"
  | "not_found"
  /** SKU (products) or name (categories) already used in the organization. */
  | "duplicate"
  /** Category missing, inactive, or of another organization. */
  | "invalid_category"
  | "failed";

export function writeFailure(
  operation: string,
  error: { code?: string; message?: string },
): ProductWriteFailure {
  switch (error.code) {
    case "23505": // unique_violation: the only unique keys are SKU / category name
      return "duplicate";
    case "23503": // foreign_key_violation: category not in this organization
      return "invalid_category";
    case "23514": // check_violation
    case "23502": // not_null_violation
    case "22001": // string_data_right_truncation
    case "22003": // numeric_value_out_of_range
    case "22023": // invalid_parameter_value
      return "invalid";
    case "42501": // insufficient_privilege, including RLS violations
      return "forbidden";
    case "P0002": // no_data_found
    case "22P02": // invalid_text_representation (bad UUID)
      return "not_found";
    default:
      console.error(`${operation} failed`, {
        code: error.code,
        message: error.message,
      });
      return "failed";
  }
}
