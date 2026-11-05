import { describe, expect, it } from "vitest";
import { parseInvoiceListParams, invoiceListHref, sourceSalesOrderHref, toListInvoicesArgs } from "./list-params";

const CUSTOMER = "DDDDDDDD-0000-4000-8000-000000000004";
const ORG = "aaaaaaaa-0000-4000-8000-000000000001";

describe("sourceSalesOrderHref", () => {
  it("links the tenant-filtered source ID independently of its historical number", () => {
    expect(sourceSalesOrderHref(ORG, "SO-000042")).toBe(`/sales-orders/${ORG}`);
    expect(sourceSalesOrderHref(ORG, "Recorded old number")).toBe(`/sales-orders/${ORG}`);
  });

  it("has no navigation target for direct invoices or missing source references", () => {
    expect(sourceSalesOrderHref(null, null)).toBeNull();
    expect(sourceSalesOrderHref(null, "SO-000042")).toBeNull();
    expect(sourceSalesOrderHref(ORG, null)).toBeNull();
    expect(sourceSalesOrderHref("", "SO-000042")).toBeNull();
    expect(sourceSalesOrderHref(ORG, "")).toBeNull();
  });
});

describe("parseInvoiceListParams", () => {
  it("defaults to everything, page 1", () => {
    expect(parseInvoiceListParams({})).toEqual({ search: "", status: "all", customer: "all", page: 1 });
  });

  it("reads search (Unicode-trimmed), status, customer and page", () => {
    expect(
      parseInvoiceListParams({ q: "　INV-000001 ", status: "issued", customer: CUSTOMER, page: "3" }),
    ).toEqual({ search: "INV-000001", status: "issued", customer: CUSTOMER.toLowerCase(), page: 3 });
  });

  it("ignores quotation statuses, unknown statuses, malformed customers and bad pages", () => {
    expect(parseInvoiceListParams({ status: "sent", customer: "x", page: "-2" })).toMatchObject({
      status: "all",
      customer: "all",
      page: 1,
    });
    expect(parseInvoiceListParams({ status: "ISSUED", page: "abc" })).toMatchObject({ status: "all", page: 1 });
    expect(parseInvoiceListParams({ page: "999999999" }).page).toBe(10_000);
    expect(parseInvoiceListParams({ q: "x".repeat(150) }).search).toHaveLength(100);
    expect(parseInvoiceListParams({ status: ["draft", "cancelled"] }).status).toBe("draft");
  });
});

describe("invoiceListHref", () => {
  it("leaves out defaults and round-trips", () => {
    expect(invoiceListHref({ search: "", status: "all", customer: "all", page: 1 })).toBe("/invoices");
    const params = { search: "Acme 100%", status: "paid" as const, customer: CUSTOMER.toLowerCase(), page: 2 };
    const href = invoiceListHref(params);
    const query = Object.fromEntries(new URLSearchParams(href.split("?")[1]));
    expect(parseInvoiceListParams(query)).toEqual(params);
  });
});

describe("toListInvoicesArgs", () => {
  it("passes the tenant organization, 25 per page, NULL for unset filters", () => {
    expect(toListInvoicesArgs(ORG, { search: "", status: "all", customer: "all", page: 1 })).toEqual({
      p_organization_id: ORG,
      p_search: null,
      p_status: null,
      p_customer_id: null,
      p_limit: 25,
      p_offset: 0,
    });
    expect(
      toListInvoicesArgs(ORG, { search: "acme", status: "draft", customer: CUSTOMER.toLowerCase(), page: 3 }),
    ).toMatchObject({ p_search: "acme", p_status: "draft", p_customer_id: CUSTOMER.toLowerCase(), p_offset: 50 });
  });
});
