import { isUuid } from "@/lib/validation/fields";
import { trimText, truncateChars } from "@/lib/validation/text";
import { isInvoiceStatus, type InvoiceStatus } from "./validation";

/**
 * Invoice list parameters from the URL query string. Same rules as the
 * quotation list: untrusted values become safe defaults, and the database
 * (list_invoices()) repeats the trimming and caps.
 */

export const INVOICE_PAGE_SIZE = 25;
/** Same cap as list_invoices() applies in the database. */
export const INVOICE_SEARCH_MAX_LENGTH = 100;
const MAX_PAGE = 10_000;

export type InvoiceStatusFilter = InvoiceStatus | "all";

export type InvoiceListParams = {
  /** Invoice number or customer name (snapshot). */
  search: string;
  status: InvoiceStatusFilter;
  /** A customer ID, or "all". */
  customer: string;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

/** Use only the tenant-filtered source ID from the list read, with its recorded label. */
export function sourceSalesOrderHref(id: string | null, number: string | null): string | null {
  return id && number ? `/sales-orders/${id}` : null;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Parses untrusted query-string values into safe list parameters. */
export function parseInvoiceListParams(params: SearchParams): InvoiceListParams {
  const search = truncateChars(trimText(first(params.q)), INVOICE_SEARCH_MAX_LENGTH);
  const statusRaw = first(params.status);
  const customerRaw = first(params.customer);
  const pageNum = Number.parseInt(first(params.page), 10);
  return {
    search,
    status: isInvoiceStatus(statusRaw) ? statusRaw : "all",
    customer: isUuid(customerRaw) ? customerRaw.toLowerCase() : "all",
    page: Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, MAX_PAGE) : 1,
  };
}

/** The list URL for the given parameters (defaults are left out). */
export function invoiceListHref(params: InvoiceListParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("q", params.search);
  if (params.status !== "all") query.set("status", params.status);
  if (params.customer !== "all") query.set("customer", params.customer);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return qs ? `/invoices?${qs}` : "/invoices";
}

/** Arguments for list_invoices(); the organization comes from the tenant. */
export function toListInvoicesArgs(organizationId: string, params: InvoiceListParams) {
  return {
    p_organization_id: organizationId,
    p_search: params.search || null,
    p_status: params.status === "all" ? null : params.status,
    p_customer_id: params.customer === "all" ? null : params.customer,
    p_limit: INVOICE_PAGE_SIZE,
    p_offset: (params.page - 1) * INVOICE_PAGE_SIZE,
  };
}
