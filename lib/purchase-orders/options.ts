import {
  hasMore,
  missingIds,
  normalizeOptionSearch,
  OPTION_LIMIT,
  SEARCH_OPTION_LIMIT,
  type CountedRow,
  type OptionList,
} from "@/lib/quotations/options";
import { withCurrentOptions, type OptionSearchResult } from "@/lib/quotations/form";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import type { PurchaseProductOption, VendorOption } from "./form";

/**
 * Vendor and product choices for the purchase order form and list filter.
 * Same rules as the quotation options (lib/quotations/options.ts):
 *
 *   - New choices come from a bounded server-side search that reuses the
 *     list RPCs, list_vendors() and list_products(): SECURITY INVOKER (RLS
 *     applies), explicit organization filter, shared whitespace trim,
 *     literal wildcards, deterministic order. Active records only.
 *   - The records a PO already references are read by ID within the tenant,
 *     whatever their status, so an edit form keeps showing them.
 *
 * Products carry their PURCHASE price (the PO default), never the selling
 * price.
 */

type Tenant = Pick<TenantContext, "organization">;

type VendorRow = {
  id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  status: VendorOption["status"];
};

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  description: string | null;
  purchase_price: string | null;
  status: PurchaseProductOption["status"];
};

const VENDOR_COLUMNS = "id, name, company_name, phone, email, status";
const PRODUCT_COLUMNS = "id, name, sku, unit, description, purchase_price::text, status";

function toVendorOption(row: VendorRow): VendorOption {
  return {
    id: row.id,
    name: row.name,
    companyName: row.company_name,
    phone: row.phone,
    email: row.email,
    status: row.status,
  };
}

export function toPurchaseProductOption(row: ProductRow): PurchaseProductOption {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    unit: row.unit,
    description: row.description,
    purchasePrice: row.purchase_price,
    status: row.status,
  };
}

// -----------------------------------------------------------------------------
// Current references (by ID, any status)
// -----------------------------------------------------------------------------

async function fetchVendorsById(tenant: Tenant, ids: string[]): Promise<VendorOption[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select(VENDOR_COLUMNS)
    .eq("organization_id", tenant.organization.id)
    .in("id", ids)
    .returns<VendorRow[]>();
  if (error) throw new Error("Failed to load vendor.", { cause: error });
  return (data ?? []).map(toVendorOption);
}

/** The PO's current vendor, active or not; null if malformed, unknown or another tenant's. */
export async function getVendorOption(
  tenant: Tenant,
  vendorId: string | null | undefined,
): Promise<VendorOption | null> {
  const [found] = await fetchVendorsById(tenant, missingIds([vendorId]));
  return found ?? null;
}

/** The products the PO's lines use, active or not. One query for all lines. */
export async function getPurchaseProductOptions(
  tenant: Tenant,
  productIds: readonly (string | null | undefined)[],
): Promise<PurchaseProductOption[]> {
  const ids = missingIds(productIds);
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("organization_id", tenant.organization.id)
    .in("id", ids)
    .returns<ProductRow[]>();
  if (error) throw new Error("Failed to load products.", { cause: error });
  return (data ?? []).map(toPurchaseProductOption);
}

// -----------------------------------------------------------------------------
// Selector search (active only, bounded)
// -----------------------------------------------------------------------------

type VendorSearchRow = VendorRow & CountedRow;

/**
 * Active vendors matching the search (name, company name, email, phone;
 * the same matching as the vendor list). Empty search: the newest.
 */
export async function searchVendorOptions(
  tenant: Tenant,
  rawSearch: unknown,
): Promise<OptionSearchResult<VendorOption>> {
  const search = normalizeOptionSearch(rawSearch);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_vendors", {
    p_organization_id: tenant.organization.id,
    p_search: search || null,
    p_status: "active",
    p_limit: SEARCH_OPTION_LIMIT,
    p_offset: 0,
  });
  if (error) throw new Error("Failed to search vendors.", { cause: error });

  const rows = ((data ?? []) as VendorSearchRow[]).slice(0, SEARCH_OPTION_LIMIT);
  return {
    ok: true,
    options: rows.filter((r) => r.status === "active").map(toVendorOption),
    more: hasMore(rows),
  };
}

type ProductSearchRow = { id: string; status: PurchaseProductOption["status"] } & CountedRow;

/**
 * Active products and services matching the search (name, SKU, category
 * name; the same matching as the product list), with their purchase price.
 * list_products() has no description/price columns, so matches are read
 * again by ID (tenant and active filter repeated), in the RPC's order.
 */
export async function searchPurchaseProductOptions(
  tenant: Tenant,
  rawSearch: unknown,
): Promise<OptionSearchResult<PurchaseProductOption>> {
  const search = normalizeOptionSearch(rawSearch);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_products", {
    p_organization_id: tenant.organization.id,
    p_search: search || null,
    p_status: "active",
    p_product_type: null,
    p_category_id: null,
    p_limit: SEARCH_OPTION_LIMIT,
    p_offset: 0,
  });
  if (error) throw new Error("Failed to search products.", { cause: error });

  const rows = ((data ?? []) as ProductSearchRow[]).slice(0, SEARCH_OPTION_LIMIT);
  const ids = missingIds(rows.filter((r) => r.status === "active").map((r) => r.id));
  if (!ids.length) return { ok: true, options: [], more: hasMore(rows) };

  const { data: details, error: detailError } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("organization_id", tenant.organization.id)
    .eq("status", "active")
    .in("id", ids)
    .returns<ProductRow[]>();
  if (detailError) throw new Error("Failed to search products.", { cause: detailError });

  const byId = new Map((details ?? []).map((row) => [row.id, toPurchaseProductOption(row)]));
  return {
    ok: true,
    options: ids.map((id) => byId.get(id)).filter((p): p is PurchaseProductOption => p !== undefined),
    more: hasMore(rows),
  };
}

// -----------------------------------------------------------------------------
// PO list filter
// -----------------------------------------------------------------------------

/**
 * Vendors for the PO list's vendor filter: all of them (also inactive, since
 * old orders reference them), by name, capped, plus the filtered vendor even
 * if it is beyond the cap.
 */
export async function listVendorFilterOptions(
  tenant: Tenant,
  { currentId }: { currentId?: string | null } = {},
): Promise<OptionList<VendorOption>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select(VENDOR_COLUMNS)
    .eq("organization_id", tenant.organization.id)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(OPTION_LIMIT + 1)
    .returns<VendorRow[]>();
  if (error) throw new Error("Failed to load vendors.", { cause: error });

  const rows = data ?? [];
  const listed = rows.slice(0, OPTION_LIMIT).map(toVendorOption);
  const current = await fetchVendorsById(tenant, missingIds([currentId], listed));
  return { options: withCurrentOptions(listed, current), truncated: rows.length > OPTION_LIMIT };
}
