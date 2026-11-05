import type { CustomerOption, OptionSearchResult, ProductOption } from "@/lib/quotations/form";
import { searchCustomerOptions, searchProductOptions } from "@/lib/quotations/options";
import { getTenant, type TenantContext } from "@/lib/tenancy/context";
import { canSalesOrder } from "./permissions";

/**
 * Selector searches for the sales order form, as called by its Server
 * Actions. The search itself is the quotation selector search
 * (lib/quotations/options.ts: list_customers() / list_products(), active
 * only, 25 per search, tenant-filtered, RLS). Only the permission guard is
 * sales-order specific.
 *
 * The tenant comes from the session (active membership only), never from
 * the request; the only input is the search text. Signed-out users,
 * disabled members, roles that can neither create nor edit sales orders,
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
    if (!canSalesOrder(tenant.role, "create") && !canSalesOrder(tenant.role, "editDraft"))
      return { ok: false };
    return await search(tenant);
  } catch (err) {
    console.error(`${label} failed`, err);
    return { ok: false };
  }
}

export function searchSalesOrderCustomers(search: unknown): Promise<OptionSearchResult<CustomerOption>> {
  return guarded("searchSalesOrderCustomers", (tenant) => searchCustomerOptions(tenant, search));
}

export function searchSalesOrderProducts(search: unknown): Promise<OptionSearchResult<ProductOption>> {
  return guarded("searchSalesOrderProducts", (tenant) => searchProductOptions(tenant, search));
}
