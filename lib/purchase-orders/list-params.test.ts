import { describe, expect, it } from "vitest";
import { parsePurchaseOrderListParams, purchaseOrderListHref, toListPurchaseOrdersArgs } from "./list-params";

const VENDOR = "DDDDDDDD-0000-4000-8000-000000000004";
const ORG = "aaaaaaaa-0000-4000-8000-000000000001";

describe("parsePurchaseOrderListParams", () => {
  it("defaults to everything, page 1", () => {
    expect(parsePurchaseOrderListParams({})).toEqual({ search: "", status: "all", vendor: "all", page: 1 });
  });

  it("reads search (Unicode-trimmed), status, vendor and page", () => {
    expect(parsePurchaseOrderListParams({ q: "　PO-000001 ", status: "ordered", vendor: VENDOR, page: "3" }))
      .toEqual({ search: "PO-000001", status: "ordered", vendor: VENDOR.toLowerCase(), page: 3 });
    expect(parsePurchaseOrderListParams({ status: "partially_received" }).status).toBe("partially_received");
  });

  it("ignores other modules' statuses, unknown statuses, malformed vendors and bad pages", () => {
    expect(parsePurchaseOrderListParams({ status: "issued", vendor: "x", page: "-2" }))
      .toMatchObject({ status: "all", vendor: "all", page: 1 });
    expect(parsePurchaseOrderListParams({ status: "ORDERED", page: "abc" })).toMatchObject({ status: "all", page: 1 });
    expect(parsePurchaseOrderListParams({ page: "999999999" }).page).toBe(10_000);
    expect(parsePurchaseOrderListParams({ q: "x".repeat(150) }).search).toHaveLength(100);
    expect(parsePurchaseOrderListParams({ status: ["draft", "cancelled"] }).status).toBe("draft");
  });
});

describe("purchaseOrderListHref", () => {
  it("leaves out defaults and round-trips", () => {
    expect(purchaseOrderListHref({ search: "", status: "all", vendor: "all", page: 1 })).toBe("/purchase-orders");
    const params = { search: "Acme 100%_", status: "received" as const, vendor: VENDOR.toLowerCase(), page: 2 };
    const href = purchaseOrderListHref(params);
    expect(parsePurchaseOrderListParams(Object.fromEntries(new URLSearchParams(href.split("?")[1])))).toEqual(params);
  });
});

describe("toListPurchaseOrdersArgs", () => {
  it("passes the tenant organization, 25 per page, NULL for unset filters", () => {
    expect(toListPurchaseOrdersArgs(ORG, { search: "", status: "all", vendor: "all", page: 1 })).toEqual({
      p_organization_id: ORG, p_search: null, p_status: null, p_vendor_id: null, p_limit: 25, p_offset: 0,
    });
    expect(toListPurchaseOrdersArgs(ORG, { search: "acme", status: "draft", vendor: VENDOR.toLowerCase(), page: 3 }))
      .toMatchObject({ p_search: "acme", p_status: "draft", p_vendor_id: VENDOR.toLowerCase(), p_offset: 50 });
  });
});
