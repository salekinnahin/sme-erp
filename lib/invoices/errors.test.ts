import { afterEach, describe, expect, it, vi } from "vitest";
import { invoiceWriteFailure } from "./errors";

afterEach(() => vi.restoreAllMocks());

describe("invoiceWriteFailure", () => {
  it("maps 55000 per operation", () => {
    expect(invoiceWriteFailure("updateInvoiceDraft", { code: "55000" })).toBe("not_draft");
    expect(invoiceWriteFailure("setInvoiceStatus", { code: "55000" })).toBe("invalid_transition");
    expect(invoiceWriteFailure("createInvoiceFromSalesOrder", { code: "55000" })).toBe(
      "sales_order_not_confirmed",
    );
  });

  it("maps a repeated conversion to already_invoiced", () => {
    expect(invoiceWriteFailure("createInvoiceFromSalesOrder", { code: "23505" })).toBe("already_invoiced");
  });

  it("maps references, input, permission and not-found errors", () => {
    expect(invoiceWriteFailure("createInvoice", { code: "23503" })).toBe("invalid_reference");
    for (const code of ["22023", "22003", "23514"]) expect(invoiceWriteFailure("createInvoice", { code })).toBe("invalid");
    // 42501 is also what a reserved payment status raises.
    expect(invoiceWriteFailure("setInvoiceStatus", { code: "42501" })).toBe("forbidden");
    expect(invoiceWriteFailure("createInvoiceFromSalesOrder", { code: "P0002" })).toBe("not_found");
    expect(invoiceWriteFailure("updateInvoiceDraft", { code: "P0002" })).toBe("not_found");
  });

  it("logs and hides anything unexpected", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(invoiceWriteFailure("createInvoice", { code: "23505", message: "x" })).toBe("failed");
    expect(invoiceWriteFailure("createInvoice", { code: "XX000" })).toBe("failed");
    expect(log).toHaveBeenCalledTimes(2);
  });
});
