import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenancy/context";
import { isOrganizationFeatureKey, type OrganizationFeatureKey } from "./feature-keys";

/**
 * Request-time entitlement check for routes, actions and server navigation.
 * Tenant comes only from the verified session. No cross-request caching:
 * the database re-checks membership and the current entitlement on each call.
 * Role permissions must be checked separately by the consuming module.
 */
export async function hasOrganizationFeature(feature: OrganizationFeatureKey): Promise<boolean> {
  if (!isOrganizationFeatureKey(feature)) return false;

  try {
    const tenant = await getTenant();
    if (!tenant) return false;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("has_org_feature", {
      p_organization_id: tenant.organization.id,
      p_feature_key: feature,
    });
    return !error && data === true;
  } catch {
    // Auth, membership, transport and database failures never grant access.
    return false;
  }
}
