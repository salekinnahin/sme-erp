import { describe, expect, it } from "vitest";
import type { QuotationWriteFailure } from "./errors";
import { FIX_FIELDS_ERROR, QUOTATION_FAILURE_MESSAGES, quotationFailureState } from "./messages";

describe("quotationFailureState", () => {
  it("keeps inactive customer and product errors next to their fields", () => {
    const state = quotationFailureState(
      {
        reason: "invalid",
        fieldErrors: { customerId: "This customer is inactive. Choose an active customer." },
        itemErrors: [undefined, { productId: "This product is inactive. Choose an active one." }],
      },
      ["a", "b"],
    );
    expect(state).toEqual({
      error: FIX_FIELDS_ERROR,
      fieldErrors: { customerId: "This customer is inactive. Choose an active customer." },
      itemErrors: { b: { productId: "This product is inactive. Choose an active one." } },
    });
  });

  it.each<[QuotationWriteFailure, RegExp]>([
    ["not_draft", /no longer a draft/],
    ["invalid_transition", /not possible/],
    ["forbidden", /permission/],
    ["not_found", /could not be found/],
    ["invalid_reference", /no longer available/],
    ["failed", /Something went wrong/],
    ["invalid", /not valid/],
  ])("maps %s to a safe message", (reason, message) => {
    const state = quotationFailureState({ reason }, []);
    expect(state).toEqual({ error: QUOTATION_FAILURE_MESSAGES[reason] });
    expect(state.error).toMatch(message);
  });

  it("never includes database wording", () => {
    for (const message of Object.values(QUOTATION_FAILURE_MESSAGES))
      expect(message).not.toMatch(/sqlstate|violat|constraint|postgres|supabase|P0002|55000|23503/i);
  });
});
