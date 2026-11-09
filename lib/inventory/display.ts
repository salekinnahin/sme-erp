import { exactQuantity } from "@/lib/goods-receipts/receiving";
import { isProductUnit, PRODUCT_UNIT_LABELS } from "@/lib/products/validation";
import type { CurrentStockParams } from "./list-params";
import { STOCK_MOVEMENT_TYPE_LABELS, STOCK_SOURCE_TYPE_LABELS } from "./messages";
import { parseStockQuantity } from "./quantity";
import type { StockMovementType, StockSourceType } from "./types";

/**
 * Pure presentation helpers for the read-only Inventory UI. Safe for client
 * components (no database access). Quantities stay exact decimal strings:
 * they are validated and grouped as text, never converted to JS numbers.
 */

/** A balance or quantity with thousands separators and all 3 decimals: "1,234.500". */
export function formatStockQuantity(quantity: string): string {
  return exactQuantity(parseStockQuantity(quantity));
}

/**
 * A signed movement quantity: "+30.000" (stock in) or "-10.000" (stock out).
 * The sign comes from the database string, so future negative movement types
 * display correctly without changes here.
 */
export function formatMovementQuantity(quantityDelta: string): string {
  const exact = formatStockQuantity(quantityDelta);
  return exact.startsWith("-") ? exact : `+${exact}`;
}

/** Display label for a movement type; never the raw database key. */
export function stockMovementTypeLabel(type: StockMovementType): string {
  return STOCK_MOVEMENT_TYPE_LABELS[type];
}

/** Display label for a movement's source document type. */
export function stockSourceTypeLabel(type: StockSourceType): string {
  return STOCK_SOURCE_TYPE_LABELS[type];
}

/** Full unit name for a known product unit ("Pieces (pcs)"), else the stored unit. */
export function stockUnitLabel(unit: string): string {
  return isProductUnit(unit) ? PRODUCT_UNIT_LABELS[unit] : unit;
}

/** Shown for products with stock history whose current type is not inventory. */
export const STOCK_TYPE_MISMATCH_MESSAGE =
  "This product has inventory history but is currently classified as a non-inventory type.";

/** URL of a current stock list page; keeps search and page stable. */
export function currentStockListHref(params: CurrentStockParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("q", params.search);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return qs ? `/inventory?${qs}` : "/inventory";
}

/** URL of one product's stock detail, optionally at a movement history page. */
export function productStockHref(productId: string, page = 1): string {
  return page > 1 ? `/inventory/${productId}?page=${page}` : `/inventory/${productId}`;
}

/** Previous/next hrefs for a page of results (null when unavailable). */
export function pageLinks(
  page: number,
  pageSize: number,
  total: number | null,
  href: (page: number) => string,
): { prevHref: string | null; nextHref: string | null } {
  return {
    prevHref: page > 1 ? href(page - 1) : null,
    nextHref: total !== null && page * pageSize < total ? href(page + 1) : null,
  };
}
