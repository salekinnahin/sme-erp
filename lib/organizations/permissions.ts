import type { Role } from "@/lib/tenancy/context";

/**
 * Organization branding permissions (DECISIONS 029). Owners and managers
 * manage the logo; every active member sees it on documents. Storage
 * policies and the branding RPCs enforce the same rule, so hiding a control
 * is never the only protection. Branding is not a feature entitlement.
 */
export type BrandingAction = "view" | "manage";

const BRANDING_PERMISSIONS: Record<BrandingAction, readonly Role[]> = {
  view: ["owner", "manager", "employee"],
  manage: ["owner", "manager"],
};

export function canBranding(role: Role, action: BrandingAction): boolean {
  return BRANDING_PERMISSIONS[action].includes(role);
}
