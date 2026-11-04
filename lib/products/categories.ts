import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenancy/context";
import { isUuid } from "@/lib/validation/fields";
import { writeFailure, type ProductWriteFailure } from "./errors";
import { canCategory } from "./permissions";
import type { ProductStatus } from "./validation";

/**
 * Product category domain functions. Same rules as lib/products/products.ts:
 * the tenant comes from requireTenant(), every query is scoped by
 * organization_id and by RLS, reads throw, writes return a reason.
 */

type Tenant = Pick<TenantContext, "organization" | "role">;

export type ProductCategory = {
  id: string;
  name: string;
  status: ProductStatus;
};

export type CategoryWriteResult =
  | { ok: true; categoryId: string }
  | { ok: false; reason: ProductWriteFailure };

// Categories are a short list per organization; this is a safety cap.
const MAX_CATEGORIES = 1000;

/** The tenant's categories, by name. */
export async function listCategories(tenant: Tenant): Promise<ProductCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, name, status")
    .eq("organization_id", tenant.organization.id)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_CATEGORIES);

  if (error) throw new Error("Failed to load categories.", { cause: error });
  return (data ?? []) as ProductCategory[];
}

/** One category of the tenant, or null. */
export async function getCategory(
  tenant: Tenant,
  categoryId: string,
): Promise<ProductCategory | null> {
  if (!isUuid(categoryId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, name, status")
    .eq("id", categoryId)
    .eq("organization_id", tenant.organization.id)
    .maybeSingle<ProductCategory>();

  if (error) throw new Error("Failed to load category.", { cause: error });
  return data;
}

/**
 * Options for a product's category select: the active categories, plus the
 * product's current category even if it is inactive. Other inactive
 * categories are left out, so they can't be newly assigned.
 */
export function selectableCategories(
  categories: ProductCategory[],
  current: ProductCategory | null,
): ProductCategory[] {
  const options = categories.filter(
    (c) => c.status === "active" || c.id === current?.id,
  );
  if (current && !options.some((c) => c.id === current.id)) options.unshift(current);
  return options;
}

/**
 * Category options for the product form. The current category is fetched
 * by ID when it is not in the capped list (MAX_CATEGORIES), so an edit form
 * never shows "No category" for a product that has one, and saving an
 * unrelated change never clears it. getCategory() is scoped to the tenant,
 * so another organization's category ID is never loaded.
 */
export async function listCategoryOptions(
  tenant: Tenant,
  currentCategoryId: string | null,
): Promise<ProductCategory[]> {
  const categories = await listCategories(tenant);
  let current: ProductCategory | null = null;
  if (currentCategoryId) {
    current =
      categories.find((c) => c.id === currentCategoryId) ??
      (await getCategory(tenant, currentCategoryId));
  }
  return selectableCategories(categories, current);
}

/** Creates an active category. Names are unique per organization, ignoring case. */
export async function createCategory(
  tenant: Tenant,
  name: string,
): Promise<CategoryWriteResult> {
  if (!canCategory(tenant.role, "create")) return { ok: false, reason: "forbidden" };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("product_categories")
      .insert({ organization_id: tenant.organization.id, name })
      .select("id")
      .single<{ id: string }>();

    if (error) return { ok: false, reason: writeFailure("createCategory", error) };
    return { ok: true, categoryId: data.id };
  } catch (err) {
    console.error("createCategory threw", err);
    return { ok: false, reason: "failed" };
  }
}

export async function renameCategory(
  tenant: Tenant,
  categoryId: string,
  name: string,
): Promise<CategoryWriteResult> {
  if (!canCategory(tenant.role, "rename")) return { ok: false, reason: "forbidden" };
  if (!isUuid(categoryId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("product_categories")
      .update({ name })
      .eq("id", categoryId)
      .eq("organization_id", tenant.organization.id)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) return { ok: false, reason: writeFailure("renameCategory", error) };
    if (!data) return { ok: false, reason: "not_found" };
    return { ok: true, categoryId: data.id };
  } catch (err) {
    console.error("renameCategory threw", err);
    return { ok: false, reason: "failed" };
  }
}

/** Deactivates or reactivates a category (owner and manager only). Its
 *  products keep the category. */
export async function setCategoryStatus(
  tenant: Tenant,
  categoryId: string,
  status: ProductStatus,
): Promise<CategoryWriteResult> {
  if (!canCategory(tenant.role, "changeStatus"))
    return { ok: false, reason: "forbidden" };
  if (!isUuid(categoryId)) return { ok: false, reason: "not_found" };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_product_category_status", {
      p_category_id: categoryId,
      p_status: status,
    });
    if (error) return { ok: false, reason: writeFailure("setCategoryStatus", error) };
    return { ok: true, categoryId };
  } catch (err) {
    console.error("setCategoryStatus threw", err);
    return { ok: false, reason: "failed" };
  }
}
