import { isUuid } from "@/lib/validation/fields";
import { trimText, truncateChars } from "@/lib/validation/text";

/**
 * Inventory list parameters from a URL query string. Untrusted values become
 * safe defaults; the read RPCs repeat the trimming, caps and clamping. The
 * organization always comes from the session tenant, never from the URL.
 */

export const CURRENT_STOCK_PAGE_SIZE = 25;
export const STOCK_MOVEMENT_PAGE_SIZE = 25;
/** Same cap as list_current_stock() applies in the database. */
export const INVENTORY_SEARCH_MAX_LENGTH = 100;
const MAX_PAGE = 10_000;

export type CurrentStockParams = {
  /** Product name or SKU (current master data). */
  search: string;
  page: number;
};

export type StockMovementParams = {
  /** Only this product's movements; null for all. */
  productId: string | null;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parsePage(value: string | string[] | undefined): number {
  const page = Number.parseInt(first(value), 10);
  return Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1;
}

export function parseCurrentStockParams(params: SearchParams): CurrentStockParams {
  return {
    search: truncateChars(trimText(first(params.q)), INVENTORY_SEARCH_MAX_LENGTH),
    page: parsePage(params.page),
  };
}

export function parseStockMovementParams(params: SearchParams): StockMovementParams {
  const productId = trimText(first(params.product));
  return { productId: isUuid(productId) ? productId : null, page: parsePage(params.page) };
}

export type ListCurrentStockArgs = {
  p_organization_id: string;
  p_search: string | null;
  p_product_id: string | null;
  p_limit: number;
  p_offset: number;
};

/** Arguments for list_current_stock(). */
export function toListCurrentStockArgs(organizationId: string, params: CurrentStockParams): ListCurrentStockArgs {
  return {
    p_organization_id: organizationId,
    p_search: params.search || null,
    p_product_id: null,
    p_limit: CURRENT_STOCK_PAGE_SIZE,
    p_offset: (params.page - 1) * CURRENT_STOCK_PAGE_SIZE,
  };
}

/** Arguments for list_current_stock() restricted to one product. */
export function toProductStockArgs(organizationId: string, productId: string): ListCurrentStockArgs {
  return {
    p_organization_id: organizationId,
    p_search: null,
    p_product_id: productId,
    p_limit: 1,
    p_offset: 0,
  };
}

/** Arguments for list_stock_movements(). */
export function toListStockMovementsArgs(organizationId: string, params: StockMovementParams) {
  return {
    p_organization_id: organizationId,
    p_product_id: params.productId,
    p_source_type: null,
    p_limit: STOCK_MOVEMENT_PAGE_SIZE,
    p_offset: (params.page - 1) * STOCK_MOVEMENT_PAGE_SIZE,
  };
}
