/**
 * Write failures of the invoice domain functions. Server Actions map each
 * reason to a safe message; database details are only logged on the server.
 */
export type InvoiceWriteFailure =
  | "invalid"
  | "forbidden"
  /** Invoice, or (conversion) sales order, missing or of another tenant. */
  | "not_found"
  /** Customer or product missing, of another organization, or inactive. */
  | "invalid_reference"
  /** The invoice is no longer a draft (edit). */
  | "not_draft"
  /** The status change is not allowed from the current status. */
  | "invalid_transition"
  /** Conversion: the sales order is not confirmed. */
  | "sales_order_not_confirmed"
  /** Conversion: the sales order already has an invoice. */
  | "already_invoiced"
  | "failed";

export type InvoiceOperation =
  | "createInvoice"
  | "createInvoiceFromSalesOrder"
  | "updateInvoiceDraft"
  | "setInvoiceStatus";

/**
 * Maps a database error from the invoice functions. 55000
 * (object_not_in_prerequisite_state) means "not a draft" for edits,
 * "transition not allowed" for status changes and "sales order not
 * confirmed" for conversions. 23505 (unique_violation) only arises from
 * conversion: the sales order already has an invoice.
 */
export function invoiceWriteFailure(
  operation: InvoiceOperation,
  error: { code?: string; message?: string },
): InvoiceWriteFailure {
  switch (error.code) {
    case "23503": // foreign_key_violation: customer / product not usable
      return "invalid_reference";
    case "23505":
      if (operation === "createInvoiceFromSalesOrder") return "already_invoiced";
      break;
    case "55000":
      if (operation === "setInvoiceStatus") return "invalid_transition";
      if (operation === "createInvoiceFromSalesOrder") return "sales_order_not_confirmed";
      return "not_draft";
    case "23514": // check_violation
    case "23502": // not_null_violation
    case "22001": // string_data_right_truncation
    case "22003": // numeric_value_out_of_range
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
    case "22023": // invalid_parameter_value
      return "invalid";
    case "42501": // insufficient_privilege (role, or a reserved payment status)
      return "forbidden";
    case "P0002": // no_data_found
    case "22P02": // invalid_text_representation (bad UUID)
      return "not_found";
  }
  console.error(`${operation} failed`, { code: error.code, message: error.message });
  return "failed";
}
