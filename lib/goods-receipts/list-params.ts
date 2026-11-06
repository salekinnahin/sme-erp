import { trimText, truncateChars } from "@/lib/validation/text";

/**
 * Goods receipt list parameters from the URL query string. Untrusted values
 * become safe defaults; list_goods_receipts() repeats the trimming and caps.
 */

export const GOODS_RECEIPT_PAGE_SIZE = 25;
/** Same cap as list_goods_receipts() applies in the database. */
export const GOODS_RECEIPT_SEARCH_MAX_LENGTH = 100;
/** Receipts shown in a purchase order's history before linking to the list. */
export const RECEIPT_HISTORY_LIMIT = 25;
const MAX_PAGE = 10_000;

export type GoodsReceiptListParams = {
  /** GR number, PO number, or vendor name / company name (PO snapshot). */
  search: string;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseGoodsReceiptListParams(params: SearchParams): GoodsReceiptListParams {
  const pageNum = Number.parseInt(first(params.page), 10);
  return {
    search: truncateChars(trimText(first(params.q)), GOODS_RECEIPT_SEARCH_MAX_LENGTH),
    page: Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, MAX_PAGE) : 1,
  };
}

export function goodsReceiptListHref(params: GoodsReceiptListParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("q", params.search);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return qs ? `/goods-receipts?${qs}` : "/goods-receipts";
}

/** Arguments for list_goods_receipts(); the organization comes from the tenant. */
export function toListGoodsReceiptsArgs(organizationId: string, params: GoodsReceiptListParams) {
  return {
    p_organization_id: organizationId,
    p_search: params.search || null,
    p_purchase_order_id: null,
    p_limit: GOODS_RECEIPT_PAGE_SIZE,
    p_offset: (params.page - 1) * GOODS_RECEIPT_PAGE_SIZE,
  };
}

/** One purchase order's receipt history in a single query (no N+1). */
export function toReceiptHistoryArgs(organizationId: string, purchaseOrderId: string) {
  return {
    p_organization_id: organizationId,
    p_search: null,
    p_purchase_order_id: purchaseOrderId,
    p_limit: RECEIPT_HISTORY_LIMIT,
    p_offset: 0,
  };
}
