import { describe, expect, it } from "vitest";
import {
  GOODS_RECEIPT_PAGE_SIZE,
  RECEIPT_HISTORY_LIMIT,
  goodsReceiptListHref,
  parseGoodsReceiptListParams,
  toListGoodsReceiptsArgs,
  toReceiptHistoryArgs,
} from "./list-params";

describe("goods receipt list parameters", () => {
  it("defaults untrusted values safely", () => {
    expect(parseGoodsReceiptListParams({})).toEqual({ search: "", page: 1 });
    expect(parseGoodsReceiptListParams({ q: ["GR-1", "x"], page: ["2", "9"] })).toEqual({ search: "GR-1", page: 2 });
    for (const page of ["0", "-1", "abc", ""]) expect(parseGoodsReceiptListParams({ page }).page).toBe(1);
    expect(parseGoodsReceiptListParams({ page: "999999" }).page).toBe(10_000);
  });
  it("trims Unicode whitespace and caps search at 100 code points", () => {
    expect(parseGoodsReceiptListParams({ q: "  PO-000123　" }).search).toBe("PO-000123");
    expect(Array.from(parseGoodsReceiptListParams({ q: "😀".repeat(150) }).search)).toHaveLength(100);
  });
  it("round-trips hrefs, leaving defaults out", () => {
    expect(goodsReceiptListHref({ search: "", page: 1 })).toBe("/goods-receipts");
    expect(goodsReceiptListHref({ search: "50% off_", page: 3 })).toBe("/goods-receipts?q=50%25+off_&page=3");
  });
  it("builds tenant-scoped list args with 25 per page; organization never comes from the URL", () => {
    expect(toListGoodsReceiptsArgs("org", { search: "", page: 3 })).toEqual({
      p_organization_id: "org", p_search: null, p_purchase_order_id: null, p_limit: GOODS_RECEIPT_PAGE_SIZE, p_offset: 50,
    });
    expect(GOODS_RECEIPT_PAGE_SIZE).toBe(25);
    expect(toReceiptHistoryArgs("org", "po")).toEqual({
      p_organization_id: "org", p_search: null, p_purchase_order_id: "po", p_limit: RECEIPT_HISTORY_LIMIT, p_offset: 0,
    });
  });
});
