import { describe, expect, it } from "vitest";
import type { InvoiceWriteFailure } from "./errors";
import { invoiceWriteFailure } from "./errors";
import {
  CONVERSION_FAILURE_MESSAGES,
  FIX_FIELDS_ERROR,
  INVOICE_FAILURE_MESSAGES,
  isStaleFailure,
  invoiceFailureState,
} from "./messages";

const REASONS: InvoiceWriteFailure[] = [
  "invalid", "forbidden", "not_found", "invalid_reference", "not_draft",
  "invalid_transition", "sales_order_not_confirmed", "already_invoiced", "failed",
];

describe("invoice messages", () => {
  it("has a safe message for every reason, never a database detail", () => {
    for (const map of [INVOICE_FAILURE_MESSAGES, CONVERSION_FAILURE_MESSAGES])
      for (const reason of REASONS) {
        expect(map[reason]).toBeTruthy();
        expect(map[reason]).not.toMatch(/sql|constraint|violat|unique|23505|P0002|invoices_/i);
      }
  });

  it("maps raw database errors (duplicate conversion, stale status, non-draft) to friendly text", () => {
    const quiet = () => {};
    const orig = console.error;
    console.error = quiet;
    const dup = invoiceWriteFailure("createInvoiceFromSalesOrder", {
      code: "23505",
      message: 'duplicate key value violates unique constraint "invoices_source_sales_order_key"',
    });
    console.error = orig;
    expect(CONVERSION_FAILURE_MESSAGES[dup]).toBe("This sales order already has an invoice, including if it was cancelled.");
    expect(INVOICE_FAILURE_MESSAGES[invoiceWriteFailure("setInvoiceStatus", { code: "55000" })]).toMatch(
      /latest status/,
    );
    expect(INVOICE_FAILURE_MESSAGES[invoiceWriteFailure("updateInvoiceDraft", { code: "55000" })]).toMatch(
      /no longer a draft/,
    );
    expect(CONVERSION_FAILURE_MESSAGES[invoiceWriteFailure("createInvoiceFromSalesOrder", { code: "P0002" })]).toMatch(
      /sales order could not be found/,
    );
    expect(CONVERSION_FAILURE_MESSAGES[invoiceWriteFailure("createInvoiceFromSalesOrder", { code: "55000" })]).toMatch(
      /Only a confirmed sales order/,
    );
  });

  it("treats concurrent changes as stale (page is revalidated)", () => {
    expect(REASONS.filter(isStaleFailure)).toEqual([
      "not_found", "not_draft", "invalid_transition", "sales_order_not_confirmed", "already_invoiced",
    ]);
  });

  it("keeps per-field and per-line errors (including line IDs) next to their fields", () => {
    const state = invoiceFailureState(
      {
        reason: "invalid",
        fieldErrors: { customerId: "This customer is inactive. Choose an active customer." },
        itemErrors: [undefined, { lineId: "This line no longer exists." }, { productId: "inactive" }],
      },
      ["a", "b", "c"],
    );
    expect(state).toEqual({
      error: FIX_FIELDS_ERROR,
      fieldErrors: { customerId: "This customer is inactive. Choose an active customer." },
      itemErrors: { b: { lineId: "This line no longer exists." }, c: { productId: "inactive" } },
    });
    expect(invoiceFailureState({ reason: "not_draft" }, [])).toEqual({ error: INVOICE_FAILURE_MESSAGES.not_draft });
    expect(invoiceFailureState({ reason: "failed" }, [])).toEqual({ error: INVOICE_FAILURE_MESSAGES.failed });
  });
});
