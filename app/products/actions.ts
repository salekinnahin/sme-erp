"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant, type TenantContext } from "@/lib/tenancy/context";
import type { ProductWriteFailure } from "@/lib/products/errors";
import { canCategory } from "@/lib/products/permissions";
import {
  createProduct,
  setProductStatus,
  updateProduct,
} from "@/lib/products/products";
import {
  createCategory,
  renameCategory,
  setCategoryStatus,
} from "@/lib/products/categories";
import {
  PRODUCT_FIELDS,
  isProductStatus,
  validateCategoryName,
  validateProductInput,
  type ProductFieldErrors,
  type ProductRawInput,
} from "@/lib/products/validation";

export type ProductFormState = {
  error?: string;
  fieldErrors?: ProductFieldErrors;
  values?: ProductRawInput;
};

export type StatusState = { error?: string };

export type CategoryFormState = {
  error?: string;
  nameError?: string;
  name?: string;
  saved?: boolean;
};

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

const FAILURE_MESSAGES: Record<ProductWriteFailure, string> = {
  invalid: "Some details are not valid. Please check the form and try again.",
  forbidden: "You don't have permission to do that.",
  not_found: "This product could not be found.",
  duplicate: "This SKU is already used by another product.",
  invalid_category: "Choose an active category from the list.",
  failed: GENERIC_ERROR,
};

const CATEGORY_FAILURE_MESSAGES: Record<ProductWriteFailure, string> = {
  ...FAILURE_MESSAGES,
  not_found: "This category could not be found.",
  duplicate: "A category with this name already exists.",
};

function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function readProductFields(formData: FormData): ProductRawInput {
  // Only these fields are read. organization_id, status, created_by and
  // created_at are never taken from the request.
  return Object.fromEntries(
    PRODUCT_FIELDS.map((name) => [name, readString(formData, name)]),
  ) as ProductRawInput;
}

/**
 * The tenant for this request. Redirects if the user is signed out or has no
 * organization; returns null on a database error.
 */
async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await requireTenant();
  } catch (err) {
    unstable_rethrow(err); // let redirect() through
    console.error("Failed to load tenant in product action", err);
    return null;
  }
}

/** Duplicate SKU and category problems belong next to their fields. */
function productFailureState(
  reason: ProductWriteFailure,
  values: ProductRawInput,
): ProductFormState {
  if (reason === "duplicate")
    return { fieldErrors: { sku: FAILURE_MESSAGES.duplicate }, values };
  if (reason === "invalid_category")
    return { fieldErrors: { categoryId: FAILURE_MESSAGES.invalid_category }, values };
  return { error: FAILURE_MESSAGES[reason], values };
}

// -----------------------------------------------------------------------------
// Products
// -----------------------------------------------------------------------------

export async function createProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const values = readProductFields(formData);

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR, values };

  const parsed = validateProductInput(values);
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values };

  const result = await createProduct(tenant, parsed.value);
  if (!result.ok) return productFailureState(result.reason, values);

  revalidatePath("/products");
  redirect(`/products/${result.productId}`);
}

/** Bound to the product ID by the edit page. The ID is re-checked here. */
export async function updateProductAction(
  productId: string,
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const values = readProductFields(formData);

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR, values };

  const parsed = validateProductInput(values);
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values };

  const result = await updateProduct(tenant, productId, parsed.value);
  if (!result.ok) return productFailureState(result.reason, values);

  revalidatePath("/products");
  revalidatePath(`/products/${result.productId}`);
  redirect(`/products/${result.productId}`);
}

export async function setProductStatusAction(
  _prev: StatusState,
  formData: FormData,
): Promise<StatusState> {
  const productId = readString(formData, "productId");
  const status = readString(formData, "status");
  if (!isProductStatus(status)) return { error: FAILURE_MESSAGES.invalid };

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };

  const result = await setProductStatus(tenant, productId, status);
  if (!result.ok) return { error: FAILURE_MESSAGES[result.reason] };

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  return {};
}

// -----------------------------------------------------------------------------
// Categories
// -----------------------------------------------------------------------------

export async function createCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const name = readString(formData, "name");

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR, name };
  if (!canCategory(tenant.role, "create"))
    return { error: CATEGORY_FAILURE_MESSAGES.forbidden, name };

  const parsed = validateCategoryName(name);
  if (!parsed.ok) return { nameError: parsed.error, name };

  const result = await createCategory(tenant, parsed.value);
  if (!result.ok) {
    return result.reason === "duplicate"
      ? { nameError: CATEGORY_FAILURE_MESSAGES.duplicate, name }
      : { error: CATEGORY_FAILURE_MESSAGES[result.reason], name };
  }

  revalidatePath("/products", "layout");
  return { saved: true };
}

/** Bound to the category ID by the categories page. */
export async function renameCategoryAction(
  categoryId: string,
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const name = readString(formData, "name");

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR, name };
  if (!canCategory(tenant.role, "rename"))
    return { error: CATEGORY_FAILURE_MESSAGES.forbidden, name };

  const parsed = validateCategoryName(name);
  if (!parsed.ok) return { nameError: parsed.error, name };

  const result = await renameCategory(tenant, categoryId, parsed.value);
  if (!result.ok) {
    return result.reason === "duplicate"
      ? { nameError: CATEGORY_FAILURE_MESSAGES.duplicate, name }
      : { error: CATEGORY_FAILURE_MESSAGES[result.reason], name };
  }

  revalidatePath("/products", "layout");
  return { saved: true, name: parsed.value };
}

export async function setCategoryStatusAction(
  _prev: StatusState,
  formData: FormData,
): Promise<StatusState> {
  const categoryId = readString(formData, "categoryId");
  const status = readString(formData, "status");
  if (!isProductStatus(status)) return { error: CATEGORY_FAILURE_MESSAGES.invalid };

  const tenant = await loadTenant();
  if (!tenant) return { error: GENERIC_ERROR };

  const result = await setCategoryStatus(tenant, categoryId, status);
  if (!result.ok) return { error: CATEGORY_FAILURE_MESSAGES[result.reason] };

  revalidatePath("/products", "layout");
  return {};
}
