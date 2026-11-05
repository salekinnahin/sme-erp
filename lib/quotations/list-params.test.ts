import { describe, expect, it } from "vitest";
import { parseQuotationListParams, quotationListHref } from "./validation";

const CUSTOMER = "DDDDDDDD-0000-4000-8000-000000000004";

describe("parseQuotationListParams", () => {
  it("defaults to everything, page 1", () => {
    expect(parseQuotationListParams({})).toEqual({ search: "", status: "all", customer: "all", page: 1 });
  });

  it("reads search, status, customer and page", () => {
    expect(
      parseQuotationListParams({ q: "  QT-000001　", status: "sent", customer: CUSTOMER, page: "3" }),
    ).toEqual({ search: "QT-000001", status: "sent", customer: CUSTOMER.toLowerCase(), page: 3 });
  });

  it("ignores unknown statuses, malformed customer IDs and bad pages", () => {
    expect(
      parseQuotationListParams({ status: "SENT", customer: "not-a-uuid", page: "-2" }),
    ).toMatchObject({ status: "all", customer: "all", page: 1 });
    expect(parseQuotationListParams({ status: "bogus", page: "abc" })).toMatchObject({ status: "all", page: 1 });
    expect(parseQuotationListParams({ page: "999999999" }).page).toBe(10_000);
  });

  it("uses the first value of repeated parameters", () => {
    expect(parseQuotationListParams({ status: ["draft", "sent"], q: ["a", "b"] })).toMatchObject({
      status: "draft",
      search: "a",
    });
  });

  it("caps the search at 100 code points without splitting emoji", () => {
    const search = parseQuotationListParams({ q: "😀".repeat(150) }).search;
    expect(Array.from(search)).toHaveLength(100);
    expect(search).toBe("😀".repeat(100));
  });

  it("treats a whitespace-only search as no search", () => {
    expect(parseQuotationListParams({ q: "   " }).search).toBe("");
  });
});

describe("quotationListHref", () => {
  it("keeps filters and leaves defaults out", () => {
    expect(quotationListHref({ search: "", status: "all", customer: "all", page: 1 })).toBe("/quotations");
    expect(
      quotationListHref({ search: "acme & co", status: "draft", customer: CUSTOMER.toLowerCase(), page: 2 }),
    ).toBe(`/quotations?q=acme+%26+co&status=draft&customer=${CUSTOMER.toLowerCase()}&page=2`);
  });

  it("round-trips through the parser", () => {
    const params = { search: "Renamed Buyer", status: "sent" as const, customer: CUSTOMER.toLowerCase(), page: 4 };
    const query = Object.fromEntries(new URL(quotationListHref(params), "http://x").searchParams);
    expect(parseQuotationListParams(query)).toEqual(params);
  });
});
