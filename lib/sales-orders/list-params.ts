import { isUuid } from "@/lib/validation/fields";
import { trimText, truncateChars } from "@/lib/validation/text";
import { isSalesOrderStatus, type SalesOrderStatus } from "./validation";

/**
 * Sales order list parameters from the URL query string. Same rules as the
 * quotation list: untrusted values become safe defaults, and the database
 * (list_sales_orders()) repeats the trimming and caps.
 */

export const SALES_ORDER_PAGE_SIZE = 25;
/** Same cap as list_sales_orders() applies in the database. */
export const SALES_ORDER_SEARCH_MAX_LENGTH = 100;
const MAX_PAGE = 10_000;

export type SalesOrderStatusFilter = SalesOrderStatus | "all";

export type SalesOrderListParams = {
  /** Sales order number or customer name (snapshot). */
  search: string;
  status: SalesOrderStatusFilter;
  /** A customer ID, or "all". */
  customer: string;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Parses untrusted query-string values into safe list parameters. */
export function parseSalesOrderListParams(params: SearchParams): SalesOrderListParams {
  const search = truncateChars(trimText(first(params.q)), SALES_ORDER_SEARCH_MAX_LENGTH);
  const statusRaw = first(params.status);
  const customerRaw = first(params.customer);
  const pageNum = Number.parseInt(first(params.page), 10);
  return {
    search,
    status: isSalesOrderStatus(statusRaw) ? statusRaw : "all",
    customer: isUuid(customerRaw) ? customerRaw.toLowerCase() : "all",
    page: Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, MAX_PAGE) : 1,
  };
}

/** The list URL for the given parameters (defaults are left out). */
export function salesOrderListHref(params: SalesOrderListParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("q", params.search);
  if (params.status !== "all") query.set("status", params.status);
  if (params.customer !== "all") query.set("customer", params.customer);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return qs ? `/sales-orders?${qs}` : "/sales-orders";
}

/** Arguments for list_sales_orders(); the organization comes from the tenant. */
export function toListSalesOrdersArgs(organizationId: string, params: SalesOrderListParams) {
  return {
    p_organization_id: organizationId,
    p_search: params.search || null,
    p_status: params.status === "all" ? null : params.status,
    p_customer_id: params.customer === "all" ? null : params.customer,
    p_limit: SALES_ORDER_PAGE_SIZE,
    p_offset: (params.page - 1) * SALES_ORDER_PAGE_SIZE,
  };
}
