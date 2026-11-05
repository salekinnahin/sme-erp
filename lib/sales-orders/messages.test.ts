import { describe, expect, it } from "vitest";
import type { SalesOrderWriteFailure } from "./errors";
import { salesOrderWriteFailure } from "./errors";
import {
  CONVERSION_FAILURE_MESSAGES,
  FIX_FIELDS_ERROR,
  SALES_ORDER_FAILURE_MESSAGES,
  isStaleFailure,
  salesOrderFailureState,
} from "./messages";

const REASONS: SalesOrderWriteFailure[] = [
  "invalid", "forbidden", "not_found", "invalid_reference", "not_draft",
  "invalid_transition", "quotation_not_accepted", "already_converted", "failed",
];

describe("sales order messages", () => {
  it("has a safe message for every reason, never a database detail", () => {
    for (const map of [SALES_ORDER_FAILURE_MESSAGES, CONVERSION_FAILURE_MESSAGES])
      for (const reason of REASONS) {
        expect(map[reason]).toBeTruthy();
        expect(map[reason]).not.toMatch(/sql|constraint|violat|unique|23505|P0002|sales_orders_/i);
      }
  });

  it("maps raw database errors (duplicate conversion, stale status, non-draft) to friendly text", () => {
    const quiet = () => {};
    const orig = console.error;
    console.error = quiet;
    const dup = salesOrderWriteFailure("createSalesOrderFromQuotation", {
      code: "23505",
      message: 'duplicate key value violates unique constraint "sales_orders_source_quotation_key"',
    });
    console.error = orig;
    expect(CONVERSION_FAILURE_MESSAGES[dup]).toBe("This quotation has already been converted to a sales order.");
    expect(SALES_ORDER_FAILURE_MESSAGES[salesOrderWriteFailure("setSalesOrderStatus", { code: "55000" })]).toMatch(
      /latest status/,
    );
    expect(SALES_ORDER_FAILURE_MESSAGES[salesOrderWriteFailure("updateSalesOrderDraft", { code: "55000" })]).toMatch(
      /no longer a draft/,
    );
    expect(CONVERSION_FAILURE_MESSAGES[salesOrderWriteFailure("createSalesOrderFromQuotation", { code: "P0002" })]).toMatch(
      /quotation could not be found/,
    );
    expect(CONVERSION_FAILURE_MESSAGES[salesOrderWriteFailure("createSalesOrderFromQuotation", { code: "55000" })]).toMatch(
      /Only an accepted quotation/,
    );
  });

  it("treats concurrent changes as stale (page is revalidated)", () => {
    expect(REASONS.filter(isStaleFailure)).toEqual([
      "not_found", "not_draft", "invalid_transition", "quotation_not_accepted", "already_converted",
    ]);
  });

  it("keeps per-field and per-line errors (including line IDs) next to their fields", () => {
    const state = salesOrderFailureState(
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
    expect(salesOrderFailureState({ reason: "not_draft" }, [])).toEqual({ error: SALES_ORDER_FAILURE_MESSAGES.not_draft });
    expect(salesOrderFailureState({ reason: "failed" }, [])).toEqual({ error: SALES_ORDER_FAILURE_MESSAGES.failed });
  });
});
