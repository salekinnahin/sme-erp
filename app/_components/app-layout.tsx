import { Suspense } from "react";
import { requireTenant } from "@/lib/tenancy/context";
import { getOrganizationBranding } from "@/lib/organizations/branding";
import { signOut } from "@/app/auth/actions";
import { AppFrame } from "./app-frame";
import { LogoutButton } from "./logout-button";
import { PageSkeleton } from "./ui";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageSkeleton />}>
    <Workspace>{children}</Workspace>
  </Suspense>;
}
async function Workspace({ children }: { children: React.ReactNode }) {
  const tenant = await requireTenant();
  const branding = await getOrganizationBranding(tenant);
  // No optional module has a route yet, so no entitlement query is needed for navigation.
  return <AppFrame identity={{ organizationName: tenant.organization.name, logoUrl: branding.logoUrl, email: tenant.user.email ?? "", role: tenant.role }} signOutControl={<form action={signOut}>
    <LogoutButton />
  </form>}>{children}</AppFrame>;
}
