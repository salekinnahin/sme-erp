import type { Role } from "@/lib/tenancy/context";

/**
 * Version 1 vendor permissions (same as customers, docs/DECISIONS.md 013).
 *
 * Used by Server Actions and domain functions to reject operations early and
 * by pages to decide which controls to show. The database enforces the same
 * rules (RLS, column privileges and set_vendor_status()), so hiding a
 * control is never the only protection.
 */
export type VendorAction = "view" | "create" | "edit" | "changeStatus";

const VENDOR_PERMISSIONS: Record<VendorAction, readonly Role[]> = {
  view: ["owner", "manager", "employee"],
  create: ["owner", "manager", "employee"],
  edit: ["owner", "manager", "employee"],
  changeStatus: ["owner", "manager"],
};

export function canVendor(role: Role, action: VendorAction): boolean {
  return VENDOR_PERMISSIONS[action].includes(role);
}
