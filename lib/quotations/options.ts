import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { trimText, truncateChars } from "@/lib/validation/text";
import {
  withCurrentOptions,
  type CustomerOption,
  type OptionSearchResult,
  type ProductOption,
} from "./form";

/**
 * Customer and product choices for the quotation form and list filter.
 *
 * The form never loads whole tables. New choices come from a small,
 * server-side search (searchCustomerOptions / searchProductOptions) that
 * reuses the list RPCs, list_customers() and list_products(): SECURITY
 * INVOKER (RLS applies), an explicit organization filter, the shared
 * whitespace trim, literal `\`, `%` and `_`, and a deterministic order
 * (newest first, ID tie-breaker). Only active records are offered.
 *
 * The records a quotation already references are fetched separately by ID,
 * within the tenant and without a status filter (getCustomerOption /
 * getProductOptions). So an edit form always shows its current customer and
 * products, even inactive ones, and saving an unrelated change never
 * silently clears or swaps a reference.
 *
 * Every query filters on organization_id and RLS applies, so another
 * tenant's IDs are never loaded: they are simply not found.
 */

type Tenant = Pick<TenantContext, "organization">;

/** Cap of the quotation list's customer filter (all customers, by name). */
export const OPTION_LIMIT = 500;

/** Results per selector search. */
export const SEARCH_OPTION_LIMIT = 25;

/** Same cap as the customer and product list searches (and the RPCs). */
export const OPTION_SEARCH_MAX_LENGTH = 100;

export type OptionList<T> = {
  options: T[];
  /** True if more records exist than the capped list shows. */
  truncated: boolean;
};

type CustomerRow = {
  id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  status: CustomerOption["status"];
};

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  description: string | null;
  selling_price: string | null;
  status: ProductOption["status"];
};

const CUSTOMER_COLUMNS = "id, name, company_name, phone, email, status";
const PRODUCT_COLUMNS = "id, name, sku, unit, description, selling_price::text, status";

function toCustomerOption(row: CustomerRow): CustomerOption {
  return {
    id: row.id,
    name: row.name,
    companyName: row.company_name,
    phone: row.phone,
    email: row.email,
    status: row.status,
  };
}

function toProductOption(row: ProductRow): ProductOption {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    unit: row.unit,
    description: row.description,
    sellingPrice: row.selling_price,
    status: row.status,
  };
}

/** Valid, distinct, lower-case IDs that are not already in the list. */
function missingIds(ids: readonly (string | null | undefined)[], listed: { id: string }[] = []): string[] {
  const have = new Set(listed.map((o) => o.id));
  return [
    ...new Set(
      ids
        .filter((id): id is string => typeof id === "string" && isUuid(id))
        .map((id) => id.toLowerCase())
        .filter((id) => !have.has(id)),
    ),
  ];
}

/**
 * The search term as the list RPCs use it: a string, at most 100 code
 * points, trimmed with the shared whitespace set. "" means no filter.
 */
export function normalizeOptionSearch(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return trimText(truncateChars(raw, OPTION_SEARCH_MAX_LENGTH));
}

type CountedRow = { total_count: number | string };

/** total_count is a bigint; PostgREST may send it as a string. */
function hasMore(rows: CountedRow[]): boolean {
  return rows.length > 0 && Number(rows[0].total_count) > rows.length;
}

// -----------------------------------------------------------------------------
// Current references (by ID, any status)
// -----------------------------------------------------------------------------

async function fetchCustomersById(tenant: Tenant, ids: string[]): Promise<CustomerOption[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("organization_id", tenant.organization.id)
    .in("id", ids)
    .returns<CustomerRow[]>();
  if (error) throw new Error("Failed to load customer.", { cause: error });
  return (data ?? []).map(toCustomerOption);
}

/**
 * The quotation's current customer, active or not, or null if the ID is
 * malformed, unknown or another tenant's.
 */
export async function getCustomerOption(
  tenant: Tenant,
  customerId: string | null | undefined,
): Promise<CustomerOption | null> {
  const [found] = await fetchCustomersById(tenant, missingIds([customerId]));
  return found ?? null;
}

/**
 * The products the quotation's lines use, active or not. Malformed,
 * unknown and other tenants' IDs are left out. One query for all lines.
 */
export async function getProductOptions(
  tenant: Tenant,
  productIds: readonly (string | null | undefined)[],
): Promise<ProductOption[]> {
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
  return (data ?? []).map(toProductOption);
}

// -----------------------------------------------------------------------------
// Selector search (active only, bounded)
// -----------------------------------------------------------------------------

type CustomerSearchRow = CustomerRow & CountedRow;

/**
 * Active customers matching the search (name, company name, email, phone;
 * the same matching as the customer list). Empty search: the newest.
 */
export async function searchCustomerOptions(
  tenant: Tenant,
  rawSearch: unknown,
): Promise<OptionSearchResult<CustomerOption>> {
  const search = normalizeOptionSearch(rawSearch);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_customers", {
    p_organization_id: tenant.organization.id,
    p_search: search || null,
    p_status: "active",
    p_limit: SEARCH_OPTION_LIMIT,
    p_offset: 0,
  });
  if (error) throw new Error("Failed to search customers.", { cause: error });

  const rows = ((data ?? []) as CustomerSearchRow[]).slice(0, SEARCH_OPTION_LIMIT);
  return {
    ok: true,
    options: rows.filter((r) => r.status === "active").map(toCustomerOption),
    more: hasMore(rows),
  };
}

type ProductSearchRow = { id: string; status: ProductOption["status"] } & CountedRow;

/**
 * Active products and services matching the search (name, SKU, category
 * name; the same matching as the product list). Empty search: the newest.
 *
 * list_products() does not return the description needed to prefill a
 * line, so the matches are read again by ID (tenant and active filter
 * repeated) and kept in the RPC's order.
 */
export async function searchProductOptions(
  tenant: Tenant,
  rawSearch: unknown,
): Promise<OptionSearchResult<ProductOption>> {
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

  const byId = new Map((details ?? []).map((row) => [row.id, toProductOption(row)]));
  return {
    ok: true,
    options: ids.map((id) => byId.get(id)).filter((p): p is ProductOption => p !== undefined),
    more: hasMore(rows),
  };
}

// -----------------------------------------------------------------------------
// Quotation list filter
// -----------------------------------------------------------------------------

/**
 * Customers for the quotation list's customer filter: all of them (or only
 * active ones), by name, capped, plus the filtered customer even if it is
 * beyond the cap.
 */
export async function listCustomerOptions(
  tenant: Tenant,
  { currentId, includeInactive = false }: { currentId?: string | null; includeInactive?: boolean } = {},
): Promise<OptionList<CustomerOption>> {
  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("organization_id", tenant.organization.id);
  if (!includeInactive) query = query.eq("status", "active");
  const { data, error } = await query
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(OPTION_LIMIT + 1)
    .returns<CustomerRow[]>();
  if (error) throw new Error("Failed to load customers.", { cause: error });

  const rows = data ?? [];
  const listed = rows.slice(0, OPTION_LIMIT).map(toCustomerOption);
  const current = await fetchCustomersById(tenant, missingIds([currentId], listed));

  return { options: withCurrentOptions(listed, current), truncated: rows.length > OPTION_LIMIT };
}
