import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { writeFailure, type ProductWriteFailure } from "./errors";
import { canProduct } from "./permissions";
import {
  PRODUCT_PAGE_SIZE,
  type ProductInput,
  type ProductListParams,
  type ProductStatus,
  type ProductType,
  type ProductUnit,
} from "./validation";

/**
 * Product domain functions (same shape as lib/vendors/vendors.ts). Callers
 * pass the tenant from requireTenant(); the organization is never taken from
 * request input.
 *
 * Every query is scoped twice: an explicit organization_id filter, and RLS.
 * Reads throw on database errors so the route's error boundary handles them.
 * Writes return a result with a reason that the Server Action maps to a safe
 * message.
 *
 * Prices and the reorder level are read as text (`::text`) and written as
 * decimal strings, so they never pass through JavaScript floating point.
 */

type Tenant = Pick<TenantContext, "organization" | "role">;

export type Product = {
  id: string;
  name: string;
  sku: string;
  categoryId: string | null;
  categoryName: string | null;
  productType: ProductType;
  unit: ProductUnit;
  description: string | null;
  purchasePrice: string | null;
  sellingPrice: string | null;
  reorderLevel: string;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
};

export type ProductListItem = Pick<
  Product,
  | "id"
  | "name"
  | "sku"
  | "categoryId"
  | "categoryName"
  | "productType"
  | "unit"
  | "purchasePrice"
  | "sellingPrice"
  | "status"
  | "createdAt"
>;

export type ProductList = {
  items: ProductListItem[];
  /** Matching rows across all pages. Null if the page is past the end. */
  total: number | null;
  page: number;
  pageSize: number;
};

export type ProductWriteResult =
  | { ok: true; productId: string }
  | { ok: false; reason: ProductWriteFailure };

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  category_id: string | null;
  product_type: ProductType;
  unit: ProductUnit;
  description: string | null;
  purchase_price: string | null;
  selling_price: string | null;
  reorder_level: string;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
};

type ProductListRow = {
  id: string;
  name: string;
  sku: string;
  category_id: string | null;
  category_name: string | null;
  product_type: ProductType;
  unit: ProductUnit;
  purchase_price: string | null;
  selling_price: string | null;
  status: ProductStatus;
  created_at: string;
  total_count: number | string;
};

const PRODUCT_COLUMNS =
  "id, name, sku, category_id, product_type, unit, description, " +
  "purchase_price::text, selling_price::text, reorder_level::text, " +
  "status, created_at, updated_at";

/** Writable columns only. organization_id is added on insert. */
function toRow(input: ProductInput) {
  return {
    name: input.name,
    sku: input.sku,
    category_id: input.categoryId,
    product_type: input.productType,
    unit: input.unit,
    description: input.description,
    purchase_price: input.purchasePrice,
    selling_price: input.sellingPrice,
    reorder_level: input.reorderLevel,
  };
}

/** One product of the tenant, or null if it doesn't exist or isn't theirs. */
export async function getProduct(
  tenant: Tenant,
  productId: string,
): Promise<Product | null> {
  if (!isUuid(productId)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("id", productId)
    .eq("organization_id", tenant.organization.id)
    .maybeSingle<ProductRow>();

  if (error) throw new Error("Failed to load product.", { cause: error });
  if (!data) return null;

  let categoryName: string | null = null;
  if (data.category_id) {
    const { data: category, error: catError } = await supabase
      .from("product_categories")
      .select("name")
      .eq("id", data.category_id)
      .eq("organization_id", tenant.organization.id)
      .maybeSingle<{ name: string }>();
    if (catError) throw new Error("Failed to load category.", { cause: catError });
    categoryName = category?.name ?? null;
  }

  return {
    id: data.id,
    name: data.name,
    sku: data.sku,
    categoryId: data.category_id,
    categoryName,
    productType: data.product_type,
    unit: data.unit,
    description: data.description,
    purchasePrice: data.purchase_price,
    sellingPrice: data.selling_price,
    reorderLevel: data.reorder_level,
    status: data.status,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/** A page of the tenant's products, newest first. */
export async function listProducts(
  tenant: Tenant,
  params: ProductListParams,
): Promise<ProductList> {
  const pageSize = PRODUCT_PAGE_SIZE;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_products", {
    p_organization_id: tenant.organization.id,
    p_search: params.search || null,
    p_status: params.status === "all" ? null : params.status,
    p_product_type: params.type === "all" ? null : params.type,
    p_category_id: params.category === "all" ? null : params.category,
    p_limit: pageSize,
    p_offset: (params.page - 1) * pageSize,
  });

  if (error) throw new Error("Failed to load products.", { cause: error });

  const rows = (data ?? []) as ProductListRow[];
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      categoryId: row.category_id,
      categoryName: row.category_name,
      productType: row.product_type,
      unit: row.unit,
      purchasePrice: row.purchase_price,
      sellingPrice: row.selling_price,
      status: row.status,
      createdAt: row.created_at,
    })),
    // total_count is a bigint; PostgREST may send it as a string.
    total: rows.length
      ? Number(rows[0].total_count)
      : params.page === 1
        ? 0
        : null,
    page: params.page,
    pageSize,
  };
}

