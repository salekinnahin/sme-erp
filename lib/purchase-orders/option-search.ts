import type { OptionSearchResult } from "@/lib/quotations/form";
import { getTenant, type TenantContext } from "@/lib/tenancy/context";
import type { PurchaseProductOption, VendorOption } from "./form";
import { searchPurchaseProductOptions, searchVendorOptions } from "./options";
import { canPurchaseOrder } from "./permissions";

/**
 * Selector searches for the purchase order form, as called by its Server
 * Actions (lib/purchase-orders/options.ts: active only, 25 per search,
 * tenant-filtered, RLS).
 *
 * The tenant comes from the session (active membership only), never from
 * the request; the only input is the search text. Signed-out users,
 * disabled members, roles that can neither create nor edit purchase orders,
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
    if (!canPurchaseOrder(tenant.role, "create") && !canPurchaseOrder(tenant.role, "editDraft"))
      return { ok: false };
    return await search(tenant);
  } catch (err) {
    console.error(`${label} failed`, err);
    return { ok: false };
  }
}

export function searchPurchaseOrderVendors(search: unknown): Promise<OptionSearchResult<VendorOption>> {
  return guarded("searchPurchaseOrderVendors", (tenant) => searchVendorOptions(tenant, search));
}

export function searchPurchaseOrderProducts(search: unknown): Promise<OptionSearchResult<PurchaseProductOption>> {
  return guarded("searchPurchaseOrderProducts", (tenant) => searchPurchaseProductOptions(tenant, search));
}
