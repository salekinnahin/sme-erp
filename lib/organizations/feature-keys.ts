/** Keep in sync with organization_features_feature_key_check via a new migration. */
export const ORGANIZATION_FEATURE_KEYS = ["rentals"] as const;

export type OrganizationFeatureKey = (typeof ORGANIZATION_FEATURE_KEYS)[number];

export function isOrganizationFeatureKey(value: unknown): value is OrganizationFeatureKey {
  return ORGANIZATION_FEATURE_KEYS.some((key) => key === value);
}