/**
 * A category may be chosen if it belongs to the tenant and is active, or if
 * it is the product's current category (so editing an older product doesn't
 * force a category change). The composite foreign key enforces the
 * same-organization part in the database.
 */
async function categoryAllowed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenant: Tenant,
  categoryId: string,
  currentCategoryId: string | null,
): Promise<boolean> {
  if (categoryId === currentCategoryId) return true;
  const { data, error } = await supabase
    .from("product_categories")
    .select("status")
    .eq("id", categoryId)
    .eq("organization_id", tenant.organization.id)
    .maybeSingle<{ status: ProductStatus }>();
  if (error) throw error;
  return data?.status === "active";
}

/** Creates an active product in the tenant's organization. */
export async function createProduct(
  tenant: Tenant,
  input: ProductInput,
): Promise<ProductWriteResult> {
  if (!canProduct(tenant.role, "create")) return { ok: false, reason: "forbidden" };

  try {
    const supabase = await createClient();
    if (
      input.categoryId &&
      !(await categoryAllowed(supabase, tenant, input.categoryId, null))
    )
      return { ok: false, reason: "invalid_category" };

    // status defaults to 'active' and created_by to auth.uid() in the
    // database. Clients have no privilege to set either.
    const { data, error } = await supabase
      .from("products")
      .insert({ organization_id: tenant.organization.id, ...toRow(input) })
      .select("id")
      .single<{ id: string }>();

    if (error) return { ok: false, reason: writeFailure("createProduct", error) };
    return { ok: true, productId: data.id };
  } catch (err) {
    console.error("createProduct threw", err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Updates the editable fields of one of the tenant's products. Product type
 * changes are allowed while there is no stock data; once stock movements
 * exist this needs a rule (DECISIONS 016).
 */
export async function updateProduct(
  tenant: Tenant,
  productId: string,
  input: ProductInput,
): Promise<ProductWriteResult> {
  if (!canProduct(tenant.role, "edit")) return { ok: false, reason: "forbidden" };
  if (!isUuid(productId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();

    if (input.categoryId) {
      const { data: current, error } = await supabase
        .from("products")
        .select("category_id")
        .eq("id", productId)
        .eq("organization_id", tenant.organization.id)
        .maybeSingle<{ category_id: string | null }>();
      if (error) return { ok: false, reason: writeFailure("updateProduct", error) };
      if (!current) return { ok: false, reason: "not_found" };
      if (!(await categoryAllowed(supabase, tenant, input.categoryId, current.category_id)))
        return { ok: false, reason: "invalid_category" };
    }

    const { data, error } = await supabase
      .from("products")
      .update(toRow(input))
      .eq("id", productId)
      .eq("organization_id", tenant.organization.id)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) return { ok: false, reason: writeFailure("updateProduct", error) };
    // No row: it doesn't exist, or RLS hides it (another tenant).
    if (!data) return { ok: false, reason: "not_found" };
    return { ok: true, productId: data.id };
  } catch (err) {
    console.error("updateProduct threw", err);
    return { ok: false, reason: "failed" };
  }
}

/** Deactivates or reactivates a product (owner and manager only). */
export async function setProductStatus(
  tenant: Tenant,
  productId: string,
  status: ProductStatus,
): Promise<ProductWriteResult> {
  if (!canProduct(tenant.role, "changeStatus"))
    return { ok: false, reason: "forbidden" };
  if (!isUuid(productId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    // The function re-checks membership and role in the database.
    const { error } = await supabase.rpc("set_product_status", {
      p_product_id: productId,
      p_status: status,
    });

    if (error) return { ok: false, reason: writeFailure("setProductStatus", error) };
    return { ok: true, productId };
  } catch (err) {
    console.error("setProductStatus threw", err);
    return { ok: false, reason: "failed" };
  }
}
