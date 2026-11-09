import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentStockListHref,
  formatMovementQuantity,
  formatStockQuantity,
  pageLinks,
  productStockHref,
  stockMovementTypeLabel,
  stockSourceTypeLabel,
  stockUnitLabel,
} from "./display";
import { STOCK_MOVEMENT_TYPES, STOCK_SOURCE_TYPES } from "./types";

const PRODUCT = "cccccccc-0000-4000-8000-000000000003";

describe("exact stock quantity display", () => {
  it.each([
    ["0.000", "0.000"],
    ["0.001", "0.001"],
    ["4.500", "4.500"],
    ["120.000", "120.000"],
    ["1234.500", "1,234.500"],
    ["999999999999999.999", "999,999,999,999,999.999"],
    // A balance can exceed numeric(18,3); still exact text.
    ["1999999999999999.999", "1,999,999,999,999,999.999"],
  ])("shows %s as %s without floating point", (input, expected) => {
    expect(formatStockQuantity(input)).toBe(expected);
  });

  it("signs movement quantities from the string: + for stock in, - for stock out", () => {
    expect(formatMovementQuantity("30.000")).toBe("+30.000");
    expect(formatMovementQuantity("0.001")).toBe("+0.001");
    expect(formatMovementQuantity("999999999999999.999")).toBe("+999,999,999,999,999.999");
    expect(formatMovementQuantity("-10.000")).toBe("-10.000");
    expect(formatMovementQuantity("-1234.500")).toBe("-1,234.500");
  });

  it.each(["1.5", "abc", "", "-0.000", "1e3"])("rejects malformed quantity %j (fail closed)", (value) => {
    expect(() => formatStockQuantity(value)).toThrow();
    expect(() => formatMovementQuantity(value)).toThrow();
  });

  it("never converts quantities to JavaScript numbers", () => {
    const source = readFileSync(join(__dirname, "display.ts"), "utf8");
    expect(source).not.toMatch(/parseFloat|Number\(|toLocaleString|Intl\.NumberFormat|\+quantity/);
  });
});

describe("labels", () => {
  it("maps every movement and source type to a display label, not the database key", () => {
    expect(stockMovementTypeLabel("goods_receipt")).toBe("Goods receipt");
    expect(stockSourceTypeLabel("goods_receipt")).toBe("Goods receipt");
    for (const type of STOCK_MOVEMENT_TYPES) expect(stockMovementTypeLabel(type)).not.toContain("_");
    for (const type of STOCK_SOURCE_TYPES) expect(stockSourceTypeLabel(type)).not.toContain("_");
  });

  it("names known units and keeps unknown stored units as-is", () => {
    expect(stockUnitLabel("pcs")).toBe("Pieces (pcs)");
    expect(stockUnitLabel("drum")).toBe("drum");
  });
});

describe("links and pagination", () => {
  it("keeps search and page in the current stock URL (q, like other lists)", () => {
    expect(currentStockListHref({ search: "", page: 1 })).toBe("/inventory");
    expect(currentStockListHref({ search: "bitumen", page: 1 })).toBe("/inventory?q=bitumen");
    expect(currentStockListHref({ search: "a&b c", page: 3 })).toBe("/inventory?q=a%26b+c&page=3");
  });

  it("links a product's stock detail and its movement pages", () => {
    expect(productStockHref(PRODUCT)).toBe(`/inventory/${PRODUCT}`);
    expect(productStockHref(PRODUCT, 1)).toBe(`/inventory/${PRODUCT}`);
    expect(productStockHref(PRODUCT, 2)).toBe(`/inventory/${PRODUCT}?page=2`);
  });

  it("offers previous/next only where pages exist", () => {
    const href = (n: number) => `/p${n}`;
    expect(pageLinks(1, 25, 10, href)).toEqual({ prevHref: null, nextHref: null });
    expect(pageLinks(1, 25, 26, href)).toEqual({ prevHref: null, nextHref: "/p2" });
    expect(pageLinks(2, 25, 50, href)).toEqual({ prevHref: "/p1", nextHref: null });
    expect(pageLinks(9, 25, null, href)).toEqual({ prevHref: "/p8", nextHref: null });
  });
});
