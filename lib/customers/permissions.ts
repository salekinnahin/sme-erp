import type { Role } from "@/lib/tenancy/context";

/**
 * Version 1 customer permissions (docs/DECISIONS.md 013).
 *
 * Used by Server Actions and domain functions to reject operations early and
 * by pages to decide which controls to show. The database enforces the same
 * rules (RLS, column privileges and set_customer_status()), so hiding a
 * control is never the only protection.
 */
export type CustomerAction = "view" | "create" | "edit" | "changeStatus";

const CUSTOMER_PERMISSIONS: Record<CustomerAction, readonly Role[]> = {
  view: ["owner", "manager", "employee"],
  create: ["owner", "manager", "employee"],
  edit: ["owner", "manager", "employee"],
  changeStatus: ["owner", "manager"],
};

export function canCustomer(role: Role, action: CustomerAction): boolean {
  return CUSTOMER_PERMISSIONS[action].includes(role);
}
