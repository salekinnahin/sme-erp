import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side tenant context: the one place that resolves who the user is
 * and which organization they act in. Use it from Server Components,
 * Server Actions and Route Handlers. Never accept an organization ID from
 * the browser in place of this.
 *
 * Results are memoized per request with React `cache`, so calling these
 * helpers from several components costs one auth check and one query.
 */

export type Role = "owner" | "manager" | "employee";

export type Organization = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
};

export type TenantContext = {
  user: User;
  membershipId: string;
  role: Role;
  organization: Organization;
};

type MembershipRow = {
  id: string;
  role: Role;
  organization: Organization | null;
};

/** The authenticated user, verified with Supabase Auth, or null. */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  // getUser() validates the token with the Auth server. getSession() does not.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** The authenticated user. Redirects to sign-in if there is none. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/auth/login");
  return user;
}

/**
 * The user's active membership and organization, or null if they have none.
 * Throws on database errors, so a failed query never looks like "no
 * organization" (that would wrongly send members to onboarding).
 */
export const getTenant = cache(async (): Promise<TenantContext | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  // RLS also limits rows to the caller. The explicit user_id filter keeps
  // the query correct and indexed.
  const { data, error } = await supabase
    .from("organization_members")
    .select("id, role, organization:organizations (id, name, currency, timezone)")
    .eq("user_id", user.id)
    .eq("status", "active")
    // Version 1 allows one organization per user. Ordering makes the choice
    // deterministic if that changes later.
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<MembershipRow>();

  if (error) {
    throw new Error("Failed to load organization membership.", {
      cause: error,
    });
  }
  if (!data?.organization) return null;

  return {
    user,
    membershipId: data.id,
    role: data.role,
    organization: data.organization,
  };
});

/**
 * The full tenant context. Redirects to sign-in if the user is not
 * authenticated, or to onboarding if they have no active organization.
 */
export async function requireTenant(): Promise<TenantContext> {
  await requireUser();
  const tenant = await getTenant();
  if (!tenant) redirect("/onboarding/organization");
  return tenant;
}
