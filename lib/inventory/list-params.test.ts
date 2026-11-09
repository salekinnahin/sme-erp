import { describe, expect, it } from "vitest";
import {
  CURRENT_STOCK_PAGE_SIZE,
  STOCK_MOVEMENT_PAGE_SIZE,
  parseCurrentStockParams,
  parseStockMovementParams,
  toListCurrentStockArgs,
  toListStockMovementsArgs,
  toProductStockArgs,
} from "./list-params";

const PRODUCT = "cccccccc-0000-4000-8000-000000000003";

describe("inventory list parameters", () => {
  it("defaults untrusted current stock values safely", () => {
    expect(parseCurrentStockParams({})).toEqual({ search: "", page: 1 });
    expect(parseCurrentStockParams({ q: ["INV-A", "x"], page: ["2", "9"] })).toEqual({ search: "INV-A", page: 2 });
    for (const page of ["0", "-1", "abc", ""]) expect(parseCurrentStockParams({ page }).page).toBe(1);
    expect(parseCurrentStockParams({ page: "999999" }).page).toBe(10_000);
  });

  it("trims Unicode whitespace and caps search at 100 code points", () => {
    expect(parseCurrentStockParams({ q: "  Widget　" }).search).toBe("Widget");
    expect(Array.from(parseCurrentStockParams({ q: "😀".repeat(150) }).search)).toHaveLength(100);
  });

  it("accepts only a UUID product filter for movement history", () => {
    expect(parseStockMovementParams({ product: PRODUCT, page: "3" })).toEqual({ productId: PRODUCT, page: 3 });
    for (const product of ["", "x", "1; drop table", `${PRODUCT}x`]) {
      expect(parseStockMovementParams({ product }).productId).toBeNull();
    }
  });

  it("builds tenant-scoped RPC arguments; organization never comes from the URL", () => {
    expect(toListCurrentStockArgs("org", { search: "", page: 3 })).toEqual({
      p_organization_id: "org", p_search: null, p_product_id: null, p_limit: CURRENT_STOCK_PAGE_SIZE, p_offset: 50,
    });
    expect(toListCurrentStockArgs("org", { search: "50%_", page: 1 }).p_search).toBe("50%_");
    expect(toProductStockArgs("org", PRODUCT)).toEqual({
      p_organization_id: "org", p_search: null, p_product_id: PRODUCT, p_limit: 1, p_offset: 0,
    });
    expect(toListStockMovementsArgs("org", { productId: PRODUCT, page: 2 })).toEqual({
      p_organization_id: "org", p_product_id: PRODUCT, p_source_type: null, p_limit: STOCK_MOVEMENT_PAGE_SIZE, p_offset: 25,
    });
    expect(CURRENT_STOCK_PAGE_SIZE).toBe(25);
    expect(STOCK_MOVEMENT_PAGE_SIZE).toBe(25);
  });

  it("never sends a product type filter (the database decides stock-bearing products)", () => {
    expect(Object.keys(toListCurrentStockArgs("org", { search: "", page: 1 }))).not.toContain("p_product_type");
  });
});
