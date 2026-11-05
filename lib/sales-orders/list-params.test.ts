import { describe, expect, it } from "vitest";
import { parseSalesOrderListParams, salesOrderListHref, toListSalesOrdersArgs } from "./list-params";

const CUSTOMER = "DDDDDDDD-0000-4000-8000-000000000004";
const ORG = "aaaaaaaa-0000-4000-8000-000000000001";

describe("parseSalesOrderListParams", () => {
  it("defaults to everything, page 1", () => {
    expect(parseSalesOrderListParams({})).toEqual({ search: "", status: "all", customer: "all", page: 1 });
  });

  it("reads search (Unicode-trimmed), status, customer and page", () => {
    expect(
      parseSalesOrderListParams({ q: "　SO-000001 ", status: "confirmed", customer: CUSTOMER, page: "3" }),
    ).toEqual({ search: "SO-000001", status: "confirmed", customer: CUSTOMER.toLowerCase(), page: 3 });
  });

  it("ignores quotation statuses, unknown statuses, malformed customers and bad pages", () => {
    expect(parseSalesOrderListParams({ status: "sent", customer: "x", page: "-2" })).toMatchObject({
      status: "all",
      customer: "all",
      page: 1,
    });
    expect(parseSalesOrderListParams({ status: "CONFIRMED", page: "abc" })).toMatchObject({ status: "all", page: 1 });
    expect(parseSalesOrderListParams({ page: "999999999" }).page).toBe(10_000);
    expect(parseSalesOrderListParams({ q: "x".repeat(150) }).search).toHaveLength(100);
    expect(parseSalesOrderListParams({ status: ["draft", "cancelled"] }).status).toBe("draft");
  });
});

describe("salesOrderListHref", () => {
  it("leaves out defaults and round-trips", () => {
    expect(salesOrderListHref({ search: "", status: "all", customer: "all", page: 1 })).toBe("/sales-orders");
    const params = { search: "Acme 100%", status: "completed" as const, customer: CUSTOMER.toLowerCase(), page: 2 };
    const href = salesOrderListHref(params);
    const query = Object.fromEntries(new URLSearchParams(href.split("?")[1]));
    expect(parseSalesOrderListParams(query)).toEqual(params);
  });
});

describe("toListSalesOrdersArgs", () => {
  it("passes the tenant organization, 25 per page, NULL for unset filters", () => {
    expect(toListSalesOrdersArgs(ORG, { search: "", status: "all", customer: "all", page: 1 })).toEqual({
      p_organization_id: ORG,
      p_search: null,
      p_status: null,
      p_customer_id: null,
      p_limit: 25,
      p_offset: 0,
    });
    expect(
      toListSalesOrdersArgs(ORG, { search: "acme", status: "draft", customer: CUSTOMER.toLowerCase(), page: 3 }),
    ).toMatchObject({ p_search: "acme", p_status: "draft", p_customer_id: CUSTOMER.toLowerCase(), p_offset: 50 });
  });
});
