import type { CustomerOption, OptionSearchResult, ProductOption } from "@/lib/quotations/form";
import { searchCustomerOptions, searchProductOptions } from "@/lib/quotations/options";
import { getTenant, type TenantContext } from "@/lib/tenancy/context";
import { canInvoice } from "./permissions";

/**
 * Selector searches for the invoice form, as called by its Server
 * Actions. The search itself is the quotation selector search
 * (lib/quotations/options.ts: list_customers() / list_products(), active
 * only, 25 per search, tenant-filtered, RLS). Only the permission guard is
 * invoice specific.
 *
 * The tenant comes from the session (active membership only), never from
 * the request; the only input is the search text. Signed-out users,
 * disabled members, roles that can neither create nor edit invoices,
 * and any error give { ok: false } (details logged on the server only). No
 * redirect: these run while the form is open in the browser.
 */
async function guarded<T>(
  label: string,
  search: (tenant: TenantContext) => Promise<OptionSearchResult<T>>,
): Promise<OptionSearchResult<T>> {
  try {
    const tenant = await getTenant();
    if (!tenant) return { ok: false };
    if (!canInvoice(tenant.role, "create") && !canInvoice(tenant.role, "editDraft"))
      return { ok: false };
    return await search(tenant);
  } catch (err) {
    console.error(`${label} failed`, err);
    return { ok: false };
  }
}

export function searchInvoiceCustomers(search: unknown): Promise<OptionSearchResult<CustomerOption>> {
  return guarded("searchInvoiceCustomers", (tenant) => searchCustomerOptions(tenant, search));
}

export function searchInvoiceProducts(search: unknown): Promise<OptionSearchResult<ProductOption>> {
  return guarded("searchInvoiceProducts", (tenant) => searchProductOptions(tenant, search));
}
