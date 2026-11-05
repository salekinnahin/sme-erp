import { getTenant, type TenantContext } from "@/lib/tenancy/context";
import type { CustomerOption, OptionSearchResult, ProductOption } from "./form";
import { searchCustomerOptions, searchProductOptions } from "./options";
import { canQuotation } from "./permissions";

/**
 * Selector searches for the quotation form, as called by its Server
 * Actions. The tenant comes from the session (active membership only),
 * never from the request; the only input is the search text.
 *
 * Signed-out users, disabled members and roles that can neither create nor
 * edit drafts get { ok: false }, and so does any error (logged on the server
 * only). The answer is the same whatever organizations exist, so the search
 * is no tenant-existence side channel. No redirect: these run while the
 * form is open in the browser.
 */
async function guarded<T>(
  label: string,
  search: (tenant: TenantContext) => Promise<OptionSearchResult<T>>,
): Promise<OptionSearchResult<T>> {
  try {
    const tenant = await getTenant();
    if (!tenant) return { ok: false };
    if (!canQuotation(tenant.role, "create") && !canQuotation(tenant.role, "editDraft"))
      return { ok: false };
    return await search(tenant);
  } catch (err) {
    console.error(`${label} failed`, err);
    return { ok: false };
  }
}

/** Active customers of the caller's organization matching `search`. */
export function searchQuotationCustomers(search: unknown): Promise<OptionSearchResult<CustomerOption>> {
  return guarded("searchQuotationCustomers", (tenant) => searchCustomerOptions(tenant, search));
}

/** Active products of the caller's organization matching `search`. */
export function searchQuotationProducts(search: unknown): Promise<OptionSearchResult<ProductOption>> {
  return guarded("searchQuotationProducts", (tenant) => searchProductOptions(tenant, search));
}
