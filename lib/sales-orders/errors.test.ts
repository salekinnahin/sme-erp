import { afterEach, describe, expect, it, vi } from "vitest";
import { salesOrderWriteFailure } from "./errors";

afterEach(() => vi.restoreAllMocks());

describe("salesOrderWriteFailure", () => {
  it("maps 55000 per operation", () => {
    expect(salesOrderWriteFailure("updateSalesOrderDraft", { code: "55000" })).toBe("not_draft");
    expect(salesOrderWriteFailure("setSalesOrderStatus", { code: "55000" })).toBe("invalid_transition");
    expect(salesOrderWriteFailure("createSalesOrderFromQuotation", { code: "55000" })).toBe(
      "quotation_not_accepted",
    );
  });

  it("maps a repeated conversion to already_converted", () => {
    expect(salesOrderWriteFailure("createSalesOrderFromQuotation", { code: "23505" })).toBe(
      "already_converted",
    );
  });

  it("maps references, input, permission and not-found errors", () => {
    expect(salesOrderWriteFailure("createSalesOrder", { code: "23503" })).toBe("invalid_reference");
    for (const code of ["22023", "22003", "23514"])
      expect(salesOrderWriteFailure("createSalesOrder", { code })).toBe("invalid");
    expect(salesOrderWriteFailure("setSalesOrderStatus", { code: "42501" })).toBe("forbidden");
    expect(salesOrderWriteFailure("createSalesOrderFromQuotation", { code: "P0002" })).toBe("not_found");
    expect(salesOrderWriteFailure("updateSalesOrderDraft", { code: "P0002" })).toBe("not_found");
  });

  it("logs and hides anything unexpected", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(salesOrderWriteFailure("createSalesOrder", { code: "23505", message: "x" })).toBe("failed");
    expect(salesOrderWriteFailure("createSalesOrder", { code: "XX000" })).toBe("failed");
    expect(log).toHaveBeenCalledTimes(2);
  });
});
