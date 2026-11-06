import { isUuid } from "@/lib/validation/fields";
import { trimText, truncateChars } from "@/lib/validation/text";
import { isPurchaseOrderStatus, type PurchaseOrderStatus } from "./validation";

/**
 * Purchase order list parameters from the URL query string. Same rules as
 * the invoice list: untrusted values become safe defaults, and the database
 * (list_purchase_orders()) repeats the trimming and caps.
 */

export const PURCHASE_ORDER_PAGE_SIZE = 25;
/** Same cap as list_purchase_orders() applies in the database. */
export const PURCHASE_ORDER_SEARCH_MAX_LENGTH = 100;
const MAX_PAGE = 10_000;

export type PurchaseOrderStatusFilter = PurchaseOrderStatus | "all";

export type PurchaseOrderListParams = {
  /** PO number or vendor name / company name (snapshot). */
  search: string;
  status: PurchaseOrderStatusFilter;
  /** A vendor ID, or "all". */
  vendor: string;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Parses untrusted query-string values into safe list parameters. */
export function parsePurchaseOrderListParams(params: SearchParams): PurchaseOrderListParams {
  const search = truncateChars(trimText(first(params.q)), PURCHASE_ORDER_SEARCH_MAX_LENGTH);
  const statusRaw = first(params.status);
  const vendorRaw = first(params.vendor);
  const pageNum = Number.parseInt(first(params.page), 10);
  return {
    search,
    status: isPurchaseOrderStatus(statusRaw) ? statusRaw : "all",
    vendor: isUuid(vendorRaw) ? vendorRaw.toLowerCase() : "all",
    page: Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, MAX_PAGE) : 1,
  };
}

/** The list URL for the given parameters (defaults are left out). */
export function purchaseOrderListHref(params: PurchaseOrderListParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("q", params.search);
  if (params.status !== "all") query.set("status", params.status);
  if (params.vendor !== "all") query.set("vendor", params.vendor);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return qs ? `/purchase-orders?${qs}` : "/purchase-orders";
}

/** Arguments for list_purchase_orders(); the organization comes from the tenant. */
export function toListPurchaseOrdersArgs(organizationId: string, params: PurchaseOrderListParams) {
  return {
    p_organization_id: organizationId,
    p_search: params.search || null,
    p_status: params.status === "all" ? null : params.status,
    p_vendor_id: params.vendor === "all" ? null : params.vendor,
    p_limit: PURCHASE_ORDER_PAGE_SIZE,
    p_offset: (params.page - 1) * PURCHASE_ORDER_PAGE_SIZE,
  };
}
