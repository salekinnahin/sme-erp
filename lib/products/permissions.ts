import type { Role } from "@/lib/tenancy/context";

/**
 * Version 1 product and category permissions (same shape as customers and
 * vendors, docs/DECISIONS.md 013).
 *
 * Used by Server Actions and domain functions to reject operations early and
 * by pages to decide which controls to show. The database enforces the same
 * rules (RLS, column privileges, set_product_status() and
 * set_product_category_status()), so hiding a control is never the only
 * protection.
 */
export type ProductAction = "view" | "create" | "edit" | "changeStatus";

const PERMISSIONS: Record<ProductAction, readonly Role[]> = {
  view: ["owner", "manager", "employee"],
  create: ["owner", "manager", "employee"],
  edit: ["owner", "manager", "employee"],
  changeStatus: ["owner", "manager"],
};

export function canProduct(role: Role, action: ProductAction): boolean {
  return PERMISSIONS[action].includes(role);
}

/**
 * Categories: everyone views them (and picks active ones for products); only
 * owners and managers create, rename, deactivate and reactivate them. The
 * database enforces the same rule (RLS policies from
 * 20261104080000_restrict_product_category_writes.sql and
 * set_product_category_status()).
 */
export type CategoryAction = "view" | "create" | "rename" | "changeStatus";

const CATEGORY_PERMISSIONS: Record<CategoryAction, readonly Role[]> = {
  view: ["owner", "manager", "employee"],
  create: ["owner", "manager"],
  rename: ["owner", "manager"],
  changeStatus: ["owner", "manager"],
};

export function canCategory(role: Role, action: CategoryAction): boolean {
  return CATEGORY_PERMISSIONS[action].includes(role);
}
