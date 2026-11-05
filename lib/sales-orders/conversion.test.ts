import { describe, expect, it } from "vitest";
import { quotationConversionView } from "./conversion";

const EXISTING = { id: "cccccccc-0000-4000-8000-000000000003", salesOrderNumber: "SO-000004" };

describe("quotationConversionView", () => {
  it.each(["owner", "manager", "employee"] as const)("%s can convert an accepted, unconverted quotation", (role) => {
    expect(quotationConversionView(role, "accepted", null)).toEqual({ kind: "create" });
  });

  it.each(["draft", "sent", "rejected", "expired", "cancelled", "bogus"])(
    "offers nothing for a %s quotation",
    (status) => {
      expect(quotationConversionView("owner", status, null)).toEqual({ kind: "hidden" });
    },
  );

  it("an already converted quotation shows View sales order, never Create again", () => {
    for (const role of ["owner", "manager", "employee"] as const)
      expect(quotationConversionView(role, "accepted", EXISTING)).toEqual({
        kind: "view",
        salesOrderId: EXISTING.id,
        salesOrderNumber: "SO-000004",
      });
  });
});
